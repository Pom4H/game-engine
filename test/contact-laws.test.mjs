import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene,PhysicsWorld,RigidBody,material} from '../dist/index.js';
import {transferFragmentMotion} from '../dist/materials/fragment-motion.js';

function impact(axis){
 const scene=new Scene({version:1,gravity:[0,0,0],ground:-100,entities:[
 {id:'glass',position:[0,10,0],mesh:{kind:'box',size:axis==='x'?[.01,1.4,1.2]:[1.4,.01,1.2]},material:{kind:'glass'}},
 {id:'ball',position:axis==='x'?[-1,10,0]:[0,11,0],mesh:{kind:'sphere',radius:.11},material:{kind:'steel'},body:{mass:3.8,velocity:axis==='x'?[30,0,0]:[0,-30,0]}},
 ]});
 for(let i=0;i<8;i++)scene.step();
 return scene;
}
test('horizontal and vertical thin glass both use the material failure law',()=>{
 for(const axis of ['x','y'])assert.equal(impact(axis).entities.has('glass'),false,axis);
});
function slide(friction){
 const world=new PhysicsWorld([0,-9.81,0],-100);
 world.add(new RigidBody({id:'surface',position:[0,-.1,0],shape:{kind:'box',half:[20,.1,20]},material:material('asphalt'),friction}));
 const body=world.add(new RigidBody({id:'slider',position:[0,.1,0],velocity:[5,0,0],mass:1,friction:1,shape:{kind:'sphere',radius:.1}}));
 for(let i=0;i<30;i++)world.step(1/60);
 return body.velocity[0];
}
test('horizontal contacts use the effective surface friction',()=>{
 assert.ok(Math.abs(slide(0)-5)<1e-10);assert.ok(slide(1)<2);
});
function momentum(scene){return [...scene.physics.bodies.values()].reduce((p,b)=>p.map((v,k)=>v+b.mass*b.velocity[k]),[0,0,0]);}
test('dynamic fracture conserves authored mass and center-of-mass momentum',()=>{
 const scene=new Scene({version:1,gravity:[0,0,0],ground:-100,entities:[
 {id:'glass',position:[0,10,0],mesh:{kind:'box',size:[.01,1.4,1.2]},material:{kind:'glass'},body:{mass:42,velocity:[0,20,0]}},
 {id:'ball',position:[-1,10,0],mesh:{kind:'sphere',radius:.11},material:{kind:'steel'},body:{mass:3.8,velocity:[30,20,0]}},
 ]});
 const before=momentum(scene);
 for(let i=0;i<30&&scene.entities.has('glass');i++)scene.step();
 assert.equal(scene.entities.has('glass'),false);
 const fragments=[...scene.physics.bodies.values()].filter(b=>b.id.startsWith('glass:shard:'));
 assert.ok(Math.abs(fragments.reduce((s,b)=>s+b.mass,0)-42)<1e-9);
 const after=momentum(scene);for(let k=0;k<3;k++)assert.ok(Math.abs(before[k]-after[k])<1e-7,`${before} -> ${after}`);
});
function totals(bodies){
 const p=[0,0,0],l=[0,0,0];let energy=0;
 for(const b of bodies){
  const m=b.mass,r=b.position,v=b.velocity,w=b.angularVelocity,I=b.invInertiaLocal.map(x=>x?1/x:0);
  for(let k=0;k<3;k++){p[k]+=m*v[k];l[k]+=I[k]*w[k];energy+=.5*(m*v[k]*v[k]+I[k]*w[k]*w[k]);}
  l[0]+=m*(r[1]*v[2]-r[2]*v[1]);l[1]+=m*(r[2]*v[0]-r[0]*v[2]);l[2]+=m*(r[0]*v[1]-r[1]*v[0]);
 }
 return{p,l,energy};
}
test('fragment motion projects scatter to zero net momentum within its energy budget',()=>{
 const source=new RigidBody({id:'source',mass:10,position:[0,0,0],velocity:[2,3,4],angularVelocity:[.2,.4,.6],shape:{kind:'box',half:[1,1,1]}});
 const fragments=[-1,1].map(sign=>new RigidBody({id:String(sign),mass:5,position:[0,sign*.5,0],shape:{kind:'box',half:[1,.5,1]}}));
 const before=totals([source]);transferFragmentMotion(source,fragments,[9,9,9],5,71);const after=totals(fragments);
 for(let k=0;k<3;k++){assert.ok(Math.abs(before.p[k]-after.p[k])<1e-8);assert.ok(Math.abs(before.l[k]-after.l[k])<1e-8);}
 assert.ok(after.energy<=before.energy+.75+1e-8);
});
test('a finite horizontal slab does not teleport a body from beneath it',()=>{
 const world=new PhysicsWorld([0,0,0],-100);
 world.add(new RigidBody({id:'slab',position:[0,5,0],shape:{kind:'box',half:[2,.1,2]}}));
 const body=world.add(new RigidBody({id:'below',position:[0,1,0],mass:1,shape:{kind:'sphere',radius:.1}}));
 world.step(1/60);assert.equal(body.position[1],1);
});


test('rotated OBB narrow phase detects contacts that axis-aligned bounds miss',()=>{
 const world=new PhysicsWorld([0,0,0],-100);
 world.add(new RigidBody({id:'rail',position:[0,0,0],rotation:[0,Math.PI/2,0],shape:{kind:'box',half:[2,.25,.25]}}));
 const mover=world.add(new RigidBody({id:'mover',position:[0,0,1.7],velocity:[0,0,-1],mass:1,shape:{kind:'box',half:[.3,.3,.3]}}));
 world.step(1/60);
 assert.ok(world.contacts.some(contact=>contact.a==='mover'&&contact.b==='rail'),'rotated long axis must participate in narrow phase');
 assert.ok(mover.velocity[2]>-.95,'contact impulse should oppose penetration into the rotated rail');
});

function offsetBoxImpact(y){
 const world=new PhysicsWorld([0,0,0],-100);
 world.add(new RigidBody({id:'wall',position:[0,0,0],shape:{kind:'box',half:[.5,1,1]},restitution:0}));
 const mover=world.add(new RigidBody({id:'mover',position:[-1.2,y,0],velocity:[4,0,0],mass:2,shape:{kind:'box',half:[.5,.5,.5]},restitution:0,friction:0}));
 for(let i=0;i<8;i++)world.step(1/120);
 return{world,mover};
}
test('off-center body contact applies impulse at the contact point and creates torque',()=>{
 const {world,mover}=offsetBoxImpact(.55);
 assert.ok(world.contacts.length>0);
 assert.ok(Math.abs(mover.angularVelocity[2])>.05,`expected collision torque, got ${mover.angularVelocity}`);
});
test('centered body contact does not invent collision torque',()=>{
 const {world,mover}=offsetBoxImpact(0);
 assert.ok(world.contacts.length>0);
 assert.ok(Math.abs(mover.angularVelocity[0])<1e-8&&Math.abs(mover.angularVelocity[1])<1e-8&&Math.abs(mover.angularVelocity[2])<1e-8,`centered contact should remain torque-free: ${mover.angularVelocity}`);
});
