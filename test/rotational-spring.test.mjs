import test from 'node:test';
import assert from 'node:assert/strict';
import {SolidBody,SolidWorld,Qaxis} from '../dist/physics/compound.js';
import {RotationalSpring} from '../dist/physics/rotational-spring.js';
import {PointFastener} from '../dist/physics/point-fastener.js';
const energy=b=>.5*b.mass*b.v.reduce((n,v)=>n+v*v,0)+.5*b.w[0]**2/b.invI[0];

test('jamb and check-strap stops retain a door against a commanded handle and an inward slam',()=>{
 for(const dt of [1/60,1/120,1/240]){
  const world=new SolidWorld({gravity:[0,0,0]}),a=world.add(new SolidBody({mass:1e6})),b=world.add(new SolidBody({half:[.025,.5,.5],mass:25}));a.ignore.add(b.id);b.ignore.add(a.id);
  const spring=new RotationalSpring(a,b,()=>({axis:[1,0,0],center:b.p,angle:2*Math.atan2(b.q[0],b.q[3])}),.5);spring.target=2;spring.max=1.12;spring.stiffness=3000;spring.damping=30;spring.limitStiffness=6000;spring.maxTorque=20;world.constraint(a,b,spring);
  for(let i=0;i<2/dt;i++){world.step(dt);assert.ok(2*Math.atan2(b.q[0],b.q[3])<=1.125);}
  spring.target=null;b.q=Qaxis([1,0,0],.02);b.w=[-8,0,0];b.wake();
  for(let i=0;i<1/dt;i++){world.step(dt);assert.ok(2*Math.atan2(b.q[0],b.q[3])>=-.005);assert.ok(b.w.every(Number.isFinite));}
 }
});

test('implicit angular damping dissipates energy and preserves the two owners angular momentum at different fixed rates',()=>{
 for(const dt of [1/60,1/120,1/240]){
  const world=new SolidWorld({gravity:[0,0,0]}),a=world.add(new SolidBody({mass:3})),b=world.add(new SolidBody({mass:1}));a.ignore.add(b.id);b.ignore.add(a.id);a.w=[-1,0,0];b.w=[3,0,0];
  const spring=new RotationalSpring(a,b,()=>({axis:[1,0,0],center:[0,0,0],angle:0}),.5);spring.damping=3;world.constraint(a,b,spring);let previous=energy(a)+energy(b);
  for(let i=0;i<3/dt;i++){world.step(dt);const e=energy(a)+energy(b);assert.ok(e<=previous+1e-10);assert.ok(Math.abs(a.w[0]/a.invI[0]+b.w[0]/b.invI[0])<1e-10);previous=e;}
  assert.ok(previous<1e-8);
 }
});

test('a thin lid reaches a handle target without an explicit-torque instability',()=>{
 const world=new SolidWorld({gravity:[0,0,0]}),a=world.add(new SolidBody({mass:1e6})),b=world.add(new SolidBody({half:[.7,.025,.12],mass:12,q:Qaxis([1,0,0],.1)}));a.ignore.add(b.id);b.ignore.add(a.id);
 const spring=new RotationalSpring(a,b,()=>({axis:[1,0,0],center:b.p,angle:2*Math.atan2(b.q[0],b.q[3])}),.4);spring.target=.8;spring.stiffness=150;spring.damping=22;spring.max=1;spring.maxTorque=40;world.constraint(a,b,spring);
 for(let i=0;i<360;i++){world.step(1/120);assert.ok(b.w.every(Number.isFinite));assert.ok(Math.abs(b.w[0])<20);}
 assert.ok(Math.abs(2*Math.atan2(b.q[0],b.q[3])-.8)<.01);
});

test('supported articulated bodies sleep together and an impulse wakes their connected owners',()=>{
 let a;const world=new SolidWorld({gravity:[0,0,0],policies:{supported:b=>b===a}});a=world.add(new SolidBody({mass:10}));const b=world.add(new SolidBody({p:[0,1,0],half:[.3,.03,.3],mass:1}));a.ignore.add(b.id);b.ignore.add(a.id);
 world.constraint(a,b,new PointFastener(a,b,()=>a.point([0,1,0]),[0,0,0],{stiffness:10000,damping:100,failureForce:100000,engagement:1}));
 for(let i=0;i<240;i++)world.step(1/120);assert.equal(a.sleeping,true);assert.equal(b.sleeping,true);
 b.impulse([1,0,0]);world.step(1/120);assert.equal(a.sleeping,false);assert.equal(b.sleeping,false);
});

test('a skewed material flange uses the actual couple mass and cannot add damping energy',()=>{
 const a=new SolidBody({mass:30,half:[.4,.3,.2]}),b=new SolidBody({mass:2,half:[.7,.025,.3]});
 a.w=[-2,3,-4];b.w=[20,-40,30];
 const kinetic=body=>.5*body.w.reduce((sum,n,k)=>sum+n*body.angularMomentum()[k],0)+.5*body.mass*body.v.reduce((sum,n)=>sum+n*n,0),spring=new RotationalSpring(a,b,()=>({axis:[1,0,0],center:b.p,angle:0,positive:[.4,.03,.01],negative:[-.4,-.03,-.01]}),.3);
 spring.damping=10;let previous=kinetic(a)+kinetic(b);
 for(let i=0;i<120;i++){spring.beginStep(1/120);spring.solve(1/120);const next=kinetic(a)+kinetic(b);assert.ok(next<=previous+1e-9);previous=next;}
});
