import test from 'node:test';
import assert from 'node:assert/strict';
import {SolidBody,SolidWorld} from '../dist/index.js';

test('body query filters admit a deeper support while preserving static and dynamic exclusions',()=>{
 const world=new SolidWorld({gravity:[0,0,0]}),top=world.add(new SolidBody({p:[0,3,0],half:[1,.5,1],mass:0})),bottom=world.add(new SolidBody({p:[0,1,0],half:[1,.5,1],mass:2}));
 assert.equal(world.ray([0,5,0],[0,-1,0],8).body,top);
 assert.equal(world.ray([0,5,0],[0,-1,0],8,null,b=>b!==top).body,bottom);
 assert.equal(world.ray([0,5,0],[0,-1,0],8,top,b=>b!==bottom),null);
 assert.equal(world.overlapsBox([0,3,0],[.2,.2,.2],null,b=>b!==top),false);
 assert.equal(world.overlapsBox([0,1,0],[.2,.2,.2],null,b=>b!==top),true);
});

test('range constraints leave admitted separation free and apply equal opposite impulse outside the range',()=>{
 const world=new SolidWorld({gravity:[0,0,0]}),a=world.add(new SolidBody({p:[0,0,0],mass:2})),b=world.add(new SolidBody({p:[1,0,0],mass:2})),joint=world.rangeJoint(a,b,.5,1.5);
 a.v=[.2,0,0];b.v=[-.2,0,0];world.solveJoint(joint,1/120);assert.deepEqual(a.v,[.2,0,0]);assert.deepEqual(b.v,[-.2,0,0]);
 a.v=[0,0,0];b.v=[0,0,0];b.p=[2,0,0];world.solveJoint(joint,1/120);assert.ok(a.v[0]>0&&b.v[0]<0);assert.ok(Math.abs(a.v[0]+b.v[0])<1e-12);
 assert.throws(()=>world.rangeJoint(a,b,2,1),/range/);assert.throws(()=>world.rangeJoint(a,b,0,Infinity),/range/);
 const staticA=new SolidBody({mass:0}),staticB=new SolidBody({mass:0,p:[2,0,0]});world.solveJoint(world.rangeJoint(staticA,staticB,0,1),1/120);assert.ok([...staticA.v,...staticB.v].every(Number.isFinite));
});
