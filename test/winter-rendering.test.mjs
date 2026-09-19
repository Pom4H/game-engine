import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene,EngineKernel,primitiveMesh,primitiveKey,validateScene} from '../dist/index.js';
import {snowDriftMesh} from '../dist/procedural/mesh.js';
import {WebGPURenderer} from '../dist/render/webgpu.js';

test('adjacent continuous snow banks share heights and normals without floating edges',()=>{
 const size=[6,.85,1.2],a=snowDriftMesh(size,31,48,true,0),b=snowDriftMesh(size,31,48,true,6),row=49,rows=a.vertices.length/6/row;
 for(let z=0;z<rows;z++){
  const ai=(z*row+48)*6,bi=z*row*6;
  for(const c of [1,3,4,5])assert.ok(Math.abs(a.vertices[ai+c]-b.vertices[bi+c])<1e-5,`seam row ${z} component ${c}`);
 }
 for(const mesh of [a,b])for(let i=0;i<mesh.vertices.length;i+=6){
  assert.ok(mesh.vertices[i+1]>=0);
  assert.ok(Math.abs(Math.hypot(...mesh.vertices.slice(i+3,i+6))-1)<1e-6);
  if(Math.abs(Math.abs(mesh.vertices[i+2])-.6)<1e-6)assert.equal(mesh.vertices[i+1],0);
 }
 const extreme=snowDriftMesh([.0001,1,100000],42,128);assert.ok(extreme.vertices.length<=129*129*6);
});

test('prism normals point outward for every extrusion axis and either winding',()=>{
 for(const axis of [0,1,2])for(const reversed of [false,true]){
  const square=[[-1,-1],[1,-1],[1,1],[-1,1]];if(reversed)square.reverse();
  const {vertices:v}=primitiveMesh({kind:'polygon-prism',axis,points:square,thickness:.6});
  for(let i=0;i<v.length;i+=6)assert.ok(v[i]*v[i+3]+v[i+1]*v[i+4]+v[i+2]*v[i+5]>0);
 }
});

test('runtime geometry owns an immutable copy and mutable authoring keys stay current',()=>{
 const mesh={kind:'triangle-mesh',positions:[0,0,0,1,0,0,0,0,1],normals:[0,1,0,0,1,0,0,1,0],indices:[0,1,2]};
 const scene=new Scene({version:1,entities:[{id:'geometry',mesh}]});const runtime=scene.entities.get('geometry').mesh;
 const before=primitiveKey(mesh);mesh.positions[0]=10;assert.notEqual(primitiveKey(mesh),before);assert.equal(runtime.positions[0],0);const shallow=Object.freeze({kind:'box',size:[1,1,1]});const shallowKey=primitiveKey(shallow);shallow.size[0]=2;assert.notEqual(primitiveKey(shallow),shallowKey);
 assert.throws(()=>runtime.positions[0]=10,TypeError);assert.throws(()=>runtime.indices.push(1),TypeError);
});

test('lazy contexts are projected only when a consumer runs and include prior commits',()=>{
 let reads=0,state=0,seen;const kernel=new EngineKernel();
 kernel.use({id:'writer',phase:'simulate',rateHz:60,context:'none',reads:[],writes:['x'],run:()=>[1]});
 kernel.use({id:'reader',phase:'publish',rateHz:30,reads:['x'],writes:[],run:c=>{seen=c.x;assert.throws(()=>c.x=999,TypeError);}});
 const options={read:()=>{reads++;return{x:state};},commit:commands=>{state+=commands[0];return{x:state};}};
 kernel.run(1,{},'detailed',options);assert.equal(reads,0);kernel.run(2,{},'detailed',options);assert.equal(reads,1);assert.equal(seen,2);
});

test('initial ice and snow populate local winter fields without requiring time acceleration',()=>{
 const scene=new Scene({version:1,environment:{temperatureC:-6,snowfall:'none',sunlight:0},entities:[{id:'road',mesh:{kind:'box',size:[8,.2,4]},material:{kind:'asphalt'},environmental:{surfaceUse:'road',snowDepthM:.07,iceDepthM:.002}}]});scene.step();
 const cell=scene.winter.sample('road',0,0);assert.ok(cell.snowDepthM>=.069);assert.ok(cell.iceDepthM>=.0019);assert.ok(cell.frictionScale<1);
});

