import test from 'node:test';
import assert from 'node:assert/strict';
import spec,{provingGroundMeta} from '../tools/proving-ground/scene.mjs';
import {provingGroundZones,releasePhysicsRequirements} from '../tools/proving-ground/catalog.mjs';
import {Scene,RigidBody,material} from '../dist/index.js';

const dt=1/120;
const speed=b=>Math.hypot(...b.velocity);

test('proving ground is a valid engine scene with every authored test zone',()=>{
 const scene=new Scene(spec);
 assert.equal(provingGroundMeta.zones.length,provingGroundZones.length);
 assert.equal(new Set(provingGroundZones.map(z=>z.id)).size,provingGroundZones.length);
 assert.ok(scene.entities.size>180,scene.entities.size);
 const ids=[...scene.entities.keys()];
 for(const prefix of ['straight-','obstacle-','surface-','circle-','ramp-','loop-','handling-','hill-','rough-','water-','tunnel-']){
  assert.ok(ids.some(id=>id.startsWith(prefix)),`missing zone prefix ${prefix}`);
 }
 assert.ok(releasePhysicsRequirements.length>=20);
 assert.ok(!ids.some(id=>/npc|player|mission|economy|quest/i.test(id)),'proving ground must remain engine-only');
});

test('straight is real collision geometry, not a render-only road',()=>{
 const scene=new Scene(spec),probe=scene.physics.add(new RigidBody({
  id:'probe-straight',position:[-28,2,-72],mass:1200,
  shape:{kind:'box',half:[.85,.42,1.7]},material:material('steel'),friction:.7
 }));
 let roadContact=false;
 for(let i=0;i<360;i++){
  scene.physics.step(dt);
  roadContact ||= scene.physics.contacts.some(c=>c.a===probe.id&&String(c.b).startsWith('straight-'));
 }
 assert.equal(roadContact,true);
 assert.ok(probe.position[1]>.25&&probe.position[1]<.8,probe.position);
 assert.ok(probe.position.every(Number.isFinite));
});

test('obstacle lane produces an actual rigid-body impact',()=>{
 const scene=new Scene(spec),probe=scene.physics.add(new RigidBody({
  id:'probe-obstacle',position:[-58,.72,-88],velocity:[0,0,18],mass:950,
  shape:{kind:'box',half:[.8,.45,1.35]},material:material('steel'),restitution:.05,friction:.35
 }));
 let obstacleContact=false,maxImpulse=0;
 for(let i=0;i<180;i++){
  scene.physics.step(dt);
  for(const c of scene.physics.contacts)if(c.a===probe.id&&String(c.b).startsWith('obstacle-')){
   obstacleContact=true;maxImpulse=Math.max(maxImpulse,c.impulse);
  }
 }
 assert.equal(obstacleContact,true);
 assert.ok(maxImpulse>0,maxImpulse);
 assert.ok(probe.position.every(Number.isFinite));
});

test('jump ramp converts forward speed into height through contact geometry',()=>{
 const scene=new Scene(spec),probe=scene.physics.add(new RigidBody({
  id:'probe-ramp',position:[-28,.65,29],velocity:[0,0,28],mass:900,
  shape:{kind:'box',half:[.75,.35,1.25]},material:material('steel'),restitution:0,friction:.12
 }));
 let rampContact=false,maxY=probe.position[1],airborneAfterRamp=false;
 for(let i=0;i<300;i++){
  scene.physics.step(dt);
  rampContact ||= scene.physics.contacts.some(c=>c.a===probe.id&&String(c.b).startsWith('ramp-main-'));
  maxY=Math.max(maxY,probe.position[1]);
  if(i>80&&probe.position[1]>1.2&&!scene.physics.contacts.some(c=>c.a===probe.id))airborneAfterRamp=true;
 }
 assert.equal(rampContact,true);
 assert.ok(maxY>2.5,maxY);
 assert.equal(airborneAfterRamp,true);
});

test('surface station exposes distinct physical surface state',()=>{
 const scene=new Scene(spec);
 const dry=scene.surfaces.surface('surface-asphalt');
 const concrete=scene.surfaces.surface('surface-concrete');
 const rubber=scene.surfaces.surface('surface-rubber');
 const wet=scene.surfaces.surface('surface-wet-asphalt');
 for(const state of [dry,concrete,rubber,wet])assert.ok(state);
 assert.ok((wet?.waterDepthM??0)>.003);
 const drySample=scene.surfaces.sample('surface-asphalt',-1,-96);
 const wetSample=scene.surfaces.sample('surface-wet-asphalt',41,-96);
 assert.ok(drySample&&wetSample);
 assert.notEqual(drySample.frictionScale,wetSample.frictionScale);
});

test('water volume is deliberately non-solid until fluid physics owns it',()=>{
 const scene=new Scene(spec),water=scene.entities.get('water-volume');
 assert.ok(water);
 assert.equal(water.body,undefined,'water must never be faked with a solid collision plane');
});

test('loop and hill are composed from ordinary physical segments',()=>{
 const scene=new Scene(spec);
 const loop=[...scene.entities.values()].filter(e=>/^loop-\d+$/.test(e.id));
 const hill=[...scene.entities.values()].filter(e=>/^hill-\d+$/.test(e.id));
 assert.equal(loop.length,48);
 assert.ok(hill.length>=10);
 assert.ok(loop.every(e=>e.body&&e.body.invMass===0));
 assert.ok(hill.every(e=>e.body&&e.body.invMass===0));
 assert.ok(loop.some(e=>Math.abs(e.rotation[0])>1));
});
