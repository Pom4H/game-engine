import test from 'node:test';
import assert from 'node:assert/strict';
import {StructuralBody} from '../dist/physics/structure.js';
import {Qaxis,Qrotate} from '../dist/physics/compound.js';

const rest=[[-.02,-.02,-.08],[.02,-.02,-.08],[0,.02,-.08],[0,0,-.02]],material={youngModulusPa:190e9,yieldStressPa:1e15,failureStressPa:1e16,failureStrain:10000,plasticity:0,brittle:false},h=1/240;
function fixture(sign,q=[0,0,0,1]){const nodes=rest.map(p=>({position:Qrotate(q,[p[0]+sign*.2,p[1],p[2]]),mass:1})),constraints=[];for(let a=0;a<4;a++)for(let b=a+1;b<4;b++)constraints.push({kind:'distance',a,b,areaM2:.0004,material});const b=new StructuralBody({nodes,constraints,projectiveDistances:true,plasticityMode:'stress',internalDamping:0,iterations:10,sleepDelay:10});b.wake();b.predictStep(h,[0,0,0]);return b;}
const momentum=(a,b)=>{const P=[0,0,0];for(const c of [a,b])for(let i=0;i<c.nodeCount;i++)for(let k=0;k<3;k++)P[k]+=c.mass[i]*(c.position[i*3+k]-c.previous[i*3+k])/h;return P;};

test('a two-owner contact applies exactly the same multiplier through opposite material rows',()=>{
 const a=fixture(-1),b=fixture(1),A=a.positionConstraint([0,2,3],[.2,.3,.5]),B=b.positionConstraint([0,1,3],[.1,.4,.5]),n=[.3,-.4,Math.sqrt(.75)],lambda=.001;assert.ok(A&&B);const k=A.inverseContactMass(n)+B.inverseContactMass(n);assert.ok(k>0);A.displaceContact(n,lambda);B.displaceContact(n,-lambda);
 for(let axis=0;axis<3;axis++){const qa=a.projective.external,qb=b.projective.external;let force=0;for(let i=0;i<4;i++)force+=qa[i*3+axis]+qb[i*3+axis];assert.ok(Math.abs(force)<1e-16);assert.ok(Math.abs(momentum(a,b)[axis])<1e-11);}
 A.displaceContact(n,-lambda);B.displaceContact(n,lambda);assert.ok(a.projective.external.every(v=>Math.abs(v)<1e-16));assert.ok(b.projective.external.every(v=>Math.abs(v)<1e-16));assert.ok(a.position.every(Number.isFinite));assert.ok(b.position.every(Number.isFinite));a.disposeNumericalResources();b.disposeNumericalResources();
});

test('the explicit contact-only anchor response is covariant while the bilateral operation remains separate',()=>{
 const q=Qaxis([.3,.8,-.2],.7),run=rotation=>{const a=fixture(-1,rotation),b=fixture(1,rotation),A=a.positionConstraint([0,2,3],[.2,.3,.5]),B=b.positionConstraint([0,1,3],[.1,.4,.5]),n=Qrotate(rotation,[0,0,1]);A.displaceContact(n,.0007);B.displaceContact(n,-.0007);const result=[a.position.slice(),b.position.slice()];a.disposeNumericalResources();b.disposeNumericalResources();return result;},base=run([0,0,0,1]),rotated=run(q);
 for(let owner=0;owner<2;owner++)for(let i=0;i<4;i++){const expected=Qrotate(q,Array.from(base[owner].slice(i*3,i*3+3)));for(let axis=0;axis<3;axis++)assert.ok(Math.abs(expected[axis]-rotated[owner][i*3+axis])<1e-11);}
 const c=fixture(1),anchor=c.positionConstraint([3],[1]),response=new Float64Array(c.nodeCount*3);c.projective.response([3],[1],[0,0,1],response);const before=c.position.slice();anchor.displace([0,0,1],.001);for(let j=0;j<response.length;j++)assert.ok(Math.abs(c.position[j]-before[j]-.001*response[j])<1e-14);c.disposeNumericalResources();
});
