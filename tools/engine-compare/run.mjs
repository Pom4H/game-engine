#!/usr/bin/env node
// Copied into pinned upstream/tools/rom4-run.mjs. Its host.html + Sim3D +
// fixed-tick measurement loop remain unchanged.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {cpus, totalmem, platform, release} from 'node:os';
import {mkdir, writeFile, readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {startServer} from './serve.mjs';

const SCENES = [
  'three-mesh-webgpu',
  'three-instanced-webgpu',
  'babylon-instances-webgpu',
  'babylon-thin-webgpu',
  'rom4-js',
  'rom4-rust',
  'rom4-js-baseline'
];
const LEVELS = [1000, 2000, 5000];
const REPEATS = process.argv.includes('--full') ? 3 : 1;
const OUTPUT = resolve('..');
const screenshotValidated = new Set();
const server = await startServer(8128);
let browser;
const report = {
  schema: 1,
  benchmark: 'webgl-engine-bench/cubes',
  upstreamCommit: '2785ce1d4a0afdfff88d4d1f6863de9427f831f5',
  sourceLicense: 'MIT',
  note: 'Identical seeded Sim3D and unit cubes; original checker atlas replaced by opaque white texture for every engine. Lighting implementations differ; exact cross-engine pixel equality is not asserted.',
  variants: SCENES, levels: LEVELS, repeats: REPEATS,
  host: {
    cpu: cpus()[0]?.model, logicalCores: cpus().length,
    ramGB: +(totalmem() / 2 ** 30).toFixed(2),
    os: platform() + ' ' + release(), node: process.version
  },
  browser: null, gpu: null, runs: [], screenshots: [], counts: [], failures: []
};
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}
async function save() {
  await mkdir(OUTPUT, {recursive: true});
  await writeFile(resolve(OUTPUT, 'results.json'), JSON.stringify(report, null, 2) + '\n');
}
async function navigate(page, scene, params) {
  const url = 'http://127.0.0.1:8128/host.html?test=cubes&scene=' +
    scene + '&' + new URLSearchParams(params);
  await page.goto(url, {waitUntil: 'load', timeout: 30000});
  await page.waitForFunction(() =>
    window.benchResult !== undefined || window.benchReady === true,
    null, {timeout: 180000});
  const result = await page.evaluate(() => window.benchResult ?? null);
  if (result?.error) throw new Error(scene + ': ' + result.error);
  return result;
}

