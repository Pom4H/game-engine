#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,relative,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {decodeCanvasPNG} from '../engine-compare/png-rgba.mjs';
import {halfToFloat} from '../engine-compare/fixture.mjs';

const root=resolve(import.meta.dirname,'../..'),args=process.argv.slice(2);
const option=(name,fallback)=>{const n=args.indexOf(name);if(n<0)return fallback;assert.ok(args[n+1]&&!args[n+1].startsWith('--'),'Missing '+name);return args[n+1];};
const beforeDir=resolve(root,option('--before','artifacts/engine-compare/model-history-before')),afterDir=resolve(root,option('--after','artifacts/engine-compare/model-history-after'));
const output=resolve(root,option('--output','artifacts/engine-compare/model-history-comparison'));
const experiment=option('--experiment','model-history');assert.ok(['model-history','sun-shadow','radiance-projection','radiance-membership','pose-arena','shadow-filter','moss-demand','surface-presence'].includes(experiment));
const title=experiment==='pose-arena'?'Persistent pose memory with fixed-length views':experiment==='radiance-membership'?'Radiance static membership reuse':experiment==='surface-presence'?'Physical surface membership locality':experiment==='sun-shadow'?'Sun shadow demand':experiment==='radiance-projection'?'Radiance projection dataflow':experiment==='shadow-filter'?'Normalized sun shadows and receiver-plane depth':experiment==='moss-demand'?'Live material demand: zero moss':'Persistent render model history';
const load=async directory=>JSON.parse(await readFile(resolve(directory,'report.json'),'utf8'));
const [before,after]=await Promise.all([load(beforeDir),load(afterDir)]),same=(a,b,label)=>assert.deepEqual(a,b,label);
let numeric=null,paired=null,integration=null,presence=null,membership=null;
if(experiment==='radiance-membership'||experiment==='pose-arena'){
 const file=option('--paired');assert.ok(file,'Membership comparison requires the actual paired diagnostic');membership=JSON.parse(await readFile(resolve(root,file),'utf8'));
 same(membership.status,'completed');same(membership.controls.count,10000);same(membership.controls.pairs,experiment==='pose-arena'?512:128);same(membership.controls.width,after.controls.width);same(membership.controls.height,after.controls.height);same(membership.adapter,after.results[0].adapter);
 for(const key of ['srcSha256','distSha256'])same(membership.sourceState[key],after.sourceState[key],'Paired membership source/dist provenance');
 for(const gate of ['nativeTimestamps','variantsExecuted','physicalReplay','environmentCausesExact','gpuWorkExact','cpuCombinedImproved'])same(membership.gates[gate],true,gate);
 same(membership.quality.length,9);same(membership.quality.filter(value=>value.stage!=='taa').every(value=>value.changedChannels===0),true,'Paired opaque/HDR exact');same(membership.causeChecks.length,membership.controls.pairs*2);same(membership.causeChecks.every(value=>value.exact),true);
 same(membership.replayHash,membership.afterHash);same(membership.replayHash,after.results.find(value=>value.count===10000&&value.backend==='engine').replayHash);
 const historical=await readFile(resolve(beforeDir,experiment==='pose-arena'?'measured-workspace/dist/render/frame.js':'measured-workspace/dist/render/radiance.js'),'utf8'),archivedModule=await readFile(resolve(dirname(resolve(root,file)),experiment==='pose-arena'?'measured-state/tools/gpu-visibility/projection-pose-arena-baseline.mjs':'measured-state/tools/gpu-visibility/radiance-cause-baseline.mjs'),'utf8');
 same(archivedModule,historical.replaceAll("from '../math.js'","from '../../dist/math.js'").replaceAll("from '../procedural/mesh.js'","from '../../dist/procedural/mesh.js'"),'Actual historical module, with only its imports relocated');same(await readFile(resolve(beforeDir,'measured-workspace/dist/math.js')),await readFile(resolve(afterDir,'measured-workspace/dist/math.js')),'Unchanged math dependency');
 for(const scenario of ['static','camera-motion']){const run=membership.runs.find(value=>value.scenario===scenario);assert.ok(run);same(run.rawPairs.length,membership.controls.pairs);for(const first of ['baseline','candidate'])same(run.rawPairs.filter(value=>value.first===first).length,membership.controls.pairs/2);}
 if(experiment==='pose-arena'){
  same(membership.experiment,'projection-pose-arena');same(membership.frameModelsExact,true);same(membership.poseStorage.candidate.buffers,1);same(membership.poseStorage.baseline.buffers,membership.frameCacheObservations.baseline.entries);
  same(membership.modelChannelsChecked,membership.controls.pairs*2*membership.frameCacheObservations.baseline.entries*16);
  same(await readFile(resolve(beforeDir,'measured-workspace/dist/procedural/mesh.js')),await readFile(resolve(afterDir,'measured-workspace/dist/procedural/mesh.js')),'Unchanged mesh dependency');
 }
}
if(experiment==='surface-presence'){
 const file=option('--paired');assert.ok(file,'Presence comparison requires the actual paired diagnostic');presence=JSON.parse(await readFile(resolve(root,file),'utf8'));
 same(presence.status,'completed');same(presence.controls.count,10000);same(presence.controls.pairs,128);same(presence.controls.width,after.controls.width);same(presence.controls.height,after.controls.height);same(presence.adapter,after.results[0].adapter);
 for(const key of ['srcSha256','distSha256'])same(presence.sourceState[key],after.sourceState[key],'Presence diagnostic measures actual benchmark code');
 for(const gate of ['nativeTimestamps','variantsExecuted','physicalReplay'])same(presence.gates[gate],true,gate);
 same(presence.quality.length,3);for(const stage of ['opaque','hdr','taa'])same(presence.quality.filter(x=>x.stage===stage).length,1);same(presence.quality.filter(x=>x.stage!=='taa').every(x=>x.changedChannels===0),true,'Opaque/HDR exact');
 same(presence.replayHash,presence.afterHash);same(presence.replayHash,after.results.find(x=>x.count===10000&&x.backend==='engine').replayHash);same(presence.selected,{legacy:800,indexed:928});
 same(presence.runs.length,2);for(const scenario of ['static','camera-motion']){const run=presence.runs.find(x=>x.scenario===scenario);assert.ok(run);same(run.pairs,128);same(run.rawPairs.length,128);for(const first of ['legacy','indexed'])same(run.rawPairs.filter(x=>x.first===first).length,64);}
}
if(experiment==='shadow-filter'){
 const file=option('--numeric');assert.ok(file,'Shadow-filter comparisons require the actual numeric GPU report');numeric=JSON.parse(await readFile(resolve(root,file),'utf8'));
 same(numeric.status,'completed');same(numeric.maxError,0);same(numeric.failures.length,0);assert.ok(numeric.changedLegacyCases>0);assert.ok(Object.values(numeric.gates).every(Boolean));
 same(numeric.controls.staticSamples,4);same(numeric.controls.dynamicSamples,2);same(numeric.productionModuleHashes.length,3);
 same(numeric.controls.receiverPlanes,225);same(numeric.controls.receiverPlaneAbsoluteTolerance,1e-6);same(numeric.receiverPlanes.failures.length,0);assert.ok(numeric.receiverPlanes.maxError<=numeric.controls.receiverPlaneAbsoluteTolerance);
 for(const key of ['srcSha256','distSha256'])same(numeric.sourceState[key],after.sourceState[key],'Numeric test measures actual benchmark code');same(numeric.adapter,after.results[0].adapter,'Numeric native hardware');
}
if(experiment==='moss-demand'){
 assert.ok(option('--paired')&&option('--integration'),'Moss comparison requires prototype timings and actual production integration');
 paired=JSON.parse(await readFile(resolve(root,option('--paired')),'utf8'));integration=JSON.parse(await readFile(resolve(root,option('--integration')),'utf8'));
 for(const [report,expected] of [[paired,before],[integration,after]]){
  same(report.status,'completed');same(report.controls.count,10000);same(report.controls.width,after.controls.width);same(report.controls.height,after.controls.height);same(report.adapter,after.results[0].adapter);
  for(const key of ['srcSha256','distSha256'])same(report.sourceState[key],expected.sourceState[key],'Paired diagnostic source/dist provenance');
  for(const gate of ['nativeTimestamps','baselinePipelinesExecuted','physicalReplay','liveGrowthObserved','liveTransitionNoRecompile'])same(report.gates[gate],true,gate);
  same(report.shaderPairs.length,3);same(report.quality.length,9);for(const state of ['zero','growth','restored'])for(const stage of ['opaque','hdr','taa'])same(report.quality.filter(x=>x.state===state&&x.stage===stage).length,1,'Every live state/stage observed');
  same(report.quality.filter(x=>x.stage!=='taa').every(x=>x.changedChannels===0),true,'Live opaque/HDR exact');
  same(report.replayHash,report.afterHash);same(report.replayHash,expected.results.find(x=>x.count===10000&&x.backend==='engine').replayHash,'Actual physical fixture');
 }
 same(paired.controls.pairs,128);assert.ok(integration.controls.pairs>=16);same(paired.shaderPairs,integration.shaderPairs,'Actual compiled variants identical to measured prototype');
}
same(before.controls,after.controls,'Actual controls');same(before.controls.backends,['engine','three','babylon'],'Actual three-way measurements');same(before.controls.profile,'native','Full native pipeline');
assert.ok(after.controls.frames>=240&&after.controls.warmup>=48&&after.controls.repetitions>=3);
same(before.browser.product,after.browser.product,'Browser');same(before.sourceState.harnessSha256,after.sourceState.harnessSha256,'Unchanged measured harness');
const histories=[],radiance=[];
for(const report of [before,after]){
 same(report.status,'completed');same(report.sceneInputsMatched,true);same(report.equalPixelQualityEstablished,false);
 same(report.results.length,report.controls.counts.length*report.controls.scenarios.length*report.controls.backends.length*report.controls.repetitions,'Every measured case');
 for(const run of report.results){
  same(run.adapter,after.results[0].adapter,'Native hardware');assert.ok(run.timestampCoverage>=.95);same(run.replayHash,run.afterHash,'Physical state');same(run.measured.errors?.length??0,0,'GPU errors');
  const peer=after.results.find(r=>r.count===run.count&&r.backend===run.backend&&r.scenario===run.scenario&&r.repetition===run.repetition);assert.ok(peer);
  for(const key of ['sourceHash','geometryHash','environmentHash','replayHash','audit'])same(run[key],peer[key],key);
  if(report===after&&run.backend==='engine'){
   const h=run.measured.preparation.modelHistory;assert.ok(h,'Production history inspection');same(h.entries,run.audit.objects,'Bounded history');same(h.allocations,h.entries,'One allocation per frozen source');same(h.frame,run.warmup+run.frames,'Every frame observed');same(h.modelChanges,0,'Frozen Render IR matrices');assert.ok(h.commits>=h.frame*run.count,'Every batch observation committed');
   histories.push({count:run.count,scenario:run.scenario,repetition:run.repetition,...h});
   const old=before.results.find(r=>r.count===run.count&&r.backend===run.backend&&r.scenario===run.scenario&&r.repetition===run.repetition);
   same(run.uploadBytes.mean,old.uploadBytes.mean,'Transfers preserved');same(run.drawCalls.mean,old.drawCalls.mean,'Draw work preserved');same(run.measured.pipeline,old.measured.pipeline,'Full presentation dependencies');same(run.measured.renderTargets,old.measured.renderTargets,'Targets preserved');
   if(experiment==='radiance-projection'){
    const r=run.measured.preparation.radiance,staticCauses=run.count+1; // shared fixture cubes + ground; eight physical movers are excluded
    assert.ok(r,'Production radiance observations');
    same(r.fusedFrames,h.frame,'One fused projection per rendered frame');same(r.fallbackFrames,0,'Built-in projection is sufficient');
    same(r.observations,staticCauses*h.frame,'Every static radiance cause observed');same(r.checkedPoses,staticCauses,'Only initial raw pose checks');same(r.reusedPoses,staticCauses*(h.frame-1),'Stationary certified poses reused');
    radiance.push({count:run.count,scenario:run.scenario,repetition:run.repetition,staticCauses,...r});
   }
  }
 }
}
const envelopes=new Map(),images=[];
for(const count of before.controls.counts){
 const runs=before.results.filter(r=>r.backend==='engine'&&r.count===count),decoded=await Promise.all(runs.map(async r=>decodeCanvasPNG(await readFile(resolve(beforeDir,r.image)))));
 const minimum=Buffer.from(decoded[0].pixels),maximum=Buffer.from(minimum);
 for(const image of decoded){same([image.width,image.height],[before.controls.width,before.controls.height],'PNG extent');for(let n=0;n<minimum.length;n++){minimum[n]=Math.min(minimum[n],image.pixels[n]);maximum[n]=Math.max(maximum[n],image.pixels[n]);}}
 let varyingChannels=0;for(let n=0;n<minimum.length;n++)if(minimum[n]!==maximum[n])varyingChannels++;
 envelopes.set(count,{minimum,maximum,varyingChannels,captures:runs.length});
}
for(const run of after.results.filter(r=>r.backend==='engine')){
 const old=before.results.find(r=>r.backend===run.backend&&r.count===run.count&&r.scenario===run.scenario&&r.repetition===run.repetition),a=decodeCanvasPNG(await readFile(resolve(beforeDir,old.image))),b=decodeCanvasPNG(await readFile(resolve(afterDir,run.image))),envelope=envelopes.get(run.count);
 same([a.width,a.height],[b.width,b.height],'Paired PNG extent');let changedChannels=0,maxError=0,outsideBaselineRange=0;const coordinates=[];
 for(let n=0;n<a.pixels.length;n++){
  const error=Math.abs(a.pixels[n]-b.pixels[n]);if(error)changedChannels++;maxError=Math.max(maxError,error);
  if(b.pixels[n]<envelope.minimum[n]||b.pixels[n]>envelope.maximum[n]){outsideBaselineRange++;if(coordinates.length<12)coordinates.push({x:Math.floor(n/4)%a.width,y:Math.floor(n/4/a.width),channel:n%4,before:a.pixels[n],after:b.pixels[n],minimum:envelope.minimum[n],maximum:envelope.maximum[n]});}
 }
 images.push({count:run.count,scenario:run.scenario,repetition:run.repetition,comparedChannels:a.pixels.length,changedChannels,maxError,outsideBaselineRange,coordinates,baselineCaptures:envelope.captures,baselineVaryingChannels:envelope.varyingChannels});
}
const sha=data=>createHash('sha256').update(data).digest('hex'),quality=[];
for(const key of ['mode','sourceHash','textureHash','replayHash','afterHash','adapter','width','height'])same(before.visualQuality[key],after.visualQuality[key],'Wet fixture '+key);
same(before.visualQuality.captures.length,after.visualQuality.captures.length,'Wet views');
for(const old of before.visualQuality.captures){
 const peer=after.visualQuality.captures.find(v=>v.name===old.name);assert.ok(peer);for(const key of ['camera','width','height','reflectionWidth','reflectionHeight'])same(old[key],peer[key],key);
 const result={name:old.name,presentationChannels:old.width*old.height*4,reflectionChannels:old.reflectionWidth*old.reflectionHeight*4,changedPresentationChannels:0,changedReflectionChannels:0,maxPresentationError:0,maxReflectionError:0,coordinates:[],bounds:null};
 let minX=old.width,minY=old.height,maxX=-1,maxY=-1;
 for(const [field,hashField,bytes] of [['rgba8File','pixelHash',result.presentationChannels],['reflectionRgba16fFile','reflectionHash',result.reflectionChannels*2]]){
  const a=await readFile(resolve(beforeDir,old[field])),b=await readFile(resolve(afterDir,peer[field]));same(a.length,bytes);same(b.length,bytes);same(sha(a),old[hashField]);same(sha(b),peer[hashField]);
  if(field==='rgba8File')for(let n=0;n<a.length;n++){const error=Math.abs(a[n]-b[n]);if(error){result.changedPresentationChannels++;const x=Math.floor(n/4)%old.width,y=Math.floor(n/4/old.width);minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);if(result.coordinates.length<12)result.coordinates.push({x,y,channel:n%4,before:a[n],after:b[n]});}result.maxPresentationError=Math.max(result.maxPresentationError,error);}
  else for(let n=0;n<a.length;n+=2){const x=halfToFloat(a.readUInt16LE(n)),y=halfToFloat(b.readUInt16LE(n));assert.ok(Number.isFinite(x)&&Number.isFinite(y));const error=Math.abs(x-y);if(error)result.changedReflectionChannels++;result.maxReflectionError=Math.max(result.maxReflectionError,error);}
 }
 if(maxX>=0)result.bounds={minX,minY,maxX,maxY};quality.push(result);
}
const rows=before.aggregates.map(old=>({count:old.count,scenario:old.scenario,backend:old.backend,before:old,after:after.aggregates.find(r=>r.count===old.count&&r.scenario===old.scenario&&r.backend===old.backend)}));
const gates={historyRecordsResident:true,...(presence?{presenceIndexQueried:true,pairedOpaqueHDRExact:true,pairedAllFinalStagesExact:presence.gates.finalCanonicalStages}:{}),...(experiment==='radiance-projection'?{radianceObservationsFused:true}:{}),...(numeric?{shadowFilterNormalized:true,shadowReceiverPlaneVerified:true}:{}),...(paired?{liveMaterialTransitions:true,pairedOpaqueHDRExact:true,pairedAllFinalStagesExact:paired.gates.finalCanonicalStages&&integration.gates.finalCanonicalStages}:{}),canonicalPixels:images.every(r=>r.outsideBaselineRange===0),wetPixels:quality.every(r=>r.changedPresentationChannels===0&&r.changedReflectionChannels===0),frameBudget:after.aggregates.filter(r=>r.backend==='engine').every(r=>r.frameBudgetPassed),equalPixelQualityEstablished:false,competitiveAdvantageEstablished:false,performanceIsolationEstablished:false};
const portable=path=>relative(root,path).replaceAll('\\','/');
if(membership)Object.assign(gates,{...(experiment==='pose-arena'?{poseStorageShared:true,pairedFrameModelsExact:true}:{staticMembershipObserved:true}),pairedEnvironmentCausesExact:true,pairedGPUWorkExact:true,pairedOpaqueHDRExact:true,pairedAllFinalStagesExact:membership.gates.finalCanonicalStages});
const changeDescriptions={
 'pose-arena':'Reuses the complete native baseline and exactly its frozen harness/assets. Persistent pose numbers share one ArrayBuffer while fixed-length Float64Array views retain the existing numerical observation loop. Growth rebinds internal views without changing immutable current/previous matrices. Direct raw pose edits, topology changes, material observations, geometry, physics and all shader sources remain observable and unchanged. Same-device AB/BA CPU measurements check every matrix channel outside the timing interval and retain every strict TAA failure.',
 'radiance-membership':'Historical and candidate source/build run the same frozen native harness and assets. The projection reuses completed static membership when entity identity/order and the observed mover contents agree. Small mover sets are validated once per frame; dense-moving scenes keep the original classification path. Raw pose/material checking, geometry, physical state, environment keys and all production shaders remain unchanged. Paired host-cost means and every strict TAA failure are retained separately.',
 'surface-presence':'Reuses the complete moss-demand-after baseline with its exact frozen runner/harness. A membership index follows public field/surface/body Map set/delete/clear operations and supplies one presence query for batch eligibility. Scene links generated visuals to their physical sources; custom state readers retain their original path. Physical values, instance packing, shader sources and all rendering dependencies are preserved. Same-device timing evidence and every paired TAA failure are recorded separately.',
 'model-history':'The history cache owns render observations only; the existing Render IR index is the current-model source.',
 'sun-shadow':'The only production change skips shadow sampling when the direct sunlight cosine is zero; lit-fragment PCF and all other shading, features, targets, geometry and physical state are retained.',
 'radiance-projection':'Reuses the completed sun-shadow-before baseline with its exact archived runner and harness, executing from a measured workspace containing the newly built candidate source/dist. Render IR observes radiance causes in its existing pass and certifies unchanged raw poses with immutable model identities. Direct material causes are still checked and standalone/custom/dormant paths scan Scene. Hash/probe inputs, physical state and all GPU shader code are retained.',
 'shadow-filter':'Reuses the complete radiance-projection-after baseline and its exact frozen runner/harness. Four static PCF samples and two dynamic samples are normalized separately before the existing map combination; shared counts drive the shader loops and inactive dynamic-map visibility. A receiver-plane gradient from geometric position derivatives corrects comparison depth for each offset PCF tap, with a finite neutral fallback for singular light projections. Derivatives are computed before bounds returns. Sample offsets, existing normal/constant/caster biases, comparison samplers, depth maps, all render features and physics are retained. The earlier CPU fallback-key lifecycle repair also separates the source snapshots, but is inactive in the built-in live route measured here. Intentional shadow pixel changes are recorded, and no pixel-equality or performance claim overrides the observed failed gates.',
 'moss-demand':'Reuses the complete shadow-filter-plane-after baseline and its exact frozen runner/harness. The only production change skips the three moss-only FBM evaluations when the live material uniform is zero. The concrete base and all nonzero moss expressions are retained. Same-device AB/BA prototype timings are separately recorded; actual production shader-pair hashes match them. Live authored material replacements publish appearance revisions, change then restore opaque shading without pipeline reconstruction. Original exact canonical/wet/frame gates and the paired final TAA failures are retained.',
};
const evidence={version:1,status:'completed',experiment,gates,controls:after.controls,browser:after.browser.product,adapter:after.results[0].adapter,beforeRun:before.runId,afterRun:after.runId,beforeSourceState:before.sourceState,afterSourceState:after.sourceState,histories,...(radiance.length?{radiance}:{}),...(numeric?{numericReport:option('--numeric'),numericControls:numeric.controls,numericMaxError:numeric.maxError,receiverPlaneMaxError:numeric.receiverPlanes.maxError,presentationChangeExpected:true,presentationChangeReason:'Four static PCF samples were incorrectly combined as if there were two. Both maps now use their own averages. Offset taps also use their local receiver-plane depth; normalization alone exposed self-shadow stripes in the wet road highlight. These corrections intentionally change shadow pixels; equality with the old incorrect weights is not claimed. Original equality/frame gates are still recorded and not waived.'}:{}),images,quality,rows,reports:{before:portable(beforeDir),after:portable(afterDir)},
 ...(paired?{pairedReport:option('--paired'),integrationReport:option('--integration'),pairedControls:paired.controls,pairedRuns:paired.runs.map(({rawPairs,...r})=>r),pairedQuality:paired.quality,integrationQuality:integration.quality,shaderPairs:paired.shaderPairs}:{}),
 ...(presence?{pairedReport:option('--paired'),pairedControls:presence.controls,pairedRuns:presence.runs.map(({rawPairs,...r})=>r),pairedQuality:presence.quality,pairedSourceState:presence.sourceState}:{}),
 provenance:'Baseline source and dist were built together before edits; compiled baseline stayed unchanged through all 36 cases and wet captures and is archived under the before report. Changed renderer passed full checks and was rebuilt before after capture. Measured harness fingerprints are identical. '+changeDescriptions[experiment],
 interpretation:'Actual native three-way reports with identical scene inputs and physical hashes. Engine effects/shading differ from peers; no equal-quality competitive claim. Every Engine PNG channel uses only the observed before repeat range, without a tolerance; every wet RGBA8 and finite HDR reflection channel is compared exactly. Failed gates remain failed. CPU/GPU p95 from sequential local runs can vary with clock/load; exclusive GPU use was not established. Headless RAF is not display FPS.'};
