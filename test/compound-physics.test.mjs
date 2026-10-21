import test from 'node:test';
import assert from 'node:assert/strict';
import {SolidWorld,SolidBody,COMPOUND_PHYSICS_BACKEND,Qeuler} from '../dist/index.js';

test('Engine compound bodies retain shape poses, angular inertia and finite-plane rays',()=>{
 const world=new SolidWorld({gravity:[0,0,0]}),body=world.add(new SolidBody({p:[0,3,0],q:Qeuler(.4),mass:12,shapes:[{half:[.2,.3,.4],offset:[1,0,0],q:Qeuler(.2)}]}));
 assert.equal(world.backend,COMPOUND_PHYSICS_BACKEND);assert.equal(body.boxes().length,1);
 body.impulse([0,0,12],[1,3,0]);assert.deepEqual(body.v,[0,0,1]);assert.ok(Math.abs(body.w[1])>0);
 const plane=world.addPlane({p:[0,0,0],hu:10,hv:10});const hit=world.ray([8,3,0],[0,-1,0],4);
 assert.equal(hit.plane,plane);assert.equal(hit.t,3);assert.deepEqual(hit.n,[0,1,0]);
});
test('Engine application policies control ray roles and contact friction without built-in Game tags',()=>{
 const world=new SolidWorld({gravity:[0,0,0]}),a=world.add(new SolidBody({p:[0,2,0],mass:2,tag:'ragdoll',friction:.64})),b=world.add(new SolidBody({p:[2,2,0],mass:2,tag:'vehicle',friction:.25}));
 assert.equal(world.ray([0,4,0],[0,-1,0],3).body,a,'the generic solver has no pedestrian/ragdoll ray exclusion');
 world.addContact(a,b,[1,2,0],[-1,0,0],.1,'vehicle',1/120);assert.equal(world.contacts[0].mu,.4);
 const controlled=new SolidWorld({policies:{frictionLimit:()=>.1,rayBody:()=>false}});controlled.add(a);controlled.add(b);
 assert.equal(controlled.ray([0,4,0],[0,-1,0],3),null);controlled.addContact(a,b,[1,2,0],[-1,0,0],.1,'vehicle',1/120);assert.equal(controlled.contacts[0].mu,.1);
});
test('the standalone Engine kernel sleeps on contact and wakes after an impulse, with local swept islands',()=>{
 const world=new SolidWorld(),body=world.add(new SolidBody({p:[0,.5,0],mass:10}));world.addPlane({p:[0,0,0],hu:10,hv:10});
 for(let i=0;i<240;i++)world.step(1/120);assert.equal(body.sleeping,true);body.impulse([20,0,0]);assert.equal(body.sleeping,false);assert.equal(body.v[0],2);
 const isolated=new SolidWorld({gravity:[0,0,0]}),fast=isolated.add(new SolidBody({p:[0,5,0],mass:1})),slow=isolated.add(new SolidBody({p:[100,5,0],mass:1}));fast.v=[120,0,0];const calls=new Map();isolated.beforeSubstep=(_dt,members)=>{for(const b of members)calls.set(b,(calls.get(b)??0)+1);};
 isolated.step(1/120);assert.equal(calls.get(fast),8);assert.equal(calls.get(slow),1);assert.equal(isolated.metrics.bodySubsteps,9);assert.throws(()=>isolated.step(.1),/dt/);
});
