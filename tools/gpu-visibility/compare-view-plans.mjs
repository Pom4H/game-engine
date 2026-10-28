#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,relative} from 'node:path';
import {execFileSync} from 'node:child_process';
import {decodeCanvasPNG} from '../engine-compare/png-rgba.mjs';

const args=process.argv.slice(2),root=resolve(import.meta.dirname,'../..');
const option=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
const before=option('--before','artifacts/engine-compare/view-planning-before'),after=option('--after','artifacts/engine-compare/view-planning-after');
const output=resolve(root,option('--output','artifacts/engine-compare/view-planning-comparison'));
const evidenceFile=option('--evidence'),afterReport=JSON.parse(await readFile(resolve(root,after,'report.json'),'utf8'));
function verifyVisibilityPlan(run){
 const plan=run.measured?.preparation?.visibilityPlan;
 assert.ok(plan,'Measured renderer must expose its visibility plan');
 assert.equal(plan.entries,run.audit.objects);assert.equal(plan.sourceBuilds,1);
 const {staticShadow,cameraOpaque,reflection,dynamicShadow}=plan.passes;
 // The shared fixture freezes physics outside measurement and keeps the light
 // target fixed. Camera motion must not revisit any static shadow candidate.
 assert.equal(staticShadow.staticCandidates,run.count+1);assert.equal(staticShadow.movingCandidates,0);
 assert.equal(staticShadow.sourceBuilds,1);assert.equal(staticShadow.staticBuilds,1);
 assert.equal(staticShadow.tests,run.count+1);assert.equal(staticShadow.lastTests,0);
 assert.equal(cameraOpaque.staticCandidates,1);assert.equal(reflection.staticCandidates,1);
 assert.equal(dynamicShadow.movingCandidates,8);
 return{count:run.count,scenario:run.scenario,repetition:run.repetition,plan};
}
const visibilityPlans=afterReport.results.map(verifyVisibilityPlan);
const comparatorArgs=[resolve(root,'tools/engine-compare/compare-reflection.mjs'),'--before',before,'--after',after,'--output',output,
 '--title','Independent render visibility plans',
 '--description','Camera, reflection and light projections own separate cause-driven plans. GPU-owned instances stay outside CPU camera/reflection candidates; stationary shadow eligibility and models remain resident.',
 '--provenance','Baseline dist was rebuilt before renderer edits; the changed renderer was rebuilt before the after measurements. Unmodified reruns retain identical recorded source/dist fingerprints. HEAD alone does not describe these uncommitted working-tree builds.'];
