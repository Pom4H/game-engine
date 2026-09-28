import test from 'node:test';
import assert from 'node:assert/strict';
import {PhysicsWorld,RigidBody} from '../dist/physics/world.js';
import {ForceFrame} from '../dist/physics/force-frame.js';
import {wheelHit,bodyWheelSupport,rayTriangles} from '../dist/physics/wheel-support.js';
import {CarBallArena} from '../dist/examples/car-ball.js';
import {idleInput} from '../dist/vehicles/arcade.js';
const close=(a,b,tolerance=1e-9)=>{assert.equal(a.length,b.length);a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<tolerance,`${i}: ${v} != ${b[i]}`));};
const basis=r=>{const f=new ForceFrame();f.update(r);return [...f.basis];};
test('shared support query sees floor, oriented surfaces, ceiling and moving bodies on repeated casts',()=>{
 const world=new PhysicsWorld([0,-9.81,0],0),hit=wheelHit();
 const wall=new RigidBody({id:'wall',shape:{kind:'box',half:[.2,5,5]},position:[4,5,0]}),ceiling=new RigidBody({id:'ceiling',shape:{kind:'box',half:[5,.2,5]},position:[0,10,0]});world.add(wall);world.add(ceiling);let query=bodyWheelSupport(world.bodies.values(),world.ground);
 for(let i=0;i<5;i++){assert.ok(query([0,2,0],[0,-1,0],3,hit));close(hit.normal,[0,1,0]);assert.equal(hit.distance,2);assert.ok(query([0,5,0],[1,0,0],5,hit));close(hit.normal,[-1,0,0]);assert.ok(query([0,8,0],[0,1,0],3,hit));close(hit.normal,[0,-1,0]);}
 const slope=new RigidBody({id:'slope',shape:{kind:'box',half:[2,.1,2]},position:[0,4,0],rotation:[0,0,.4],velocity:[1,2,3],angularVelocity:[0,0,2]});world.add(slope);query=bodyWheelSupport(world.bodies.values(),world.ground);
 assert.ok(query([0,5,0],[0,-1,0],2,hit));close(hit.normal,[-Math.sin(.4),Math.cos(.4),0]);assert.equal(hit.body,slope);
 close(hit.velocity,[1-2*(hit.point[1]-4),2+2*hit.point[0],3]);slope.rotation[2]=-.4;
 assert.ok(query([0,5,0],[0,-1,0],2,hit));close(hit.normal,[Math.sin(.4),Math.cos(.4),0]);assert.equal(query([0,5,0],[0,-1,0],2,hit,slope),false);
 const ball=new RigidBody({id:'sphere',shape:{kind:'sphere',radius:1},position:[0,6,0]});world.add(ball);query=bodyWheelSupport(world.bodies.values(),world.ground);assert.ok(query([0,8,0],[0,-1,0],2,hit));assert.equal(hit.body,ball);close(hit.normal,[0,1,0]);
 assert.throws(()=>query([0,0,0],[0,2,0],1,hit));world.clear();
});


test('raycast samples current triangle coordinates and barycentric surface velocity',()=>{
 const hit=wheelHit(),nodes=[-2,0,-2,0,.3,2,2,0,-2],indices=[0,1,2];
 assert.ok(rayTriangles([0,1,0],[0,-1,0],2,nodes,indices,hit,new Float64Array(9).fill(2)));assert.ok(hit.normal[1]>.9);close(hit.velocity,[2,2,2]);const first=hit.point[1];nodes[4]=.8;
 assert.ok(rayTriangles([0,1,0],[0,-1,0],2,nodes,indices,hit));assert.ok(hit.point[1]>first);assert.equal(hit.triangle,0);
 assert.equal(rayTriangles([0,-1,0],[0,1,0],2,nodes,indices,hit),false);
});


test('landing on the real deforming ball recharges at four nodal-surface wheel contacts',t=>{
 const a=new CarBallArena(),c=a.cars[0];t.after(()=>a.dispose());a.phase=1;c.reset([0,3.6,0],[0,0,0]);c.jumps=2;c.body.velocity[1]=-2;
 let reset=null;const evaluate=c.evaluate.bind(c);c.evaluate=dt=>{const old=c.stats.resets;evaluate(dt);if(c.stats.resets>old)reset={y:c.body.position[1],wheels:c.blueprint.parts.map(p=>({contact:c.part(p.source.id).contact,fixed:c.part(p.source.id).fixedSupport,id:c.part(p.source.id).supportId})),jumps:c.jumps};};
 for(let i=0;i<90&&!reset;i++)a.step();assert.ok(reset);assert.ok(reset.y>2);assert.equal(reset.jumps,0);assert.ok(reset.wheels.every(w=>w.contact&&!w.fixed&&w.id==='ball'));t.diagnostic(JSON.stringify(reset));
});


test('airborne pitch, yaw and roll apply independent local-axis torque through the world integrator',()=>{
 for(const [field,axis,sign] of [['roll',0,1],['steer',1,-1],['pitch',2,1]]){
  const a=new CarBallArena(),c=a.cars[0];try{c.reset([-8,6,0],[.3,.7,.4]);const initial=basis(c.body.rotation);c.input={...idleInput(),[field]:1};
   for(let i=0;i<24;i++)a.world.step(1/240);
   const component=c.body.angularVelocity.reduce((sum,v,k)=>sum+v*initial[axis*3+k],0);assert.ok(component*sign>.4);assert.equal(c.grounded,false);
  }finally{a.dispose();}
 }
});

test('moving rigid wheel support gets the reciprocal impulse; translation does not invent tire slip',t=>{
 const a=new CarBallArena(),c=a.cars[0];t.after(()=>a.dispose());
 const platform=new RigidBody({id:'moving',mass:1000,shape:{kind:'box',half:[4,.1,3]},position:[-8,2,8],velocity:[2,0,0]});
 a.world.wheelSupport=bodyWheelSupport([platform],-100);c.reset([-8,2.45,8],[0,0,0]);c.body.velocity[0]=2;
 // Initial angular wheel speed matches the contact patch, which translates with the car.
 const before=platform.velocity.slice();c.evaluate(1/240);assert.equal(c.wheelContacts,4);
 const force=c.blueprint.parts.map(p=>c.part(p.source.id).force).reduce((sum,f)=>sum.map((v,k)=>v+f[k]),[0,0,0]);
 close(platform.velocity.map((v,k)=>(v-before[k])*platform.mass),force.map(v=>-v/240),1e-9);
 assert.ok(c.blueprint.parts.every(p=>c.part(p.source.id).supportId==='moving'&&!c.part(p.source.id).fixedSupport));
});
