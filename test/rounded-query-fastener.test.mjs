import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SolidWorld,SolidBody} from '../dist/physics/compound.js';
import {PointFastener} from '../dist/physics/point-fastener.js';

test('rounded support meets a curb continuously before the hub crosses its edge, in both directions',()=>{
 for(const sign of [-1,1]){
  const world=new SolidWorld();world.addPlane({p:[0,0,0],hu:100,hv:100});world.add(new SolidBody({p:[0,.075,sign*1],half:[2,.075,1]}));
  let previous=0;
  for(let i=0;i<=800;i++){const z=sign*(-.4+i*.001),hit=world.sphereCast([0,1,z],[0,-1,0],1,.34);assert.ok(hit);const y=1-hit.t;if(i)assert.ok(Math.abs(y-previous)<.003);if(z*sign<-.3)assert.ok(Math.abs(y-.34)<1e-7);previous=y;}
  assert.ok(Math.abs(previous-.49)<1e-7);
  const edge=world.sphereCast([0,1,-sign*.2],[0,-1,0],1,.34);assert.ok(edge.n[1]>.2&&edge.n[1]<1);assert.ok(edge.n[2]*sign<0);
 }
});
test('rounded query shares finite-plane filters, dynamic OBBs, and owner exclusions',()=>{
 const world=new SolidWorld(),car=world.add(new SolidBody({p:[0,1,0],mass:100})),part=world.add(new SolidBody({p:[0,.4,0],half:[1,.1,1],mass:10}));car.ignore.add(part.id);
 world.addPlane({p:[0,0,0],hu:1,hv:1,filter:p=>p[0]<.5});
 assert.ok(Math.abs(world.sphereCast([0,1,0],[0,-1,0],1,.2,car).t-.8)<1e-7);
 assert.equal(world.sphereCast([3,1,0],[0,-1,0],1,.2,car),null);
 assert.equal(world.sphereCast([.8,1,0],[0,-1,0],1,.2,car),null);
 car.ignore.clear();assert.equal(world.sphereCast([0,1,0],[0,-1,0],1,.2,car).body,part);
});
test('point fastener exchanges momentum, stays bounded and breaks from physical anchor displacement',()=>{
 const world=new SolidWorld({gravity:[0,0,0]}),a=world.add(new SolidBody({p:[0,0,0],mass:100})),b=world.add(new SolidBody({p:[1,0,0],mass:20}));a.ignore.add(b.id);
 const fastener=new PointFastener(a,b,()=>a.point([.5,0,0]),[-.5,0,0],{stiffness:30000,damping:800,failureForce:50000,engagement:.12});world.constraint(a,b,fastener);b.v=[1,0,0];
 for(let i=0;i<100;i++)world.step(1/120);
 assert.equal(fastener.broken,false);assert.ok(Math.abs(a.mass*a.v[0]+b.mass*b.v[0]-20)<1e-7);assert.ok(fastener.extension<.01);
 b.p[0]+=.2;world.step(1/120);assert.equal(fastener.broken,true);
});
test('a thin part can bound numerical penetration recovery without suppressing a physical approach impulse',()=>{
 for(const speed of [0,5]){
  const world=new SolidWorld({gravity:[0,0,0]}),body=world.add(new SolidBody({p:[.9,0,0],half:[.5,.5,.5],mass:20,restitution:1}));world.add(new SolidBody({p:[0,0,0],half:[.5,2,2]}));body.maxContactBiasSpeed=.15;body.v=[-speed,0,0];world.step(1/120);
  assert.ok(world.contacts.length>0);assert.ok(world.contacts.every(c=>c.target<=Math.max(.15,speed*.08)+1e-9));
  if(speed){assert.ok(world.contacts.some(c=>c.approach>4&&c.jn>0));assert.ok(body.v[0]>0);assert.ok(world.contacts.some(c=>c.target>.15));}
  else assert.ok(body.v[0]<.3);
 }
});
test('fastener fracture uses the converged reaction in the same substep, not an intermediate iteration',()=>{
 const a=new SolidBody({p:[0,0,0],mass:100}),b=new SolidBody({p:[0,0,0],mass:20}),h=new PointFastener(a,b,()=>a.p,[0,0,0],{stiffness:30000,damping:800,failureForce:500,engagement:.1});
 h.beginStep();b.v=[1,0,0];h.solve(1/120);assert.ok(h.force>500);assert.equal(h.broken,false);
 b.v=[...a.v];h.solve(1/120);assert.ok(h.force<500);h.endStep();assert.equal(h.broken,false);
 h.beginStep();b.v=[100,0,0];h.solve(1/120);assert.equal(h.broken,false);h.endStep();assert.equal(h.broken,true);
});
test('thin plates substep across their thickness and during rotation, without paying that cost for in-plane travel',()=>{
 const counts=[];for(const [v,w]of [[[0,0,20],[0,0,0]],[[20,0,0],[0,0,0]],[[0,0,0],[0,15,0]]]){const world=new SolidWorld({gravity:[0,0,0]}),b=world.add(new SolidBody({p:[0,3,0],half:[.025,1,2],mass:20}));b.v=v;b.w=w;world.step(1/120);counts.push(world.metrics.substeps);assert.ok(b.p.every(Number.isFinite));}
 assert.equal(counts[0],2);assert.ok(counts[1]>=6);assert.ok(counts[2]>=10);assert.ok(counts.every(n=>n<=16));
});
