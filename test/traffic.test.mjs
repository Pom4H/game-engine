import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene} from '../dist/scene/scene.js';
import {VehicleRoute} from '../dist/animation/route.js';
import {quaternionFromEuler} from '../dist/physics/rotation.js';
import {synthesizeEvent,renderAudio} from '../dist/audio/synth.js';
import {makeTrafficScene,TrafficDirector} from '../tools/winter/traffic-scene.mjs';
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const near=(a,b,e=1e-8)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
const points=Array.from({length:8},(_,i)=>[10*Math.cos(i*Math.PI/4),0,10*Math.sin(i*Math.PI/4)]);

test('closed routes sample arc distance continuously through either side of the seam and copy authoring data',()=>{
 const spec={points:structuredClone(points)},route=new VehicleRoute(spec);spec.points[0][0]=999;
 assert.ok(route.lengthM>60&&route.lengthM<64);
 assert.deepEqual(route.sample(0).position,points[0]);
 assert.ok(distance(route.sample(-.001).position,route.sample(.001).position)<.0021);
 for(let d=0;d<route.lengthM;d+=.21){
  near(distance(route.sample(d).position,route.sample(d+.05).position),.05,4e-4);
  assert.ok(distance(route.sample(d).position,route.sample(d+route.lengthM*3).position)<1e-10);
 }
 assert.throws(()=>new VehicleRoute({points:points.slice(0,3)}));
 assert.throws(()=>new VehicleRoute({points:points.map(()=>[0,0,0])}));
 assert.throws(()=>new VehicleRoute({points:[[NaN,0,0],...points.slice(1)]}));
 assert.throws(()=>new VehicleRoute({points,offsetM:Infinity}));
 assert.throws(()=>route.sample(NaN));
});

test('routed kinematic vehicles preserve rigid part offsets, correct world axle roll and bounded seam velocity over two laps',()=>{
 const route=new VehicleRoute({points}),offsetM=route.lengthM-.01,radius=.33,speed=4;
 const scene=new Scene({version:1,ground:-100,entities:[
  {id:'body',body:{motion:'kinematic',mass:1000,collisionSize:[2,1,1]}},
  {id:'wheel',body:{motion:'kinematic',mass:250,collisionSize:[.66,.66,.25]}},
 ],animation:{vehicles:[{id:'car',velocity:[speed,0,0],route:{points,offsetM},parts:[
  {id:'body',origin:points[0]},
  {id:'wheel',origin:[points[0][0]+1,.33,.5],wheel:true,radius},
 ]}]}});
 scene.animation.step(0,scene.entities);let previous=[...scene.entities.get('body').position];
 for(let i=0;i<2000;i++){
  scene.step();const body=scene.entities.get('body'),wheel=scene.entities.get('wheel'),pose=route.sample(speed*scene.time+offsetM);
  assert.ok(distance(previous,body.position)<.067);previous=[...body.position];
  assert.ok(distance(body.position,pose.position)<1e-8);
  assert.ok(Math.hypot(...body.body.angularVelocity)<1);assert.ok(Math.hypot(...wheel.body.angularVelocity)<13);
  const c=Math.cos(pose.heading),s=Math.sin(pose.heading);
  assert.ok(distance(wheel.position,[pose.position[0]+c+s*.5,.33,pose.position[2]-s+c*.5])<1e-8);
  const actual=quaternionFromEuler(wheel.rotation),expected=quaternionFromEuler([0,pose.heading,-speed*scene.time/radius]);
  near(Math.abs(actual.reduce((sum,v,k)=>sum+v*expected[k],0)),1,1e-8);
 }
});

test('horn commands record source position at the authoritative tick and synthesize deterministic stereo replay',()=>{
 const create=()=>new Scene({version:1,entities:[{id:'taxi',position:[12,1,0]}]}),a=create(),b=create();
 for(const scene of [a,b]){
  scene.use({id:'driver',phase:'commit',rateHz:60,context:'none',reads:[],writes:['events'],after:['engine:clock'],run:()=>[{type:'horn',id:'taxi',durationSeconds:.3,frequencyHz:330}]});
  scene.step();
 }
 const events=a.drainEvents();assert.deepEqual(events,b.drainEvents());assert.equal(events[0].type,'horn');near(events[0].time,1/60);assert.deepEqual(events[0].point,[12,1,0]);
 a.entities.get('taxi').position[0]=99;assert.equal(events[0].point[0],12);
 const audio=synthesizeEvent(events[0],8000);assert.deepEqual(audio,synthesizeEvent(events[0],8000));assert.ok(audio.left.some(v=>v!==0));
 const energy=x=>x.reduce((sum,v)=>sum+v*v,0);assert.ok(energy(audio.right)>energy(audio.left));assert.ok(energy(audio.left.slice(-100))<energy(audio.left.slice(500,600))*.002);
 const replay=renderAudio(events,1,8000);assert.deepEqual(replay,renderAudio(events,1,8000));
 assert.throws(()=>a.honk('missing'));assert.throws(()=>a.honk('taxi',0));assert.throws(()=>a.honk('taxi',.3,Infinity));assert.equal(a.drainEvents().length,0);
});

test('winter traffic integrates preserved snow, dense opposing cars, native tyre spray and bounded horn policy',()=>{
 const data=makeTrafficScene(),scene=new Scene(data.spec),director=new TrafficDirector(scene,data.cars);
 scene.animation.step(0,scene.entities,p=>scene.contacts.sample(p));
 const initialEntities=scene.entities.size;
 for(let i=0;i<45;i++)scene.step(1/30);
 const stats=director.inspect();assert.equal(stats.cars,48);assert.ok(stats.visibleCars>=25);assert.ok(stats.leftbound>=12&&stats.rightbound>=12);assert.ok(stats.honks>0);assert.ok(stats.sprayEmitted>1000);
 assert.equal(scene.contacts.inspect().wheelContacts,192);assert.ok(scene.entities.size<=initialEntities+100);
 assert.ok(data.spec.entities.some(e=>e.material?.kind==='snow'&&e.mesh.kind==='triangle-mesh'&&e.mesh.positions.length>1000));assert.ok(data.spec.animation.walkers.length===1);assert.ok(!data.spec.entities.some(e=>/traffic.?light|signal-light/.test(e.id)));
 const events=scene.drainEvents().filter(e=>e.type==='horn');assert.ok(events.length>0&&events.length<15);assert.ok(events.every(e=>e.point.every(Number.isFinite)));
 director.honkNearest();assert.equal(scene.drainEvents().filter(e=>e.type==='horn').length,1);
 assert.throws(()=>makeTrafficScene({count:100}));assert.throws(()=>makeTrafficScene({count:15}));
});
