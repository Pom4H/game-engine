import test from 'node:test';
import assert from 'node:assert/strict';
import {containsClipBounds,intersectsClip} from '../dist/render/visibility.js';
import {compose,lookAt,multiply4,perspective} from '../dist/math.js';

const rng=(()=>{let n=0x5eed;return()=>((n=(Math.imul(n,1664525)+1013904223)>>>0)/4294967296);})();
const rnd=(a,b)=>a+(b-a)*rng();
const unitBounds={center:[0,0,0],half:[.5,.5,.5]};
const vp=multiply4(perspective(Math.PI/3,1280/720,.1,1000),lookAt([0,0,40],[0,0,0]));

function clip(point,model){
 const x=point[0],y=point[1],z=point[2];
 return [
  model[0]*x+model[4]*y+model[8]*z+model[12],
  model[1]*x+model[5]*y+model[9]*z+model[13],
  model[2]*x+model[6]*y+model[10]*z+model[14],
  model[3]*x+model[7]*y+model[11]*z+model[15]
 ];
}
test('contained world envelope guarantees every rotated/scaled cube is in WebGPU clip',()=>{
 const objects=[];
 const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
 for(let i=0;i<200;i++){
  const p=[rnd(-20,20),rnd(-10,10),rnd(-12,4)];
  const euler=[rnd(-Math.PI,Math.PI),rnd(-Math.PI,Math.PI),rnd(-Math.PI,Math.PI)];
  const scale=[rnd(.7,1.3),rnd(.7,1.3),rnd(.7,1.3)];
  const radius=Math.hypot(...scale.map(v=>v*.5));
  for(let a=0;a<3;a++){lo[a]=Math.min(lo[a],p[a]-radius);hi[a]=Math.max(hi[a],p[a]+radius);}
  objects.push({model:compose(p,euler,scale)});
 }
 const envelope={center:hi.map((v,a)=>(v+lo[a])/2),half:hi.map((v,a)=>(v-lo[a])/2)};
 assert.equal(containsClipBounds(envelope,vp),true,'Test fixture should exercise the shortcut');
 for(const {model} of objects){
  assert.equal(intersectsClip(unitBounds,multiply4(vp,model)),true);
  const transform=multiply4(vp,model);
  for(const x of [-.5,.5])for(const y of [-.5,.5])for(const z of [-.5,.5]){
   const p=clip([x,y,z],transform),epsilon=1e-4;
   assert.ok(p[0]>=-p[3]-epsilon&&p[0]<=p[3]+epsilon);
   assert.ok(p[1]>=-p[3]-epsilon&&p[1]<=p[3]+epsilon);
   assert.ok(p[2]>=-epsilon&&p[2]<=p[3]+epsilon);
  }
 }
});
test('envelope shortcut rejects straddlers and boxes outside a frustum',()=>{
 const identity=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
 assert.equal(containsClipBounds({center:[0,0,.5],half:[.1,.1,.1]},identity),true);
 assert.equal(containsClipBounds({center:[0,0,.01],half:[.1,.1,.1]},identity),false);
 assert.equal(containsClipBounds({center:[1,0,.5],half:[.1,.1,.1]},identity),false);
 assert.equal(containsClipBounds({center:[0,0,1.01],half:[.1,.1,.1]},identity),false);
});
