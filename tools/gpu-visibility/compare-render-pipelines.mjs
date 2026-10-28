#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,relative,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {decodeCanvasPNG} from '../engine-compare/png-rgba.mjs';
import {halfToFloat} from '../engine-compare/fixture.mjs';
import {auditProfile} from '../engine-compare/profiles.mjs';

const root=resolve(import.meta.dirname,'../..'),args=process.argv.slice(2);
const option=(name,fallback)=>{const i=args.indexOf(name);if(i<0)return fallback;if(!args[i+1]||args[i+1].startsWith('--'))throw new Error('Missing '+name);return args[i+1];};
const beforeDir=resolve(root,option('--before','artifacts/engine-compare/current-native'));
const nativeDir=resolve(root,option('--native','artifacts/engine-compare/pipeline-native'));
const commonDir=resolve(root,option('--common','artifacts/engine-compare/pipeline-common-post'));
const output=resolve(root,option('--output','artifacts/engine-compare/pipeline-comparison'));
const previousCommonPath=option('--previous-common');
const previousCommonDir=previousCommonPath?resolve(root,previousCommonPath):null;
const load=async dir=>JSON.parse(await readFile(resolve(dir,'report.json'),'utf8'));
const [before,native,common]=await Promise.all([load(beforeDir),load(nativeDir),load(commonDir)]);
const contentionPath=option('--contention');
const contention=contentionPath?JSON.parse(await readFile(resolve(root,contentionPath),'utf8')):null;
const sha=data=>createHash('sha256').update(data).digest('hex');
const match=(a,b,label)=>assert.deepEqual(a,b,label);
const controls=report=>({...report.controls,profile:undefined});
match(before.controls.profile??'native','native','Baseline profile');match(native.controls.profile,'native','Default after profile');match(common.controls.profile,'common-post','Common postprocessing profile');
for(const report of [before,native,common]){
 assert.equal(report.status,'completed');assert.equal(report.sceneInputsMatched,true);assert.equal(report.equalPixelQualityEstablished,false);
 match(report.controls.backends,['engine','three','babylon'],'Three actual WebGPU implementations required');
 assert.ok(report.controls.repetitions>=3&&report.controls.frames>=240&&report.controls.warmup>=48,'Measured repetitions required');
 match(controls(report),controls(native),'Measurement controls');match(report.browser.product,native.browser.product,'Native browser');
 assert.equal(report.results.length,report.controls.counts.length*report.controls.scenarios.length*report.controls.backends.length*report.controls.repetitions);
 for(const run of report.results){
  match(run.adapter,native.results[0].adapter,'Native GPU');assert.ok(run.timestampCoverage>=.95);assert.equal(run.replayHash,run.afterHash);assert.equal(run.measured.errors?.length??0,0);
  const reference=native.results.find(r=>r.count===run.count&&r.scenario===run.scenario&&r.backend===run.backend&&r.repetition===run.repetition);assert.ok(reference,'Paired measured case');
  for(const key of ['sourceHash','geometryHash','environmentHash','replayHash','audit'])match(run[key],reference[key],key);
  auditProfile(report.controls.profile??'native',run.backend,run.measured,run.gpuPasses);
 }
}
for(const key of ['srcSha256','distSha256','harnessSha256'])match(native.sourceState[key],common.sourceState[key],'Same changed program: '+key);
const rasterTargets=[];
for(const report of [native,common])for(const run of report.results.filter(r=>r.backend==='engine')){
 const targets=run.measured.renderTargets;
 if(!targets)continue; // Historical reports predate actual target introspection.
 const reduced=report===common;
 match(run.measured.pipeline.colorTargets,reduced?['rgba16float',null,null,null]:['rgba16float','rgba16float','rgba8unorm','rg16float'],'Executed material targets');
 for(const key of ['normal','specular','velocity','effects','taaA','taaB','bloomA','bloomB','reflectionDepth'])assert.equal(!!targets[key],!reduced,'Actual target '+key);
 if(reduced)match(targets.reflection,{width:1,height:1,format:'rgba16float'},'Fixed material layout placeholder');
 rasterTargets.push({profile:report.controls.profile,count:run.count,scenario:run.scenario,repetition:run.repetition,targets,
  omittedAuxiliaryBytes:reduced?report.controls.width*report.controls.height*(8+4+4):0});
}
// The raster-only change has its own same-profile pixel gate. It cannot inherit
// the full default renderer's quality result or a cross-engine quality claim.
let rasterComparison=null;
if(previousCommonDir){
 const previous=await load(previousCommonDir);
 match(previous.status,'completed','Previous common report');match(previous.controls,common.controls,'Same reduced profile controls');
 match(previous.browser.product,common.browser.product,'Same reduced profile browser');
 match(previous.sourceState.harnessSha256,common.sourceState.harnessSha256,'Unchanged measured harness');
 match(previous.results.length,common.results.length,'Same reduced profile cases');
 const pixels=[];
 for(const count of common.controls.counts){
  const oldRuns=previous.results.filter(r=>r.backend==='engine'&&r.count===count);
  const decoded=await Promise.all(oldRuns.map(async r=>decodeCanvasPNG(await readFile(resolve(previousCommonDir,r.image)))));
  const minimum=Buffer.from(decoded[0].pixels),maximum=Buffer.from(minimum);
  for(const image of decoded){match([image.width,image.height],[common.controls.width,common.controls.height],'Reduced PNG extent');for(let n=0;n<minimum.length;n++){minimum[n]=Math.min(minimum[n],image.pixels[n]);maximum[n]=Math.max(maximum[n],image.pixels[n]);}}
  let baselineVaryingChannels=0;for(let n=0;n<minimum.length;n++)if(minimum[n]!==maximum[n])baselineVaryingChannels++;
  for(const run of common.results.filter(r=>r.backend==='engine'&&r.count===count)){
   const old=previous.results.find(r=>r.backend===run.backend&&r.count===run.count&&r.scenario===run.scenario&&r.repetition===run.repetition);assert.ok(old);
   for(const key of ['sourceHash','geometryHash','environmentHash','replayHash','afterHash','adapter','audit'])match(old[key],run[key],'Reduced '+key);
   auditProfile('common-post','engine',old.measured,old.gpuPasses);
   const a=decodeCanvasPNG(await readFile(resolve(previousCommonDir,old.image))),b=decodeCanvasPNG(await readFile(resolve(commonDir,run.image)));
   match([a.width,a.height],[b.width,b.height],'Reduced paired PNG extent');let changedChannels=0,maxError=0,outsideBaselineRange=0;const coordinates=[];
   for(let n=0;n<a.pixels.length;n++){
    const error=Math.abs(a.pixels[n]-b.pixels[n]);if(error)changedChannels++;maxError=Math.max(maxError,error);
    if(b.pixels[n]<minimum[n]||b.pixels[n]>maximum[n]){outsideBaselineRange++;if(coordinates.length<12)coordinates.push({x:Math.floor(n/4)%a.width,y:Math.floor(n/4/a.width),channel:n%4,before:a.pixels[n],after:b.pixels[n],minimum:minimum[n],maximum:maximum[n]});}
   }
   pixels.push({count,scenario:run.scenario,repetition:run.repetition,changedChannels,maxError,outsideBaselineRange,coordinates,baselineCaptures:oldRuns.length,baselineVaryingChannels});
  }
 }
 rasterComparison={before:{runId:previous.runId,sourceState:previous.sourceState,report:relative(root,previousCommonDir).replaceAll('\\','/'),aggregates:previous.aggregates},afterRunId:common.runId,pixels,
  interpretation:'Same common-post profile and measured harness before/after removing unused normal/specular/velocity attachments. Every channel is decoded; only the observed before repeat range is accepted. Performance remains a sequential local comparison, not a cross-engine quality claim.'};
}
const envelopes=new Map(),benchmarkPixels=[];
for(const count of before.controls.counts){
 const runs=before.results.filter(r=>r.backend==='engine'&&r.count===count),decoded=await Promise.all(runs.map(async r=>decodeCanvasPNG(await readFile(resolve(beforeDir,r.image)))));
 const minimum=Buffer.from(decoded[0].pixels),maximum=Buffer.from(minimum);
 for(const image of decoded){match([image.width,image.height],[before.controls.width,before.controls.height],'PNG extent');for(let n=0;n<minimum.length;n++){minimum[n]=Math.min(minimum[n],image.pixels[n]);maximum[n]=Math.max(maximum[n],image.pixels[n]);}}
 let varyingChannels=0;for(let n=0;n<minimum.length;n++)if(minimum[n]!==maximum[n])varyingChannels++;
 envelopes.set(count,{minimum,maximum,captures:runs.length,varyingChannels});
}
for(const run of native.results.filter(r=>r.backend==='engine')){
 const reference=before.results.find(r=>r.backend==='engine'&&r.count===run.count&&r.scenario===run.scenario&&r.repetition===run.repetition);
 const a=decodeCanvasPNG(await readFile(resolve(beforeDir,reference.image))),b=decodeCanvasPNG(await readFile(resolve(nativeDir,run.image))),envelope=envelopes.get(run.count);
 match([a.width,a.height],[b.width,b.height],'Paired PNG extent');let changedChannels=0,maxError=0,outsideBaselineRange=0;const coordinates=[];
 for(let n=0;n<a.pixels.length;n++){
  const error=Math.abs(a.pixels[n]-b.pixels[n]);if(error)changedChannels++;maxError=Math.max(maxError,error);
  if(b.pixels[n]<envelope.minimum[n]||b.pixels[n]>envelope.maximum[n]){outsideBaselineRange++;if(coordinates.length<12)coordinates.push({x:Math.floor(n/4)%a.width,y:Math.floor(n/4/a.width),channel:n%4,before:a.pixels[n],after:b.pixels[n],minimum:envelope.minimum[n],maximum:envelope.maximum[n]});}
 }
 benchmarkPixels.push({count:run.count,scenario:run.scenario,repetition:run.repetition,comparedChannels:a.pixels.length,changedChannels,maxError,outsideBaselineRange,coordinates,baselineCaptures:envelope.captures,baselineVaryingChannels:envelope.varyingChannels});
}
const quality=[];
for(const report of [native,common]){
 const a=before.visualQuality,b=report.visualQuality;assert.ok(a&&b,'Full default-engine quality captures required');
 for(const key of ['mode','sourceHash','textureHash','replayHash','afterHash','adapter','width','height'])match(a[key],b[key],'Wet fixture '+key);
 match(a.captures.length,b.captures.length,'Wet view count');
 const dir=report===native?nativeDir:commonDir;
 for(const view of a.captures){
  const peer=b.captures.find(v=>v.name===view.name);assert.ok(peer);
  for(const key of ['camera','width','height','reflectionWidth','reflectionHeight'])match(view[key],peer[key],key);
  const data={name:view.name,run:report.runId,presentationChannels:view.width*view.height*4,reflectionChannels:view.reflectionWidth*view.reflectionHeight*4,changedPresentationChannels:0,changedReflectionChannels:0,maxPresentationError:0,maxReflectionError:0};
  for(const [key,hashKey,bytes] of [['rgba8File','pixelHash',data.presentationChannels],['reflectionRgba16fFile','reflectionHash',data.reflectionChannels*2]]){
   const x=await readFile(resolve(beforeDir,view[key])),y=await readFile(resolve(dir,peer[key]));match(x.length,bytes,'Stored buffer extent');match(y.length,bytes,'Stored paired buffer extent');match(sha(x),view[hashKey],'Baseline hash');match(sha(y),peer[hashKey],'Paired hash');
   if(key==='reflectionRgba16fFile'){
    for(let n=0;n<x.length;n+=2){const v=halfToFloat(x.readUInt16LE(n)),w=halfToFloat(y.readUInt16LE(n));assert.ok(Number.isFinite(v)&&Number.isFinite(w),'Finite linear radiance');const error=Math.abs(v-w);if(error)data.changedReflectionChannels++;data.maxReflectionError=Math.max(data.maxReflectionError,error);}
   }else for(let n=0;n<x.length;n++){const error=Math.abs(x[n]-y[n]);if(error)data.changedPresentationChannels++;data.maxPresentationError=Math.max(data.maxPresentationError,error);}
  }
  quality.push(data);
 }
}
const names={engine:'Engine',three:'Three.js',babylon:'Babylon.js'},portable=path=>relative(root,path).replaceAll('\\','/');
const rows=[native,common].flatMap(report=>report.aggregates.map(row=>({...row,profile:report.controls.profile})));
const gates={canonicalDefaultPixels:benchmarkPixels.every(v=>v.outsideBaselineRange===0),wetDefaultPixels:quality.every(v=>v.changedPresentationChannels===0&&v.changedReflectionChannels===0),commonPostWork:true,
 performanceIsolationEstablished:false,
 ...(rasterTargets.length?{rasterTargetsPruned:rasterTargets.length===native.results.filter(r=>r.backend==='engine').length+common.results.filter(r=>r.backend==='engine').length}:{}),
 ...(rasterComparison?{reducedProfilePixels:rasterComparison.pixels.every(v=>v.outsideBaselineRange===0)}:{}),
 nativeFrameBudget:native.aggregates.every(r=>r.frameBudgetPassed),commonPostFrameBudget:common.aggregates.every(r=>r.frameBudgetPassed),equalPixelQualityEstablished:false,competitiveAdvantageEstablished:false};
