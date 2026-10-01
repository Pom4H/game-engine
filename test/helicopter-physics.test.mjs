import test from 'node:test';
import assert from 'node:assert/strict';
import {PhysicsWorld} from '../dist/physics/world.js';
import {Vehicle,vehicle,rotor} from '../dist/vehicles/vehicle.js';
import {
 lightHelicopter,LIGHT_HELICOPTER_HOVER_COLLECTIVE,LIGHT_HELICOPTER_HOVER_ROLL,
 LIGHT_HELICOPTER_MAIN_RPM,LIGHT_HELICOPTER_TAIL_RPM,
} from '../dist/vehicles/helicopter.js';

const near=(a,b,ratio=.08)=>assert.ok(Math.abs(a-b)<=Math.max(1,Math.abs(b)*ratio),`${a} != ${b}`);
const spool=(heli,seconds=6)=>{for(let i=0;i<Math.round(seconds*120);i++)heli.evaluate(1/120);};

test('rotor creates thrust at zero translational speed on the same rigid body',()=>{
 const world=new PhysicsWorld([0,0,0],-100),bp=lightHelicopter('hover-force'),heli=new Vehicle(world,bp,{position:[0,30,0]});
 heli.setControls({throttle:1,collective:LIGHT_HELICOPTER_HOVER_COLLECTIVE,roll:LIGHT_HELICOPTER_HOVER_ROLL});
 spool(heli);
 const main=heli.part('main.rotor'),tail=heli.part('tail.rotor');
 assert.equal(world.bodies.size,1);
 assert.equal(main.kind,'rotor');assert.ok(main.liftN>0);assert.ok(tail.liftN>0);
 near(main.angularSpeed,LIGHT_HELICOPTER_MAIN_RPM*Math.PI/30,.03);
 near(tail.angularSpeed,LIGHT_HELICOPTER_TAIL_RPM*Math.PI/30,.03);
 near(main.liftN,bp.massKg*9.81,.14);
 assert.ok(main.powerW>100_000);assert.ok(Math.abs(main.reactionTorqueNm)>1_000);
 heli.dispose();
});

test('main reaction torque and tail rotor trim approximately balance hover yaw',()=>{
 const world=new PhysicsWorld([0,0,0],-100),heli=new Vehicle(world,lightHelicopter('yaw-trim'),{position:[0,30,0]});
 heli.setControls({throttle:1,collective:LIGHT_HELICOPTER_HOVER_COLLECTIVE,roll:LIGHT_HELICOPTER_HOVER_ROLL,yaw:0});
 spool(heli);heli.evaluate(1/120);
 const trimmed=heli.torque[1];
 assert.ok(Math.abs(trimmed)<2200,`unbalanced yaw torque ${trimmed}`);
 heli.setControls({yaw:1});heli.evaluate(1/120);const right=heli.torque[1];
 heli.setControls({yaw:-1});heli.evaluate(1/120);const left=heli.torque[1];
 assert.ok(right>trimmed+1200);assert.ok(left<trimmed-1200);
 heli.dispose();
});

test('cyclic tilts rotor thrust and produces real pitch/roll body moments',()=>{
 const world=new PhysicsWorld([0,0,0],-100),heli=new Vehicle(world,lightHelicopter('cyclic'),{position:[0,30,0]});
 heli.setControls({throttle:1,collective:LIGHT_HELICOPTER_HOVER_COLLECTIVE});
 spool(heli);
 heli.setControls({pitch:.6,roll:.5});heli.evaluate(1/120);
 const main=heli.part('main.rotor');
 assert.ok(Math.abs(main.force[0])>500);assert.ok(Math.abs(main.force[2])>400);
 assert.ok(Math.abs(heli.torque[2])>300);assert.ok(Math.abs(heli.torque[0])>300);
 heli.dispose();
});

test('trimmed helicopter can hover without scripted position hold',()=>{
 const world=new PhysicsWorld([0,-9.81,0],-100),heli=new Vehicle(world,lightHelicopter('hover'),{position:[0,80,0]});
 heli.setControls({throttle:1,collective:LIGHT_HELICOPTER_HOVER_COLLECTIVE,roll:LIGHT_HELICOPTER_HOVER_ROLL});
 spool(heli);
 const start=[...heli.body.position];
 for(let i=0;i<4*120;i++)world.step(1/120);
 assert.ok(Math.abs(heli.body.position[1]-start[1])<12,`vertical drift ${heli.body.position[1]-start[1]}`);
 assert.ok(Math.hypot(heli.body.position[0]-start[0],heli.body.position[2]-start[2])<20);
 assert.ok(Math.abs(heli.body.angularVelocity[1])<1.5);
 heli.dispose();
});

