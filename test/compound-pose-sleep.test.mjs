import test from 'node:test';
import assert from 'node:assert/strict';
import {SolidWorld,SolidBody,Qeuler} from '../dist/physics/compound.js';

test('connected stationary bodies sleep despite post-solve angular bias and wake after a real impulse',()=>{
 const world=new SolidWorld({gravity:[0,0,0],policies:{supported:b=>b.tag==='support'}}),a=world.add(new SolidBody({p:[0,5,0],mass:2,tag:'support',q:Qeuler(.2,.3,-.4).map(x=>x*3)})),b=world.add(new SolidBody({p:[3,5,0],mass:2,q:Qeuler(-.4,.1,.2)}));
 // A velocity-level constraint can publish a correction which the next force
 // stage cancels. Completed poses, rather than that intermediate speed, are
 // the sleep oracle. Include equivalent opposite quaternion hemispheres.
 world.beforeSubstep=(_dt,members)=>{for(const body of members)if(!body.sleeping){body.w=[0,0,0];body.q=body.q.map(x=>-x);}};
 world.constraint(a,b,{solve(){a.w=[.061,0,0];b.w=[.061,0,0];}});
 for(let tick=0;tick<240;tick++)world.step(1/120);
 assert.equal(a.sleeping,true);assert.equal(b.sleeping,true);assert.deepEqual(a.w,[0,0,0]);assert.deepEqual(b.w,[0,0,0]);
 a.impulse([20,0,0],a.p);assert.equal(a.sleeping,false);for(let tick=0;tick<3;tick++)world.step(1/120);assert.equal(b.sleeping,false);assert.ok(a.p[0]>.2);assert.ok(a.v[0]>9);
});

test('real angular pose travel above the unchanged threshold keeps a supported body awake',()=>{
 const world=new SolidWorld({gravity:[0,0,0],policies:{supported:()=>true}}),body=world.add(new SolidBody({p:[0,5,0],mass:2}));body.w=[.08,0,0];
 for(let tick=0;tick<240;tick++)world.step(1/120);
 assert.equal(body.sleeping,false);assert.ok(Math.abs(body.q[0])>.07);assert.ok(Math.hypot(...body.w)>.07);assert.equal(body.sleepTime,0);
});