const compact=report=>({runId:report.runId,sourceState:report.sourceState,controls:report.controls,...(report.recovery?{recovery:report.recovery}:{}),results:report.results.map(({raw,pixelSamples,...r})=>r),aggregates:report.aggregates});
const evidence={version:1,status:'completed',gates,browser:native.browser.product,adapter:native.results[0].adapter,controls:native.controls,baseline:compact(before),native:compact(native),common:compact(common),benchmarkPixels,quality,rows,rasterTargets,rasterComparison,contention,
 provenance:'Baseline source and dist were built together before edits; its compiled dist stayed unchanged until its 36 cases and wet views completed. Native/common after-runs execute identical rebuilt source, dist and measured harness. Before/after harness fingerprints differ because profile selection and post-measurement auditing were added; original GPU journal, fixture and measured RAF/timing loop remain in use. Default before/after timings are descriptive, not an isolated same-harness performance claim.'+(common.recovery?' Common report recovered '+common.recovery.preservedCases+' validated cases and executed '+common.recovery.resumedCases+' remaining cases after a navigation document-readiness error. The failed original report is retained; both original/recovery runner hashes and the exact provenance are included. Recovery changed document null checking and case restoration outside the measured loop. This is a recovered execution, not a successful original run.':''),
 interpretation:'common-post matches absence of TAA, AO, diffuse bounce, SSR, DOF, bloom and planar reflections. Native PBR, procedural materials, shadow filtering, atmosphere, point-light attenuation, IBL and tone mapping still differ. Equal pixel quality and competitive advantage are not established. Wet views in BOTH after reports exercise the full default engine, independently of the benchmark profile. Strict canonical comparison uses every decoded channel and only the observed baseline repeat range; no tolerance is introduced.',
 reports:{before:portable(beforeDir),native:portable(nativeDir),common:portable(commonDir)}};
