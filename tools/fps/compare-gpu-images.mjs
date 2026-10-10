#!/usr/bin/env node
/** Same-device, same-scene A/B: image fidelity is a hard gate; FPS claims are not.
 * The baseline is the matched shader before the new geometric GI receiving-hemisphere skip.
 * Uses existing CPU SSIM metric; ffmpeg only decodes captured PNGs.
 */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {compareImages} from '../quality/metrics.mjs';

const root=resolve('.');
const expected=[1920,1080],names=['render34','render35','render36','render37'];
const json=file=>JSON.parse(readFileSync(resolve(root,file),'utf8'));
const baseline=json('artifacts/fps/gpu-budget-baseline.json');
const current=json('artifacts/fps/gpu-budget-optimized.json');
assert.deepEqual(baseline.resolution,expected);
assert.deepEqual(current.resolution,expected);
assert.equal(baseline.adapter?.vendor,current.adapter?.vendor,'different GPU vendors');
assert.equal(baseline.adapter?.architecture,current.adapter?.architecture,'different GPU architectures');
assert.equal(baseline.requestedFrames,current.requestedFrames);
function rgb(file){
 const p=resolve(root,file);
 const pixels=execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-i',p,
   '-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],
   {maxBuffer:32*1024*1024});
 assert.equal(pixels.length,expected[0]*expected[1]*3,'unexpected 1080p PNG size: '+file);
 return pixels;
}
const views=names.map(name=>{
 const expectedRgb=rgb('artifacts/fps/label-ab-baseline/'+name+'.png');
 const actualRgb=rgb('artifacts/'+name+'.png');
 const metrics=compareImages(expectedRgb,actualRgb,...expected);
 return {name,...metrics,passed:metrics.ssim>=.995&&metrics.meanAbsoluteLumaError<=.003};
});
const detail=(report,key)=>report.gpuPasses?.[key]??null;
const ratio=(a,b)=>a!==null&&b!==null&&a>0&&b>0?Number((a/b).toFixed(3)):null;
const gpu={
 baselineSamples:baseline.gpuFrames,optimizedSamples:current.gpuFrames,
 beforeMainP95Ms:detail(baseline,'main')?.p95Ms??null,
 afterMainP95Ms:detail(current,'main')?.p95Ms??null,
 mainP95Speedup:ratio(detail(baseline,'main')?.p95Ms??null,detail(current,'main')?.p95Ms??null),
 beforeEffectsP95Ms:detail(baseline,'effects')?.p95Ms??null,
 afterEffectsP95Ms:detail(current,'effects')?.p95Ms??null,
 effectsP95Speedup:ratio(detail(baseline,'effects')?.p95Ms??null,detail(current,'effects')?.p95Ms??null),
 beforeTotalP95Ms:baseline.gpu?.p95Ms??null,
 afterTotalP95Ms:current.gpu?.p95Ms??null,
 totalP95Speedup:ratio(baseline.gpu?.p95Ms??null,current.gpu?.p95Ms??null),
};
const report={
 schema:1,hardware:current.adapter,resolution:expected,frames:current.requestedFrames,
 image:{views,allPassed:views.every(v=>v.passed),minimumSSIM:.995,maximumLumaError:.003},
 gpu,frame:{
  beforeP50Ms:baseline.frameInterval?.p50Ms,
  afterP50Ms:current.frameInterval?.p50Ms,
  beforeP95Ms:baseline.frameInterval?.p95Ms,
  afterP95Ms:current.frameInterval?.p95Ms,
 },warning:'GPU speedup is a paired sample, not a universal FPS claim; only image fidelity is a hard gate.',
};
mkdirSync(resolve(root,'artifacts/fps'),{recursive:true});
writeFileSync(resolve(root,'artifacts/fps/shader-ab.json'),JSON.stringify(report,null,2)+'\n');
console.log('SHADER_AB='+JSON.stringify(report));
assert.ok(report.image.allPassed,'Shader A/B changed the scene image outside a tight pixel-error tolerance');
