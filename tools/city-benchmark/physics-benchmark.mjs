import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {Scene} from '../../dist/scene/scene.js';
import {createWasmRigidContactKernel} from '../../dist/physics/rigid-wasm.js';
import city,{cityMetadata,CITY_TRAFFIC} from './scene.mjs';
import {cityCameraAtTick,CITY_ROUTE_TICKS} from './route.mjs';

const wasmPath=resolve('kernels/world-rigid/target/wasm32-unknown-unknown/release/world_rigid_kernel.wasm');
const wasm=await WebAssembly.compile(new Uint8Array(readFileSync(wasmPath)));
const quick=process.argv.includes('--quick');
const parityTicks=quick?48:CITY_ROUTE_TICKS;
const timedTicks=quick?36:90;
const warmup=quick?12:36;
const count=4; // A-B-B-A reduces order and CPU warming bias.
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const round=n=>Number(n.toFixed(5));
const hash=createHash('sha256');

function bodyStates(scene){
 return [...scene.physics.bodies.values()].filter(body=>body.invMass>0).map(body=>({
  id:body.id,position:[...body.position],rotation:[...body.rotation],
  velocity:[...body.velocity],angularVelocity:[...body.angularVelocity],
  sleeping:body.sleeping,sleepTimer:body.sleepTimer,
  crushPositive:[...body.crushPositive],crushNegative:[...body.crushNegative],
 }));
}
function compareState(js,rust,tick){
 const a=bodyStates(js),b=bodyStates(rust);
 assert.equal(b.length,a.length,'body count tick '+tick);
 const drift={tick,maxError:0,owner:null,field:null};
 for(let i=0;i<a.length;i++){
  const ref=a[i],native=b[i];assert.equal(native.id,ref.id,'body identity tick '+tick);
  assert.equal(native.sleeping,ref.sleeping,'sleep tick '+tick+' '+ref.id);
  for(const field of ['position','rotation','velocity','angularVelocity','crushPositive','crushNegative']){
   const left=ref[field],right=native[field];
   for(let k=0;k<left.length;k++){
    const diff=Math.abs(left[k]-right[k]);
    assert.ok(Number.isFinite(diff),'nonfinite '+ref.id+'.'+field+'['+k+'] tick '+tick);
    if(diff>drift.maxError){drift.maxError=diff;drift.owner=ref.id;drift.field=field+'['+k+']';}
    const budget=1e-7+Math.max(Math.abs(left[k]),Math.abs(right[k]))*1e-8;
    assert.ok(diff<=budget,'physical parity tick '+tick+' '+ref.id+'.'+field+'['+k+'] '+left[k]+' / '+right[k]+' diff='+diff);
   }
  }
 }
 assert.equal(rust.physics.contacts.length,js.physics.contacts.length,'contact count tick '+tick);
 for(let i=0;i<js.physics.contacts.length;i++){
  const a=js.physics.contacts[i],b=rust.physics.contacts[i];
  assert.equal(b.a,a.a,'contact body A tick '+tick);
  assert.equal(b.b,a.b,'contact body B tick '+tick);
  assert.equal(b.mode,a.mode,'contact material law tick '+tick);
  for(const key of ['penetration','impulse','normalEnergy','normalSpeed']){
   const budget=1e-6+Math.abs(a[key])*1e-8;
   assert.ok(Math.abs(a[key]-b[key])<=budget,'contact '+key+' tick '+tick+': '+a[key]+' != '+b[key]);
  }
 }
 return drift;
}
async function session(backend){
 const scene=new Scene(city);
 const kernel=backend==='rust'?await createWasmRigidContactKernel(wasm):null;
 if(kernel)scene.physics.setRigidContactKernel(kernel);
 return{scene,kernel,close(){scene.physics.setRigidContactKernel(null);kernel?.dispose();}};
}
async function parity(){
 const a=await session('js'),b=await session('rust');
 const drift=[],traffic=new Set(city.entities.filter(e=>e.id.startsWith('bench-car-')).map(e=>e.id));
 let maximum=0,contactTotal=0;
 try{
  assert.equal(traffic.size,CITY_TRAFFIC);
  for(let tick=0;tick<parityTicks;tick++){
   const camera=cityCameraAtTick(tick);
   a.scene.setCamera(camera);b.scene.setCamera(camera);
   a.scene.step(1/60);b.scene.step(1/60);
   const result=compareState(a.scene,b.scene,tick);
   maximum=Math.max(maximum,result.maxError);
   if(tick%12===0)drift.push(result);
   contactTotal+=a.scene.physics.contacts.length;
   hash.update(JSON.stringify(bodyStates(a.scene).map(b=>[b.id,b.position,b.rotation,b.velocity,b.angularVelocity])));
  }
  assert.ok(contactTotal>0,'city must create real rigid contacts');
  const diagnostics=b.scene.physics.rigidContactDiagnostics;
  assert.ok(diagnostics.calls+diagnostics.serialPairs>0,'Rust kernel did not execute any real contacts');
  return{ticks:parityTicks,maxPositionOrVelocityDrift:maximum,contactTotal,
    referenceFingerprint:hash.digest('hex'),rustDispatch:diagnostics,
    sampledDrift:drift,
    note:'Parity compares entire PhysicsWorld dynamic body state and contact laws each simulation tick.'};
 }finally{a.close();b.close();}
}
const proof=await parity();
const timings={js:[],rust:[]},usage={};
for(let trial=0;trial<count;trial++){
 const backend=['js','rust','rust','js'][trial];
 const item=await session(backend);
 try{
  const {scene}=item;
  for(let tick=0;tick<warmup;tick++){
   scene.setCamera(cityCameraAtTick(tick%CITY_ROUTE_TICKS));
   scene.step(1/60);
  }
  const start=performance.now();
  let contactTotal=0;
  for(let tick=0;tick<timedTicks;tick++){
   scene.setCamera(cityCameraAtTick((warmup+tick)%CITY_ROUTE_TICKS));
   scene.step(1/60);
   contactTotal+=scene.physics.contacts.length;
  }
  const ms=(performance.now()-start)/timedTicks;
  timings[backend].push(ms);
  usage[backend]={contacts:contactTotal,diagnostics:scene.physics.rigidContactDiagnostics,
   bodies:scene.physics.bodies.size,entities:scene.entities.size};
 }finally{item.close();}
}
const js=median(timings.js),rust=median(timings.rust);
const report={
 schema:1,commit:process.env.GITHUB_SHA??null,
 platform:process.platform,architecture:process.arch,node:process.version,
 fixture:cityMetadata,sceneEntityCount:city.entities.length,
 method:'Identical production SceneSpec, deterministic 60Hz camera/ticks/physics. A-B-B-A on the same machine. Rust replaces only PhysicsWorld rigid contacts; all other JS systems remain identical.',
 parity:proof,
 benchmark:{
  ticksPerTrial:timedTicks,warmupTicks:warmup,
  js:{medianMsPerTick:round(js),trialsMsPerTick:timings.js.map(round)},
  rust:{medianMsPerTick:round(rust),trialsMsPerTick:timings.rust.map(round)},
  speedupJsOverRust:round(js/rust),
  diagnostic:usage,
  warning:'Full Scene.tick CPU, including weather/animation/deformation. Rust accelerates only the rigid contact kernel; parity is a hard gate, speedup is measured not assumed.',
 }
};
mkdirSync(resolve('artifacts/city-benchmark'),{recursive:true});
writeFileSync(resolve('artifacts/city-benchmark/physics-js-rust.json'),JSON.stringify(report,null,2)+'\n');
console.log('CITY_PHYSICS_BENCHMARK='+JSON.stringify(report));