test('density altitude reduces rotor thrust at identical controls and RPM',()=>{
 const make=(id,density)=>{
  const world=new PhysicsWorld([0,0,0],-100),heli=new Vehicle(world,lightHelicopter(id),{position:[0,50,0]});
  heli.setAir({densityKgM3:density,wind:[0,0,0]});
  heli.setControls({throttle:1,collective:LIGHT_HELICOPTER_HOVER_COLLECTIVE});
  spool(heli);return heli;
 };
 const sea=make('density-sea',1.225),high=make('density-high',.75);
 assert.ok(high.part('main.rotor').liftN<sea.part('main.rotor').liftN*.72);
 near(high.part('main.rotor').angularSpeed,sea.part('main.rotor').angularSpeed,.03);
 sea.dispose();high.dispose();
});

test('translational lift comes from relative disk flow, including wind',()=>{
 const make=(id,velocity=[0,0,0],wind=[0,0,0])=>{
  const world=new PhysicsWorld([0,0,0],-100),heli=new Vehicle(world,lightHelicopter(id),{position:[0,50,0],velocity});
  heli.setAir({densityKgM3:1.225,wind});heli.setControls({throttle:1,collective:.22});spool(heli);return heli;
 };
 const hover=make('etl-hover'),moving=make('etl-moving',[30,0,0]),wind=make('etl-wind',[0,0,0],[-30,0,0]);
 assert.ok(moving.part('main.rotor').liftN>hover.part('main.rotor').liftN*1.06);
 near(wind.part('main.rotor').liftN,moving.part('main.rotor').liftN,.02);
 hover.dispose();moving.dispose();wind.dispose();
});

test('descending airflow preserves rotor energy better after engine cut (autorotation)',()=>{
 const make=(id,descending)=>{
  const world=new PhysicsWorld([0,0,0],-100),heli=new Vehicle(world,lightHelicopter(id),{position:[0,100,0],velocity:[0,descending?-12:0,0]});
  heli.setControls({throttle:1,collective:.18});spool(heli,4);
  heli.setControls({throttle:0,collective:.18});
  for(let i=0;i<3*120;i++)heli.evaluate(1/120);
  return heli;
 };
 const still=make('cut-still',false),descending=make('cut-desc',true);
 assert.ok(descending.part('main.rotor').angularSpeed>still.part('main.rotor').angularSpeed*1.6);
 assert.ok(descending.part('main.rotor').liftN>still.part('main.rotor').liftN);
 still.dispose();descending.dispose();
});

test('failed rotor loses thrust but remains attached mass and does not create a second simulation',()=>{
 const bp=vehicle('failed-rotor',{chassis:{massKg:500,sizeM:[4,1.5,1.5]},parts:[
  rotor('main',{at:[0,1,0],massKg:80,radiusM:4,bladeChordM:.28,blades:3,governorRpm:450,maxPowerW:300000,
   collectiveControl:'collective',collectiveGainRad:.14,condition:{failureLoadN:1000}}),
 ]});
 const world=new PhysicsWorld([0,0,0],-100),heli=new Vehicle(world,bp,{position:[0,20,0]});const mass=heli.body.mass;
 heli.setControls({throttle:1,collective:.5});spool(heli,4);
 assert.equal(heli.part('main').failed,true);
 heli.evaluate(1/120);
 assert.equal(heli.part('main').liftN,0);assert.equal(heli.body.mass,mass);assert.equal(world.bodies.size,1);
 heli.dispose();
});

test('rotor validation rejects impossible geometry and controls stay bounded',()=>{
 assert.throws(()=>vehicle('bad',{chassis:{massKg:10,sizeM:[1,1,1]},parts:[
  rotor('r',{at:[0,0,0],massKg:1,radiusM:1,bladeChordM:.2,blades:0,governorRpm:400,maxPowerW:1000}),
 ]}));
 const heli=new Vehicle(new PhysicsWorld([0,0,0],-100),lightHelicopter('controls'));
 assert.throws(()=>heli.setControls({collective:-.1}));
 assert.throws(()=>heli.setControls({yaw:2}));
 heli.dispose();
});
