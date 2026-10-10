#!/usr/bin/env node
/** Paired hardware-only A-B-B-A shader benchmark aggregation.
 * Every trial must contain real GPU timestamp queries from the same adapter.
 */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';

const load=(label)=>JSON.parse(readFileSync(resolve('artifacts/fps/gpu-budget-'+label+'.json'),'utf8'));
const runs={a1:load('a1'),b1:load('b1'),b2:load('b2'),a2:load('a2')};
const devices=new Set();
for(const [name,run] of Object.entries(runs)){
  assert.deepEqual(run.resolution,[1920,1080],name+' resolution changed');
  assert.equal(run.requestedFrames,90,name+' has different frame count');
  assert.equal(run.timestampQueries,true,name+' lacks WebGPU timestamps');
  assert.ok(run.gpuFrames>=10,name+' has too few GPU frames');
  assert.ok(Number.isFinite(run.gpu?.p95Ms)&&run.gpu.p95Ms>0,name+' invalid GPU p95');
  assert.ok(Number.isFinite(run.gpuPasses?.main?.p95Ms)&&run.gpuPasses.main.p95Ms>0,name+' missing main pass');
  assert.ok(Number.isFinite(run.gpuPasses?.effects?.p95Ms)&&run.gpuPasses.effects.p95Ms>0,name+' missing effects pass');
  assert.equal(run.adapter?.vendor?.toLowerCase(),'amd',name+' must use AMD GPU');
  assert.equal(run.adapter?.architecture?.toLowerCase(),'rdna-3',name+' must use RDNA 3');
  devices.add(JSON.stringify([run.adapter?.vendor,run.adapter?.architecture,run.adapter?.device]));
}
assert.equal(devices.size,1,'crossover runs used different GPUs');
const image=JSON.parse(readFileSync(resolve('artifacts/fps/shader-ab.json'),'utf8')).image;
assert.equal(image?.allPassed,true,'candidate failed reference image equivalence');
const average=(values)=>values.reduce((a,b)=>a+b,0)/values.length;
function compare(read){
  const a=[read(runs.a1),read(runs.a2)],b=[read(runs.b1),read(runs.b2)];
  const before=average(a),after=average(b);
  return {
    beforeMs:Number(before.toFixed(5)),afterMs:Number(after.toFixed(5)),
    speedup:Number((before/after).toFixed(4)),
    deltaPercent:Number((((after/before)-1)*100).toFixed(2)),
    baselineTrialsMs:a,candidateTrialsMs:b,
  };
}
const stages={
  gpuP95:compare(r=>r.gpu.p95Ms),
  gpuMean:compare(r=>r.gpu.meanMs),
  mainP95:compare(r=>r.gpuPasses.main.p95Ms),
  effectsP95:compare(r=>r.gpuPasses.effects.p95Ms),
  frameIntervalP95:compare(r=>r.frameInterval.p95Ms),
  cpuFrameP95:compare(r=>r.frameCpu.p95Ms),
};
const regression=stages.gpuP95.deltaPercent>5||stages.mainP95.deltaPercent>5;
const gain=stages.gpuP95.deltaPercent<-3&&stages.mainP95.deltaPercent<0;
const report={
  schema:1,order:['a1','b1','b2','a2'],
  baselineCommit:'31d83a331aeb4063d27b7741f5f3b838a9df588e',
  candidateCommit:process.env.GITHUB_SHA??null,
  adapter:runs.a1.adapter,profile:'Windows self-hosted RDNA3 WebGPU 1920x1080',
  framesPerTrial:90,
  gpuSamples:Object.fromEntries(Object.entries(runs).map(([n,r])=>[n,r.gpuFrames])),
  image,stages,
  verdict:regression?'potential-regression':gain?'provisional-improvement':'inconclusive',
  warning:'Two trials per variant; same-device result is provisional, not an all-scene or stable-60-FPS guarantee.',
};
mkdirSync(resolve('artifacts/fps'),{recursive:true});
writeFileSync(resolve('artifacts/fps/gpu-crossover.json'),JSON.stringify(report,null,2)+'\n');
console.log('GPU_CROSSOVER='+JSON.stringify(report));
