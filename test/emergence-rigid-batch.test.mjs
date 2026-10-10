import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PhysicsWorld,RigidBody} from '../dist/physics/world.js';
import {createWasmRigidContactKernel} from '../dist/physics/rigid-wasm.js';
import {Scene} from '../dist/scene/scene.js';
import {renderAudio} from '../dist/audio/synth.js';
import {projectSceneRenderFrame} from '../dist/execution/index.js';
import {MemoryContentStore} from '../dist/render-ir/index.js';
import {material} from '../dist/materials/catalog.js';
import {AcousticWaveField} from '../dist/physics/wave-field.js';
import {syncSceneAcousticBoundaries} from '../dist/scene/acoustic-boundary.js';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const bytes=new Uint8Array(readFileSync(resolve(root,'kernels/world-rigid/target/wasm32-unknown-unknown/release/world_rigid_kernel.wasm')));
const module=await WebAssembly.compile(bytes);
const epsilon=(a,b,label)=>assert.ok(
 Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-8+1e-9*Math.max(Math.abs(a),Math.abs(b)),
 label+': '+a+' vs '+b,
);

function matchingWorlds(create){
 const a=create(),b=create();
 return[a,b];
}
function compareWorlds(a,b,tick){
 assert.equal(a.contacts.length,b.contacts.length,'contact count at '+tick);
 for(const [id,reference] of a.bodies){
  const state=b.bodies.get(id);assert.ok(state,'missing body '+id);
  for(const field of ['position','rotation','velocity','angularVelocity']){
   for(let axis=0;axis<3;axis++)epsilon(reference[field][axis],state[field][axis],id+'.'+field+' tick '+tick);
  }
  assert.equal(reference.sleeping,state.sleeping,'sleep '+id);
  assert.equal(reference.supportedThisStep,state.supportedThisStep,'support '+id);
 }
 for(let index=0;index<a.contacts.length;index++){
  const ref=a.contacts[index],actual=b.contacts[index];
  assert.equal(actual.a,ref.a);assert.equal(actual.b,ref.b);assert.equal(actual.mode,ref.mode);
  for(const key of ['penetration','impulse','normalSpeed','normalEnergy'])
   epsilon(ref[key],actual[key],'contact.'+key+' tick '+tick);
 }
}
function boxed(id,x,z,velocity){
 return new RigidBody({
  id,position:[x,3,z],mass:1400,shape:{kind:'box',half:[2,.7,.95]},
  rotation:[0,.04*(id.length%3),0],velocity:[velocity,0,0],
  material:material('steel'),friction:.75,restitution:.08,
 });
}

test('batch resolves dependent B contacts sequentially, remains one kernel call per A',async()=>{
 const create=()=>{
  const world=new PhysicsWorld([0,0,0],-100);
  // A sees two moving overlapping B bodies. B #2 must observe A after B #1.
  world.add(boxed('alpha',0,0,3));
  world.add(boxed('beta',3.6,0,-2));
  world.add(boxed('gamma',-3.6,0,1));
  world.add(boxed('delta',-3,4,-1));
  return world;
 };
 const [reference,native]=matchingWorlds(create);
 const kernel=await createWasmRigidContactKernel(module);
 native.setRigidContactKernel(kernel);
 try{
  let count=0;
  for(let tick=0;tick<100;tick++){
   reference.step(1/120);
   native.step(1/120);
   compareWorlds(reference,native,tick);
   count+=reference.contacts.length;
  }
  assert.ok(count>0);
  const stats=native.rigidContactDiagnostics;
  assert.ok(stats.calls>0,JSON.stringify(stats));
  assert.ok(stats.candidates>stats.calls,'multiple bodies must be considered in one Rust call');
  assert.ok(stats.contacts>0);
  assert.equal(stats.policyFallbacks,0);
  assert.equal(stats.traceFallbacks,0);
 }finally{native.setRigidContactKernel(null);kernel.dispose();}
});

