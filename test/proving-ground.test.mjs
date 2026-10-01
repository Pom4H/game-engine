import test from 'node:test';
import assert from 'node:assert/strict';
import spec,{provingGroundMeta} from '../tools/proving-ground/scene.mjs';
import {provingGroundZones,releasePhysicsRequirements} from '../tools/proving-ground/catalog.mjs';
import {Scene,RigidBody,material,Vehicle,vehicle,wheel,wing,bodyWheelSupport,lightHelicopter,LIGHT_HELICOPTER_HOVER_COLLECTIVE,LIGHT_HELICOPTER_HOVER_ROLL} from '../dist/index.js';

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


const roadCar=(id,extraParts=[])=>vehicle(id,{
 chassis:{massKg:1450,sizeM:[4.6,1.3,1.9],dragAreaM2:.72},
 parts:[
  wheel('front.left',{at:[1.35,-.45,-.78],massKg:20,radiusM:.34,widthM:.24,suspension:{restM:.45,travelM:.24,springNPerM:36000,damperNsPerM:3200},steerRad:.55,brakeTorqueNm:3200,grip:1.08}),
  wheel('front.right',{at:[1.35,-.45,.78],massKg:20,radiusM:.34,widthM:.24,suspension:{restM:.45,travelM:.24,springNPerM:36000,damperNsPerM:3200},steerRad:.55,brakeTorqueNm:3200,grip:1.08}),
  wheel('rear.left',{at:[-1.35,-.45,-.78],massKg:20,radiusM:.34,widthM:.24,suspension:{restM:.45,travelM:.24,springNPerM:36000,damperNsPerM:3200},driveTorqueNm:1500,drivePowerW:90000,brakeTorqueNm:3000,grip:1.08}),
  wheel('rear.right',{at:[-1.35,-.45,.78],massKg:20,radiusM:.34,widthM:.24,suspension:{restM:.45,travelM:.24,springNPerM:36000,damperNsPerM:3200},driveTorqueNm:1500,drivePowerW:90000,brakeTorqueNm:3000,grip:1.08}),
  ...extraParts,
 ]
});

test('wheel vehicle reverses direction on the straight from torque, without a stop gate',()=>{
 const scene=new Scene(spec);
 scene.physics.wheelSupport=bodyWheelSupport(scene.physics.bodies.values(),scene.physics.ground);
 const car=new Vehicle(scene.physics,roadCar('proving.car.reverse'),{
  position:[-28,1.2,-48],rotation:[0,-Math.PI/2,0],velocity:[0,0,-7]
 });
 const start=car.body.velocity[2];
 car.setControls({throttle:1,brake:0});
 let crossed=false,loaded=false;
 for(let i=0;i<600;i++){
  scene.physics.step(dt);
  loaded ||= ['front.left','front.right','rear.left','rear.right'].some(id=>car.part(id).loadN>500);
  if(car.body.velocity[2]>0){crossed=true;break;}
 }
 assert.equal(loaded,true,'wheels must be physically supported by the proving-ground road');
 assert.ok(car.body.velocity[2]>start+2,{start,end:car.body.velocity[2]});
 assert.equal(crossed,true,'forward drive torque must pass continuously through zero speed');
 assert.ok(car.part('rear.left').angularSpeed>0);
 car.dispose();
});

test('wind-tunnel wing force depends on relative air velocity, not a vehicle mode',()=>{
 const make=(id,velocity,wind)=>{
  const scene=new Scene(spec),bp=vehicle(id,{chassis:{massKg:800,sizeM:[4,1.2,1.7],dragAreaM2:0},parts:[
   wing('test.wing',{at:[0,.35,0],massKg:20,spanM:6,chordM:1.4,incidenceRad:.14,zeroLiftRad:0,dragCoefficient:.03,stallRad:.32}),
  ]});
  const v=new Vehicle(scene.physics,bp,{position:[70,4.5,-32],velocity});
  v.setAir({densityKgM3:1.225,wind});v.evaluate(dt);
  return{v,force:[...v.force],part:{lift:v.part('test.wing').liftN,drag:v.part('test.wing').dragN}};
 };
 const moving=make('tunnel.moving',[45,0,0],[0,0,0]),windy=make('tunnel.windy',[0,0,0],[-45,0,0]),coflow=make('tunnel.coflow',[45,0,0],[45,0,0]);
 assert.deepEqual(moving.force,windy.force);
 assert.ok(moving.part.lift>1000,moving.part);
 assert.ok(moving.part.drag>0,moving.part);
 assert.ok(Math.hypot(...coflow.force)<1e-9,coflow.force);
 moving.v.dispose();windy.v.dispose();coflow.v.dispose();
});

test('rotorcraft uses the same Vehicle body above the proving ground',()=>{
 const scene=new Scene(spec),bp=lightHelicopter('proving.helicopter'),heli=new Vehicle(scene.physics,bp,{position:[-72,35,42]});
 heli.setControls({throttle:1,collective:LIGHT_HELICOPTER_HOVER_COLLECTIVE,roll:LIGHT_HELICOPTER_HOVER_ROLL});
 for(let i=0;i<720;i++)heli.evaluate(dt);
 const main=heli.part('main.rotor'),tail=heli.part('tail.rotor');
 assert.equal(main.kind,'rotor');assert.equal(tail.kind,'rotor');
 assert.ok(main.angularSpeed>35,main.angularSpeed);
 assert.ok(main.liftN>bp.massKg*9.81*.72,{lift:main.liftN,weight:bp.massKg*9.81});
 assert.ok(main.powerW>100000,main.powerW);
 assert.equal(scene.physics.bodies.get(heli.body.id),heli.body);
 heli.dispose();
});


test('wet asphalt reduces the actual tyre force limit on the surface station',()=>{
 const sample=(x,id)=>{
  const scene=new Scene(spec);
  scene.physics.wheelSupport=bodyWheelSupport(scene.physics.bodies.values(),scene.physics.ground);
  const car=new Vehicle(scene.physics,roadCar(id),{position:[x,1.2,-96],rotation:[0,-Math.PI/2,0]});
  for(let i=0;i<180;i++)scene.physics.step(dt);
  const wheelState=car.part('rear.left');
  assert.equal(wheelState.contact,true,`${id} rear wheel must contact the authored pad`);
  const out={surface:wheelState.surfaceFriction,effective:wheelState.effectiveGrip,tyre:wheelState.tyreGrip,support:wheelState.supportId};
  car.dispose();return out;
 };
 const dry=sample(-1,'surface.dry'),wet=sample(41,'surface.wet');
 assert.equal(dry.support,'surface-asphalt');
 assert.equal(wet.support,'surface-wet-asphalt');
 assert.equal(dry.tyre,wet.tyre,'same tyre must retain the same authored tyre grip');
 assert.ok(wet.surface<dry.surface,{dry,wet});
 assert.ok(wet.effective<dry.effective,{dry,wet});
});
