import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene} from '../dist/scene/scene.js';
import {SnowSurface} from '../dist/environment/snow-surface.js';
import spec,{initializeRuntime,seekRuntime,createAuthority} from '../tools/snow-city/scene.mjs';
import {SnowCitySimulation} from '../tools/snow-city/simulation.mjs';
import {closestApproach} from '../tools/snow-city/math.mjs';
import {cityTile} from '../tools/snow-city/city.mjs';
import {renderAudio} from '../tools/snow-city/recorded-audio.mjs';
test('visual poses cannot bypass physics; limb impressions change snow geometry',()=>{
 const s=new Scene({version:1,entities:[{id:'body',body:{mass:2,collisionSize:[1,1,1]}}]});assert.throws(()=>s.setVisualTransform('body',[2,1,0]),/body-free/);
 const snow=new SnowSurface({id:'angel',center:[0,0],size:[4,4],height:.2,snowDepth:.18,tileSize:2,detailedCellSize:.12});const before=snow.height(.4,0);snow.drainMeshes();snow.stamp({sequence:0,foot:'arm',position:[0,.2,0],yaw:0,time:1,depth:.07,ellipse:[.7,.12]});assert.ok(snow.height(.4,0)<before-.03);assert.ok(snow.drainMeshes().length);assert.throws(()=>snow.stamp({position:[0,0,0],yaw:0,depth:.1,ellipse:[NaN,1]}));
});
test('prediction uses future relative motion and infinite tiles remain world anchored',()=>{
 const risk=closestApproach({position:[-12,0,0],velocity:[8,0,0]},{position:[0,0,12],velocity:[0,0,-8]});assert.equal(risk.time,1.5);assert.equal(risk.distance,0);assert.deepEqual(risk.point,[0,1,0]);assert.deepEqual(cityTile(103,-77),cityTile(103,-77));assert.ok(cityTile(103,-77).every(e=>!e.body));
});
test('native drift, impact prediction, snow collection/lift and vandalism replay across workers',async()=>{
 const a=new Scene(spec),b=new Scene(spec),sa=new SnowCitySimulation(a),sb=new SnowCitySimulation(b);await sa.prepareFrame();let predicted=false,impact=false,lifted=false;
 for(let tick=0;tick<1740;tick++){a.step(1/60);b.step(1/60);a.drainEvents();b.drainEvents();predicted ||= !!sa.director.prediction&&sa.director.prediction.expectedAt>a.time;impact ||= sa.collisionCount>0;if(tick===1500)lifted=sa.people.balls[2].body.position[1]>2;
  if(tick%180===0){assert.deepEqual(sa.cars.map(c=>c.rig.body.position),sb.cars.map(c=>c.rig.body.position));assert.deepEqual(sa.people.balls.map(e=>e.body.position),sb.people.balls.map(e=>e.body.position));}
 }
 assert.ok(predicted&&impact);assert.ok(Math.max(...sa.cars.map(c=>c.maxSlip))>1000);assert.ok(sa.people.rollDistance>1);assert.ok(sa.people.rollingRadius>.40);assert.ok(Math.abs(sa.people.stockM3+sa.people.usedM3-2)<1e-10);assert.ok(lifted);assert.ok(sa.people.knocked);assert.ok(sa.people.balls[2].body.position[1]<1.5);assert.ok(sa.people.skin.stamps.some(s=>s.ellipse));
 assert.ok(sa.cars.some(c=>c.distanceM>150&&c.routeIndex>=2));assert.ok(sa.cars.every(c=>c.fullThrottleTicks>900));assert.ok(sa.cars.some(c=>c.driftTicks>60));assert.equal(sa.people.skin.snowDepth,.48);
 sa.freeCamera={position:[960000,20,-960000],target:[960010,1,-960010]};a.step(1/60);await sa.prepareFrame();assert.ok(sa.world.inspect().resident<=12);assert.ok(a.entities.size<2500);assert.equal(sa.origin[0],960000);sa.dispose();sb.dispose();assert.ok([...a.entities.keys()].every(id=>a.contacts.controlledEntityIds().has(id)));a.contacts.dispose();assert.equal(a.entities.size,0);
});
test('audio segments join at exact absolute samples',()=>{const all=renderAudio({startTime:0,duration:.1}),left=renderAudio({startTime:0,duration:.05}),right=renderAudio({startTime:.05,duration:.05});assert.deepEqual([...left,...right],[...all]);});

test('late workers restore exact requested snapshots, cached and out of order',async()=>{
 const native=await createAuthority({startTick:360000}),base=native.checkpoint(),frames=[];for(let n=0;n<120;n++){frames.push(native.frame());native.step();}
 const previousFetch=globalThis.fetch;let requests=0;globalThis.fetch=async url=>{assert.match(url,/tick=360000/);requests++;return Response.json({startTick:360000,frames,base});};
 const make=()=>({scene:new Scene(spec),tickRate:60}),a=make(),b=make();
 try{await initializeRuntime(a);await initializeRuntime(b);const identity={streamId:'test',sceneHash:'a'.repeat(64)};
  await seekRuntime(a,360050,identity);await seekRuntime(b,360050,identity);assert.equal(a.scene.tick,360050);assert.equal(a.scene.physics.steps,0);assert.deepEqual(a.snowCity.cars.map(c=>c.rig.body.position),b.snowCity.cars.map(c=>c.rig.body.position));
  const count=requests;await seekRuntime(a,360080,identity);await seekRuntime(a,360006,identity);assert.equal(requests,count);assert.equal(a.scene.tick,360006);assert.deepEqual(a.snowCity.cars[0].rig.body.position,frames[6].cars[0].body.slice(0,3));
 }finally{globalThis.fetch=previousFetch;a.snowCity?.dispose();b.snowCity?.dispose();native.dispose();}
});
