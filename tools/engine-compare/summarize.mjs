#!/usr/bin/env node
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';

const reportPath = resolve(process.env.COMPARE_OUTPUT ?? 'artifacts/engine-compare', 'report.json');
const report = JSON.parse(await readFile(reportPath, 'utf8'));
if (report.status !== 'completed') throw new Error('Only completed benchmark evidence can be summarized: ' + report.status);
const num = value => value.toFixed(2), escape = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const names = {engine: 'Engine', three: 'Three.js', babylon: 'Babylon.js'};
console.log('Identical scene inputs; native pipelines differ. ' + report.controls.width + '×' + report.controls.height + ', ' + report.controls.repetitions + ' repetitions.\n');
console.log('Cubes | Camera | Renderer | FPS | CPU p95 ms | GPU p95 ms | Frame p95 ms | Upload B/frame | Draws/frame\n--- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---:');
for (const row of report.aggregates) console.log([row.count, row.scenario, names[row.backend], num(row.fps), num(row.cpuMs.p95), num(row.gpuMs.p95), num(row.frameIntervalMs.p95), num(row.uploadBytes.mean), num(row.drawCalls.mean)].join(' | '));

const rows = report.aggregates.map(row => `<tr><td>${row.count.toLocaleString('en-US')}</td><td>${escape(row.scenario)}</td><td>${names[row.backend]}</td><td>${num(row.fps)}</td><td>${num(row.cpuMs.p95)}</td><td>${num(row.gpuMs.p95)}</td><td>${num(row.frameIntervalMs.p95)}</td><td>${num(row.uploadBytes.mean)}</td><td>${num(row.drawCalls.mean)}</td><td>${row.frameBudgetPassed ? 'pass' : 'fail'}</td></tr>`).join('');
const galleries = report.controls.counts.map(count => `<section><h2>${count.toLocaleString('en-US')} cubes · canonical camera</h2><div class="images">${report.controls.backends.map(backend => {
  const run = report.results.find(run => run.count === count && run.backend === backend);
  return `<figure><a href="${escape(run.image)}"><img src="${escape(run.image)}" alt="${names[backend]}: same scene and camera"></a><figcaption>${names[backend]} · ${escape(run.version)}${run.pipeline.visualLimitations?.length ? '<br><small>' + escape(run.pipeline.visualLimitations.join(' ')) + '</small>' : ''}</figcaption></figure>`;
}).join('')}</div></section>`).join('');
const pipelines = report.controls.backends.map(backend => {const pipeline = report.results.find(run => run.backend === backend).pipeline;return `<tr><th>${names[backend]}</th><td>${escape(pipeline.instances)}</td><td>${escape(pipeline.antiAliasing)}</td><td>${escape(pipeline.effects.join(', '))}</td><td>${escape(pipeline.shadows)}</td></tr>`;}).join('');
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Native WebGPU · engine / Three / Babylon</title>
<style>body{font:15px/1.6 system-ui,sans-serif;background:#101722;color:#e9edf4;margin:0;padding:32px}main{max-width:1500px;margin:auto}h1{font-size:30px;line-height:1.2}h2{font-size:20px;margin-top:32px}p{max-width:1050px;color:#b6c3d6}.note{border-left:4px solid #e5b668;padding:12px 18px;background:#202735;color:#f0d8b3}table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:right;padding:10px 12px;border-bottom:1px solid #334155}td:nth-child(-n+3),th{text-align:left}thead{background:#202d40}.scroll{overflow:auto}.images{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}figure{margin:0}img{display:block;width:100%;border:1px solid #34445d;border-radius:6px}figcaption{padding:8px 0;color:#bdccdf}a{color:#9dccff}pre{white-space:pre-wrap;color:#bdd0e5;background:#172130;padding:16px;border-radius:6px}details{margin-top:20px}small{color:#9aaec8}@media(max-width:800px){body{padding:16px}.images{grid-template-columns:1fr}}</style>
<main><h1>Engine / Three.js / Babylon.js</h1><p>${escape(report.completedAt)} · ${report.controls.width}×${report.controls.height} · ${report.controls.repetitions} rotated-order repetitions · ${report.controls.warmup} warmup + ${report.controls.frames} measured frames per run · native ${escape(report.results[0].adapter.vendor)} ${escape(report.results[0].adapter.architecture)} · ${escape(report.browser.product)}</p>
<p class="note">Identical geometry, transforms, colors, lights, camera, radiance input and frozen physical state. Native shading and postprocessing differ. Equal pixel quality is not established; these numbers compare the recorded pipelines.</p>
<div class="scroll"><table><thead><tr><th>Cubes</th><th>Camera</th><th>Renderer</th><th>FPS</th><th>CPU p95 ms</th><th>GPU p95 ms</th><th>Frame p95 ms</th><th>Upload B/frame</th><th>Draws/frame</th><th>60 FPS p95</th></tr></thead><tbody>${rows}</tbody></table></div>
<p>FPS = 1,000 / mean RAF interval, with native headless scheduling. GPU time sums render/compute pass timestamps; copy commands and queue gaps are excluded. Common timestamp hooks apply to every renderer. Uploads count requested queue payloads. Draws include shadow/reflection passes and cached bundles; indirect triangle counts are excluded. <a href="report.json">Full numerical evidence and raw samples</a>.</p>
${galleries}<h2>Recorded pipeline features</h2><div class="scroll"><table><thead><tr><th>Renderer</th><th>Instances</th><th>AA</th><th>Effects</th><th>Shadows</th></tr></thead><tbody>${pipelines}</tbody></table></div>
<p>Point-light attenuation, IBL prefiltering, atmosphere, tone mapping and shadow filtering use each renderer's implementation. Shared materials use engine linearized colors and the same roughness/metalness values.</p>
<details><summary>Controls, correctness and source fingerprints</summary><pre>${escape(JSON.stringify({controls: report.controls, methodology: report.methodology, sourceState: report.sourceState, pixelComparisons: report.pixelComparisons, audits: report.results.map(run => ({backend: run.backend, count: run.count, scenario: run.scenario, repetition: run.repetition, audit: run.audit, timestampCoverage: run.timestampCoverage, sourceHash: run.sourceHash, replayHash: run.replayHash, geometryHash: run.geometryHash, environmentHash: run.environmentHash}))}, null, 2))}</pre></details>
<small>Local benchmark evidence. No CI-success claim. Peer versions: Three ${escape(report.libraries.three.version)} / Babylon ${escape(report.libraries.babylon.version)}.</small></main></html>`;
await writeFile(resolve(dirname(reportPath), 'report.html'), html);
const evidenceIndex = process.argv.indexOf('--evidence');
if (evidenceIndex !== -1) {
  if (!process.argv[evidenceIndex + 1]) throw new Error('Missing --evidence path');
  const path = resolve(process.argv[evidenceIndex + 1]);await mkdir(dirname(path), {recursive: true});
  const compact = {...report, fullEvidence: reportPath, review: resolve(dirname(reportPath), 'report.html'), results: report.results.map(({raw, pixelSamples, ...run}) => run)};
  await writeFile(path, JSON.stringify(compact, null, 2) + '\n');
  console.log('\nCompact evidence: ' + path);
}
console.log('\nReview: ' + resolve(dirname(reportPath), 'report.html'));
if (process.argv.includes('--check-budget') && report.aggregates.some(row => !row.frameBudgetPassed)) process.exitCode = 1;
