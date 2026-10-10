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
 const kernel=backend==='wasm'?await createWasmRigidContactKernel(module):null;
 state.world.setRigidContactKernel(kernel);
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
  for(let round=0;round<rounds;round++){
   // Interleave backends to reduce CPU frequency/load/JIT ordering bias.
   const order=round%2===0?['typescript','wasm']:['wasm','typescript'];
   for(const backend of order){
    const context=contexts[backend],start=performance.now();
    for(let tick=0;tick<ticks;tick++)advance(context);
    context.samples.push((performance.now()-start)/ticks);
   }
  }
  const ts=contexts.typescript,wasm=contexts.wasm;
  if(ts.contacts!==wasm.contacts)throw new Error('Contact replay count changed for '+workload.id+': '+ts.contacts+' vs '+wasm.contacts);
  const jsMs=median(ts.samples),wasmMs=median(wasm.samples),speedup=jsMs/wasmMs;
  console.log(workload.id+': JS '+jsMs.toFixed(4)+'ms/tick Rust '+
   wasmMs.toFixed(4)+'ms/tick, ratio '+speedup.toFixed(2)+'x, contacts '+ts.contacts);
  results.push({
   workload,typescript:{medianMs:jsMs,roundMsPerTick:ts.samples,contacts:ts.contacts},
   wasm:{medianMs:wasmMs,roundMsPerTick:wasm.samples,contacts:wasm.contacts},
   speedup,
  });
 }finally{
  for(const context of Object.values(contexts)){
   context.state.world.setRigidContactKernel(null);context.kernel?.dispose();
  }
 }
}
const report={
 schema:2,commit:process.env.GITHUB_SHA??null,node:process.version,platform:process.platform,machine:process.arch,
 method:'Production PhysicsWorld 120 Hz. Warmup outside timing; five alternating backend rounds of 180 ticks each. Per-tick cost includes optional scripted pose reset, existing broadphase, material callback (marked), narrowphase, pair impulses, and sleeping. Independent worlds with identical fixtures; contact counts must match exactly.',
 caveats:'Native kernel remains opt-in. Contact-heavy scripted replay repeats impacts for stress testing. Sparse case must have zero pair contacts and is an overhead control. Natural case may have no contacts after warmup. Report is not an FPS measurement.',
 workloads:results,
};
mkdirSync(resolve(root,'artifacts/world-rigid'),{recursive:true});
writeFileSync(resolve(root,'artifacts/world-rigid/benchmark.json'),JSON.stringify(report,null,2)+'\n');