try {
  browser = await chromium.launch({
    headless: true, channel: 'chrome',
    args: ['--enable-unsafe-webgpu', '--enable-gpu', '--disable-software-rasterizer']
  });
  report.browser = browser.version();
  const page = await browser.newPage({
    viewport: {width: 1400, height: 950}, deviceScaleFactor: 1
  });
  page.setDefaultTimeout(180000);
  await page.goto('http://127.0.0.1:8128/index.html');
  report.gpu = await page.evaluate(async () => {
    if (!navigator.gpu) throw new Error('WebGPU unavailable');
    const adapter = await navigator.gpu.requestAdapter({powerPreference: 'high-performance'});
    if (!adapter) throw new Error('Hardware GPU adapter unavailable');
    const info = adapter.info ?? {};
    const details = {
      vendor: info.vendor, architecture: info.architecture,
      device: info.device, description: info.description,
      fallback: !!(adapter.isFallbackAdapter ?? info.isFallbackAdapter)
    };
    if (details.fallback ||
        /swiftshader|lavapipe|llvmpipe|software|basic render/i.test(JSON.stringify(details)))
      throw new Error('Software GPU adapter forbidden: ' + JSON.stringify(details));
    return details;
  });
  await save();
  for (const scene of SCENES) {
    try {
      await navigate(page, scene, {mode: 'shot', n: '2000', frames: '120'});
      const hasSize = await page.locator('#stage canvas').evaluateAll(
        canvases => canvases.some(canvas => canvas.width === 1280 && canvas.height === 720));
      assert.ok(hasSize, 'Not a 1280x720 backing canvas');
      const screenshot = await page.locator('#stage').screenshot({path: resolve(OUTPUT, scene + '.png')});
      // This scene has 2000 multicoloured cubes; blank WebGPU canvases compress
      // to ~4 KiB versus >150 KiB for a real image. Treat blanks as failures.
      assert.ok(screenshot.byteLength > 30000,
        'Blank/suspiciously empty 2000-cube frame: PNG bytes=' + screenshot.byteLength);
      screenshotValidated.add(scene);
      report.screenshots.push(scene);
      console.log('SCREENSHOT=' + scene);
    } catch (error) {
      report.failures.push({scene, phase: 'screenshot', error: String(error)});
      console.error('SCREENSHOT_FAIL=' + scene, error);
    }
    await save();
  }
  // Compare new instancing to the original per-object path at SAME tick,
  // same PBR shading, same scene. A speedup with a missing/dark image fails.
  if (screenshotValidated.has('rom4-js') && screenshotValidated.has('rom4-js-baseline')) {
    const [after, before] = await Promise.all([
      readFile(resolve(OUTPUT, 'rom4-js.png')),
      readFile(resolve(OUTPUT, 'rom4-js-baseline.png'))
    ]);
    const visual = await page.evaluate(async ({after, before}) => {
      const pixels = async str => {
        const bytes = Uint8Array.from(atob(str), x => x.charCodeAt(0));
        const bmp = await createImageBitmap(new Blob([bytes], {type:'image/png'}));
        const canvas = document.createElement('canvas');
        canvas.width = bmp.width; canvas.height = bmp.height;
        const ctx = canvas.getContext('2d', {willReadFrequently:true});
        ctx.drawImage(bmp,0,0);bmp.close();
        return {width:canvas.width,height:canvas.height,data:ctx.getImageData(0,0,canvas.width,canvas.height).data};
      };
      const a=await pixels(after),b=await pixels(before);
      if(a.width!==b.width||a.height!==b.height)throw new Error('Different screenshot dimensions');
      let diff=0,changed=0,max=0;
      for(let i=0;i<a.data.length;i+=4){
        let delta=0;
        for(let c=0;c<3;c++){
          const d=Math.abs(a.data[i+c]-b.data[i+c]);
          delta+=d;max=Math.max(max,d);
        }
        diff+=delta;
        if(delta>60)changed++;
      }
      return {
        size:[a.width,a.height],
        meanAbsoluteRgb8:diff/(a.width*a.height*3),
        pixelsWithRgbDeltaAbove60:changed,
        fractionSignificant:changed/(a.width*a.height),maxChannelDelta:max
      };
    },{after:after.toString('base64'),before:before.toString('base64')});
    report.visualParity=visual;
    console.log('VISUAL_PARITY='+JSON.stringify(visual));
    if(visual.meanAbsoluteRgb8>4 || visual.fractionSignificant>0.03)
      report.failures.push({phase:'visual-parity',error:'Instancing changed the rendered picture',...visual});
    await save();
  }
  for (const scene of SCENES) {
    if (!screenshotValidated.has(scene)) continue;
    try {
      const result = await navigate(page, scene, {
        mode: 'count', n: '2000', n2: '1000'
      });
      const counts = result?.counts;
      assert.equal(counts?.length, 2, 'Missing draw verification');
      assert.ok(counts[0].triangles >= 12 * 2000,
        'Missing drawn triangles at n=2000: ' + JSON.stringify(counts[0]));
      assert.ok(counts[1].triangles >= 12 * 1000,
        'Missing drawn triangles at n=1000: ' + JSON.stringify(counts[1]));
      assert.ok(counts[1].triangles < counts[0].triangles,
        'Drawn work did not decrease with object count');
      report.counts.push({scene, counts});
      console.log('COUNT=' + scene + ' ' + JSON.stringify(counts));
    } catch (error) {
      report.failures.push({scene, phase: 'count', error: String(error)});
      console.error('COUNT_FAIL=' + scene, error);
    }
    await save();
  }
  // Alternating order reduces heating/warm-cache effects.
  for (let rep = 0; rep < REPEATS; rep++) {
    for (const n of LEVELS) {
      const order = rep % 2 === 0 ? SCENES : [...SCENES].reverse();
      for (const scene of order) {
        if (!screenshotValidated.has(scene)) continue;
        try {
          const result = await navigate(page, scene, {
            mode: 'fixed', n: String(n), quick: '1'
          });
          assert.ok(result?.ref && result.ref.cpuMs > 0 &&
            result.ref.medianMs > 0 && result.ref.simMs >= 0,
          'No complete timing data');
          const run = {
            scene, n, repeat: rep, backend: 'webgpu',
            cpuRenderMs: result.ref.cpuMs,
            cpuSimulationMs: result.ref.simMs,
            frameIntervalMs: result.ref.medianMs,
            frameP95Ms: result.ref.p95Ms,
            fps: 1000 / result.ref.medianMs,
            refreshMs: result.env?.refreshMs,
            gpuMs: null
          };
          report.runs.push(run);
          console.log('BENCH=' + JSON.stringify(run));
        } catch (error) {
          report.failures.push({scene, n, repeat: rep,
            phase: 'timing', error: String(error)});
          console.error('BENCH_FAIL=' + scene + '@' + n, error);
        }
        await save();
      }
    }
  }
  // Diagnostic profiling is run AFTER all timed variants, never mixed into the
  // primary FPS/CPU results. It is another run of the same physics/render path.
  report.diagnostics = [];
  for (const scene of ['rom4-js','rom4-js-baseline']) {
    if (!screenshotValidated.has(scene)) continue;
    try {
      await navigate(page, scene, {mode:'fixed',n:'5000',quick:'1',diagnose:'1'});
      const probe = await page.evaluate(() => window.__ENGINE_BENCH_DIAGNOSTICS?.() ?? null);
      if (!probe?.profile?.cpuFrames) throw new Error('Renderer returned no CPU profiler samples');
      const result = {
        scene,n:5000,
        cpuStages:probe.profile.cpu,
        latestCpu:probe.profile.latestCpu,
        latestGpu:probe.profile.latestGpu,
        gpuTotal:probe.profile.gpuTotal,
        work:probe.profile.latestCpu?.work,
        inspected:probe.inspect
      };
      report.diagnostics.push(result);
      console.log('ROM4_DIAG='+JSON.stringify(result));
    } catch (error) {
      report.failures.push({scene,phase:'diagnostic',error:String(error)});
      console.error('ROM4_DIAG_FAIL='+scene,error);
    }
    await save();
  }
  report.summary = Object.fromEntries(SCENES.map(scene => [scene,
    Object.fromEntries(LEVELS.map(n => {
      const runs = report.runs.filter(run => run.scene === scene && run.n === n);
      return [n, runs.length ? {
        cpuRenderMs: median(runs.map(run => run.cpuRenderMs)),
        cpuSimulationMs: median(runs.map(run => run.cpuSimulationMs)),
        frameIntervalMs: median(runs.map(run => run.frameIntervalMs)),
        medianFps: median(runs.map(run => run.fps)),
        samples: runs.length
      } : null];
    }))]));
  // The upstream reference loop does NOT contain GPU timestamp queries.
  // Never synthesize GPU milliseconds from FPS or CPU measurements.
  await save();
  console.log('RESULTS=' + JSON.stringify(report.summary));
  if (report.failures.length) process.exitCode = 1;
} catch (error) {
  report.failures.push({phase: 'setup', error: String(error)});
  await save();
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.close();
}
