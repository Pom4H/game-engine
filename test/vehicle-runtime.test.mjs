import test from 'node:test';
import assert from 'node:assert/strict';
import {Vehicle,vehicle,wheel,wing,PartCondition} from '../dist/vehicles/vehicle.js';
import {PhysicsWorld,RigidBody} from '../dist/physics/world.js';
import {ForceFrame} from '../dist/physics/force-frame.js';
import {compose} from '../dist/math.js';
import {fixture,carBlueprint} from '../tools/vehicle-runtime-fixture.mjs';
const near=(a,b,e=1e-8)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
const run=(f,seconds)=>{for(let i=0;i<Math.round(seconds*120);i++)f.world.step(1/120);return f;};
const surface=(id,at=[0,0,0],extra={})=>wing(id,{at,massKg:10,spanM:4,chordM:1.6,incidenceRad:.20,zeroLiftRad:0,...extra});
const wingFixture=(parts,pose={})=>{const world=new PhysicsWorld([0,0,0],-100);return {world,car:new Vehicle(world,vehicle('aero',{chassis:{massKg:100,sizeM:[2,1,1]},parts}),{position:[0,10,0],velocity:[60,0,0],...pose})};};

test('adding wings lifts the SAME PhysicsWorld vehicle without a flight mode or pose update',()=>{
 const road=run(fixture({wings:false},{velocity:[60,0,0]}),2),air=run(fixture({wings:true},{velocity:[60,0,0]}),2);
 assert.ok(air.car.body.position[1]>2,air.car.body.position);
 assert.ok(road.car.body.position[1]<1,road.car.body.position);
 for(const id of ['front.left','front.right','rear.left','rear.right'])assert.equal(air.car.part(id).loadN,0);
 assert.ok(air.car.body.velocity[0]<60,'lift must not manufacture forward thrust');
 assert.equal(air.world.bodies.size,1);assert.equal(air.car.body.mass,1630);assert.equal(road.car.body.mass,1580);
});

test('wheel-powered runway acceleration and wing deflection cause takeoff, not a scripted jump',()=>{
 const f=fixture({incidenceRad:0});f.car.setControls({throttle:1});run(f,15);
 assert.ok(f.car.body.velocity[0]>50);assert.ok(f.car.body.position[1]<1);
 f.car.setControls({flap:1});run(f,1.5);
 assert.ok(f.car.body.position[1]>1.3,f.car.body.position);
 assert.equal(f.car.part('rear.left').loadN,0);
});

test('still air, zero density and spanwise flow never create wing lift',()=>{
 for(const velocity of [[0,0,0],[0,0,60]]){const f=wingFixture([surface('wing')],{velocity});f.car.evaluate(1/120);near(f.car.part('wing').liftN,0);}
 const f=wingFixture([surface('wing')]);f.car.setAir({densityKgM3:0,wind:[0,0,0]});f.car.evaluate(1/120);assert.deepEqual(f.car.force,[0,0,0]);
});

test('lift is perpendicular to local flow; drag dissipates; reverse and high alpha stay finite',()=>{
 for(const velocity of [[60,0,0],[-60,0,0],[0,60,0],[30,-10,5]]){
  const f=wingFixture([surface('wing')],{velocity});f.car.evaluate(1/120);const p=f.car.part('wing'),speed=Math.hypot(...velocity),power=p.force.reduce((n,v,i)=>n+v*velocity[i],0);
  near(power,-p.dragN*speed,1e-6);assert.ok(p.dragN>=0);assert.ok(p.force.every(Number.isFinite));
 }
 const high=wingFixture([surface('wing')],{velocity:[10,-60,0]});high.car.evaluate(1/120);assert.ok(high.car.part('wing').stall>.9);
});

test('asymmetric aerodynamic geometry and angular point velocity produce actual body torque',()=>{
 const single=wingFixture([surface('wing',[0,0,3])]);single.car.evaluate(1/120);assert.ok(Math.abs(single.car.torque[0])>1000);
 single.world.step(1/120);assert.ok(Math.abs(single.car.body.angularVelocity[0])>.01);
 const pair=wingFixture([surface('left',[0,0,-3]),surface('right',[0,0,3])]);pair.car.evaluate(1/120);near(pair.car.torque[0],0);
 pair.car.body.angularVelocity[0]=.2;pair.car.evaluate(1/120);assert.notEqual(pair.car.part('left').liftN,pair.car.part('right').liftN);
});

