import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectProbePixels,compareProbePixels} from '../tools/render-stability/probe-readback.mjs';

function cube(size=2){const values=new Float32Array(size*size*6*4);for(let i=0;i<values.length;i+=4)values.set([.125,.5,2,1],i);return{size,words:new Uint32Array(values.buffer)};}

test('probe pixel oracle covers all six faces and distinguishes unchanged, RGB and alpha writes',()=>{
 const before=cube(),after=cube();assert.deepEqual(inspectProbePixels(before),{size:2,faces:6,checkedChannels:96,nonFinite:0,nonblackPixels:24,minRgb:.125,maxRgb:2});
 assert.deepEqual(compareProbePixels(before,after),{checkedChannels:96,changedChannels:0,changedRgbChannels:0,changedPixels:0,maxAbsError:0,maxRgbError:0,rmsError:0});
 const pixels=new Float32Array(after.words.buffer);pixels[5*2*2*4]=.375;pixels[95]=0;
 const changed=compareProbePixels(before,after);assert.equal(changed.changedChannels,2);assert.equal(changed.changedRgbChannels,1);assert.equal(changed.changedPixels,2);assert.equal(changed.maxAbsError,1);assert.equal(changed.maxRgbError,.25);assert.equal(changed.rmsError,Math.sqrt(1.0625/96));
});

test('probe pixel oracle rejects missing faces, mismatched dimensions and non-finite channels',()=>{
 assert.throws(()=>inspectProbePixels({size:2,words:new Uint32Array(80)}),/six square/);assert.throws(()=>compareProbePixels(cube(1),cube(2)),/dimensions/);
 for(const bits of [0x7f800000,0xff800000,0x7fc00001]){const poisoned=cube();poisoned.words[poisoned.words.length-1]=bits;assert.throws(()=>inspectProbePixels(poisoned),/Non-finite/);assert.throws(()=>compareProbePixels(cube(),poisoned),/Non-finite/);}
});