test('finite static road stays on physical ground manifold solver rather than batched rigid',async()=>{
 const create=()=>{
  const world=new PhysicsWorld([0,-9.81,0],-100);
  world.add(new RigidBody({id:'road',position:[0,-.1,0],
   shape:{kind:'box',half:[20,.1,8]},material:material('asphalt'),friction:.9}));
  world.add(new RigidBody({id:'car',position:[0,.7,0],
   shape:{kind:'box',half:[2,.7,1]},mass:1200,velocity:[2,0,0],
   material:material('steel'),friction:.9}));
  return world;
 };
 const [reference,native]=matchingWorlds(create);
 const kernel=await createWasmRigidContactKernel(module);
 native.setRigidContactKernel(kernel);
 try{
  for(let i=0;i<45;i++){reference.step(1/120);native.step(1/120);compareWorlds(reference,native,i);}
  assert.ok(native.rigidContactDiagnostics.staticSurfaceFallbacks>0);
 }finally{kernel.dispose();}
});

function coupledScene(){
 return new Scene({
  version:1,seed:2048,gravity:[0,-9.81,0],ground:-100,
  environment:{temperatureC:-5,snowfall:'light',wind:[4,0,.5],sunlight:.15,humidity:.7},
  fluids:[{id:'water',shape:'box',center:[8,.1,0],sizeM:[5,1.4,5],densityKgM3:998,dragCoefficient:.9}],
  windVolumes:[{id:'gust',center:[0,2,0],sizeM:[30,7,15],wind:[8,0,1.5],blendM:1}],
  entities:[
   {id:'road',position:[0,-.1,0],mesh:{kind:'box',size:[24,.2,10]},
    material:{kind:'asphalt'},environmental:{surfaceUse:'road',snowDepthM:.018,waterDepthM:.002},body:{}},
   {id:'glass',position:[0,1.3,0],mesh:{kind:'box',size:[.012,1.4,1.2]},
    material:{kind:'glass'},body:{}},
   {id:'projectile',position:[-1,1.3,0],mesh:{kind:'sphere',radius:.11},
    material:{kind:'steel'},body:{mass:3.8,velocity:[30,0,0]}},
   {id:'car-a',position:[-5,1.1,2.8],mesh:{kind:'box',size:[4,1.3,1.8]},
    renderMesh:{kind:'sphere',radius:2},material:{kind:'steel'},
    body:{mass:1200,velocity:[3,0,0]}},
   {id:'car-b',position:[.5,1.1,2.8],mesh:{kind:'box',size:[4,1.3,1.8]},
    material:{kind:'steel'},body:{mass:1200,velocity:[-3,0,0]}},
   {id:'buoyant',position:[8,.3,0],mesh:{kind:'box',size:[.7,.7,.7]},
    material:{kind:'wood'},body:{mass:80,velocity:[0,0,0]}},
  ],
 });
}

