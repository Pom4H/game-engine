import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {PhysicsWorld,RigidBody} from '../../dist/physics/world.js';
import {createWasmRigidContactKernel} from '../../dist/physics/rigid-wasm.js';
import {evaluateFracture} from '../../dist/materials/fracture.js';
import {material} from '../../dist/materials/catalog.js';

const root=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const module=await WebAssembly.compile(new Uint8Array(readFileSync(resolve(root,'kernels/world-rigid/target/wasm32-unknown-unknown/release/world_rigid_kernel.wasm'))));
const quick=process.argv.includes('--quick'),warmup=quick?20:80,ticks=quick?80:180,rounds=quick?2:5;
const workloads=[
 {id:'2-moving-cars-natural',count:2,spacing:3.8,reset:false,material:false},
 {id:'16-moving-cars-dense',count:16,spacing:3.7,reset:true,material:false},
 {id:'64-moving-cars-dense',count:64,spacing:3.7,reset:true,material:false},
 {id:'64-moving-cars-dense-materials',count:64,spacing:3.7,reset:true,material:true},
 {id:'64-moving-cars-sparse',count:64,spacing:22,reset:true,material:false},
];
function createWorld(workload){
 const world=new PhysicsWorld([0,0,0],-100);
 const bodies=[];
 for(let i=0;i<workload.count;i++){
   const x=(i%8)*workload.spacing;
   const z=Math.floor(i/8)*(workload.spacing>10?workload.spacing:1.7);
   const body=new RigidBody({id:'car'+i,position:[x,4,z],
     rotation:[0,i%3*.03,0],velocity:[i%2?-2:2,0,0],
     mass:1700,shape:{kind:'box',half:[2.1,.72,.95]},
     friction:.88,restitution:.12,material:material('steel')});
   world.add(body);bodies.push(body);
 }
 const initial=bodies.map(body=>({p:[...body.position],r:[...body.rotation],v:[...body.velocity]}));
 return{world,bodies,initial};
}
function authoredControl(state){
 for(let i=0;i<state.bodies.length;i++){
  const b=state.bodies[i],start=state.initial[i];
  for(let k=0;k<3;k++){
   b.position[k]=start.p[k];b.rotation[k]=start.r[k];b.velocity[k]=start.v[k];
   b.angularVelocity[k]=0;
  }
  b.sleeping=false;b.sleepTimer=0;
 }
}
const materialPolicy=contact=>evaluateFracture(contact).decision;
function advance(context){
 if(context.workload.reset)authoredControl(context.state);
 context.state.world.step(1/120,context.workload.material?materialPolicy:undefined);
 context.contacts+=context.state.world.contacts.length;
}
async function setup(workload,backend){
 const state=createWorld(workload);
 const kernel=backend==='typescript'?null:await createWasmRigidContactKernel(module);
 const installed=backend==='wasm-serial'&&kernel?{
  test:(a,b)=>kernel.test(a,b),resolve:contact=>kernel.resolve(contact),dispose:()=>{},
 }:kernel;
 state.world.setRigidContactKernel(installed);
 const context={state,kernel,backend,workload,contacts:0,samples:[]};
 for(let i=0;i<warmup;i++)advance(context);
 context.contacts=0;
 return context;
}
function median(values){
 const sorted=[...values].sort((a,b)=>a-b);
 return sorted[Math.floor(sorted.length/2)];
}
const results=[];
for(const workload of workloads){
 const contexts={};
 try{
  contexts.typescript=await setup(workload,'typescript');
  contexts.wasm=await setup(workload,'wasm');
  contexts.serial=await setup(workload,'wasm-serial');
  for(let round=0;round<rounds;round++){
   // Interleave backends to reduce CPU frequency/load/JIT ordering bias.
   const order=round%2===0?['typescript','wasm-serial','wasm']:['wasm','wasm-serial','typescript'];
   for(const backend of order){
    const context=contexts[backend],start=performance.now();
    for(let tick=0;tick<ticks;tick++)advance(context);
    context.samples.push((performance.now()-start)/ticks);
   }
  }
  const ts=contexts.typescript,wasm=contexts.wasm,serial=contexts.serial;
  if(ts.contacts!==wasm.contacts||ts.contacts!==serial.contacts)
   throw new Error('Contact replay count changed for '+workload.id);
  const jsMs=median(ts.samples),wasmMs=median(wasm.samples),serialMs=median(serial.samples);
  const speedup=jsMs/wasmMs;
  const calls=wasm.state.world.rigidContactDiagnostics;
  if(!workload.material&&workload.count>2&&workload.spacing<10&&calls.calls===0)
   throw new Error('Expected actual Rust batch execution in '+workload.id);
  if(workload.material&&calls.calls!==0)
   throw new Error('Material-coupled world was unsafely batched');
  console.log(workload.id+': JS '+jsMs.toFixed(4)+'ms/tick, serial WASM '+
   serialMs.toFixed(4)+'ms/tick, batched WASM '+wasmMs.toFixed(4)+
   'ms/tick, vs JS '+speedup.toFixed(2)+'x, vs serial '+(serialMs/wasmMs).toFixed(2)+
   'x, contacts '+ts.contacts);
  results.push({
   workload,typescript:{medianMs:jsMs,roundMsPerTick:ts.samples,contacts:ts.contacts},
   serialWasm:{medianMs:serialMs,roundMsPerTick:serial.samples,contacts:serial.contacts},
   wasm:{medianMs:wasmMs,roundMsPerTick:wasm.samples,contacts:wasm.contacts},
   batch:calls,speedup,versusSerial:serialMs/wasmMs,
  });
 }finally{
  for(const context of Object.values(contexts)){
   context.state.world.setRigidContactKernel(null);context.kernel?.dispose();
  }
 }
}
const report={
 schema:3,commit:process.env.GITHUB_SHA??null,node:process.version,platform:process.platform,machine:process.arch,
 method:'Production PhysicsWorld 120 Hz. Three backends (JS, serial WASM, batched WASM), warmup outside timing, five alternating rounds of 180 ticks each. Per-tick cost includes scripted reset where marked, original broadphase, material callback where marked, impulses and sleeping. Identical initial fixtures and contact counts.',
 caveats:'Batch optimizes pure rigid contacts for each current A body. Material laws, causal traces, horizontal surfaces and oversized queries fall back to deterministic sequential code. Contact-heavy scripted replay repeats impacts; this is not an FPS measurement.',
 workloads:results,
};
mkdirSync(resolve(root,'artifacts/world-rigid'),{recursive:true});
writeFileSync(resolve(root,'artifacts/world-rigid/benchmark.json'),JSON.stringify(report,null,2)+'\n');
