import test from 'node:test';
import assert from 'node:assert/strict';
import {audioFeatures,checkRange,compareImages,decodeWav,imageFeatures,verifyGpuProfile} from '../tools/quality/metrics.mjs';

test('black screens are detected; sharp images have measurable edges',()=>{
  const black=imageFeatures(Buffer.alloc(6*6*3),6,6);
  assert.equal(black.lumaStdDev,0);assert.equal(black.blackFraction,1);
  const checker=Buffer.from(Array.from({length:6*6},(_,i)=>(i%6+Math.floor(i/6))%2?[255,255,255]:[0,0,0]).flat());
  const real=imageFeatures(checker,6,6);
  assert.ok(real.lumaStdDev>.4);assert.ok(real.meanEdge>.9);
});

test('local SSIM is one for identical images and detects changes',()=>{
  const a=Buffer.from(Array.from({length:16*16*3},(_,i)=>i%255));
  assert.ok(Math.abs(compareImages(a,a,16,16).ssim-1)<1e-8);
  const b=Buffer.from(a);b.fill(0,3*8*8,3*12*8);
  assert.ok(compareImages(a,b,16,16).ssim<.99);
  assert.ok(compareImages(a,b,16,16).meanAbsoluteLumaError>0);
});

test('real WAVE PCM is read; silence/clipping are measurable',()=>{
  const pcm=[0,16384,-16384,32767],b=Buffer.alloc(44+pcm.length*2);
  b.write('RIFF',0);b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);
  b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);
  b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(pcm.length*2,40);
  pcm.forEach((n,i)=>b.writeInt16LE(n,44+i*2));
  const decoded=decodeWav(b),features=audioFeatures(decoded);
  assert.equal(decoded.sampleRate,16000);assert.equal(features.channels.length,1);
  assert.equal(decoded.durationSeconds,4/16000);
  assert.ok(features.peak>.99);assert.ok(features.channels[0].rms>.4);
  assert.throws(()=>decodeWav(Buffer.from('not a wave')));
});

test('hardware FPS checks fail closed on missing counters or degraded resolution',()=>{
  const cfg={resolution:[1920,1080],minFrames:90,minGpuFrames:10,maxFrameIntervalP95Ms:17.6,maxCpuFrameP95Ms:16.667,maxGpuP95Ms:16.667};
  const valid={resolution:[1920,1080],requestedFrames:90,frameInterval:{p95Ms:16.5},frameCpu:{p95Ms:9},gpu:{p95Ms:7,samples:80},timestampQueries:true,adapter:{vendor:'NVIDIA'}};
  assert.equal(verifyGpuProfile(valid,cfg).passed,true);
  assert.equal(verifyGpuProfile({...valid,gpu:null},cfg).passed,false);
  assert.equal(verifyGpuProfile({...valid,resolution:[960,540]},cfg).passed,false);
  assert.equal(verifyGpuProfile({...valid,timestampQueries:false},cfg).passed,false);
  assert.equal(verifyGpuProfile({...valid,frameInterval:{p95Ms:22}},cfg).passed,false);
  assert.equal(checkRange('bad',NaN,10).passed,false);
});
