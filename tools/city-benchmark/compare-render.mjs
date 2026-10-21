#!/usr/bin/env node
/** JS vs Rust/WASM City benchmark: identical production Scene, camera and GPU.
 * The only intended difference is the rigid-contact execution backend.
 */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {compareImages} from '../quality/metrics.mjs';

const root=resolve('.');
const load=path=>JSON.parse(readFileSync(resolve(path),'utf8'));
const js=load('artifacts/fps/gpu-budget-city-js.json');
const rust=load('artifacts/fps/gpu-budget-city-rust.json');
assert.deepEqual(js.resolution,[1920,1080]);
assert.deepEqual(rust.resolution,[1920,1080]);
assert.equal(js.requestedFrames,180);
assert.equal(rust.requestedFrames,180);
assert.equal(js.cameraRouteEnabled,true,'JS did not execute the fixed route');
assert.equal(rust.cameraRouteEnabled,true,'Rust did not execute the fixed route');
assert.equal(js.rigidBackend,'js');
assert.equal(rust.rigidBackend,'rust');
assert.equal(js.rigidDiagnostics?.backend,'typescript');
assert.equal(rust.rigidDiagnostics?.backend,'wasm');
assert.ok(rust.rigidDiagnostics.calls+rust.rigidDiagnostics.serialPairs>0,
 'Rust rigid kernel was installed but did not calculate any collision candidates');
assert.deepEqual(js.adapter,rust.adapter,'GPU changed between variant captures');
assert.ok(js.gpuFrames>=10&&rust.gpuFrames>=10&&js.timestampQueries&&rust.timestampQueries,
 'GPU timestamp queries unavailable: cannot claim a GPU comparison');
assert.deepEqual(js.finalCamera,rust.finalCamera,'camera route diverged');

const trajectories=[];
assert.equal(js.trafficBodies?.length,48);
assert.equal(rust.trafficBodies?.length,48);
let maxDrift=0;
for(let i=0;i<48;i++){
 const a=js.trafficBodies[i],b=rust.trafficBodies[i];
 assert.equal(a.id,b.id);
 let maxBodyError=0;
 for(const key of ['position','velocity','rotation']){
  for(let axis=0;axis<3;axis++){
   const error=Math.abs(a[key][axis]-b[key][axis]);
   assert.ok(Number.isFinite(error),'nonfinite traffic state '+a.id);
   maxBodyError=Math.max(maxBodyError,error);
   maxDrift=Math.max(maxDrift,error);
  }
 }
 assert.equal(a.sleeping,b.sleeping,'sleep state '+a.id);
 trajectories.push({id:a.id,maxDrift:maxBodyError});
}
function rgb(path){
 const data=execFileSync('ffmpeg',['-hide_banner','-loglevel','error',
  '-i',resolve(path),'-frames:v','1','-f','rawvideo',
  '-pix_fmt','rgb24','pipe:1'],{maxBuffer:32*1024*1024});
 assert.equal(data.length,1920*1080*3,'Invalid 1080p frame '+path);
 return data;
}
const image=compareImages(
 rgb('artifacts/city-benchmark/last-js.png'),
 rgb('artifacts/city-benchmark/last-rust.png'),1920,1080);
const ratio=(a,b)=>Number((a/b).toFixed(4));
const report={
 schema:1,scene:'City Benchmark',frames:180,resolution:[1920,1080],
 hardware:js.adapter,backends:{js:js.rigidDiagnostics,rust:rust.rigidDiagnostics},
 traffic:{count:48,maxStateDrift:maxDrift,byId:trajectories},
 image:{...image,meetsFidelity:image.ssim>=.995&&image.meanAbsoluteLumaError<=.003},
 cpu:{
  jsSimulationP50Ms:js.simulationCpu.p50Ms,rustSimulationP50Ms:rust.simulationCpu.p50Ms,
  jsSimulationP95Ms:js.simulationCpu.p95Ms,rustSimulationP95Ms:rust.simulationCpu.p95Ms,
  rustOverJsTickP95:ratio(js.simulationCpu.p95Ms,rust.simulationCpu.p95Ms),
 },
 gpu:{
  jsP95Ms:js.gpu.p95Ms,rustP95Ms:rust.gpu.p95Ms,
  jsMainP95Ms:js.gpuPasses?.main?.p95Ms,rustMainP95Ms:rust.gpuPasses?.main?.p95Ms,
 },
 pacing:{
  jsFpsMedian:js.observedFps,rustFpsMedian:rust.observedFps,
  jsFrameP95Ms:js.frameInterval.p95Ms,rustFrameP95Ms:rust.frameInterval.p95Ms,
  jsAtLeast60fpsP95:js.frameInterval.p95Ms<=1000/60,
  rustAtLeast60fpsP95:rust.frameInterval.p95Ms<=1000/60,
 },
 warnings:[
  'Rust accelerates only rigid contacts. Scene, broadphase, weather, rendering and scheduling remain identical JS.',
  'Same-runner sequential WebGPU samples are diagnostic; JS/Rust should have the same shader cost.',
  'Do not claim 60 FPS unless 1080p p95 frame interval is <= 16.667ms and no fidelity drift.',
 ],
};
mkdirSync('artifacts/city-benchmark',{recursive:true});
writeFileSync('artifacts/city-benchmark/report.json',JSON.stringify(report,null,2)+'\n');
console.log('CITY_RENDER_COMPARISON='+JSON.stringify({
 hardware:report.hardware,cpu:report.cpu,gpu:report.gpu,pacing:report.pacing,
 trafficDrift:report.traffic.maxStateDrift,image:report.image,rigid:report.backends.rust,
}));
assert.ok(maxDrift<=1e-4,'JS and Rust city trajectories diverged beyond 0.1mm / 0.1mm/s: '+maxDrift);
assert.ok(report.image.meetsFidelity,'City JS/Rust GPU render image changed');
