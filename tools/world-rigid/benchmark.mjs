import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {PhysicsWorld,RigidBody} from '../../dist/physics/world.js';
import {createWasmRigidContactKernel} from '../../dist/physics/rigid-wasm.js';
import {material} from '../../dist/materials/catalog.js';

const root=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const module=await WebAssembly.compile(new Uint8Array(readFileSync(resolve(root,'kernels/world-rigid/target/wasm32-unknown-unknown/release/world_rigid_kernel.wasm'))));
const fast=process.argv.includes('--quick'),warmup=fast?25:80,ticks=fast?60:180,rounds=fast?2:5;
const workloads=[
 {id:'2-moving-cars-natural',count:2,spacing:3.8,reset:false},
 {id:'16-moving-cars-dense',count:16,spacing:3.7,reset:true},
 {id:'64-moving-cars-dense',count:64,spacing:3.7,reset:true},
 {id:'64-moving-cars-sparse',count:64,spacing:22,reset:true},
];
function createWorld(workload){
 const world=new PhysicsWorld([0,0,0],-100);
 const bodies=[];
 for(let i=0;i<workload.count;i++){
   const x=(i%8)*workload.spacing;
   const z=Math.floor(i/8)*1.7;
   const body=new RigidBody({id:'car'+i,position:[x,4,z],
     rotation:[0,i%3*.03,0],velocity:[i%2?-2:2,0,0],
     mass:1700,shape:{kind:'box',half:[2.1,.72,.95]},
     friction:.88,restitution:.12,material:material('steel')});
   world.add(body);bodies.push(body);
 }
 // Preserve the independent body state while scripts force repeated car contacts.
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
async function measure(workload,backend){
 const state=createWorld(workload);
 const kernel=backend==='wasm'?await createWasmRigidContactKernel(module):null;
 state.world.setRigidContactKernel(kernel);
 const sample=[],contactCounts=[];
 let calls=0,contactTotal=0;
 const run=t=>{
  if(workload.reset)authoredControl(state);
  state.world.step(1/120);
  contactTotal+=state.world.contacts.length;
  calls++;
 };
 try{
  for(let i=0;i<warmup;i++)run(i);
  const baselineContacts=contactTotal;
  for(let round=0;round<rounds;round++){
   const started=performance.now();
   for(let i=0;i<ticks;i++)run(warmup+round*ticks+i);
   const elapsed=performance.now()-started;
   sample.push(elapsed/ticks);
   contactCounts.push(contactTotal-baselineContacts);
  }
  const sorted=[...sample].sort((a,b)=>a-b),medianMs=sorted[Math.floor(sample.length/2)];
  return{medianMs,roundMsPerTick:sample,timedContacts:contactTotal-baselineContacts,
   totalSteps:calls,physicsSubsteps:state.world.substeps,bodyCount:workload.count};
 }finally{state.world.setRigidContactKernel(null);kernel?.dispose();}
}
const results=[];
for(const workload of workloads){
 const order=results.length%2===0?['typescript','wasm']:['wasm','typescript'];
 const measured={};
 for(const backend of order)measured[backend]=await measure(workload,backend);
 const ratio=measured.typescript.medianMs/measured.wasm.medianMs;
 console.log(workload.id+': JS '+measured.typescript.medianMs.toFixed(4)+
   'ms/tick Rust '+measured.wasm.medianMs.toFixed(4)+'ms/tick, ratio '+ratio.toFixed(2)+'x'+
   ', contacts '+measured.typescript.timedContacts);
 results.push({workload,typescript:measured.typescript,wasm:measured.wasm,speedup:ratio});
}
const report={
 schema:1,commit:process.env.GITHUB_SHA??null,node:process.version,platform:process.platform,
 machine:process.arch,workloads:results,
 method:'Production PhysicsWorld fixed 120 Hz substep, 80 warmup ticks, 5 rounds of 180 measured ticks. Timed operation includes optional scripted body reset (only where reset=true), full broadphase, narrowphase, collision resolution, control+mass handling. Identical fixtures for both backends.',
 caveats:'Native kernel is opt-in and uses per-contact scratch (not zero-copy); tests require numerical parity. Contact-rich reset workloads are repeatable controlled impacts, not natural free-driving footage. Ratios do not imply game FPS gains.',
};
mkdirSync(resolve(root,'artifacts/world-rigid'),{recursive:true});
writeFileSync(resolve(root,'artifacts/world-rigid/benchmark.json'),JSON.stringify(report,null,2)+'\n');
