import test from 'node:test';
import assert from 'node:assert/strict';
import {FixedClock,SpatialHash,EngineKernel,Scene,encodeScene,decodeScene,renderAudio,fracturePlate,deriveSurfaceState,resolveEnvironment,material} from '../dist/index.js';

test('fixed clock keeps delayed time as bounded debt',()=>{
  const clock=new FixedClock(10,100,4);let steps=0;clock.reset(0);
  assert.equal(clock.advance(35,()=>steps++),3);assert.equal(steps,3);
  assert.equal(clock.advance(45,()=>steps++),1);assert.equal(steps,4);
});

test('spatial hash deduplicates multi-cell members',()=>{
  const index=new SpatialHash(10),item={x:10,z:10,w:20,l:20};index.add(item,15);
  assert.deepEqual(index.near(10,10,20),[item]);
});

test('kernel order is stable and cadence is exact',()=>{
  const kernel=new EngineKernel(60);const calls=[];
  kernel.use({id:'b',phase:'simulate',rateHz:30,reads:[],writes:['b'],run:()=>{calls.push('b');}});
  kernel.use({id:'a',phase:'simulate',rateHz:60,reads:[],writes:['a'],run:()=>{calls.push('a');}});
  kernel.run(1,{});assert.deepEqual(calls,['a']);calls.length=0;kernel.run(2,{});assert.deepEqual(calls,['a','b']);
});

test('scene physics is deterministic across equal runs',()=>{
  const spec={version:1,entities:[{id:'ball',position:[0,3,0],mesh:{kind:'sphere',radius:.5},body:{mass:1,restitution:.5}}]};
  const a=new Scene(spec),b=new Scene(spec);for(let i=0;i<180;i++){a.step(1/60);b.step(1/60);}assert.deepEqual(a.snapshot(),b.snapshot());assert.ok(a.entities.get('ball').position[1]>=.5-1e-6);
});

test('scene URL codec round-trips unicode ids',()=>{
  const scene={version:1,entities:[{id:'машина',position:[1,2,3],mesh:{kind:'box'}}]};assert.deepEqual(decodeScene(encodeScene(scene)),scene);
});


function fireAtGlass(thickness,speed=30){
  const scene=new Scene({
    version:1,gravity:[0,0,0],
    entities:[
      {id:'glass',position:[0,1,0],mesh:{kind:'box',size:[thickness,1.4,1.2]},material:{kind:'glass'}},
      {id:'ball',position:[-1,1,0],mesh:{kind:'sphere',radius:.11},material:{kind:'steel'},body:{mass:3.8,velocity:[speed,0,0]}},
    ],
  });
  const events=[];for(let i=0;i<30;i++){scene.step(1/60);events.push(...scene.drainEvents());}
  return{scene,events};
}

test('material physics decides penetration vs rebound from glass thickness',()=>{
  const thin=fireAtGlass(.01),thick=fireAtGlass(.20);
  assert.equal(thin.scene.entities.has('glass'),false,'10 mm glass should fracture under this impact');
  assert.ok(thin.events.some(event=>event.type==='fracture'));
  assert.equal(thick.scene.entities.has('glass'),true,'200 mm glass should survive the same impact');
  assert.ok(thick.scene.entities.get('ball').body.velocity[0]<0,'surviving glass should return collision impulse to the ball');
});

test('fracture creates engine-owned shards and procedural audio',()=>{
  const {scene,events}=fireAtGlass(.01);
  const shards=[...scene.entities.keys()].filter(id=>id.startsWith('glass:shard:'));
  assert.ok(shards.length>=10);
  const audio=renderAudio(events,.5);
  let peak=0;for(const sample of audio.left)peak=Math.max(peak,Math.abs(sample));
  assert.ok(peak>.01,'fracture events should synthesize audible output');
});


test('glass crack topology is deterministic and conserves plate area',()=>{
  const input={width:1.5,height:2,thickness:.01,impact:[.12,-.18],energyRatio:4.2,seed:123456};
  const a=fracturePlate(input),b=fracturePlate(input);
  assert.deepEqual(a,b);
  assert.ok(a.radialRays>=6&&a.rings>=2);
  assert.ok(a.fragments.length>=10);
  const area=a.fragments.reduce((sum,fragment)=>sum+fragment.area,0);
  assert.ok(Math.abs(area-3)<1e-6,`fragment area ${area} must conserve the 3 m² source plate`);
});

test('glass runtime uses exact polygon-prism fragments',()=>{
  const {scene}=fireAtGlass(.01);
  const shards=[...scene.entities.values()].filter(entity=>entity.id.startsWith('glass:shard:'));
  assert.ok(shards.length>=10);
  assert.ok(shards.every(entity=>entity.mesh?.kind==='polygon-prism'));
  const mass=shards.reduce((sum,entity)=>sum+(entity.body?.mass??0),0);
  assert.ok(Math.abs(mass-2500*.01*1.4*1.2)<.05,`fragment mass ${mass} should conserve glass mass`);
});


test('rotating debris settles on an explicit concrete surface',()=>{
  const scene=new Scene({
    version:1,
    gravity:[0,-9.81,0],
    ground:-100,
    entities:[
      {id:'floor',position:[0,-.1,0],mesh:{kind:'box',size:[10,.2,10]},material:{kind:'concrete'}},
      {id:'shard',position:[0,1.2,0],rotation:[.7,.4,.25],mesh:{kind:'box',size:[.28,.018,.2]},material:{kind:'glass'},body:{mass:.18,velocity:[.8,-.2,.35],angularVelocity:[9,7,11]}},
    ],
  });
  const shard=scene.entities.get('shard');
  shard.body.fracturable=false;
  shard.body.collisionClass='debris';
  const events=[];
  for(let i=0;i<720;i++){scene.step(1/60);events.push(...scene.drainEvents());}
  assert.equal(shard.body.sleeping,true,'debris should eventually enter rest state on concrete');
  assert.deepEqual(shard.body.velocity,[0,0,0]);
  assert.deepEqual(shard.body.angularVelocity,[0,0,0]);
  assert.ok(events.some(event=>event.type==='impact'&&event.materialA==='glass'&&event.materialB==='concrete'),'contact acoustics should see glass ↔ concrete');
});


test('environment derives concrete moss without renderer controls',()=>{
  const concrete=material('concrete');
  const dry=deriveSurfaceState(concrete,{finish:'rough',ageYears:12,treatment:'none'},resolveEnvironment({humidity:.28,temperatureC:24,precipitation:'rare',sunlight:.9,groundMoisture:.15}));
  const humid=deriveSurfaceState(concrete,{finish:'rough',ageYears:12,treatment:'none'},resolveEnvironment({humidity:.9,temperatureC:13,precipitation:'frequent',sunlight:.28,groundMoisture:.82}));
  const protectedSurface=deriveSurfaceState(concrete,{finish:'rough',ageYears:12,treatment:'biocide'},resolveEnvironment({humidity:.9,temperatureC:13,precipitation:'frequent',sunlight:.28,groundMoisture:.82}));
  assert.ok(humid.wetness>dry.wetness);
  assert.ok(humid.moss>.25,`humid aged concrete should grow moss, got ${humid.moss}`);
  assert.ok(humid.moss>dry.moss*3);
  assert.ok(protectedSurface.moss<humid.moss*.2,'biocide is a semantic cause that suppresses moss');
  assert.ok(humid.frictionScale<dry.frictionScale,'wet/mossy concrete should alter contact friction');
});
