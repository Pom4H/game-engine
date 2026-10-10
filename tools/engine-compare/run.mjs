#!/usr/bin/env node
// Copied into pinned upstream tools/rom4-run.mjs; runs original Sim3D + harness.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { cpus, totalmem, platform, release } from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startServer } from './serve.mjs';

const SCENES = [
  'three-mesh-webgpu', 'three-instanced-webgpu',
  'babylon-instances-webgpu', 'babylon-thin-webgpu',
  'rom4-js', 'rom4-rust'
];
const LEVELS = [1000, 2000, 5000];
const REPEATS = process.argv.includes('--full') ? 3 : 1;
// The script runs from artifacts/engine-compare/upstream.
const OUTPUT = resolve('..');
const server = await startServer(8128);
let browser;
const report = {
  schema: 1, benchmark: 'webgl-engine-bench/cubes',
  upstreamCommit: '2785ce1d4a0afdfff88d4d1f6863de9427f831f5',
  sourceLicense: 'MIT',
  note: 'Original seeded Sim3D, fixed 60Hz/camera/cubes. Common opaque white texture. Different engine lighting; no strict inter-engine pixel equivalence asserted.',
  variants: SCENES, levels: LEVELS, repeats: REPEATS,
  host: { cpu: cpus()[0]?.model, logicalCores: cpus().length,
    ramGB: +(totalmem() / 2 ** 30).toFixed(2), os: platform() + ' ' + release(), node: process.version },
  browser: null, gpu: null, runs: [], failures: []
};
const percentile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(fraction * (sorted.length - 1))];
};
async function save() {
  await mkdir(OUTPUT, { recursive: true });
  await writeFile(resolve(OUTPUT, 'results.json'), JSON.stringify(report, null, 2) + '\n');
}
async function navigate(page, scene, params) {
  const url = 'http://127.0.0.1:8128/host.html?test=cubes&scene=' + scene + '&' +
    new URLSearchParams(params);
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() =>
    window.benchResult !== undefined || window.benchReady === true,
    null, { timeout: 180000 });
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
    viewport: { width: 1400, height: 950 }, deviceScaleFactor: 1
  });
  page.setDefaultTimeout(180000);
  // localhost is a secure context for navigator.gpu.
  await page.goto('http://127.0.0.1:8128/index.html');
  report.gpu = await page.evaluate(async () => {
    if (!navigator.gpu) throw new Error('Hardware WebGPU unavailable');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('WebGPU adapter unavailable');
    const info = adapter.info ?? {};
    const details = {
      vendor: info.vendor, architecture: info.architecture,
      device: info.device, description: info.description,
      fallback: !!(adapter.isFallbackAdapter ?? info.isFallbackAdapter)
    };
    if (details.fallback ||
        /swiftshader|lavapipe|llvmpipe|software|basic render/i.test(JSON.stringify(details)))
      throw new Error('Software GPU rejected: ' + JSON.stringify(details));
    return details;
  });
  await save();

  for (const scene of SCENES) {
    try {
      await navigate(page, scene, { mode: 'shot', n: '2000', frames: '120' });
      const canvas = await page.locator('#stage canvas').evaluateAll(cs =>
        cs.some(c => c.width === 1280 && c.height === 720));
      assert.ok(canvas, scene + ' did not render 1280x720 pixels');
      await page.locator('#stage').screenshot({
        path: resolve(OUTPUT, scene + '.png')
      });
      console.log('SCREENSHOT=' + scene);
    } catch (error) {
      report.failures.push({ scene, phase: 'screenshot', error: String(error) });
      console.error('SCREENSHOT_FAIL=' + scene, error);
    }
    await save();
  }

  for (let repeat = 0; repeat < REPEATS; repeat++)
    for (const n of LEVELS)
      for (const scene of repeat % 2 === 0 ? SCENES : [...SCENES].reverse()) {
        try {
          const result = await navigate(page, scene,
            { mode: 'fixed', n: String(n), quick: '1' });
          assert.ok(result?.ref && result.ref.cpuMs > 0 &&
            result.ref.medianMs > 0 && result.ref.simMs >= 0,
            'Timing unavailable: ' + scene + '@' + n);
          report.runs.push({
            scene, n, repeat, backend: 'webgpu',
            cpuRenderMs: result.ref.cpuMs,
            cpuSimulationMs: result.ref.simMs,
            frameIntervalMs: result.ref.medianMs,
            frameP95Ms: result.ref.p95Ms,
            fps: 1000 / result.ref.medianMs,
            refreshMs: result.env?.refreshMs,
            gpuMs: null
          });
          console.log('BENCH=' + JSON.stringify(report.runs.at(-1)));
        } catch (error) {
          report.failures.push({
            scene, n, repeat, phase: 'timing', error: String(error)
          });
          console.error('BENCH_FAIL=' + scene + '@' + n, error);
        }
        await save();
      }

  report.summary = Object.fromEntries(SCENES.map(scene => [scene,
    Object.fromEntries(LEVELS.map(n => {
      const runs = report.runs.filter(r => r.scene === scene && r.n === n);
      return [n, runs.length ? {
        cpuRenderMs: percentile(runs.map(r => r.cpuRenderMs), .5),
        cpuSimulationMs: percentile(runs.map(r => r.cpuSimulationMs), .5),
        frameIntervalMs: percentile(runs.map(r => r.frameIntervalMs), .5),
        medianFps: percentile(runs.map(r => r.fps), .5),
        samples: runs.length
      } : null];
    }))]));
  await save();
  console.log('RESULTS=' + JSON.stringify(report.summary));
  if (report.failures.length) process.exitCode = 1;
} catch (error) {
  report.failures.push({ phase: 'setup', error: String(error) });
  await save();
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.close();
}