// The common comparator enforces unchanged inputs/replay, full image gates,
// timestamps and hardware before this architecture-specific evidence is saved.
try{execFileSync(process.execPath,comparatorArgs,{cwd:root,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']});}
catch(error){
 if(error.status!==1)throw error;
 let result;try{result=JSON.parse(error.stdout.trim());}catch{throw error;}
 if(result.pixelGatePassed!==false)throw error;
 const failed=JSON.parse(await readFile(resolve(output,'report.json'),'utf8'));
 assert.equal(failed.afterRun,afterReport.runId);
 if(failed.pixelGatePassed)throw error;
 // Preserve the common comparator's failed gate and its reviewable report.
}
const reportFile=resolve(output,'report.json'),evidence=JSON.parse(await readFile(reportFile,'utf8'));
let repeatNote='';
const observedAfter=option('--observed-after');
if(observedAfter){
 const directory=resolve(root,observedAfter),observed=JSON.parse(await readFile(resolve(directory,'report.json'),'utf8'));
 assert.equal(observed.status,'completed');assert.deepEqual(observed.controls,afterReport.controls);
 assert.equal(observed.browser.product,afterReport.browser.product);
 for(const run of observed.results){verifyVisibilityPlan(run);assert.ok(run.timestampCoverage>=.95);assert.equal(run.measured.errors.length,0);}
 for(const field of ['srcSha256','distSha256','harnessSha256'])assert.equal(observed.sourceState[field],afterReport.sourceState[field],'Unmodified rerun '+field);
 const baseline=JSON.parse(await readFile(resolve(root,before,'report.json'),'utf8')),envelopes=new Map();
 for(const count of baseline.controls.counts){
  let minimum,maximum;
  for(const run of baseline.results.filter(r=>r.count===count)){
   const {pixels}=decodeCanvasPNG(await readFile(resolve(root,before,run.image)));
   if(!minimum){minimum=Buffer.from(pixels);maximum=Buffer.from(pixels);}
   for(let n=0;n<pixels.length;n++){minimum[n]=Math.min(minimum[n],pixels[n]);maximum[n]=Math.max(maximum[n],pixels[n]);}
  }
  envelopes.set(count,{minimum,maximum});
 }
 const variations=[];
 for(const run of observed.results){
  const peer=afterReport.results.find(r=>r.count===run.count&&r.scenario===run.scenario&&r.repetition===run.repetition);
  for(const field of ['sourceHash','geometryHash','environmentHash','replayHash','afterHash','adapter'])assert.deepEqual(run[field],peer[field]);
  const x=decodeCanvasPNG(await readFile(resolve(directory,run.image))),y=decodeCanvasPNG(await readFile(resolve(root,after,peer.image)));
  assert.equal(x.pixels.length,y.pixels.length);let changedChannels=0,maximumError=0,outsideBaselineRange=0;const coordinates=[],envelope=envelopes.get(run.count);
  for(let n=0;n<x.pixels.length;n++){
   if(x.pixels[n]<envelope.minimum[n]||x.pixels[n]>envelope.maximum[n])outsideBaselineRange++;
   const error=Math.abs(x.pixels[n]-y.pixels[n]);if(!error)continue;changedChannels++;maximumError=Math.max(maximumError,error);
   if(coordinates.length<12)coordinates.push({x:Math.floor(n/4)%x.width,y:Math.floor(n/4/x.width),channel:n%4,first:x.pixels[n],repeat:y.pixels[n]});
  }
  variations.push({count:run.count,scenario:run.scenario,repetition:run.repetition,changedChannels,maximumError,outsideBaselineRange,coordinates});
 }
 const wetCaptures=[];
 for(const first of observed.visualQuality.captures){
  const repeat=afterReport.visualQuality.captures.find(c=>c.name===first.name);
  for(const field of ['camera','width','height','reflectionWidth','reflectionHeight'])assert.deepEqual(first[field],repeat[field]);
  for(const field of ['rgba8File','reflectionRgba16fFile'])assert.ok((await readFile(resolve(directory,first[field]))).equals(await readFile(resolve(root,after,repeat[field]))),'Unmodified wet capture '+first.name);
  wetCaptures.push({name:first.name,presentationExactlyMatched:true,reflectionExactlyMatched:true});
 }
 const firstGatePassed=variations.every(row=>row.outsideBaselineRange===0),changed=variations.reduce((sum,row)=>sum+row.changedChannels,0),outside=variations.reduce((sum,row)=>sum+row.outsideBaselineRange,0),maxError=Math.max(...variations.map(row=>row.maximumError));
 evidence.unmodifiedRepeat={firstRun:observed.runId,repeatRun:afterReport.runId,firstReport:relative(root,resolve(directory,'report.json')).replaceAll('\\','/'),sourceAndBuildIdentical:true,
  firstStrictPixelGatePassed:firstGatePassed,firstOutsideBaselineRange:outside,
  repeatStrictPixelGatePassed:evidence.pixelGatePassed,firstAggregates:observed.aggregates,canonicalCaptureVariation:variations,wetCaptures,
  limitation:'Unmodified builds vary at the reported RGB8 channels. The internal GPU/capture cause is not isolated. These observations are retained; failed gates remain failed.'};
 repeatNote=`<h2>Unmodified repeat</h2><p>The first after-run strict image gate ${firstGatePassed?'passed':'failed'} (${outside} channels outside the observed baseline range). The identical source/build/harness was rerun without edits; its strict gate ${evidence.pixelGatePassed?'passed':'also failed'}. Across the two runs, ${changed} paired canonical channels vary by at most ${maxError}/255; every wet-scene presentation and HDR capture matches exactly. No tolerance was changed. Both reports, metrics and pixel coordinates are retained below; the internal GPU/capture cause of the variation is not isolated.</p>`;
}
evidence.visibilityPlans=visibilityPlans;
evidence.visibilityPlanGatePassed=true;
evidence.visibilityPlanGate='Each fresh fixture owns count+9 entries. Static light projection builds exactly once, performs count+1 tests total and zero on the last measured frame; CPU camera/reflection each own one static candidate, plus movers. All 12 measured cases must satisfy this.';
await writeFile(reportFile,JSON.stringify(evidence,null,2));
const htmlFile=resolve(output,'report.html'),html=await readFile(htmlFile,'utf8');
const rows=visibilityPlans.map(({count,scenario,repetition,plan})=>`<tr><td>${count}</td><td>${scenario}</td><td>${repetition}</td><td>${plan.entries}</td><td>${plan.passes.staticShadow.staticBuilds}</td><td>${plan.passes.staticShadow.tests}</td><td>${plan.passes.staticShadow.lastTests}</td></tr>`).join('');
const detail='<h2>Measured plan work</h2><p>One static light projection per scene, even while the camera moves. CPU camera and reflection lists each contain one static ground object; the GPU owns the cube instances. The planner scans current object causes once per frame and retains only current candidates. Draw calls and uploads are not reduced by this change.</p><div class="scroll"><table><thead><tr><th>Cubes</th><th>Camera</th><th>Repeat</th><th>Plan entries</th><th>Static light builds</th><th>Total static clip tests</th><th>Last-frame static clip tests</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
await writeFile(htmlFile,html.replace('<details><summary>Evidence',repeatNote+detail+'<details><summary>Evidence').replace(/<pre>[\s\S]*?<\/pre>/,'<pre>'+JSON.stringify(evidence,null,2).replaceAll('&','&amp;').replaceAll('<','&lt;')+'</pre>'));
if(evidenceFile){
 const file=resolve(root,evidenceFile),portable={...evidence,quality:evidence.quality.map(view=>({...view,...Object.fromEntries(['beforeImage','afterImage','beforeReflection','afterReflection'].map(key=>[key,relative(root,view[key]).replaceAll('\\','/')]))}))};
 await mkdir(dirname(file),{recursive:true});
 await writeFile(file,JSON.stringify(portable,null,2));
}
console.log(JSON.stringify({report:htmlFile,pixelGatePassed:evidence.pixelGatePassed,visibilityPlanGatePassed:true,frameBudgetPassed:evidence.frameBudgetPassed,
 rows:evidence.rows.map(({count,scenario,before,after})=>({count,scenario,cpu:[before.cpuMs.p95,after.cpuMs.p95],gpu:[before.gpuMs.p95,after.gpuMs.p95],frame:[before.frameIntervalMs.p95,after.frameIntervalMs.p95],fps:[before.fps,after.fps]}))}));
if(!evidence.pixelGatePassed||(args.includes('--check-budget')&&!evidence.frameBudgetPassed))process.exitCode=1;
