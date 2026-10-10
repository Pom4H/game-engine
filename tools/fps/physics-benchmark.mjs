import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {PhysicsWorld,RigidBody} from '../../dist/physics/world.js';
import {SpatialHash} from '../../dist/core/spatial-hash.js';

const tickSeconds=1/60;
const cases=[
 {id:'airborne-boxes-128',dynamic:128,static:0,airborne:true},
 {id:'ground-boxes-96',dynamic:96,static:0,airborne:false},
 {id:'static-world-512',dynamic:32,static:512,airborne:false},
];
function createWorld(input){
 const world=new PhysicsWorld([0,-9.81,0],0,8),dynamics=[];
 for(let i=0;i<input.static;i++){
  const x=(i%32)*3,z=Math.floor(i/32)*3;
  world.add(new RigidBody({id:'terrain-'+i,position:[x,-.14,z],shape:{kind:'box',half:[1.35,.14,1.35]},friction:.8}));
 }
 for(let i=0;i<input.dynamic;i++){
  const x=(i%16)*3.1,z=Math.floor(i/16)*3.1;
  const body=new RigidBody({id:'moving-'+i,position:[x,input.airborne?200:.65+(i%4)*.08,z],
    shape:{kind:'box',half:[.45,.4,.52]},rotation:[(i%4)*.07,(i%6)*.08,(i%5)*.05],
    velocity:[(i%3-1)*.25,-.2,(i%2?-.1:.1)],angularVelocity:[.04,0,.03],
    mass:2.5,friction:.6});
  world.add(body);dynamics.push(body);
 }
 return {world,dynamics};
}
function advance(state,tick,stress=false){
 // Deterministic workload refresh prevents a settled test from reporting an idle solve.
 if(stress&&tick%12===0)for(const body of state.dynamics){
  body.wake();body.velocity[1]=-.22;body.angularVelocity[0]=.04;body.angularVelocity[2]=.03;
 }
 state.world.step(tickSeconds);
}
function fingerprint(input){
 const state=createWorld(input),hash=createHash('sha256');
 for(let tick=0;tick<90;tick++){
  advance(state,tick);
  hash.update(JSON.stringify({
   step:state.world.steps,substeps:state.world.substeps,
   bodies:[...state.world.bodies.values()].map(body=>[body.id,body.position,body.rotation,body.velocity,
     body.angularVelocity,body.sleeping,body.sleepTimer,body.supportedThisStep,
     body.crushPositive,body.crushNegative]),
   contacts:state.world.contacts,
  }));
 }
 return hash.digest('hex');
}
function bench(input,quick=false){
 const observations=[],rounds=quick?3:7,ticks=quick?70:120,warmup=45;
 for(let round=0;round<rounds;round++){
  const state=createWorld(input);
  for(let tick=0;tick<warmup;tick++)advance(state,tick,true);
  const start=performance.now();
  for(let tick=0;tick<ticks;tick++)advance(state,warmup+tick,true);
  observations.push((performance.now()-start)/ticks);
 }
 const sorted=[...observations].sort((a,b)=>a-b);
 const median=sorted[Math.floor(sorted.length/2)];
 return {medianMsPerTick:Number(median.toFixed(4)),roundsMsPerTick:observations.map(v=>Number(v.toFixed(4))),
  p95FromRoundsMs:Number(sorted[Math.floor((sorted.length-1)*.95)].toFixed(4)),
  sampleTicks:ticks,warmupTicks:warmup,goalPhysicsMs:5,withinGoal:median<=5};
}
const quick=process.argv.includes('--quick');
const results=cases.map(item=>({id:item.id,dynamic:item.dynamic,static:item.static,
 fingerprint:fingerprint(item),performance:bench(item,quick)}));
// Reference fingerprints were captured from main BEFORE the fast ground path.
const golden={
 'airborne-boxes-128':'628ec336922ff0b9a98156403ffe4100087cd7a22519402397bd8b9470ae4448',
 'ground-boxes-96':'98ac74c13b72b755e91b55c49a5a4225386e4e43ab0ec17e0a8841f402692686',
 'static-world-512':'cab98b9f89d44ae2a4c8bf259164a64de1d25e9097061114d0d0dc15627acdc7',
};
for(const result of results)assert.equal(result.fingerprint,golden[result.id],
  'Physical replay changed in '+result.id+'; performance cannot override causality');

function benchmarkSpatialRebuild(){
 const fixture=createWorld(cases[2]);
 const items=[...fixture.world.bodies.values()];
 const radius=body=>body.shape.kind==='sphere'?body.shape.radius:Math.hypot(body.shape.half[0],body.shape.half[2]);
 const times={batch:[],bulk:[]},rounds=9,repeat=160;
 const indexes={batch:new SpatialHash(8),bulk:new SpatialHash(8)};
 for(let round=0;round<rounds;round++){
  for(const name of round%2?['bulk','batch']:['batch','bulk']){
   const index=indexes[name];
   const t=performance.now();
   for(let i=0;i<repeat;i++){
    if(name==='bulk')index.rebuild(items,radius);
    else{
      index.clear();index.beginBatch();
      for(const item of items)index.add(item,radius(item));
      index.endBatch();
    }
   }
   times[name].push((performance.now()-t)/repeat);
  }
 }
 const mid=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
 const batch=mid(times.batch),bulk=mid(times.bulk);
 const probes=[[0,0,3],[20,12,8],[40,40,1],[80,50,7]];
 for(const [x,z,r] of probes)assert.deepEqual(indexes.bulk.near(x,z,r),indexes.batch.near(x,z,r));
 return {items:items.length,medianBatchMs:batch,medianBulkMs:bulk,ratio:batch/bulk,
  trials:times};
}

const broadphase=benchmarkSpatialRebuild();
const report={schema:1,commit:process.env.GITHUB_SHA??null,platform:process.platform,node:process.version,
 method:'PhysicsWorld 60Hz, 90 tick natural replay SHA256 of all body/contact states; timed rotating deterministic workload refresh; each round recreates physics world, 45 warmup ticks. CPU-only, not game FPS.',
 samples:results,broadphase};
mkdirSync(resolve('artifacts/fps'),{recursive:true});
writeFileSync(resolve('artifacts/fps/physics-budget.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
