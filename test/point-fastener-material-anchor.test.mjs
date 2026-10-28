import test from 'node:test';
import assert from 'node:assert/strict';
import {SolidBody,SolidWorld} from '../dist/physics/compound.js';
import {PointFastener} from '../dist/physics/point-fastener.js';
const spec={stiffness:150000,damping:300,failureForce:100000,engagement:.1};
test('a fastener samples its deforming B material point rather than a rigid local attachment',()=>{
 const a=new SolidBody({p:[0,0,0],mass:100}),b=new SolidBody({p:[0,1,0],mass:20});let offset=.02,calls=0;
 const pin=new PointFastener(a,b,()=>a.point([0,1,0]),[0,0,0],spec,()=>{calls++;return b.point([offset,0,0]);});
 pin.beginStep();pin.solve(1/120);assert.equal(calls,1);assert.equal(pin.extension,.02);assert.ok(pin.force>0);assert.equal(pin.broken,false);
 offset=.15;pin.beginStep();pin.solve(1/120);assert.equal(calls,2);assert.equal(pin.broken,true);
});
test('a fastener with missing attachment material stops loading either owner',()=>{
 const a=new SolidBody({p:[0,0,0],mass:100}),b=new SolidBody({p:[0,1,0],mass:20}),anchor=Object.assign(()=>a.point([0,1,0]),{available:()=>false}),pin=new PointFastener(a,b,anchor,[0,0,0],spec);
 pin.beginStep();pin.solve(1/120);assert.equal(pin.broken,true);assert.equal(pin.force,0);assert.deepEqual(a.v,[0,0,0]);assert.deepEqual(b.v,[0,0,0]);
});
test('a joint to actual static material participates in the dynamic island and supports gravity',()=>{
 const world=new SolidWorld(),a=world.add(new SolidBody({p:[0,2,0],mass:0})),b=world.add(new SolidBody({p:[0,1,0],mass:20}));a.ignore.add(b.id);b.ignore.add(a.id);
 const pin=new PointFastener(a,b,()=>a.point([0,-1,0]),[0,0,0],{...spec,engagement:.2});world.constraint(a,b,pin);
 for(let i=0;i<240;i++)world.step(1/120);
 assert.equal(pin.broken,false);assert.ok(b.p[1]>.99&&b.p[1]<1.001);assert.ok(Math.abs(pin.force-20*9.81)<1);assert.deepEqual(a.p,[0,2,0]);assert.equal(world.contacts.length,0);
});