if(membership)Object.assign(evidence,{pairedReport:option('--paired'),pairedControls:membership.controls,pairedRuns:membership.runs.map(({rawPairs,...run})=>run),pairedQuality:membership.quality,pairedSourceState:membership.sourceState,pairedFinalImageScope:'Final opaque/HDR/TAA after 32 frames, two repetitions; no multi-frame repeatability success is implied.'});
if(experiment==='pose-arena')Object.assign(evidence,{pairedPoseStorage:membership.poseStorage,pairedModelChannelsChecked:membership.modelChannelsChecked});
await mkdir(output,{recursive:true});await writeFile(resolve(output,'report.json'),JSON.stringify(evidence,null,2)+'\n');
const esc=x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),link=p=>relative(output,p).replaceAll('\\','/'),f=n=>n.toFixed(2);
const table=rows.map(r=>`<tr><td>${r.count}</td><td>${r.scenario}</td><td>${r.backend}</td><td>${f(r.before.cpuMs.p95)} → ${f(r.after.cpuMs.p95)}</td><td>${f(r.before.gpuMs.p95)} → ${f(r.after.gpuMs.p95)}</td><td>${f(r.before.frameIntervalMs.p95)} → ${f(r.after.frameIntervalMs.p95)}</td><td>${f(r.before.fps)} → ${f(r.after.fps)}</td><td>${r.after.frameBudgetPassed?'PASS':'FAIL'}</td></tr>`).join('');
const count=Math.max(...after.controls.counts),gallery=after.controls.backends.map(backend=>{const run=after.results.find(r=>r.count===count&&r.backend===backend);return `<figure><figcaption>${backend}</figcaption><a href="${esc(link(resolve(afterDir,run.image)))}"><img src="${esc(link(resolve(afterDir,run.image)))}"></a></figure>`;}).join('');
const wet=after.visualQuality.captures.map(view=>{const old=before.visualQuality.captures.find(v=>v.name===view.name);return `<h2>${view.name}</h2><div class="pair"><img src="${esc(link(resolve(beforeDir,old.pngFile)))}"><img src="${esc(link(resolve(afterDir,view.pngFile)))}"></div>`;}).join('');
const pairedSection=presence?`<h2>Same-device CPU preparation</h2><p>128 AB/BA pairs per route; same physical maps and production shaders. Final TAA differences remain failed.</p><div class="scroll"><table><thead><tr><th>Camera</th><th>Mean legacy ms</th><th>Mean indexed ms</th><th>Mean paired delta ms</th><th>Improved pairs</th></tr></thead><tbody>${presence.runs.map(r=>`<tr><td>${esc(r.scenario)}</td><td>${f(r.modes.legacy.prepareMs.mean)}</td><td>${f(r.modes.indexed.prepareMs.mean)}</td><td>${f(r.prepareDeltaMs.mean)}</td><td>${r.improvedPairs}/${r.pairs}</td></tr>`).join('')}</tbody></table></div><pre>${esc(JSON.stringify(presence.quality,null,2))}</pre>`:paired?`<h2>Same-device opaque timings</h2><p>128 AB/BA pairs per camera route; queue waits isolate GPU work. These are not display FPS. Prototype and production integration retain every final TAA failure.</p><div class="scroll"><table><thead><tr><th>Camera</th><th>Mean opaque before ms</th><th>Mean opaque after ms</th><th>Mean paired delta ms</th><th>Improved pairs</th></tr></thead><tbody>${paired.runs.map(r=>`<tr><td>${esc(r.scenario)}</td><td>${f(r.modes.before.opaqueMs.mean)}</td><td>${f(r.modes.after.opaqueMs.mean)}</td><td>${f(r.deltaMs.mean)}</td><td>${r.improvedPairs}/${r.pairs}</td></tr>`).join('')}</tbody></table></div><details><summary>Live material states: exact opaque/HDR and retained TAA differences</summary><pre>${esc(JSON.stringify({prototype:paired.quality,integration:integration.quality},null,2))}</pre></details>`:'';
await writeFile(resolve(output,'report.html'),`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><style>body{max-width:1500px;margin:auto;padding:24px;background:#142132;color:#e2e9f4;font:16px/1.5 system-ui}a{color:#98ccff}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;white-space:nowrap}td,th{padding:8px;text-align:left;border-bottom:1px solid #3d4d63}.three{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}figure{margin:0}img{width:100%;display:block}pre{white-space:pre-wrap;overflow-wrap:anywhere}@media(max-width:750px){.three,.pair{grid-template-columns:1fr}}</style><h1>${title}</h1><p>${esc(evidence.interpretation)}</p><p><strong>Gates: ${esc(JSON.stringify(gates))}</strong></p><div class="scroll"><table><thead><tr><th>Cubes</th><th>Camera</th><th>Renderer</th><th>CPU p95 ms</th><th>GPU p95 ms</th><th>RAF p95 ms</th><th>Mean RAF FPS</th><th>60 p95</th></tr></thead><tbody>${table}</tbody></table></div>${pairedSection}<h2>Actual resident history</h2><pre>${esc(JSON.stringify(histories,null,2))}</pre><h2>${count} cubes: three native pipelines</h2><div class="three">${gallery}</div>${wet}<details><summary>Strict pixel evidence</summary><pre>${esc(JSON.stringify({images,quality},null,2))}</pre></details><p>${esc(evidence.provenance)}</p><p><a href="report.json">Full evidence</a></p>`);
const evidencePath=option('--evidence');if(evidencePath){const file=resolve(root,evidencePath);await mkdir(dirname(file),{recursive:true});await writeFile(file,JSON.stringify(evidence,null,2)+'\n');}
console.log(JSON.stringify({report:resolve(output,'report.html'),gates,outsideBaselineRange:images.reduce((n,r)=>n+r.outsideBaselineRange,0),engine:rows.filter(r=>r.backend==='engine').map(r=>({count:r.count,scenario:r.scenario,cpu:[r.before.cpuMs.p95,r.after.cpuMs.p95],gpu:[r.before.gpuMs.p95,r.after.gpuMs.p95],frame:[r.before.frameIntervalMs.p95,r.after.frameIntervalMs.p95],fps:[r.before.fps,r.after.fps]}))}));
if(!gates.canonicalPixels||!gates.wetPixels||((paired||presence||membership)&&!gates.pairedAllFinalStagesExact)||(args.includes('--check-budget')&&!gates.frameBudget))process.exitCode=1;
