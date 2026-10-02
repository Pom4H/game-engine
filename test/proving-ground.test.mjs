import test from 'node:test';
import assert from 'node:assert/strict';
import spec,{provingGroundMeta} from '../tools/proving-ground/scene.mjs';
import {provingGroundZones,releasePhysicsRequirements} from '../tools/proving-ground/catalog.mjs';
import {assertExperimentCauseGraph,gravityFreeFallExperiment} from '../tools/proving-ground/experiments.mjs';
import {Scene,PhysicsWorld,RigidBody,material,Vehicle,vehicle,wheel,wing,bodyWheelSupport,soilWheelSupport,wheelHit,physicsAccounting,ThermalMass,lightHelicopter,LIGHT_HELICOPTER_HOVER_COLLECTIVE,LIGHT_HELICOPTER_HOVER_ROLL} from '../dist/index.js';

const dt=1/120;
const speed=b=>Math.hypot(...b.velocity);

test('proving ground is a valid engine scene with every authored test zone',()=>{
 const scene=new Scene(spec);
 assert.equal(provingGroundMeta.zones.length,provingGroundZones.length);
 assert.equal(new Set(provingGroundZones.map(z=>z.id)).size,provingGroundZones.length);
 assert.ok(scene.entities.size>180,scene.entities.size);
 const ids=[...scene.entities.keys()];
 for(const prefix of ['straight-','obstacle-','surface-','split-mu-','circle-','banked-','ramp-','loop-','handling-','hill-','brake-endurance-','rough-','washboard-','bumps-','potholes-','articulation-','water-','tunnel-','crosswind-','soft-ground-']){
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
 assert.equal(scene.fluids.size,1);
 assert.equal(scene.fluids.sampleXZ(12,-27)?.id,'water-basin-fluid');
});

test('water basin applies buoyancy drag and measurable hull flooding',()=>{
 const scene=new Scene(spec);
 assert.equal(scene.fluids.size,1);
 const sealed=scene.add({id:'water.sealed',position:[8,-.55,-27],mesh:{kind:'box',size:[1.2,1.2,1.2]},material:{kind:'steel'},body:{mass:1100,friction:.2,fluid:{enclosedVolumeM3:1.4,leakAreaM2:0}}}).body;
 const leaking=scene.add({id:'water.leaking',position:[16,-.55,-27],mesh:{kind:'box',size:[1.2,1.2,1.2]},material:{kind:'steel'},body:{mass:1100,friction:.2,fluid:{enclosedVolumeM3:1.4,leakAreaM2:.08}}}).body;
 assert.ok(sealed&&leaking);
 for(let i=0;i<1200;i++)scene.physics.step(dt);
 assert.equal(sealed.floodedVolumeM3,0);
 assert.ok(leaking.floodedVolumeM3>.65,leaking.floodedVolumeM3);
 assert.ok(sealed.position[1]>leaking.position[1]+.35,{sealed:sealed.position,leaking:leaking.position,flooded:leaking.floodedVolumeM3});

 const dragScene=new Scene(spec),drag=dragScene.add({id:'water.drag',position:[12,-.45,-27],mesh:{kind:'box',size:[1,1,1]},material:{kind:'steel'},body:{mass:900,velocity:[6,0,0]}}).body;
 assert.ok(drag);const initial=drag.velocity[0];
 for(let i=0;i<30;i++)dragScene.physics.step(dt);
 assert.ok(drag.velocity[0]<initial-1,{initial,after:drag.velocity[0]});
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


const provingDrivetrain={
 engine:{idleRpm:850,stallRpm:420,redlineRpm:6500,inertiaKgM2:.24,dragTorqueNm:18,torqueCurve:[{rpm:0,torqueNm:170},{rpm:1200,torqueNm:250},{rpm:3500,torqueNm:330},{rpm:6000,torqueNm:255},{rpm:6500,torqueNm:0}]},
 clutch:{maxTorqueNm:520,stiffnessNmPerRadS:14},
 gearbox:{forwardRatios:[3.55,2.15,1.52,1.16,.92,.75],reverseRatio:3.3,finalDrive:3.62,efficiency:.94},
 differential:{outputs:['rear.left','rear.right'],lockFraction:.18,preloadNm:35,couplingNmPerRadS:12},
};
const roadCar=(id,extraParts=[],drivetrain)=>vehicle(id,{
 chassis:{massKg:1450,sizeM:[4.6,1.3,1.9],dragAreaM2:.72},
 ...(drivetrain?{drivetrain}:{}),
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

test('engine clutch gearbox and differential pull a backward-rolling car forward without a stop gate',()=>{
 const scene=new Scene(spec);
 scene.physics.wheelSupport=bodyWheelSupport(scene.physics.bodies.values(),scene.physics.ground);
 const car=new Vehicle(scene.physics,roadCar('proving.car.drivetrain',[],provingDrivetrain),{
  position:[-28,1.2,-64],rotation:[0,-Math.PI/2,0],velocity:[0,0,-4]
 });
 // This fixture isolates drivetrain causality; atmosphere is tested separately in the wind stations.
 car.setAir({densityKgM3:1.225,wind:[0,0,0],temperatureC:18});
 car.setGear(1);
 const start=car.body.velocity[2];let crossed=false,maxOutput=0;
 for(let i=0;i<720;i++){
  car.setControls({throttle:1,clutch:Math.min(1,(i+1)/120)});
  scene.physics.step(dt);
  maxOutput=Math.max(maxOutput,Math.abs(car.drivetrainState?.outputTorqueNm??0));
  if(car.body.velocity[2]>0)crossed=true;
 }
 const state=car.drivetrainState;
 assert.ok(state&&Number.isFinite(state.engineRpm),state);
 assert.ok(maxOutput>500,maxOutput);
 assert.ok(state.clutchDissipatedJ>0,state);
 assert.equal(crossed,true,{start,end:car.body.velocity[2],state});
 assert.ok(car.body.velocity[2]>0,{start,end:car.body.velocity[2],state});
 assert.ok(car.part('rear.left').angularSpeed>0);
 car.dispose();
});

test('brake endurance accumulates heat across repeated physical stops and produces fade',()=>{
 const scene=new Scene(spec);
 scene.physics.wheelSupport=bodyWheelSupport(scene.physics.bodies.values(),scene.physics.ground);
 const base=structuredClone(roadCar('thermal.base').source),thermal={
  heatCapacityJPerK:3000,coolingWPerK:18,airflowCoolingWPerKPerMps:2.2,
  initialTemperatureC:20,fadeStartC:150,fadeEndC:500,minPerformanceFraction:.42,
 };
 const bp=vehicle('proving.car.thermal',{
  chassis:base.chassis,
  parts:base.parts.map(p=>p.kind==='wheel'?{...p,brakeThermal:thermal}:p),
 });
 const car=new Vehicle(scene.physics,bp,{position:[-150,1.2,-360],rotation:[0,-Math.PI/2,0]});
 car.setAir({densityKgM3:1.225,wind:[0,0,0],temperatureC:20});
 let hottest=20,minPerformance=1,maxBrakePower=0,totalStops=0;
 const observe=()=>{for(const id of ['front.left','front.right','rear.left','rear.right']){
  const p=car.part(id);hottest=Math.max(hottest,p.brakeTemperatureC);minPerformance=Math.min(minPerformance,p.brakePerformance);maxBrakePower=Math.max(maxBrakePower,p.brakePowerW);
 }};
 const runUntil=(predicate,maxTicks=1200)=>{for(let i=0;i<maxTicks;i++){scene.physics.step(dt);observe();if(predicate())return true;}return false;};
 for(let cycle=0;cycle<6;cycle++){
  car.setControls({brake:0,throttle:1});
  assert.equal(runUntil(()=>car.body.velocity[2]>24),true,'failed to accelerate on endurance runway');
  // Modulated braking keeps the wheel rolling; a locked wheel correctly dumps most
  // vehicle energy into tyre-road slip instead of the brake thermal mass.
  car.setControls({throttle:0,brake:.25});
  assert.equal(runUntil(()=>Math.abs(car.body.velocity[2])<1.2),true,'failed thermal stop');
  totalStops++;
 }
 assert.equal(totalStops,6);
 assert.ok(maxBrakePower>50000,JSON.stringify({maxBrakePower,hottest,minPerformance}));
 assert.ok(hottest>150,JSON.stringify({hottest,minPerformance,maxBrakePower,position:car.body.position}));
 assert.ok(minPerformance<.98,JSON.stringify({hottest,minPerformance,maxBrakePower}));
 assert.ok(Math.abs(car.body.position[0]+150)<12,JSON.stringify(car.body.position));
 assert.ok(car.body.position[2]>-420&&car.body.position[2]<420,JSON.stringify(car.body.position));
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


test('contact solver emits causal impulse/correction records before final state mutation',()=>{
 const world=new PhysicsWorld([0,-9.81,0],-100);
 const floor=world.add(new RigidBody({id:'trace.floor',position:[0,-.1,0],shape:{kind:'box',half:[5,.1,5]},material:material('concrete')}));
 const body=world.add(new RigidBody({id:'trace.body',position:[0,.55,0],velocity:[0,-3,0],mass:100,shape:{kind:'box',half:[.5,.5,.5]},material:material('steel')}));
 const trace=world.traceCauses({runId:'proving-contact'});
 for(let i=0;i<24;i++)world.step(dt);
 const records=trace.snapshot(),contactRecords=records.filter(r=>r.type==='physics.contribution'&&r.body_id===body.id&&r.law_id==='contact-solver.v1');
 assert.ok(contactRecords.some(r=>r.effect?.impulse_Ns),'normal/friction impulse must be attributed');
 assert.ok(contactRecords.some(r=>r.effect?.position_correction_m),'penetration correction must be attributed');
 const mutation=[...records].reverse().find(r=>r.type==='physics.state-mutation'&&r.body_id===body.id&&Array.isArray(r.contact_contribution_ids)&&r.contact_contribution_ids.length);
 assert.ok(mutation,'final body mutation must reference contact causes from the same substep');
 assert.equal(records.some(r=>r.type==='physics.contribution'&&r.body_id===floor.id),false,'static support is a source, not a second state writer');
 world.stopCauseTrace(trace);
});

test('isolated body-body collision conserves linear momentum and does not create kinetic energy',()=>{
 const world=new PhysicsWorld([0,0,0],-100),a=world.add(new RigidBody({id:'momentum.a',position:[-1.1,10,0],velocity:[8,0,0],mass:800,shape:{kind:'box',half:[.5,.5,.5]},material:material('steel'),restitution:.25,friction:0}));
 const b=world.add(new RigidBody({id:'momentum.b',position:[1.1,10,0],velocity:[-2,0,0],mass:1200,shape:{kind:'box',half:[.5,.5,.5]},material:material('steel'),restitution:.25,friction:0}));
 const momentum=()=>[a.mass*a.velocity[0]+b.mass*b.velocity[0],a.mass*a.velocity[1]+b.mass*b.velocity[1],a.mass*a.velocity[2]+b.mass*b.velocity[2]];
 const energy=()=>.5*a.mass*a.velocity.reduce((s,v)=>s+v*v,0)+.5*b.mass*b.velocity.reduce((s,v)=>s+v*v,0);
 const p0=momentum(),e0=energy();let collided=false;
 for(let i=0;i<30;i++){world.step(dt);collided ||= world.contacts.some(c=>c.a===a.id&&c.b===b.id||c.a===b.id&&c.b===a.id);}
 const p1=momentum(),e1=energy();
 assert.ok(Math.hypot(p1[0]-p0[0],p1[1]-p0[1],p1[2]-p0[2])<1e-8,{p0,p1});
 assert.ok(e1<=e0+1e-7,{e0,e1});
 assert.equal(collided,true,'fixture must actually collide');
});


const supportAt=(scene,x,z,y=3)=>{
 const cast=bodyWheelSupport(scene.physics.bodies.values(),scene.physics.ground),hit=wheelHit();
 assert.equal(cast([x,y,z],[0,-1,0],8,hit),true,`no support at ${x},${z}`);
 return hit;
};

test('split-mu lane exposes different physical tyre friction on each half',()=>{
 const scene=new Scene(spec);
 const wet=supportAt(scene,-96.8,-54),dry=supportAt(scene,-91.2,-54);
 assert.equal(wet.id,'split-mu-wet');assert.equal(dry.id,'split-mu-dry');
 const wetMu=scene.physics.wheelFrictionAt(wet.id,wet.body,wet.point);
 const dryMu=scene.physics.wheelFrictionAt(dry.id,dry.body,dry.point);
 assert.ok(wetMu<dryMu,{wetMu,dryMu});
 assert.ok(wetMu>0&&dryMu>0);
});

test('washboard and potholes are visible to the same wheel-support solver as suspension',()=>{
 const scene=new Scene(spec);
 const crest=supportAt(scene,-88,-25),between=supportAt(scene,-88,-24.45);
 assert.ok(crest.point[1]>between.point[1]+.01,{crest:crest.point,between:between.point});
 const flat=supportAt(scene,91,-96+4*2.1),deep=supportAt(scene,91,-96+11*2.1);
 assert.ok(flat.point[1]>deep.point[1]+.20,{flat:flat.point,deep:deep.point});
 assert.match(deep.id,/^potholes-11$/);
});

test('banked lane returns a tilted physical support normal',()=>{
 const scene=new Scene(spec),hit=supportAt(scene,-96,54);
 assert.match(hit.id,/^banked-/);
 assert.ok(Math.abs(hit.normal[0])>.07,hit.normal);
 assert.ok(hit.normal[1]>.95,hit.normal);
});

test('articulation course presents different wheel heights at the same station',()=>{
 const scene=new Scene(spec);
 const left=supportAt(scene,106,-30),right=supportAt(scene,110,-30);
 assert.match(left.id,/^articulation-left-/);assert.match(right.id,/^articulation-right-/);
 assert.ok(Math.abs(left.point[1]-right.point[1])>.25,{left:left.point,right:right.point});
});

test('split-mu braking generates unequal tyre grip and yaw without controller magic',()=>{
 const scene=new Scene(spec);
 scene.physics.wheelSupport=bodyWheelSupport(scene.physics.bodies.values(),scene.physics.ground);
 const car=new Vehicle(scene.physics,roadCar('proving.car.splitmu',[],provingDrivetrain),{
  position:[-94,1.2,-68],rotation:[0,-Math.PI/2,0],velocity:[0,0,-18]
 });
 car.setControls({throttle:0,brake:0});
 let initialGrip;
 for(let i=0;i<30;i++){
  scene.physics.step(dt);
  const ids=['front.left','rear.left','front.right','rear.right'],parts=ids.map(id=>car.part(id));
  if(parts.every(p=>p.contact)){
   initialGrip={left:(parts[0].effectiveGrip+parts[1].effectiveGrip)/2,right:(parts[2].effectiveGrip+parts[3].effectiveGrip)/2,supports:parts.map(p=>p.supportId)};
   break;
  }
 }
 assert.ok(initialGrip,'vehicle never settled onto split-mu');
 assert.ok(Math.abs(initialGrip.left-initialGrip.right)>.08,JSON.stringify(initialGrip));
 car.setControls({brake:1});
 let maxYaw=0;
 for(let i=0;i<180;i++){scene.physics.step(dt);maxYaw=Math.max(maxYaw,Math.abs(car.body.angularVelocity[1]));}
 assert.ok(maxYaw>.02,maxYaw);
 car.dispose();
});


test('sealed hull floats in the proving-ground basin from displaced volume',()=>{
 const scene=new Scene(spec),body=scene.physics.add(new RigidBody({
  id:'probe-float',position:[12,-.25,-27],mass:900,shape:{kind:'box',half:[1.2,.55,.8]},
  material:material('steel'),fluid:{enclosedVolumeM3:2.8,leakAreaM2:0}
 }));
 const start=body.position[1];
 for(let i=0;i<360;i++)scene.physics.step(dt);
 assert.ok(body.position[1]>start+.15,{start,end:body.position[1],v:body.velocity});
 assert.equal(body.floodedVolumeM3,0);
});

test('leaking hull accumulates flood mass and loses buoyancy margin',()=>{
 const scene=new Scene(spec);
 const sealed=scene.physics.add(new RigidBody({
  id:'probe-sealed',position:[8,-.35,-27],mass:3900,shape:{kind:'box',half:[1.2,.55,.8]},
  material:material('steel'),fluid:{enclosedVolumeM3:3.2,leakAreaM2:0}
 }));
 const leaking=scene.physics.add(new RigidBody({
  id:'probe-leaking',position:[16,-.35,-27],mass:3900,shape:{kind:'box',half:[1.2,.55,.8]},
  material:material('steel'),fluid:{enclosedVolumeM3:3.2,leakAreaM2:.06}
 }));
 for(let i=0;i<1800;i++)scene.physics.step(dt);
 assert.ok(leaking.floodedVolumeM3>.25,leaking.floodedVolumeM3);
 assert.ok(leaking.position[1]<sealed.position[1]-.08,JSON.stringify({sealed:sealed.position,leaking:leaking.position,flooded:leaking.floodedVolumeM3}));
});


test('crosswind corridor changes aerodynamic force only inside its spatial air volume',()=>{
 const scene=new Scene(spec);
 assert.equal(scene.wind.size,1);
 const make=(id,position)=>{
  const bp=vehicle(id,{chassis:{massKg:900,sizeM:[4.2,1.8,1.9],dragAreaM2:3.2},parts:[
   wing('side.panel',{at:[-1.4,.45,0],massKg:12,spanM:2.2,chordM:1.3,chord:[0,0,1],normal:[1,0,0],zeroLiftRad:0,dragCoefficient:.08,stallRad:.30}),
  ]});
  const v=new Vehicle(scene.physics,bp,{position});v.evaluate(dt);return v;
 };
 const inside=make('crosswind.inside',[100,3.2,32]),outside=make('crosswind.outside',[100,3.2,70]);
 const insideForce=Math.hypot(...inside.force),outsideForce=Math.hypot(...outside.force);
 assert.ok(insideForce>outsideForce*5,{insideForce,outsideForce,inside:[...inside.force],outside:[...outside.force]});
 assert.ok(Math.abs(inside.force[0])>100,{force:[...inside.force]});
 inside.dispose();outside.dispose();
});

test('washboard excites repeated suspension oscillation instead of one scripted bump',()=>{
 const scene=new Scene(spec);
 scene.physics.wheelSupport=bodyWheelSupport(scene.physics.bodies.values(),scene.physics.ground);
 const car=new Vehicle(scene.physics,roadCar('proving.car.washboard'),{
  position:[-88,1.15,-24],rotation:[0,-Math.PI/2,0],velocity:[0,0,10]
 });
 const samples=[];
 for(let i=0;i<300;i++){scene.physics.step(dt);samples.push(car.part('front.left').compressionM);}
 const usable=samples.slice(20),lo=Math.min(...usable),hi=Math.max(...usable);
 let peaks=0;for(let i=1;i<usable.length-1;i++)if(usable[i]>usable[i-1]&&usable[i]>=usable[i+1]&&usable[i]>lo+.012)peaks++;
 assert.ok(hi-lo>.035,{lo,hi,peaks});
 assert.ok(peaks>=4,{lo,hi,peaks});
 car.dispose();
});


test('soft ground forms persistent ruts and changes wheel contact physics',()=>{
 const scene=new Scene(spec);
 scene.physics.wheelSupport=soilWheelSupport(bodyWheelSupport(scene.physics.bodies.values(),scene.physics.ground),scene.soil);
 const car=new Vehicle(scene.physics,roadCar('proving.car.soil'),{
  position:[97,1.2,-118],rotation:[0,-Math.PI/2,0]
 });
 car.setAir({densityKgM3:1.225,wind:[0,0,0],temperatureC:18});
 car.setControls({throttle:.65,brake:0});
 let maxSinkage=0,maxCompaction=0,maxResistance=0,soilContact=false;
 for(let i=0;i<300;i++){
  scene.physics.step(dt);
  for(const id of ['front.left','front.right','rear.left','rear.right']){
   const p=car.part(id);soilContact ||= p.supportId==='soft-ground';
   maxSinkage=Math.max(maxSinkage,p.soilSinkageM);maxCompaction=Math.max(maxCompaction,p.soilCompaction);maxResistance=Math.max(maxResistance,p.soilRollingResistanceN);
  }
 }
 assert.equal(soilContact,true);
 assert.ok(maxSinkage>.025,{maxSinkage,maxCompaction,maxResistance,position:car.body.position});
 assert.ok(maxCompaction>.02,{maxSinkage,maxCompaction});
 assert.ok(maxResistance>80,{maxResistance});
 const rut=scene.soil.sample(97,-112);
 assert.ok(rut&&rut.sinkageM>0&&rut.compaction>0,rut);
 car.dispose();
});

test('same vehicle accelerates less on deformable soil than on rigid asphalt',()=>{
 const run=(kind)=>{
  const scene=new Scene(spec);
  scene.physics.wheelSupport=kind==='soil'
   ?soilWheelSupport(bodyWheelSupport(scene.physics.bodies.values(),scene.physics.ground),scene.soil)
   :bodyWheelSupport(scene.physics.bodies.values(),scene.physics.ground);
  const pose=kind==='soil'?{position:[97,1.2,-118],rotation:[0,-Math.PI/2,0]}:{position:[-28,1.2,-82],rotation:[0,-Math.PI/2,0]};
  const car=new Vehicle(scene.physics,roadCar(`proving.car.${kind}`),pose);
  car.setAir({densityKgM3:1.225,wind:[0,0,0],temperatureC:18});car.setControls({throttle:.65});
  for(let i=0;i<180;i++)scene.physics.step(dt);
  const out={speed:Math.abs(car.body.velocity[2]),soil:car.part('rear.left').soilSinkageM,grip:car.part('rear.left').effectiveGrip,resistance:car.part('rear.left').soilRollingResistanceN};
  car.dispose();return out;
 };
 const asphalt=run('asphalt'),soil=run('soil');
 assert.ok(soil.soil>.015,soil);
 assert.ok(soil.resistance>0,soil);
 assert.ok(soil.speed<asphalt.speed*.9,{asphalt,soil});
});


test('solver rolling-rest and sleep-rest are explicit causal records',()=>{
 const world=new PhysicsWorld([0,-9.81,0],0);
 const body=world.add(new RigidBody({
  id:'trace.settle',position:[0,.5,0],velocity:[.035,0,.018],angularVelocity:[.08,.05,.06],
  mass:120,shape:{kind:'box',half:[.5,.5,.5]},material:material('steel'),friction:.8,restitution:0
 }));
 const trace=world.traceCauses({runId:'settle-provenance'});
 for(let i=0;i<240&&!body.sleeping;i++)world.step(dt);
 const records=trace.snapshot(),corrections=records.filter(r=>r.type==='physics.contribution'&&r.body_id===body.id&&r.law_id==='contact-solver.v1');
 assert.ok(corrections.some(r=>r.source?.id==='solver.rolling-rest'&&r.effect?.angular_velocity_correction_rad_s),'rolling stabilization must be attributed');
 assert.equal(body.sleeping,true,'fixture must actually enter sleep');
 assert.ok(corrections.some(r=>r.source?.id==='solver.sleep-rest'&&(r.effect?.velocity_correction_m_s||r.effect?.angular_velocity_correction_rad_s)),'sleep clamp must be attributed');
 assert.deepEqual(new Set(records.filter(r=>r.type==='physics.state-mutation'&&r.body_id===body.id).map(r=>r.writer_id)),new Set(['PhysicsWorld.integrate']));
 world.stopCauseTrace(trace);
});


test('ballistic stand matches the symplectic oracle, gravity impulse and predicted numerical energy defect',()=>{
 const e=gravityFreeFallExperiment;
 const authored=spec.entities.find(entity=>entity.id===e.sceneBodyId);
 assert.ok(authored,'experiment must be materialized into the proving-ground scene');
 assert.deepEqual(authored.position,e.body.initialPosition);
 assert.deepEqual(authored.body.velocity,e.body.initialVelocity);
 const projectedScene=new Scene(spec),projectedBody=projectedScene.entities.get(e.sceneBodyId)?.body;
 assert.ok(projectedBody,'materialized experiment body must remain a physical Scene body');
 const causeTrace=projectedScene.physics.traceCauses({runId:`experiment:${e.id}`,maxRecords:50000});
 for(let i=0;i<e.durationS*e.runtimeTickRate;i++)projectedScene.step(1/e.runtimeTickRate);
 const observedCauses=assertExperimentCauseGraph(e,causeTrace.snapshot(),projectedBody.id);
 assert.deepEqual(observedCauses,['gravity.v1']);
 assert.equal(projectedScene.physics.contacts.some(c=>c.a===projectedBody.id||c.b===projectedBody.id),false,'vacuum free-fall experiment must remain contact-free');
 projectedScene.physics.stopCauseTrace(causeTrace);
 const norm=v=>Math.hypot(...v),sub=(a,b)=>a.map((v,i)=>v-b[i]);
 const roundoff=(steps,...values)=>4096*Number.EPSILON*Math.max(1,...values.map(Math.abs))*Math.max(1,steps);
 const run=tickRate=>{
  const h=1/tickRate,steps=Math.round(e.durationS*tickRate),t=steps*h;
  assert.equal(t,e.durationS,'experiment duration must be an integer number of fixed steps');
  const world=new PhysicsWorld(e.gravity,-1000),body=world.add(new RigidBody({
   id:`account.ballistic.${tickRate}`,position:e.body.initialPosition,velocity:e.body.initialVelocity,angularVelocity:e.body.angularVelocity,
   mass:e.body.massKg,shape:{kind:'sphere',radius:e.body.radiusM},material:material('steel'),friction:0,restitution:0
  }));
  const before=physicsAccounting(world.bodies.values(),world.gravity);
  for(let i=0;i<steps;i++)world.step(h);
  const after=physicsAccounting(world.bodies.values(),world.gravity),expectedPosition=e.symplecticPositionAt(t,h),expectedMomentum=e.momentumAt(t);
  const positionBudget=roundoff(steps,...expectedPosition,...body.position);
  const momentumBudget=roundoff(steps,...expectedMomentum,...after.linearMomentumNs);
  const spinBudget=roundoff(steps,...before.spinAngularMomentumNms,...after.spinAngularMomentumNms);
  const measuredEnergyDefect=after.mechanicalJ-before.mechanicalJ,expectedEnergyDefect=e.symplecticEnergyDefectJ(t,h);
  const energyBudget=roundoff(steps,before.mechanicalJ,after.mechanicalJ,expectedEnergyDefect);
  assert.ok(norm(sub(body.position,expectedPosition))<=positionBudget,{tickRate,position:body.position,expectedPosition,positionBudget});
  assert.ok(norm(sub(after.linearMomentumNs,expectedMomentum))<=momentumBudget,{tickRate,actual:after.linearMomentumNs,expectedMomentum,momentumBudget});
  assert.ok(norm(sub(after.spinAngularMomentumNms,before.spinAngularMomentumNms))<=spinBudget,{tickRate,before,after,spinBudget});
  assert.ok(Math.abs(measuredEnergyDefect-expectedEnergyDefect)<=energyBudget,{tickRate,measuredEnergyDefect,expectedEnergyDefect,energyBudget});
  return{tickRate,steps,h,positionError:sub(body.position,e.continuousPositionAt(t)),measuredEnergyDefect,expectedEnergyDefect};
 };
 const coarse=run(60),fine=run(120),coarseError=norm(coarse.positionError),fineError=norm(fine.positionError);
 const convergenceBudget=roundoff(coarse.steps+fine.steps,coarseError,fineError,coarse.measuredEnergyDefect,fine.measuredEnergyDefect);
 assert.ok(Math.abs(coarseError-2*fineError)<=convergenceBudget,{coarseError,fineError,convergenceBudget});
 assert.ok(Math.abs(coarse.measuredEnergyDefect-2*fine.measuredEnergyDefect)<=convergenceBudget,{coarse,fine,convergenceBudget});
});

test('closed rigid collision conserves total linear and angular momentum',()=>{
 const world=new PhysicsWorld([0,0,0],-1000);
 world.add(new RigidBody({id:'account.a',position:[-1.1,4,0],velocity:[8,0,0],mass:800,shape:{kind:'sphere',radius:.5},material:material('steel'),friction:0,restitution:.35}));
 world.add(new RigidBody({id:'account.b',position:[1.1,4,0],velocity:[-2,0,0],mass:1200,shape:{kind:'sphere',radius:.5},material:material('steel'),friction:0,restitution:.35}));
 const before=physicsAccounting(world.bodies.values(),world.gravity);
 let collided=false;for(let i=0;i<40;i++){world.step(dt);collided ||= world.contacts.length>0;}
 const after=physicsAccounting(world.bodies.values(),world.gravity);
 const dp=Math.hypot(after.linearMomentumNs[0]-before.linearMomentumNs[0],after.linearMomentumNs[1]-before.linearMomentumNs[1],after.linearMomentumNs[2]-before.linearMomentumNs[2]);
 const dl=Math.hypot(after.angularMomentumNms[0]-before.angularMomentumNms[0],after.angularMomentumNms[1]-before.angularMomentumNms[1],after.angularMomentumNms[2]-before.angularMomentumNms[2]);
 assert.equal(collided,true);
 assert.ok(dp<1e-8,{before,after,dp});
 assert.ok(dl<1e-8,{before,after,dl});
 assert.ok(after.kineticJ<=before.kineticJ+1e-7,{before:before.kineticJ,after:after.kineticJ});
});

test('thermal mass closes its stored dissipated and rejected energy balance',()=>{
 const thermal=new ThermalMass({heatCapacityJPerK:1000,coolingWPerK:20,initialTemperatureC:20});
 thermal.addHeat(10000);
 for(let i=0;i<100;i++)thermal.step(.1,20,0);
 const stored=(thermal.temperatureC-20)*1000,balance=thermal.dissipatedJ-thermal.rejectedJ;
 assert.ok(Math.abs(stored-balance)<1e-8,{stored,balance,dissipated:thermal.dissipatedJ,rejected:thermal.rejectedJ});
});


test('proof-mode energy ledger closes across vehicle soil contacts and fluid',()=>{
 const scene=new Scene(spec);
 scene.physics.wheelSupport=soilWheelSupport(bodyWheelSupport(scene.physics.bodies.values(),scene.physics.ground),scene.soil);
 const car=new Vehicle(scene.physics,roadCar('energy.car'),{
  position:[97,1.2,-118],rotation:[0,-Math.PI/2,0],velocity:[0,0,3]
 });
 car.setAir({densityKgM3:1.225,wind:[0,0,0],temperatureC:18});car.setControls({throttle:.35});
 const floater=scene.physics.add(new RigidBody({
  id:'energy.floater',position:[12,-.35,-27],velocity:[2,0,0],mass:900,
  shape:{kind:'box',half:[.8,.45,.6]},material:material('steel'),fluid:{enclosedVolumeM3:1.4,leakAreaM2:.01}
 }));
 const trace=scene.physics.traceCauses({runId:'proving-energy',maxRecords:200000});
 for(let i=0;i<120;i++)scene.physics.step(dt);
 const records=trace.snapshot(),proof=trace.proof,stages=new Set(records.filter(r=>r.type==='physics.energy').map(r=>r.stage));
 assert.ok(proof.maxEnergyResidualJ<1e-6,proof);
 for(const stage of ['force-driver','fluid','gravity-integrate','contacts-solver'])assert.ok(stages.has(stage),{stage,stages:[...stages]});
 assert.ok(records.some(r=>r.type==='physics.energy-closure'&&r.body_id===car.body.id));
 assert.ok(records.some(r=>r.type==='physics.energy-closure'&&r.body_id===floater.id));
 scene.physics.stopCauseTrace(trace);car.dispose();
});
