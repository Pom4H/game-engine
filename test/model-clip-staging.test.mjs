import test from 'node:test';
import assert from 'node:assert/strict';
import {intersectsModelClip} from '../dist/render/visibility.js';
import {compose,lookAt,multiply4,perspective} from '../dist/math.js';
import {originalClipProduct,originalClipTrace} from './fixtures/model-clip-before-staging.mjs';

const identity=()=>new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
const unit={center:[0,0,0],half:[.5,.5,.5]};
const bits=value=>new Uint32Array(value.buffer,value.byteOffset,value.length);
function random(seed){let n=seed;return()=>((n=(Math.imul(n,1664525)+1013904223)>>>0)/4294967296);}
function verify(bounds,vp,model,label){
 const expected=originalClipProduct(vp,model),trace=originalClipTrace(bounds,expected),scratch=new Float32Array(16),scratchBits=bits(scratch);
 const beforeVp=new Uint32Array(bits(vp)),beforeModel=new Uint32Array(bits(model));
 scratchBits.fill(0x7fa12345);
 assert.equal(intersectsModelClip(bounds,vp,model,scratch),trace.visible,label);
 const lastRow=trace.visible?2:trace.plane>>1,expectedBits=bits(expected);
 for(let i=0;i<16;i++){
  const row=i%4;
  if(row===3||row<=lastRow){
   // NaN payloads are not JavaScript semantics; finite values, signed zero and
   // infinities must retain their exact float32 bits on every calculated row.
   if(Number.isNaN(expected[i]))assert.ok(Number.isNaN(scratch[i]),label+' NaN row '+i);
   else assert.equal(scratchBits[i],expectedBits[i],label+' float32 row '+i);
  }else assert.equal(scratchBits[i],0x7fa12345,label+' untouched row '+i);
 }
 assert.deepEqual(bits(vp),beforeVp,label+' projection input');
 assert.deepEqual(bits(model),beforeModel,label+' model input');
 return trace;
}

test('staged model clip matches 12,000 arbitrary frozen products and their computed float32 rows',()=>{
 const rng=random(0xdecafbad),value=()=>((rng()-.5)*2)*10**Math.floor(rng()*76-38);
 for(let n=0;n<12000;n++){
  const vp=Float32Array.from({length:16},value),model=Float32Array.from({length:16},value);
  const bounds={center:[value(),value(),value()],half:[Math.abs(value()),Math.abs(value()),Math.abs(value())]};
  verify(bounds,vp,model,'arbitrary '+n);
 }
});

test('staged model clip preserves projective lights, large coordinates and direct signed scales',()=>{
 const rng=random(0x5c07),rnd=(a,b)=>a+(b-a)*rng();
 for(let n=0;n<6000;n++){
  const magnitude=n%4===0?1e7:n%4===1?1e-5:200,eye=[rnd(-magnitude,magnitude),rnd(-magnitude,magnitude),rnd(-magnitude,magnitude)];
  const axis=[rnd(-1,1),rnd(-1,1),rnd(-1,1)],target=eye.map((value,i)=>value+axis[i]);
  const vp=multiply4(perspective(rnd(.02,3),rnd(.2,3),.08,rnd(1,2000)),lookAt(eye,target));
  const model=compose([rnd(-magnitude,magnitude),rnd(-magnitude,magnitude),rnd(-magnitude,magnitude)],[rnd(-Math.PI,Math.PI),rnd(-Math.PI,Math.PI),rnd(-Math.PI,Math.PI)],[rnd(-20,20),rnd(-20,20),rnd(-20,20)]);
  verify({center:[rnd(-2,2),rnd(-2,2),rnd(-2,2)],half:[rnd(0,3),rnd(0,3),rnd(0,3)]},vp,model,'projective '+n);
 }
});

test('all six WebGPU planes keep the original epsilon on both sides of contact',()=>{
 const offsets=[-1e-3,-1e-5-1e-10,-1e-5,-1e-5+1e-10,-1e-7,0,1e-7,1e-5,1e-3];
 for(let plane=0;plane<6;plane++)for(const offset of offsets)for(const w of [1e-8,1,1e8]){
  const row=plane>>1,sign=(plane&1)?-1:1,model=identity();
  model[15]=w;model[14]=w*.5;
  model[12+row]=plane===4?offset:sign*(-w+offset);
  verify({center:[0,0,0],half:[0,0,0]},identity(),model,'plane '+plane+' offset '+offset+' w '+w);
 }
});