test('wind affects wing force through relative velocity rather than a speed/altitude gate',()=>{
 const a=wingFixture([surface('wing')]),b=wingFixture([surface('wing')],{velocity:[0,0,0]});
 b.car.setAir({densityKgM3:1.225,wind:[-60,0,0]});a.car.evaluate(1/120);b.car.evaluate(1/120);assert.deepEqual(a.car.force,b.car.force);
});

test('overloaded wing loses lifting capability next substep, retains drag and attached mass',()=>{
 const f=wingFixture([surface('wing',[0,0,0],{condition:{failureLoadN:1000}})]),mass=f.car.body.mass;
 f.car.evaluate(1/120);assert.equal(f.car.part('wing').failed,true);
 f.car.evaluate(1/120);assert.equal(f.car.part('wing').liftN,0);assert.ok(f.car.part('wing').dragN>0);assert.equal(f.car.body.mass,mass);
});

test('wear consumes physical work; held load is not a repeated fatigue cycle',()=>{
 const c=new PartCondition({wearEnergyJ:1000,heatCapacityJPerK:100,fatigue:{enduranceRangeN:10,referenceRangeN:100,cyclesAtReference:10,exponent:2}});
 for(let i=0;i<10000;i++)c.observeLoad(50);assert.equal(c.fatigue,0);assert.equal(c.wear,0);
 c.consumeWork(100);near(c.wear,.1);near(c.temperatureRiseK,1);
 const b=new PartCondition({wearEnergyJ:1000});for(let i=0;i<100;i++)b.consumeWork(1);near(b.wear,c.wear);
 assert.throws(()=>c.consumeWork(-1));assert.throws(()=>c.observeLoad(NaN));
});

test('fatigue counts reversals, not samples or solver iteration count',()=>{
 const spec={fatigue:{enduranceRangeN:5,referenceRangeN:100,cyclesAtReference:100,exponent:2}};
 const a=new PartCondition(spec),b=new PartCondition(spec);
 for(const load of [0,100,0,100,0,100,0]){a.observeLoad(load);for(let i=0;i<20;i++)b.observeLoad(load);}
 assert.ok(a.fatigue>0);near(a.fatigue,b.fatigue);assert.equal(a.failed,false);
});

test('tyre work drives shared tread/grip/heat state; no constant-clock tyre wear',()=>{
 const idle=run(fixture({wings:false}),2);assert.equal(idle.car.part('rear.left').dissipatedJ,0);
 const f=fixture({wings:false,wearEnergyJ:30000},{velocity:[30,0,0]});f.car.setControls({throttle:1,brake:1});run(f,2);
 const p=f.car.part('rear.left');assert.ok(p.wear>.001,p);assert.ok(p.treadDepthM<.008);assert.ok(p.effectiveGrip<1.1);assert.ok(p.effectiveRadiusM<.346);assert.ok(p.temperatureRiseK>0);
});

test('spring overload leaves a permanent set and held compression does not spend plastic work twice',()=>{
 const bp=carBlueprint({wings:false});const spec=structuredClone(bp.source);for(const p of spec.parts)p.suspension.yieldForceN=6000;
 const world=new PhysicsWorld(),car=new Vehicle(world,vehicle('damaged',spec),{position:[0,.40,0]});
 car.evaluate(1/120);const p=car.part('front.left'),set=p.permanentSetM,work=p.plasticWorkJ;
 assert.ok(set>.05);assert.ok(work>0);car.evaluate(1/120);near(p.permanentSetM,set);near(p.plasticWorkJ,work);
});