test('emergent scene preserves weather, fluid, fracture, sound and causal render observation',async()=>{
 const original=coupledScene(),accelerated=coupledScene();
 const kernel=await createWasmRigidContactKernel(module);
 accelerated.physics.setRigidContactKernel(kernel);
 const eventA=[],eventB=[];
 try{
  assert.equal(original.fluids.size,1);
  assert.equal(accelerated.wind.size,1);
  assert.ok(original.surfaces.surface('road')?.snowDepthM>0);
  for(let tick=0;tick<55;tick++){
   original.step(1/60);
   accelerated.step(1/60);
   const a=original.snapshot(),b=accelerated.snapshot();
   assert.equal(a.tick,b.tick);
   assert.deepEqual(a.entities.map(e=>e.id),b.entities.map(e=>e.id),'same physical membership tick '+tick);
   for(let i=0;i<a.entities.length;i++){
    assert.equal(a.entities[i].material,b.entities[i].material);
    for(const key of ['position','velocity','rotation'])
     for(let axis=0;axis<3;axis++)
      epsilon(a.entities[i][key][axis],b.entities[i][key][axis],'Scene.'+key+' tick '+tick);
   }
   eventA.push(...original.drainEvents());
   eventB.push(...accelerated.drainEvents());
  }
  assert.deepEqual(eventA.map(e=>[e.type,e.id]),eventB.map(e=>[e.type,e.id]));
  assert.ok(eventA.some(event=>event.type==='fracture'),'glass destruction must occur from actual collision energy');
  assert.ok(eventA.some(event=>event.type==='impact'),'contact must reach audio/impact observation');
  for(let i=0;i<eventA.length;i++){
   const a=eventA[i],b=eventB[i];
   epsilon(a.energy,b.energy,'event energy '+i);
   for(let j=0;j<3;j++)epsilon(a.point[j],b.point[j],'event point '+i);
  }
  // Audio is derived from the SAME authoritative engine events.
  const audioA=renderAudio(eventA,.08),audioB=renderAudio(eventB,.08);
  for(const channel of ['left','right']){
    assert.equal(audioA[channel].length,audioB[channel].length);
    for(let i=0;i<audioA[channel].length;i+=17)
      epsilon(audioA[channel][i],audioB[channel][i],'audio '+channel+' sample '+i);
  }

  const stateA=original.surfaces.surface('road'),stateB=accelerated.surfaces.surface('road');
  assert.ok(stateA&&stateB);
  for(const key of ['temperatureC','snowDepthM','waterDepthM','iceDepthM','slush','wetness','frictionScale'])
   epsilon(stateA[key],stateB[key],'surface.'+key);
  const storeA=new MemoryContentStore(),storeB=new MemoryContentStore();
  const renderA=projectSceneRenderFrame(original,storeA,{epoch:1n,frame:1n});
  const renderB=projectSceneRenderFrame(accelerated,storeB,{epoch:1n,frame:1n});
  const observedA=storeA.require(renderA.frame.observation.hash);
  const observedB=storeB.require(renderB.frame.observation.hash);
  assert.equal(observedA.contractVersion,observedB.contractVersion);
  assert.equal(observedA.simulationTick,observedB.simulationTick);
  assert.deepEqual(observedA.world,observedB.world);
  assert.equal(observedA.surfaces.length,observedB.surfaces.length);
  for(let i=0;i<observedA.surfaces.length;i++){
    const left=observedA.surfaces[i],right=observedB.surfaces[i];
    assert.deepEqual(left.identity,right.identity);
    assert.deepEqual(left.physicalGeometry,right.physicalGeometry);
    assert.deepEqual(left.visualGeometry,right.visualGeometry);
    assert.deepEqual(left.material,right.material);
    for(let k=0;k<16;k++)epsilon(left.transform[k],right.transform[k],'render matrix '+i);
    for(const key of ['linearVelocityMps','angularVelocityRadps'])
      for(let axis=0;axis<3;axis++)epsilon(left[key][axis],right[key][axis],'render '+key+' '+i);
    if(left.surface&&right.surface)
      for(const [key,value] of Object.entries(left.surface))
        if(typeof value==='number')epsilon(value,right.surface[key],'render surface '+key);
  }
  const car=observedA.surfaces.find(s=>s.identity.entityId==='car-a');
  assert.ok(car&&car.physicalGeometry);
  assert.notEqual(car.physicalGeometry.hash,car.visualGeometry.hash,'visual LOD must never become collision geometry');
  // The physical scene can feed the same acoustic-boundary solver regardless of backend.
  const spec={size:[24,8,12],cellSizeM:.5,waveSpeedMps:20,densityKgM3:1.225};
  const waveA=new AcousticWaveField(spec),waveB=new AcousticWaveField(spec);
  const statsA=syncSceneAcousticBoundaries(waveA,original.entities.values());
  const statsB=syncSceneAcousticBoundaries(waveB,accelerated.entities.values());
  assert.deepEqual(statsA,statsB);
  assert.deepEqual(waveA.solid,waveB.solid);
  // The material-law callback is intentionally never speculated in a batch.
  const diagnostics=accelerated.physics.rigidContactDiagnostics;
  assert.ok(diagnostics.policyFallbacks>0,JSON.stringify(diagnostics));
  assert.equal(diagnostics.calls,0,'Scene must retain per-contact material decisions');
  assert.deepEqual(original.lastExecution,accelerated.lastExecution,'engine systems must not be bypassed');
 }finally{accelerated.physics.setRigidContactKernel(null);kernel.dispose();}
});
