import test from 'node:test';
import assert from 'node:assert/strict';
import {StructuralBody} from '../dist/physics/structure.js';
import {StructuralUnilateralContact} from '../dist/physics/structural-unilateral-contact.js';
import {StructuralSolidContactSolver} from '../dist/physics/structural-solid-contact.js';
import {SolidWorld} from '../dist/physics/compound.js';

function body(){const nodes=[[-.02,-.02,-.08],[.02,-.02,-.08],[0,.02,-.08],[0,0,-.02]].map(position=>({position,mass:1})),constraints=[];for(let a=0;a<nodes.length;a++)for(let b=a+1;b<nodes.length;b++)constraints.push({kind:'distance',a,b,areaM2:.0004,material:{youngModulusPa:190e9,yieldStressPa:1e15,failureStressPa:1e16,failureStrain:10000,plasticity:0,brittle:false}});const b=new StructuralBody({nodes,constraints,projectiveDistances:true,plasticityMode:'stress',iterations:10,internalDamping:0,sleepDelay:10});b.wake();for(let i=0;i<nodes.length;i++)b.velocity[i*3+2]=20;b.predictStep(1/240,[0,0,0]);return b;}
const near=(a,b,tol=1e-11)=>assert.ok(Math.abs(a-b)<=tol,`${a} vs ${b}`);

test('a unilateral material row releases its total load and rebases changed normals without duplicate position work',()=>{
 const b=body(),q=b.projective,row=new StructuralUnilateralContact(b,[3]);row.gradient[2]=-1;q.beginExternalProjection();row.project(-.02);q.endExternalProjection();assert.ok(row.reaction>0);for(let j=0;j<b.position.length;j++)near(q.external[j],j===11?-row.reaction:0);
 const position=b.position.slice(),lambda=row.reaction;row.gradient[0]=-1;row.gradient[2]=0;row.project(0);assert.deepEqual(b.position,position);near(row.reaction,lambda);for(let j=0;j<b.position.length;j++)near(q.external[j],j===9?-lambda:0);
 row.gradient[1]=999;row.release();near(row.reaction,0);assert.ok(q.external.every(v=>Math.abs(v)<1e-12));assert.deepEqual(Array.from(row.gradient),[-1,0,0]);row.release();assert.ok(q.external.every(v=>Math.abs(v)<1e-12));
});

test('finite contact registers its actual displacement instead of adding a second fictitious lumped-mass force',()=>{
 const b=body(),q=b.projective,row=new StructuralUnilateralContact(b,[0]),before=b.position.slice();row.gradient[2]=-1;q.beginExternalProjection();row.project(-.02);q.endExternalProjection();let delta=0;for(let j=0;j<b.position.length;j++){delta+=Math.abs(b.position[j]-before[j]);near(q.external[j],j===2?-row.reaction:0);}assert.ok(delta>.02);assert.ok(q.registered.every((v,j)=>Math.abs(v-(b.position[j]-before[j]))<1e-12));
});

test('a static feature removed by its physical filter leaves no generalized contact load',()=>{
 const b=body(),q=b.projective,world=new SolidWorld();let present=true;const plane=world.addPlane({p:[0,0,0],n:[0,0,-1],u:[1,0,0],v:[0,1,0],hu:10,hv:10,filter:()=>present}),solver=new StructuralSolidContactSolver(4);q.beginExternalProjection();solver.project(b,[],[plane]);q.endExternalProjection();assert.ok(q.external.some(v=>Math.abs(v)>0));present=false;q.beginExternalProjection();solver.project(b,[],[plane]);q.endExternalProjection();assert.ok(q.external.every(v=>Math.abs(v)<1e-12));
});
