import test from 'node:test';
import assert from 'node:assert/strict';
import {fogOpticalDepth,fogViewOpticalDepth} from '../dist/render/fog.js';
import {validateScene} from '../dist/scene/validate.js';

test('height fog column matches numerical integration above, below and across the base',()=>{
 for(const [start,end] of [[[0,2,0],[12,2,0]],[[0,2,0],[15,9,2]],[[0,8,0],[8,-2,0]],[[0,-3,0],[8,-2,0]],[[0,0,0],[8,0,0]]]){
  const density=.24,falloff=.25,steps=20000,distance=Math.hypot(...end.map((v,k)=>v-start[k]));let average=0;
  for(let i=0;i<steps;i++){const y=start[1]+(end[1]-start[1])*(i+.5)/steps;average+=Math.exp(-Math.max(0,y)*falloff)/steps;}
  const depth=fogOpticalDepth(start,end,density,falloff);
  assert.ok(Math.abs(depth-distance*density*average)<1e-7);
  assert.equal(depth,fogOpticalDepth(end,start,density,falloff));
 }
 assert.ok(Math.abs(fogOpticalDepth([0,2,0],[12,2,0],.1,0)-1.2)<1e-12);
 assert.equal(fogOpticalDepth([0,2,0],[12,2,0],0,.2),0);
 assert.ok(fogOpticalDepth([0,8,0],[12,8,0],.24,.25)<fogOpticalDepth([0,2,0],[12,2,0],.24,.25));
});

test('fog authoring keeps independent radiance and rejects invalid medium parameters',()=>{
 const spec={version:1,entities:[],rendering:{skyColor:[.01,.01,.01],fogColor:[.095,.112,.13],fogDensity:.24,fogHeightFalloff:.25,fogBaseHeight:0}};
 assert.deepEqual(validateScene(spec).rendering.fogColor,[.095,.112,.13]);
 assert.throws(()=>validateScene({...spec,rendering:{fogHeightFalloff:-1}}),TypeError);
 assert.throws(()=>validateScene({...spec,rendering:{fogColor:[NaN,.1,.1]}}),TypeError);
});

test('camera fog keeps the near zone clear and progressively obscures distance',()=>{
 const depth=distance=>fogViewOpticalDepth([0,2.55,0],[distance,2.55,0],.32,.25,0,2,16);
 assert.equal(depth(2),0);
 const visibility=[4,8,18,30,48].map(distance=>Math.exp(-depth(distance)));
 assert.ok(visibility[0]>.97&&visibility[1]>.8&&visibility[2]<.27&&visibility[3]<.035&&visibility[4]<.002);
 for(let i=1;i<visibility.length;i++)assert.ok(visibility[i]<visibility[i-1]);
 assert.ok(Math.abs(depth(18-1e-6)-depth(18+1e-6))<1e-6);
});
