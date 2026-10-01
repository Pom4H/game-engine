import test from 'node:test';
import assert from 'node:assert/strict';
import {PhysicsWorld,RigidBody} from '../dist/physics/world.js';
import {bodyWheelSupport} from '../dist/physics/wheel-support.js';
import {Scene} from '../dist/scene/scene.js';
import {spawnVehicle} from '../dist/vehicles/scene-vehicle.js';
import {project} from '../dist/core/project.js';
import {helicopter} from '../dist/games/helicopter-project.js';
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

test('cyclic drives rotor flap/lead-lag dynamics before body moments emerge',()=>{
 const world=new PhysicsWorld([0,0,0],-100),heli=new Vehicle(world,lightHelicopter('cyclic'),{position:[0,30,0]});
 heli.setControls({throttle:1,collective:LIGHT_HELICOPTER_HOVER_COLLECTIVE});
 spool(heli);
 heli.setControls({pitch:.6,roll:.5});heli.evaluate(1/120);
 const main=heli.part('main.rotor'),first=Math.hypot(main.flapPitchRad,main.flapRollRad);
 for(let i=0;i<48;i++)heli.evaluate(1/120);
 const settled=Math.hypot(main.flapPitchRad,main.flapRollRad);
 assert.ok(first>0&&settled>first*2);assert.ok(Math.abs(main.leadLagRad)>1e-4);
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

test('shared gearbox caps aggregate shaft power instead of giving every rotor a private engine',()=>{
 const bp=vehicle('shaft-budget',{chassis:{massKg:600,sizeM:[4,1.5,1.5]},shafts:[{id:'engine',maxPowerW:120_000}],parts:[
  rotor('a',{at:[0,1,-1],massKg:30,radiusM:3,bladeChordM:.25,blades:3,governorRpm:500,maxPowerW:100_000,shaft:'engine',collectiveControl:'collective',collectiveGainRad:.2}),
  rotor('b',{at:[0,1,1],massKg:30,radiusM:3,bladeChordM:.25,blades:3,governorRpm:500,maxPowerW:100_000,shaft:'engine',collectiveControl:'collective',collectiveGainRad:.2}),
 ]});
 const heli=new Vehicle(new PhysicsWorld([0,0,0],-100),bp,{position:[0,30,0]});heli.setControls({throttle:1,collective:1});spool(heli,5);
 const total=heli.part('a').shaftPowerW+heli.part('b').shaftPowerW;
 assert.ok(total<=120_001,`shaft over budget ${total}`);assert.ok(total>80_000);
 heli.dispose();
});

test('ground effect emerges from rotor clearance rather than an altitude mode switch',()=>{
 const make=(id,height)=>{const world=new PhysicsWorld([0,0,0],0),heli=new Vehicle(world,lightHelicopter(id),{position:[0,height,0]});heli.setControls({throttle:1,collective:.22});spool(heli,4);return heli;};
 const low=make('oge-low',4.5),high=make('oge-high',40);
 assert.ok(low.part('main.rotor').groundEffect>1.03);assert.equal(high.part('main.rotor').groundEffect,1);
 assert.ok(low.part('main.rotor').liftN>high.part('main.rotor').liftN*1.02);
 low.dispose();high.dispose();
});

test('steep powered descent enters vortex-ring state and reduces useful thrust',()=>{
 const make=(id,vy)=>{const world=new PhysicsWorld([0,0,0],-100),heli=new Vehicle(world,lightHelicopter(id),{position:[0,80,0],velocity:[0,vy,0]});heli.setControls({throttle:1,collective:.29});spool(heli,4);return heli;};
 const hover=make('vrs-hover',0),descent=make('vrs-descent',-12);
 const rotor=descent.part('main.rotor');assert.ok(rotor.vortexRing>.1,`VRS ${rotor.vortexRing}`);
 assert.ok(rotor.liftN<hover.part('main.rotor').liftN);
 hover.dispose();descent.dispose();
});

test('high advance ratio produces retreating-blade stall and an asymmetric hub moment',()=>{
 const world=new PhysicsWorld([0,0,0],-100),heli=new Vehicle(world,lightHelicopter('retreating'),{position:[0,80,0],velocity:[105,0,0]});
 heli.setControls({throttle:1,collective:.32});spool(heli,4);heli.evaluate(1/120);
 const main=heli.part('main.rotor');assert.ok(main.retreatingStall>.15,`stall ${main.retreatingStall}`);
 assert.ok(Math.abs(heli.torque[0])>500);
 heli.dispose();
});

test('rotor ray clearance can shed blades on a real collider',()=>{
 const world=new PhysicsWorld([0,0,0],-100),bp=vehicle('strike',{chassis:{massKg:300,sizeM:[2,1,1]},parts:[
  rotor('main',{at:[0,0,0],massKg:40,radiusM:2,bladeChordM:.2,blades:2,governorRpm:500,maxPowerW:100_000,collectiveControl:'collective',collectiveGainRad:.18}),
 ]});
 const heli=new Vehicle(world,bp,{position:[0,5,0]});
 world.add(new RigidBody({id:'wall',mass:0,position:[1.5,5,0],shape:{kind:'box',half:[.08,1,1]}}));
 world.wheelSupport=bodyWheelSupport(world.bodies.values(),world.ground);
 heli.setControls({throttle:1,collective:.6});
 for(let i=0;i<4*120&&heli.part('main').rotorStrikeCount===0;i++)heli.evaluate(1/120);
 assert.ok(heli.part('main').rotorStrikeCount>0);assert.ok(heli.part('main').bladesAttached<2);
 heli.dispose();
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

test('scene rotor presentation consumes physical spin instead of a second animation clock',()=>{
 const scene=new Scene({version:1,entities:[]}),bp=lightHelicopter('scene-heli');
 const handle=spawnVehicle(scene,bp,{parts:[]},{modelOriginM:[0,0,0],damage:false,position:[0,30,0]});
 const visual=scene.entities.get('scene-heli/main.rotor');assert.ok(visual);assert.equal(visual.body,undefined);
 const before=[...visual.rotation],spin=handle.vehicle.part('main.rotor').spinRad;
 handle.vehicle.setControls({throttle:1,collective:.2});
 for(let i=0;i<120;i++)scene.step(1/120);
 assert.notEqual(handle.vehicle.part('main.rotor').spinRad,spin);
 assert.notDeepEqual([...visual.rotation],before);
 assert.equal(scene.physics.bodies.size,1);
 handle.dispose();assert.equal(scene.physics.bodies.size,0);assert.equal(scene.entities.size,0);
});

test('helicopter is an ordinary public project module with inspectable rotors',()=>{
 const definition=project({id:'helicopter-demo',modules:{flight:helicopter({altitude:25})}});
 const checked=definition.check();assert.equal(checked.modules[0].id,'helicopter');
 const live=definition.start(),game=live.values.flight;
 for(let i=0;i<240;i++)game.step();
 const views=live.inspect();assert.deepEqual(views.map(view=>view.kind),['vehicle','rotor','rotor']);
 assert.equal(game.world.bodies.size,1);assert.ok(views[1].data.rpm>100);
 live.dispose();assert.equal(game.world.bodies.size,0);
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
