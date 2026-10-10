import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {StructuralBody} from '../dist/physics/structure.js';
import {createWasmStructuralBody} from '../dist/physics/structure-wasm.js';
import {StructuralStaticContactSolver} from '../dist/physics/structural-contact.js';
import {passengerStructuralDefinition} from '../dist/vehicles/passenger.js';
import {M3_PARAMETRIC_PROFILE} from '../dist/vehicles/m3.js';
import {material} from '../dist/materials/catalog.js';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const wasmPath=resolve(root,'kernels/world-structure/target/wasm32-unknown-unknown/release/world_structure_kernel.wasm');
const module=await WebAssembly.compile(new Uint8Array(readFileSync(wasmPath)));
const steel=material('steel').mechanical;
const car=passengerStructuralDefinition(M3_PARAMETRIC_PROFILE,1700,steel);
const tetra={nodes:[
 {position:[0,0,0],mass:1},{position:[1,0,0],mass:1},{position:[0,1,0],mass:1},{position:[0,0,1],mass:1},
],constraints:[
 {kind:'distance',a:0,b:1,areaM2:1e-5,material:steel},
 {kind:'distance',a:0,b:2,areaM2:1e-5,material:steel},
 {kind:'distance',a:0,b:3,areaM2:1e-5,material:steel},
 {kind:'volume',a:0,b:1,c:2,d:3,compliance:2.5e-10,yieldRatio:.1,breakRatio:.5,plasticity:.22},
],iterations:10,sleepSpeed:.01,sleepDelay:10,internalDamping:11};

const fields=['position','previous','velocity','force','mass','inverseMass',
 'originalPosition','kind','ia','ib','ic','id','originalRest','rest',
 'compliance','yieldLimit','breakLimit','plasticity','yieldForce','lambda',
 'predictedMeasure','impulseWeights','broken'];

function parity(a,b,tick,abs=1e-9,rel=1e-10){
 for(const key of fields){
  assert.equal(a[key].length,b[key].length,key);
  for(let i=0;i<a[key].length;i++){
   const x=a[key][i],y=b[key][i],diff=Math.abs(x-y);
   assert.ok(Number.isFinite(x)&&Number.isFinite(y),'non-finite '+key+' tick '+tick);
   assert.ok(diff<=abs+Math.max(Math.abs(x),Math.abs(y))*rel,
    'first divergence: tick '+tick+' '+key+'['+i+'] TS='+x+' Rust='+y+' diff='+diff);
  }
 }
 for(const key of ['plasticWorkJ','quietTime','steps']){
  const x=a[key],y=b[key];
  assert.ok(Math.abs(x-y)<=abs+rel*Math.abs(x),'scalar divergence '+key+' tick '+tick+': '+x+' '+y);
 }
 assert.equal(a.mode,b.mode,'lifecycle '+tick);
}
function input(body,tick){
 body.wake();
 const a=((tick*7)%body.nodeCount)*3,last=(body.nodeCount-1)*3,f=40*Math.sin(tick*.13);
 body.force[a]+=f;body.force[last]-=f;
 if(tick===22||tick===100){
  body.velocity[0]+=tick===100?48:5;
  body.velocity[3]-=tick===100?48:5;
 }
 if(tick===125)body.setThermalScale(1.0004);
}

for(const [name,definition] of [['M3 structure',car],['mixed tetra',tetra]]){
 test('Rust XPBD parity '+name+' 240 ticks with plasticity and fracture',async()=>{
  const js=new StructuralBody(definition),wasm=await createWasmStructuralBody(definition,module);
  try{
   assert.equal(wasm.backend,'wasm');
   for(const key of fields)assert.deepEqual(js[key],wasm[key],'initial '+key);
   assert.strictEqual(wasm.position.buffer,wasm.broken.buffer,'one Rust-owned WASM heap');
   const original=wasm.position.buffer;
   for(const b of [js,wasm])b.activateFromRigid(b.centerOfMass(),[.3,-.1,.2],[0,0,0]);
   for(let tick=0;tick<240;tick++){
    input(js,tick);input(wasm,tick);
    js.step(1/120,[0,0,0]);wasm.step(1/120,[0,0,0]);
    parity(js,wasm,tick);
   }
   assert.strictEqual(wasm.position.buffer,original,'WASM must never grow while stepping');
   assert.ok(wasm.stats.broken>0,'fixture must exercise fracture');
  }finally{wasm.detachKernel();}
 });
}
test('arbitrary structural collision projectors preserve TS behavior on shared Rust buffers',async()=>{
 const box={id:'barrier',center:[1,0,0],half:[.4,.4,.4]};
 const definition={...tetra,collisionTriangles:[[0,1,2],[0,2,3]],sleepDelay:10};
 const a=new StructuralBody(definition),b=await createWasmStructuralBody(definition,module);
 const ca=new StructuralStaticContactSolver([box],definition.collisionTriangles);
 const cb=new StructuralStaticContactSolver([box],definition.collisionTriangles);
 try{
  for(const body of [a,b])body.activateFromRigid(body.centerOfMass(),[0,0,0],[0,0,0]);
  for(let tick=0;tick<40;tick++){
   a.step(1/120,[0,0,0],body=>ca.project(body));
   b.step(1/120,[0,0,0],body=>cb.project(body));
   parity(a,b,tick);
  }
  assert.equal(cb.stats.contacts,ca.stats.contacts);
  assert.equal(b.backend,'wasm');
 }finally{b.detachKernel();}
});
test('explicit detachment restores TS arrays and continuing physical dynamics',async()=>{
 const reference=new StructuralBody(tetra);
 const body=await createWasmStructuralBody(tetra,module);
 for(const b of [reference,body])b.activateFromRigid(b.centerOfMass(),[.4,.1,-.2],[0,0,0]);
 for(let i=0;i<20;i++){reference.step(1/120,[0,-9.81,0]);body.step(1/120,[0,-9.81,0]);}
 parity(reference,body,20);
 const old=body.position.buffer;
 body.detachKernel();
 assert.equal(body.backend,'typescript');
 assert.notStrictEqual(body.position.buffer,old);
 for(let i=0;i<20;i++){reference.step(1/120,[0,-9.81,0]);body.step(1/120,[0,-9.81,0]);}
 parity(reference,body,40);
});
