#!/usr/bin/env node
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve, dirname, relative} from 'node:path';
import {createHash} from 'node:crypto';
import {halfToFloat} from './fixture.mjs';
import {decodeCanvasPNG} from './png-rgba.mjs';

const args = process.argv.slice(2), option = (name, fallback) => {const i = args.indexOf(name);return i < 0 ? fallback : args[i + 1];};
const root = resolve(import.meta.dirname, '../..');
const beforeDir = resolve(root, option('--before', 'artifacts/engine-compare/reflection-before'));
const afterDir = resolve(root, option('--after', 'artifacts/engine-compare/reflection-after'));
const output = resolve(root, option('--output', 'artifacts/engine-compare/reflection-comparison'));
const title = option('--title', 'Engine planar reflection optimization');
const description = option('--description', 'GPU-driven reflection culling + indirect instancing shares the main 40-float source buffer. Same shader lighting, plane clip, materials, 62.5% resolution and postprocessing.');
const provenance = option('--provenance', 'Executed program is the recorded distSha256. Baseline worktree source hash includes edits staged in files before rebuilding; it is not the source revision of the older compiled baseline.');
const before = JSON.parse(await readFile(resolve(beforeDir, 'report.json'), 'utf8'));
const after = JSON.parse(await readFile(resolve(afterDir, 'report.json'), 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const same = (a, b, label) => {if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error('Comparison mismatch: ' + label);};
for (const report of [before, after]) {
  if (report.status !== 'completed' || !report.sceneInputsMatched || !report.visualQuality) throw new Error('Completed measured runs and full quality captures required');
  if (report.controls.backends.length !== 1 || report.controls.backends[0] !== 'engine') throw new Error('This comparison requires engine-only reports');
  if (report.results.some(run => run.timestampCoverage < .95 || run.replayHash !== run.afterHash || run.measured.errors?.length)) throw new Error('Invalid GPU/replay evidence');
}
same(before.controls, after.controls, 'measurement controls');
same(before.browser.product, after.browser.product, 'browser version');
same(before.results[0].adapter, after.results[0].adapter, 'native hardware');
same(before.sourceState.harnessSha256, after.sourceState.harnessSha256, 'measured harness');
const envelopes = new Map(), benchmarkImages = [];
for (const count of before.controls.counts) {
  const images = before.results.filter(run => run.count === count), decoded = images.map(async run => decodeCanvasPNG(await readFile(resolve(beforeDir, run.image))));
  const pixels = await Promise.all(decoded), minimum = Buffer.from(pixels[0].pixels), maximum = Buffer.from(minimum);
  for (const image of pixels) {
    same(image.width, before.controls.width, 'baseline PNG width');same(image.height, before.controls.height, 'baseline PNG height');
    for (let n = 0; n < minimum.length; n++) {minimum[n] = Math.min(minimum[n], image.pixels[n]);maximum[n] = Math.max(maximum[n], image.pixels[n]);}
  }
  let varyingChannels = 0, maximumVariation = 0;
  for (let n = 0; n < minimum.length; n++) {const variation = maximum[n] - minimum[n];if (variation) varyingChannels++;maximumVariation = Math.max(maximumVariation, variation);}
  envelopes.set(count, {minimum, maximum, captures: images.length, varyingChannels, maximumVariation});
}
for (const run of before.results) {
  const peer = after.results.find(item => item.count === run.count && item.scenario === run.scenario && item.repetition === run.repetition);
  if (!peer) throw new Error('Missing paired case');
  for (const field of ['sourceHash', 'replayHash', 'geometryHash', 'environmentHash', 'adapter']) same(run[field], peer[field], field);
  const x = decodeCanvasPNG(await readFile(resolve(beforeDir, run.image))), y = decodeCanvasPNG(await readFile(resolve(afterDir, peer.image))), envelope = envelopes.get(run.count);
  same([x.width, x.height], [y.width, y.height], 'paired PNG extent');
  let changedChannels = 0, maxError = 0, outsideBaselineRange = 0;const coordinates=[];
  for (let n = 0; n < x.pixels.length; n++) {
    const error = Math.abs(x.pixels[n] - y.pixels[n]);if (error) changedChannels++;maxError = Math.max(maxError, error);
    if (y.pixels[n] < envelope.minimum[n] || y.pixels[n] > envelope.maximum[n]) {
      outsideBaselineRange++;
      if(coordinates.length<12)coordinates.push({x:Math.floor(n/4)%x.width,y:Math.floor(n/4/x.width),channel:n%4,before:x.pixels[n],after:y.pixels[n],baselineMinimum:envelope.minimum[n],baselineMaximum:envelope.maximum[n]});
    }
  }
  benchmarkImages.push({count: run.count, scenario: run.scenario, repetition: run.repetition, comparedChannels: x.pixels.length, changedChannels, maxError, outsideBaselineRange,coordinates,baselineCaptures: envelope.captures, baselineVaryingChannels: envelope.varyingChannels, baselineMaxVariation: envelope.maximumVariation});
}
const qa = before.visualQuality, qb = after.visualQuality;
for (const field of ['mode', 'sourceHash', 'textureHash', 'replayHash', 'afterHash', 'adapter', 'width', 'height']) same(qa[field], qb[field], 'quality ' + field);
same(qa.captures.length, qb.captures.length, 'quality view count');
const quality = [];
for (const a of qa.captures) {
  const b = qb.captures.find(capture => capture.name === a.name);if (!b) throw new Error('Missing quality view');
  for (const field of ['camera', 'width', 'height', 'reflectionWidth', 'reflectionHeight']) same(a[field], b[field], a.name + ' ' + field);
  const presentationA = await readFile(resolve(beforeDir, a.rgba8File)), presentationB = await readFile(resolve(afterDir, b.rgba8File));
  const reflectionA = await readFile(resolve(beforeDir, a.reflectionRgba16fFile)), reflectionB = await readFile(resolve(afterDir, b.reflectionRgba16fFile));
  same(presentationA.length, a.width * a.height * 4, 'RGBA8 extent');same(presentationB.length, presentationA.length, 'paired RGBA8 extent');
  same(reflectionA.length, a.reflectionWidth * a.reflectionHeight * 8, 'HDR extent');same(reflectionB.length, reflectionA.length, 'paired HDR extent');
  same(sha(presentationA), a.pixelHash, 'stored presentation hash');same(sha(presentationB), b.pixelHash, 'stored paired presentation hash');
  same(sha(reflectionA), a.reflectionHash, 'stored reflection hash');same(sha(reflectionB), b.reflectionHash, 'stored paired reflection hash');
  let pixelChangedChannels = 0, pixelMaxError = 0, reflectionChangedChannels = 0, reflectionMaxError = 0;
  for (let n = 0; n < presentationA.length; n++) {const error = Math.abs(presentationA[n] - presentationB[n]);if (error) pixelChangedChannels++;pixelMaxError = Math.max(pixelMaxError, error);}
  for (let n = 0; n < reflectionA.length; n += 2) {
    const x = halfToFloat(reflectionA.readUInt16LE(n)), y = halfToFloat(reflectionB.readUInt16LE(n));
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Non-finite HDR capture');
    const error = Math.abs(x - y);if (error) reflectionChangedChannels++;reflectionMaxError = Math.max(reflectionMaxError, error);
  }
  if (pixelChangedChannels || reflectionChangedChannels) throw new Error('Exact image gate failed: ' + a.name + ' ' + JSON.stringify({pixelChangedChannels, pixelMaxError, reflectionChangedChannels, reflectionMaxError}));
  quality.push({name: a.name, camera: a.camera, width: a.width, height: a.height, reflectionWidth: a.reflectionWidth, reflectionHeight: a.reflectionHeight,
    pixelChannels: presentationA.length, pixelChangedChannels, pixelMaxError, reflectionChannels: reflectionA.length / 2, reflectionChangedChannels, reflectionMaxError,
    pixelHash: a.pixelHash, reflectionHash: a.reflectionHash, beforeImage: resolve(beforeDir, a.pngFile), afterImage: resolve(afterDir, b.pngFile), beforeReflection: resolve(beforeDir, a.reflectionPngFile), afterReflection: resolve(afterDir, b.reflectionPngFile)});
}
const rows = before.aggregates.map(a => {
  const b = after.aggregates.find(item => item.count === a.count && item.scenario === a.scenario);
  if (!b) throw new Error('Missing aggregate');
  const passRuns = (report, label) => report.results.filter(run => run.count === a.count && run.scenario === a.scenario).map(run => run.gpuPasses['render:' + label]);
  return {count: a.count, scenario: a.scenario, before: a, after: b,
    reflectionDrawsBefore: passRuns(before, 'render.reflection').map(pass => pass.drawCalls.mean), reflectionDrawsAfter: passRuns(after, 'render.reflection').map(pass => pass.drawCalls.mean),
    cpuP95ReductionPercent: 100 * (1 - b.cpuMs.p95 / a.cpuMs.p95), fpsGainPercent: 100 * (b.fps / a.fps - 1),
    uploadDeltaBytesPerFrame: b.uploadBytes.mean - a.uploadBytes.mean};
});
const evidence = {version: 1, status: 'completed', beforeRun: before.runId, afterRun: after.runId, controls: after.controls, adapter: after.results[0].adapter, browser: after.browser.product,
  title, description,
  beforeSourceState: before.sourceState, afterSourceState: after.sourceState,
  programProvenance: provenance,
  methodology: 'Three sequential before repetitions, then three after repetitions. Same native GPU, controls, compiled fixture, physics and pixels. GPU clock/load can vary; headless RAF is not a display/VSync measurement.',
  sceneInputsMatched: true, physicalReplayMatched: true, pixelGatePassed:benchmarkImages.every(image=>image.outsideBaselineRange===0),canonicalBenchmarkPixelsWithinBaselineRepeatRange:benchmarkImages.every(image=>image.outsideBaselineRange===0), benchmarkImages, presentationAndReflectionPixelsExactlyMatched: true,
  pixelsInspectedPerView: 'Wet fixture: all RGBA8 presentation and all finite rgba16float reflection texels, exact gate. Benchmark: all decoded PNG channels must be within the observed before-run repeat range at that pixel/channel, without a fixed tolerance.',
  frameBudgetPassed: after.aggregates.every(row => row.frameBudgetPassed), rows, quality};
await mkdir(output, {recursive: true});await writeFile(resolve(output, 'report.json'), JSON.stringify(evidence, null, 2));
const fmt = n => n.toFixed(2), link = path => relative(output, path).replaceAll('\\', '/'), escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const metricRows = rows.map(row => `<tr><td>${row.count}</td><td>${escape(row.scenario)}</td><td>${fmt(row.before.cpuMs.p95)} → ${fmt(row.after.cpuMs.p95)}</td><td>${fmt(row.before.gpuMs.p95)} → ${fmt(row.after.gpuMs.p95)}</td><td>${fmt(row.before.frameIntervalMs.p95)} → ${fmt(row.after.frameIntervalMs.p95)}</td><td>${fmt(row.before.fps)} → ${fmt(row.after.fps)}</td><td>${Math.round(row.before.drawCalls.mean)} → ${Math.round(row.after.drawCalls.mean)}</td><td>${row.after.frameBudgetPassed ? 'PASS' : 'FAIL'}</td></tr>`).join('');
const gallery = quality.map(view => `<section><h2>${escape(view.name)} — native final image</h2><p>${view.width}×${view.height}; ${view.pixelChannels.toLocaleString('en')} channels compared; zero changes.</p><div class="pair"><figure><figcaption>Before</figcaption><a href="${escape(link(view.beforeImage))}"><img src="${escape(link(view.beforeImage))}" alt="Before ${escape(view.name)}"></a></figure><figure><figcaption>After</figcaption><a href="${escape(link(view.afterImage))}"><img src="${escape(link(view.afterImage))}" alt="After ${escape(view.name)}"></a></figure></div><h3>Planar reflection target</h3><p>${view.reflectionWidth}×${view.reflectionHeight} linear HDR; ${view.reflectionChannels.toLocaleString('en')} channels compared; zero changes. Preview uses fixed Reinhard + sRGB for inspection.</p><div class="pair"><figure><figcaption>Before</figcaption><img src="${escape(link(view.beforeReflection))}" alt="Before reflected geometry"></figure><figure><figcaption>After</figcaption><img src="${escape(link(view.afterReflection))}" alt="After reflected geometry"></figure></div></section>`).join('');
await writeFile(resolve(output, 'report.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(title)}</title><style>body{margin:0 auto;max-width:1500px;padding:28px;font:16px/1.5 system-ui;background:#101820;color:#e9eff5}h1,h2,h3{line-height:1.25}table{width:100%;border-collapse:collapse}td,th{padding:10px;border-bottom:1px solid #3a4753;text-align:left}th{color:#a9cfed}.scroll{overflow:auto}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}figure{margin:0}img{display:block;width:100%;height:auto}figcaption{padding:8px 0;color:#b6c7d7}section{padding:22px 0;border-top:1px solid #3a4753}a{color:#90cfff}code{word-break:break-all}@media(max-width:700px){.pair{grid-template-columns:1fr}body{padding:14px}}</style><h1>${escape(title)}</h1><p>${escape(description)}</p><p>${escape(evidence.browser)} · ${escape(JSON.stringify(evidence.adapter))} · ${after.controls.repetitions} repetitions × ${after.controls.frames} measured frames per case.</p><div class="scroll"><table><thead><tr><th>Cubes</th><th>Camera</th><th>CPU p95 ms</th><th>GPU p95 ms</th><th>Frame p95 ms</th><th>Mean FPS</th><th>All-pass draws</th><th>60 p95 gate</th></tr></thead><tbody>${metricRows}</tbody></table></div><p>${escape(evidence.methodology)} Completed execution does not turn a failed frame budget into a successful quality/performance gate.</p><p>All paired source, geometry, environment and physical replay hashes match. Canonical pixel gate: ${evidence.pixelGatePassed ? 'PASS' : 'FAIL'}. ${benchmarkImages.reduce((sum, image) => sum + image.outsideBaselineRange, 0)} channels lie outside the observed before-run repeat range. ${benchmarkImages.filter(image => image.changedChannels).length} of ${benchmarkImages.length} paired images differ in ${benchmarkImages.reduce((sum, image) => sum + image.changedChannels, 0)} channels by at most ${Math.max(...benchmarkImages.map(image => image.maxError))}/255; ${evidence.pixelGatePassed ? 'These values already varied between baseline captures.' : 'The strict pixel gate remains failed. Completing the measurement does not waive this mismatch.'} The separate wet-surface views below match every presentation and HDR reflection pixel exactly. Transparent glass, authored vertex colors, emission, textured objects, labels and water fields remain visible.</p>${gallery}<details><summary>Evidence and source/build fingerprints</summary><pre>${escape(JSON.stringify(evidence, null, 2))}</pre></details><p><a href="report.json">Machine-readable evidence</a></p></html>`);
const evidencePath = option('--evidence');
if (evidencePath) {const file = resolve(root, evidencePath);await mkdir(dirname(file), {recursive: true});const portable = {...evidence, quality: quality.map(view => ({...view, beforeImage: relative(root, view.beforeImage).replaceAll('\\', '/'), afterImage: relative(root, view.afterImage).replaceAll('\\', '/'), beforeReflection: relative(root, view.beforeReflection).replaceAll('\\', '/'), afterReflection: relative(root, view.afterReflection).replaceAll('\\', '/')}))};await writeFile(file, JSON.stringify(portable, null, 2));}
console.log(JSON.stringify({report: resolve(output, 'report.html'), pixelGatePassed:evidence.pixelGatePassed,frameBudgetPassed: evidence.frameBudgetPassed, rows: rows.map(({count, scenario, before, after}) => ({count, scenario, cpu: [before.cpuMs.p95, after.cpuMs.p95], gpu: [before.gpuMs.p95, after.gpuMs.p95], frame: [before.frameIntervalMs.p95, after.frameIntervalMs.p95], fps: [before.fps, after.fps]}))}));
if (!evidence.pixelGatePassed||(args.includes('--check-budget') && !evidence.frameBudgetPassed)) process.exitCode = 1;