test('nonfinite and subnormal inputs retain the old boolean behavior without modifying sources',()=>{
 const special=[NaN,Infinity,-Infinity,0,-0,1.401298464324817e-45,-1.401298464324817e-45,3.4028234663852886e38,-3.4028234663852886e38];
 for(let n=0;n<1024;n++){
  const vp=identity(),model=identity();
  vp[n%16]=special[n%special.length];model[(n*7+3)%16]=special[Math.floor(n/special.length)%special.length];
  verify(unit,vp,model,'nonfinite '+n);
 }
 for(const value of special)for(let axis=0;axis<3;axis++){
  const bounds={center:[0,0,.5],half:[.1,.1,.1]};bounds.center[axis]=value;
  verify(bounds,identity(),identity(),'nonfinite center '+axis+' '+value);
  bounds.center[axis]=0;bounds.half[axis]=value;
  verify(bounds,identity(),identity(),'nonfinite half '+axis+' '+value);
 }
});

test('accepted boxes calculate all rows, while X/Y/Z rejections leave only later rows untouched',()=>{
 for(const position of [[0,0,.5],[10,0,.5],[0,10,.5],[0,0,-10],[0,0,10]]){
  const model=identity();model.set(position,12);
  verify({center:[0,0,0],half:[.1,.1,.1]},identity(),model,'early rows '+position);
 }
});

test('independent transformed-corner oracle agrees away from numerical boundaries',()=>{
 const rng=random(0xc0ffee),rnd=(a,b)=>a+(b-a)*rng();let checked=0;
 for(let n=0;n<4096;n++){
  const vp=multiply4(perspective(rnd(.2,2.5),rnd(.5,2),.08,1000),lookAt([rnd(-20,20),rnd(-20,20),rnd(-20,20)],[0,0,0]));
  const model=compose([rnd(-50,50),rnd(-50,50),rnd(-50,50)],[rnd(-3,3),rnd(-3,3),rnd(-3,3)],[rnd(-4,4),rnd(-4,4),rnd(-4,4)]),combined=originalClipProduct(vp,model);
  const maxima=Array(6).fill(-Infinity);
  for(const x of [-.5,.5])for(const y of [-.5,.5])for(const z of [-.5,.5]){
   const p=[0,1,2,3].map(row=>combined[row]*x+combined[4+row]*y+combined[8+row]*z+combined[12+row]);
   const planes=[p[3]+p[0],p[3]-p[0],p[3]+p[1],p[3]-p[1],p[2],p[3]-p[2]];
   for(let plane=0;plane<6;plane++)maxima[plane]=Math.max(maxima[plane],planes[plane]);
  }
  if(maxima.some(value=>Math.abs(value+1e-5)<1e-7*(1+Math.abs(value))))continue;
  assert.equal(intersectsModelClip(unit,vp,model,new Float32Array(16)),maxima.every(value=>value>=-1e-5),'corner '+n);checked++;
 }
 assert.ok(checked>4000);
});

test('caller-owned scratch stays separate from both inputs, including disjoint views of one buffer',()=>{
 const projection=identity(),model=identity(),scratchOwned=new Float32Array(16);
 assert.notEqual(scratchOwned.buffer,projection.buffer);assert.notEqual(scratchOwned.buffer,model.buffer);
 assert.equal(intersectsModelClip(unit,projection,model,scratchOwned),true);
 const arena=new Float32Array(48),vp=arena.subarray(0,16),source=arena.subarray(16,32),scratch=arena.subarray(32,48);
 vp.set(identity());source.set(identity());
 const beforeVp=new Uint32Array(bits(vp)),beforeSource=new Uint32Array(bits(source));
 assert.ok(scratch.byteOffset>=vp.byteOffset+vp.byteLength&&scratch.byteOffset>=source.byteOffset+source.byteLength);
 assert.equal(intersectsModelClip(unit,vp,source,scratch),true);
 assert.deepEqual(bits(vp),beforeVp);assert.deepEqual(bits(source),beforeSource);
});