await mkdir(output,{recursive:true});await writeFile(resolve(output,'report.json'),JSON.stringify(evidence,null,2)+'\n');
const escape=x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),link=path=>relative(output,path).replaceAll('\\','/'),num=n=>n.toFixed(2);
const table=rows.map(r=>`<tr><td>${r.profile}</td><td>${r.count}</td><td>${r.scenario}</td><td>${names[r.backend]}</td><td>${num(r.cpuMs.p95)}</td><td>${num(r.gpuMs.p95)}</td><td>${num(r.frameIntervalMs.p95)}</td><td>${num(r.fps)}</td><td>${num(r.uploadBytes.mean)}</td><td>${num(r.drawCalls.mean)}</td><td>${r.frameBudgetPassed?'PASS':'FAIL'}</td></tr>`).join('');
const galleryCount=Math.max(...native.controls.counts);
const galleries=[native,common].map(report=>`<section><h2>${report.controls.profile}: ${galleryCount.toLocaleString('en-US')} cubes, same canonical camera</h2><div class="three">${report.controls.backends.map(backend=>{const run=report.results.find(r=>r.count===galleryCount&&r.backend===backend);return `<figure><figcaption>${names[backend]}</figcaption><a href="${escape(link(resolve(report===native?nativeDir:commonDir,run.image)))}"><img src="${escape(link(resolve(report===native?nativeDir:commonDir,run.image)))}"></a></figure>`;}).join('')}</div></section>`).join('');
const wet=native.visualQuality.captures.map(view=>{const old=before.visualQuality.captures.find(v=>v.name===view.name);return `<section><h2>Full default quality: ${view.name}</h2><div class="pair"><figure><figcaption>Before</figcaption><img src="${escape(link(resolve(beforeDir,old.pngFile)))}"></figure><figure><figcaption>After</figcaption><img src="${escape(link(resolve(nativeDir,view.pngFile)))}"></figure></div></section>`;}).join('');
const rasterHtml=rasterComparison?`<details><summary>Same-profile raster attachment experiment</summary><p>${escape(rasterComparison.interpretation)}</p><pre>${escape(JSON.stringify({before:rasterComparison.before.aggregates,after:common.aggregates,pixels:rasterComparison.pixels,targets:rasterTargets.find(v=>v.profile==='common-post')},null,2))}</pre></details>`:'';
const contentionHtml=contention?`<p><strong>External GPU contention observed. Speed comparisons involving the recovered cases are not isolated.</strong> ${escape(contention.interpretation)}</p><details><summary>GPU contention snapshot</summary><pre>${escape(JSON.stringify(contention,null,2))}</pre></details>`:'';
await writeFile(resolve(output,'report.html'),`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Render pipeline plans: two profiles, three engines</title><style>body{max-width:1600px;margin:auto;padding:24px;background:#111b29;color:#dbe5f2;font:15px/1.5 system-ui}a{color:#9bccff}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;white-space:nowrap}td,th{padding:8px;text-align:left;border-bottom:1px solid #344259}.three{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}figure{margin:0}img{width:100%;display:block}pre{white-space:pre-wrap;overflow-wrap:anywhere}@media(max-width:750px){.three,.pair{grid-template-columns:1fr}}</style><h1>Render pipeline plans: two profiles, three engines</h1>${contentionHtml}<p>${escape(evidence.browser)} · ${escape(JSON.stringify(evidence.adapter))} · ${native.controls.width}×${native.controls.height} · ${native.controls.repetitions} rotated repetitions × ${native.controls.frames} measured frames.</p><p>${escape(evidence.interpretation)}</p><p><strong>Gates: ${escape(JSON.stringify(gates))}</strong></p><div class="scroll"><table><thead><tr><th>Profile</th><th>Cubes</th><th>Camera</th><th>Renderer</th><th>CPU p95 ms</th><th>GPU p95 ms</th><th>RAF p95 ms</th><th>Mean RAF FPS</th><th>Upload B/frame</th><th>All-pass draws</th><th>60 p95</th></tr></thead><tbody>${table}</tbody></table></div><p>Headless RAF is not display FPS. GPU timings sum measured passes and exclude copy-only commands and queue gaps. Sequential clock/load variation remains possible. All scene, geometry, environment and replay hashes match. Completed execution does not turn failed gates into success.</p>${galleries}${wet}${rasterHtml}<details><summary>Strict default pixel audit</summary><pre>${escape(JSON.stringify({benchmarkPixels,quality},null,2))}</pre></details><p>${escape(evidence.provenance)}</p><p><a href="report.json">Full evidence</a></p>`);
const evidencePath=option('--evidence');if(evidencePath){const file=resolve(root,evidencePath);await mkdir(dirname(file),{recursive:true});await writeFile(file,JSON.stringify(evidence,null,2)+'\n');}
console.log(JSON.stringify({report:resolve(output,'report.html'),gates,outsideBaselineRange:benchmarkPixels.reduce((n,v)=>n+v.outsideBaselineRange,0)}));
if(!gates.canonicalDefaultPixels||!gates.wetDefaultPixels||gates.reducedProfilePixels===false||(args.includes('--check-budget')&&(!gates.nativeFrameBudget||!gates.commonPostFrameBudget)))process.exitCode=1;
