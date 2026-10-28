import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Scene} from '../dist/scene/scene.js';
import {freezePrimitive,primitiveKey} from '../dist/procedural/mesh.js';
import spec from '../tools/snow-city/scene.mjs';
import {SnowCitySimulation} from '../tools/snow-city/simulation.mjs';
import {loadTimeline,restoreTimeline} from '../tools/snow-city/timeline.mjs';
import {SnowSurface} from '../dist/environment/snow-surface.js';

test('overlapping deep snow impressions cannot accumulate towering rims',()=>{
 const snow=new SnowSurface({id:'deep',center:[0,0],size:[4,4],height:.6,snowDepth:.48});
 const stamp={sequence:1,foot:'angel',position:[0,.15,0],yaw:0,time:0,depth:.28,ellipse:[.53,.13]};snow.stamp(stamp);
 const before=[];for(let x=-1;x<=1;x+=.025)before.push(snow.height(x,0));
 for(let n=2;n<=80;n++)snow.stamp({...stamp,sequence:n,time:n/60});
 const after=[];for(let x=-1;x<=1;x+=.025)after.push(snow.height(x,0));
 assert.deepEqual(after,before);assert(Math.max(...after)<.70);assert(Math.min(...after)>.25);
});

test('immutable shared render geometry stays isolated from mutable authoring',()=>{
 const shared=freezePrimitive({kind:'box',size:[1,1,1]}),color=[.1,.2,.3,1];
 const scene=new Scene({version:1,entities:[{id:'a',mesh:shared,material:{color}},{id:'b',mesh:shared}]});
 assert.equal(scene.entities.get('a').mesh,scene.entities.get('b').mesh);color[0]=.9;assert.equal(scene.entities.get('a').material.color[0],.1);
 const mutable={kind:'box',size:[2,2,2]};scene.add({id:'c',mesh:mutable});mutable.size[0]=20;assert.equal(scene.entities.get('c').mesh.size[0],2);
 scene.add({id:'attached-glass',visualOnly:true,mesh:shared,material:{kind:'glass'}});assert.equal(scene.entities.get('attached-glass').body,undefined);
 assert.throws(()=>scene.add({id:'invalid',visualOnly:true,body:{mass:2}}),/visualOnly/);
});

test('changing geometry uses a stable identity key and still freezes shallow-frozen authoring arrays',()=>{
 const size=[1,2,3],first=freezePrimitive(Object.freeze({kind:'box',size}),true),second=freezePrimitive({kind:'box',size:[1,2,3]},true),key=primitiveKey(first);
 assert(Object.isFrozen(size));assert.throws(()=>{size[0]=9;},TypeError);assert.equal(primitiveKey(first),key);assert(key.length<32);assert.notEqual(primitiveKey(second),key);
 assert.equal(primitiveKey(freezePrimitive({kind:'box',size:[1,2,3]})),primitiveKey(freezePrimitive({kind:'box',size:[1,2,3]})));
 const scene=new Scene({version:1,entities:[]});scene.add({id:'a',mesh:first});scene.add({id:'b',mesh:first});assert.equal(scene.entities.get('a').mesh,first);assert.equal(scene.entities.get('b').mesh,first);
});

test('assembly deformation spends a bounded contact budget without passing through a wall',()=>{
 const scene=new Scene({version:1,ground:-100,gravity:[0,0,0],entities:[{id:'wall',position:[0,0,0],body:{mass:0,collisionSize:[1,4,4]}},{id:'car',position:[-3,0,0],body:{mass:100,collisionSize:[1,1,1],velocity:[8,0,0],restitution:.5}}]});
 let contacts=0;scene.contactEnergySource=(_contact,available)=>{contacts++;return available*.7;};
 for(let n=0;n<90;n++)scene.step(1/60);
 assert.ok(contacts>0);assert.ok(scene.entities.get('car').position[0]<-1);assert.ok(scene.entities.get('car').body.velocity[0]<=0);
});

test('legacy recorded 60 Hz states restore out of order without stepping',async()=>{
 const tape=await loadTimeline();
 // The old recording is retained as a restoration compatibility fixture. Live
 // output is verified against the single authority in live-snow.test.mjs.
 const native=new Scene(spec),sim=new SnowCitySimulation(native),replayed=new Scene(spec),restored=new SnowCitySimulation(replayed);
 for(let tick=0;tick<=180;tick++){
  if(tick){native.step(1/60);native.drainEvents();native.contacts.drainFootsteps();}

 }
 const steps=replayed.physics.steps;
 for(const tick of [7400,180,6120,0,7680+180]){restoreTimeline(restored,tape,tick);await restored.prepareFrame();assert.equal(replayed.tick,tick);assert.equal(replayed.physics.steps,steps);const local=tick%7680,o=restored.origin;assert.deepEqual(restored.cars[0].rig.body.position,[tape.frames[local].cars[0].body[0]+o[0],tape.frames[local].cars[0].body[1],tape.frames[local].cars[0].body[2]+o[2]]);assert.ok([...replayed.entities.values()].every(e=>e.position.every(Number.isFinite)));}
 sim.dispose();restored.dispose();
});