test('cached and uncached derived paths are bit-identical for trajectory, forces and lifetime state',()=>{
 const a=fixture({wearEnergyJ:1e6},{velocity:[35,0,0]}),b=fixture({wearEnergyJ:1e6},{velocity:[35,0,0]},{reuseDerived:false});
 for(let i=0;i<240;i++){const input={throttle:.5,steer:i>100?.1:0,brake:i>180?.4:0};a.car.setControls(input);b.car.setControls(input);a.world.step(1/120);b.world.step(1/120);}
 assert.deepEqual(a.car.body.position,b.car.body.position);assert.deepEqual(a.car.body.velocity,b.car.body.velocity);assert.deepEqual(a.car.force,b.car.force);
 for(const p of a.blueprint.parts){const x={...a.car.part(p.source.id)},y={...b.car.part(p.source.id)};delete x.derivedBuilds;delete y.derivedBuilds;assert.deepEqual(x,y);}
 assert.deepEqual(a.car.diagnostics,b.car.diagnostics);assert.ok(b.car.part('wing.left').derivedBuilds>a.car.part('wing.left').derivedBuilds);
});

test('read-only part views are reused; three consumers do not repeat derivation',()=>{
 const f=fixture({},{velocity:[40,0,0]});f.car.evaluate(1/120);const view=f.car.part('wing.left'),builds=view.derivedBuilds;
 for(let i=0;i<10000;i++){assert.equal(f.car.part('wing.left'),view);void view.liftN;void view.failed;void view.temperatureRiseK;}
 assert.equal(view.derivedBuilds,builds);const snap=structuredClone(view);f.car.setControls({flap:.3});f.car.evaluate(1/120);assert.notEqual(view.liftN,snap.liftN);
});

test('blueprints isolate author data, instances isolate wear; part masses counted once',()=>{
 const source={chassis:{massKg:100,sizeM:[2,1,1]},parts:[surface('wing',[0,1,0])]};const bp=vehicle('test',source);source.parts[0].at[1]=55;
 assert.equal(bp.source.parts[0].at[1],1);near(bp.massKg,110);near(bp.centerOfMass[1],10/110);assert.ok(bp.inertia.every(n=>n>0));
 const a=new Vehicle(new PhysicsWorld(),bp),b=new Vehicle(new PhysicsWorld(),bp);assert.notEqual(a.part('wing'),b.part('wing'));
 a.dispose();assert.equal(a.world.bodies.size,0);assert.equal(b.world.bodies.size,1);
});

test('invalid parts/controls are rejected; unknown fields cannot write prototype/control state',()=>{
 assert.throws(()=>vehicle('bad',{chassis:{massKg:100,sizeM:[2,1,1]},parts:[surface('a'),surface('a')]}));
 assert.throws(()=>vehicle('bad',{chassis:{massKg:100,sizeM:[2,1,1]},parts:[surface('a',[0,0,0],{normal:[1,0,0]})]}));
 assert.throws(()=>vehicle('bad',{chassis:{massKg:100,sizeM:[2,1,1]},parts:[surface('a',[0,0,0],{spanM:NaN})]}));
 const {car}=fixture();assert.throws(()=>car.setControls({throttle:.5,steer:3}));assert.throws(()=>car.setControls(JSON.parse('{"__proto__":0}')));assert.throws(()=>car.part('unknown'));
});

test('force drivers use exactly one integration, bounded substeps and release on body removal',()=>{
 const world=new PhysicsWorld([0,0,0],-100),body=world.add(new RigidBody({id:'test',mass:2,position:[0,10,0],shape:{kind:'sphere',radius:1}}));
 let elapsed=0,calls=0;const driver={maxStepSeconds:.005,force:[4,0,0],torque:[0,0,0],evaluate(dt){elapsed+=dt;calls++;}};
 world.drive(body,driver);assert.throws(()=>world.drive(body,driver));world.step(.05);near(elapsed,.05);assert.equal(calls,10);near(body.velocity[0],.1);
 world.remove('test');world.step(.01);assert.equal(calls,10);world.clear();
});

test('shared f64 frame follows the exact existing engine rotation convention',()=>{
 for(const r of [[0,0,0],[.1,.2,.3],[-.8,1.1,-2]]){const f=new ForceFrame();f.update(r);const m=compose([0,0,0],r,[1,1,1]);for(let c=0;c<3;c++)for(let j=0;j<3;j++)near(f.basis[c*3+j],m[c*4+j],1e-7);}
});