test('render controls and malformed indexed meshes fail before GPU allocation',()=>{
 for(const rendering of [{sunDirection:[0,0,0]},{shadowExtent:0},{skyColor:[1,-1,1]},{exposure:NaN}])assert.throws(()=>validateScene({version:1,entities:[],rendering}),/rendering/);
 assert.throws(()=>validateScene({version:1,entities:[{id:'bad',mesh:{kind:'triangle-mesh',positions:[0,0,0,1,0,0,0,1,0],normals:[0,1,0,0,1,0,0,1,0],indices:[0,1,3]}}]}),/indices/);
});

test('GPU cache collection preserves borrowed neutral textures and collects stale labels',()=>{
 const renderer=Object.create(WebGPURenderer.prototype),destroyed=[],handle=id=>({destroy:()=>destroyed.push(id)});
 renderer.objects=new Map([['gone',{uniform:handle('uniform'),texture:handle('shared-neutral'),owned:false}]]);
 renderer.meshes=new Map();renderer.labels=new Map([['gone-label',handle('label')]]);
 renderer.collect({entities:new Map()});assert.deepEqual(destroyed,['label','uniform']);
});

test('spatial ambience follows listener orientation, attenuates with distance and is reproducible',async()=>{
 const {renderAmbience}=await import('../dist/index.js');
 const render=(vehicle,target=[0,1,-1])=>renderAmbience([{time:0,listener:[0,1,0],target,vehicle,speedMps:4.8}],.1,{sampleRate:8000,seed:17,windSpeedMps:0});
 const rms=a=>Math.sqrt(a.reduce((sum,x)=>sum+x*x,0)/a.length);
 const near=render([5,1,-2]),far=render([50,1,-20]),turned=render([5,1,-2],[0,1,1]);
 assert.ok(rms(near.right)>rms(near.left)*2);assert.ok(rms(turned.left)>rms(turned.right)*2);assert.ok(rms(far.right)<rms(near.right)*.15);
 assert.deepEqual(near,render([5,1,-2]));
 assert.throws(()=>renderAmbience([],1),/parameters/);
 assert.throws(()=>renderAmbience([{time:0,listener:[NaN,0,0],target:[0,0,1],vehicle:[0,0,0],speedMps:1}],1),/finite/);
});

test('cinematic glass study fractures from contact and preserves fragment shading controls',async()=>{
 const {makeLaboratory}=await import('../tools/promo/laboratory.mjs');const scene=new Scene(makeLaboratory().spec);let fracture;
 for(let i=0;i<30;i++){scene.step();fracture??=scene.drainEvents().find(e=>e.type==='fracture');}
 assert.ok(fracture);assert.ok(fracture.energy>fracture.requiredEnergy);assert.equal(fracture.shardCount,38);
 const fragments=[...scene.entities.values()].filter(e=>e.id.startsWith('glass:shard:'));assert.equal(fragments.length,38);for(const f of fragments)assert.equal(f.material.roughness,.09);
});

test('snow visual disappears after melting and longitudinal tiles use the same world direction',()=>{
 const scene=new Scene({version:1,environment:{temperatureC:-6,snowfall:'none'},entities:[{id:'curb',mesh:{kind:'box',size:[.2,.2,12]},material:{kind:'concrete'},environmental:{surfaceUse:'curb',snowDepthM:.2}}]});scene.step();
 const drifts=[...scene.entities.values()].filter(e=>e.id.startsWith('__winter:drift:'));
 assert.equal(drifts.length,2);assert.ok(drifts.every(d=>d.rotation[1]===-Math.PI/2));
 for(const c of scene.winter.field('curb').cells)c.snowDepthM=0;
 scene.step();assert.equal([...scene.entities.keys()].filter(id=>id.startsWith('__winter:drift:')).length,0);
});
