import test from 'node:test';
import assert from 'node:assert/strict';
import {StructuralBody} from '../dist/physics/structure.js';
import {StructuralSolidContactSolver} from '../dist/physics/structural-solid-contact.js';
import {SolidWorld} from '../dist/physics/compound.js';

const steel={youngModulusPa:190e9,yieldStressPa:1e15,failureStressPa:1e16,failureStrain:10000,plasticity:0,brittle:false},area=.0004;
const tetra=[[-.02,-.02,-.08],[.02,-.02,-.08],[0,.02,-.08],[0,0,-.02]];
function fixture(points){
 const nodes=points.map(position=>({position:position.slice(),mass:1})),constraints=[];
 for(let a=0;a<nodes.length;a++)for(let b=a+1;b<nodes.length;b++)constraints.push({kind:'distance',a,b,areaM2:area,material:steel});
 const body=new StructuralBody({nodes,constraints,projectiveDistances:true,plasticityMode:'stress',iterations:10,internalDamping:0,sleepDelay:10}),world=new SolidWorld(),plane=world.addPlane({p:[0,0,0],n:[0,0,-1],u:[1,0,0],v:[0,1,0],hu:10,hv:10});
 body.wake();for(let i=0;i<nodes.length;i++)body.velocity[i*3+2]=20;
 const rest=constraints.map(c=>Math.hypot(...points[c.a].map((n,k)=>n-points[c.b][k])));
 const energy=()=>{let U=0,K=0;for(let i=0;i<nodes.length;i++)for(let k=0;k<3;k++)K+=.5*body.mass[i]*body.velocity[i*3+k]**2;for(let i=0;i<constraints.length;i++){if(body.broken[i])continue;const c=constraints[i],length=Math.hypot(...[0,1,2].map(k=>body.position[c.a*3+k]-body.position[c.b*3+k]));U+=.5*steel.youngModulusPa*area/rest[i]*(length-rest[i])**2;}return{K,U};};
 const gap=()=>Math.min(...nodes.map((_,i)=>-.006-body.position[i*3+2]));
 const reconstructedK=h=>{let K=0;for(let i=0;i<nodes.length;i++)for(let k=0;k<3;k++)K+=.5*body.mass[i]*((body.position[i*3+k]-body.previous[i*3+k])/h)**2;return K;};
 return{body,plane,energy,gap,reconstructedK,constraints,rest};
}

test('a finite stiff-cell plane impact does not turn a rigid rotational response into elastic strain',t=>{
 const residuals=[];
 for(const order of [[0,1,2,3],[3,0,1,2],[2,1,0,3],[3,2,1,0]])for(const h of [1/120,1/240,1/480]){
  const f=fixture(order.map(i=>tetra[i])),solver=new StructuralSolidContactSolver(4),incoming=f.energy().K;let maxEnergy=0,minSkinGap=Infinity;
  for(let step=0;step<4;step++){
   f.body.step(h,[0,0,0],b=>solver.project(b,[],[f.plane]));const e=f.energy();
   assert.ok(e.K+e.U<=incoming+incoming*1e-8,`order${order} dt${h} step${step}: K${e.K}+U${e.U} > incoming${incoming}`);
   // The solver deliberately targets a6mm exterior skin. A multi-row solve's
   // finite residual is reported separately from physical plane penetration.
   assert.ok(f.gap()+.006>=-1e-10,`actual material crossed the plane: ${f.gap()+.006}`);assert.ok(f.body.position.every(Number.isFinite));assert.equal(f.body.broken.some(Boolean),false);maxEnergy=Math.max(maxEnergy,e.K+e.U);minSkinGap=Math.min(minSkinGap,f.gap());
  }
  residuals.push({order,h,maxEnergy,minSkinGap,minimumPhysicalPlaneClearance:minSkinGap+.006});
 }
 t.diagnostic(JSON.stringify({scope:'Four node orders and120/240/480Hz, unchanged10passes/material; residual relative to intentional6mm skin, not a changed collision tolerance',residuals}));
});

test('a single finite off-centre contact preserves the actual stiff-bar lengths and closes the plane gap',()=>{
 const f=fixture(tetra),h=1/240,solver=new StructuralSolidContactSolver(0,[],[{node:0,radius:1e-12}]),incoming=f.energy().K;
 f.body.predictStep(h,[0,0,0]);f.body.projectStep(b=>solver.project(b,[],[f.plane]),0);assert.ok(f.reconstructedK(h)+f.energy().U<=incoming+incoming*1e-8,'the first finite contact cannot inject false rigid-mode strain');assert.ok(Math.abs(-.006000000001-f.body.position[2])<1e-9,'the isolated scalar finite-contact root must close its actual6mm skin gap');for(let iteration=1;iteration<10;iteration++)f.body.projectStep(b=>solver.project(b,[],[f.plane]),iteration);f.body.completeStep();const e=f.energy();
 assert.ok(e.K+e.U<=incoming+incoming*1e-8);assert.ok(-.006000000001-f.body.position[2]>=-1e-6);
 // Independent geometry/constitutive check: even spending ALL incoming energy
 // in any one bar cannot stretch it beyond this exact quadratic elastic bound.
 for(let i=0;i<f.constraints.length;i++){const c=f.constraints[i],length=Math.hypot(...[0,1,2].map(k=>f.body.position[c.a*3+k]-f.body.position[c.b*3+k])),bound=Math.sqrt(2*incoming*f.rest[i]/(steel.youngModulusPa*area));assert.ok(Math.abs(length-f.rest[i])<=bound+1e-10);}
});

test('axial contact multipliers unload coherently when a material support breaks in the same substep',()=>{
 const f=fixture([[0,0,-.08],[0,0,-.02]]),h=1/240,solver=new StructuralSolidContactSolver(2),incoming=f.energy().K;
 f.body.predictStep(h,[0,0,0]);f.body.projectStep(b=>solver.project(b,[],[f.plane]),0);f.body.broken[0]=1;
 for(let iteration=1;iteration<10;iteration++)f.body.projectStep(b=>solver.project(b,[],[f.plane]),iteration);f.body.completeStep();const e=f.energy();
 assert.equal(e.U,0);assert.ok(e.K<=incoming+incoming*1e-8);assert.ok(f.gap()>=-1e-9);
 for(let step=0;step<3;step++){f.body.step(h,[0,0,0],b=>solver.project(b,[],[f.plane]));assert.ok(f.energy().K<=incoming+incoming*1e-8);assert.ok(f.gap()>=-1e-9);}
});
