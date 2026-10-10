import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {StructuralBody} from '../../dist/physics/structure.js';
import {createWasmStructuralBody} from '../../dist/physics/structure-wasm.js';
import {PhysicsWorld,RigidBody} from '../../dist/physics/world.js';
import {passengerStructuralDefinition} from '../../dist/vehicles/passenger.js';
import {M3_PARAMETRIC_PROFILE} from '../../dist/vehicles/m3.js';
import {material} from '../../dist/materials/catalog.js';
import {StructuralStaticContactSolver} from '../../dist/physics/structural-contact.js';
const root=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const compiled=await WebAssembly.compile(new Uint8Array(readFileSync(resolve(root,'kernels/world-structure/target/wasm32-unknown-unknown/release/world_structure_kernel.wasm'))));
const definition=passengerStructuralDefinition(M3_PARAMETRIC_PROFILE,1700,material('steel').mechanical);
const fast=process.argv.includes('--quick'),ticks=fast?35:110,rounds=fast?2:5,warmup=40,dt=1/120;
const metrics=[];
function worldFixture(){
 const world=new PhysicsWorld([0,-9.81,0],-100);
 world.add(new RigidBody({id:'floor',position:[0,-.25,0],shape:{kind:'box',half:[16,.25,16]},mass:0,material:material('concrete')}));
 for(let i=0;i<32;i++)world.add(new RigidBody({
  id:'probe-'+i,position:[(i%8-3.5)*1.3,3+Math.floor(i/8)*1.2,(i%4)*.7],
  shape:{kind:'sphere',radius:.4},mass:1.5,material:material('steel'),
  velocity:[((i%5)-2)*.2,0,(i%3)*.3],
 }));
 return world;
}
async function make(mode, count, withWorld, withContacts){
 const bodies=await Promise.all(Array.from({length:count},()=>mode==='rust'?
   createWasmStructuralBody(definition,compiled):Promise.resolve(new StructuralBody(definition))));
 for(const body of bodies)body.activateFromRigid(body.centerOfMass(),[.3,-.1,.2],[0,0,0]);
 const world=withWorld?worldFixture():null;
 const contacts=withContacts?bodies.map(()=>new StructuralStaticContactSolver(
   [{id:'wall',center:[1,0,0],half:[.5,.9,.5]}],definition.collisionTriangles??[],
 )):null;
 return{bodies,world,contacts,dispose(){for(const body of bodies)body.detachKernel();}};
}
function advance(caseState,tick){
 if(caseState.world)caseState.world.step(dt);
 for(let ordinal=0;ordinal<caseState.bodies.length;ordinal++){
  const body=caseState.bodies[ordinal];
  body.wake();
  const node=((tick*7+ordinal)%body.nodeCount)*3;
  const force=40*Math.sin(tick*.13+ordinal*.17);
  body.force[node]+=force;body.force[(body.nodeCount-1)*3]-=force;
  const projector=caseState.contacts?.[ordinal];
  if(projector)body.step(dt,[0,0,0],current=>projector.project(current));
  else body.step(dt,[0,0,0]);
 }
}
async function measure(mode,workload){
 const state=await make(mode,workload.bodies,workload.rigid,workload.contacts);
 try{
  for(let t=0;t<warmup;t++)advance(state,t);
  const samples=[];
  for(let round=0;round<rounds;round++){
   const start=performance.now();
   for(let t=0;t<ticks;t++)advance(state,warmup+round*ticks+t);
   samples.push((performance.now()-start)/ticks);
  }
  samples.sort((a,b)=>a-b);
  return{medianMs:samples[Math.floor(samples.length/2)],samples,
   rigidContactCount:state.world?.stats.contacts??0,
   structuralSteps:state.bodies.reduce((v,body)=>v+body.steps,0),
   fractureCount:state.bodies.reduce((v,body)=>v+body.stats.broken,0)};
 }finally{state.dispose();}
}
const workloads=[
 {id:'M3-active-1',bodies:1,rigid:false,contacts:false},
 {id:'M3-active-8',bodies:8,rigid:false,contacts:false},
 {id:'M3-plus-rigid-contact-world',bodies:1,rigid:true,contacts:false},
 {id:'M3-with-structural-wall-projector',bodies:1,rigid:false,contacts:true},
];
for(const workload of workloads){
 // Measure same complete workflow for each backend; order alternates by case.
 const names=metrics.length%2?['rust','typescript']:['typescript','rust'],r={};
 for(const mode of names)r[mode]=await measure(mode,workload);
 const speedup=r.typescript.medianMs/r.rust.medianMs;
 metrics.push({workload,typescript:r.typescript,rust:r.rust,speedup});
 console.log(workload.id+': JS '+r.typescript.medianMs.toFixed(4)+'ms/tick Rust '+r.rust.medianMs.toFixed(4)+'ms/tick ratio '+speedup.toFixed(2)+'x');
}
const output={
 schema:1,sha:process.env.GITHUB_SHA??null,node:process.version,platform:process.platform,arch:process.arch,
 method:'Rust/JS structural XPBD in the production StructuralBody API; 40 warmup ticks, 5 rounds, 110 world ticks each. PhysicsWorld workload has independent rigid probe contacts (no duplicate M3 mass). External structural contact callback uses TS fallback by design.',
 notes:'These results are NOT whole-game FPS. Rust pays instance setup outside timed hot path; all bodies remain in owned persistent WASM memory.',
 workloads:metrics,
};
mkdirSync(resolve(root,'artifacts/world-structure'),{recursive:true});
writeFileSync(resolve(root,'artifacts/world-structure/benchmark.json'),JSON.stringify(output,null,2)+'\n');
