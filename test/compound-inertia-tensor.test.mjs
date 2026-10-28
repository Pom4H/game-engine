import test from 'node:test';
import assert from 'node:assert/strict';
import {SolidBody,Qaxis,Qrotate} from '../dist/physics/compound.js';

const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const mul=(m,v)=>[0,1,2].map(i=>m.slice(i*3,i*3+3).reduce((s,n,j)=>s+n*v[j],0));
const near=(actual,expected)=>actual.forEach((n,i)=>assert.ok(Math.abs(n-expected[i])<1e-11,`${n} != ${expected[i]}`));

test('a deformed full inertia tensor drives rotated impulses, kinetic work and effective mass consistently',()=>{
 const inverse=[.8,.13,-.09,.13,.6,.07,-.09,.07,.4],body=new SolidBody({mass:12,p:[3,-2,8],q:Qaxis([1,2,3],.73)}),source=[...inverse];body.setInverseInertiaTensor(source);source.fill(99);
 for(const q of [body.q,Qaxis([0,1,0],-1.3)]){
  body.q=q;body.v.fill(0);body.w.fill(0);const localPoint=[.2,-.7,.5],localImpulse=[3,2,-1],worldPoint=body.point(localPoint),impulse=Qrotate(q,localImpulse),expectedLocal=mul(inverse,cross(localPoint,localImpulse)),expected=Qrotate(q,expectedLocal),direction=impulse.map(n=>n/Math.hypot(...impulse)),response=body.inverseEffectiveMass(worldPoint,direction);
  body.impulse(impulse,worldPoint);near(body.w,expected);near(body.v,impulse.map(n=>n/12));
  near(body.angularMomentum(),Qrotate(q,cross(localPoint,localImpulse)));
  const contactVelocity=body.pointVelocity(worldPoint),observed=contactVelocity.reduce((s,n,i)=>s+n*direction[i],0);assert.ok(Math.abs(observed-Math.hypot(...impulse)*response)<1e-11);
  const angularWork=cross(localPoint,localImpulse).reduce((s,n,i)=>s+n*expectedLocal[i],0)/2,work=impulse.reduce((s,n,i)=>s+n*contactVelocity[i],0)/2;assert.ok(Math.abs(work-(localImpulse.reduce((s,n)=>s+n*n,0)/24+angularWork))<1e-11);
 }
 assert.ok(body.maxInverseInertia>=Math.max(...inverse.filter((_,i)=>i%4===0)));assert.deepEqual(body.inverseInertiaTensor,inverse);assert.ok(Object.isFrozen(body.inverseInertiaTensor));
 body.setInverseInertiaTensor(undefined);body.invI=[.2,.3,.4];near(body.inertia(Qrotate(body.q,[1,2,3])),Qrotate(body.q,[.2,.6,1.2]));near(body.angularMomentum(Qrotate(body.q,[1,2,3])),Qrotate(body.q,[5,2/.3,7.5]));
});

test('tensor replacement invalidates the cached world response and rejects invalid or static tensors atomically',()=>{
 const body=new SolidBody({mass:2}),first=[1,.1,0,.1,2,0,0,0,3],next=[2,.2,.3,.2,3,.1,.3,.1,4];body.setInverseInertiaTensor(first);near(body.inertia([1,0,0]),[1,.1,0]);body.setInverseInertiaTensor(next);near(body.inertia([1,0,0]),[2,.2,.3]);
 body.invI[0]=.01;near(body.inertia([1,0,0]),[2,.2,.3]);
 for(const bad of [[1,0,0],Array(9).fill(0),[1,2,0,2,1,0,0,0,1],[1,1,0,0,1,0,0,0,1],[1,0,0,0,1,0,0,0,Infinity]])assert.throws(()=>body.setInverseInertiaTensor(bad),RangeError);
 near(body.inertia([1,0,0]),[2,.2,.3]);assert.throws(()=>new SolidBody().setInverseInertiaTensor(first),RangeError);
});
