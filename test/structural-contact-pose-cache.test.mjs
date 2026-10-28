import test from 'node:test';
import assert from 'node:assert/strict';
import {StructuralBody} from '../dist/physics/structure.js';
import {StructuralSolidContactSolver} from '../dist/physics/structural-solid-contact.js';
import {StructuralUnilateralContact} from '../dist/physics/structural-unilateral-contact.js';
import {structuralSparseWasmFactory,structuralSparseWasmDiagnostics} from '../dist/physics/structural-sparse-wasm.js';
import {setStructuralLinearKernelFactory} from '../dist/physics/projective-distance.js';
const material={youngModulusPa:190e9,yieldStressPa:210e6,failureStressPa:420e6,failureStrain:.35,plasticity:.8,brittle:false};
function fixture(bend=false){const nodes=[[-.5,.12,0],[.5,.12,0],[0,.12,1],[0,.14,-1]].map(position=>({position,mass:2})),constraints=[[0,1],[0,2],[1,2],[0,3],[1,3]].map(([a,b])=>({kind:'distance',a,b,areaM2:.0001,material}));if(bend)constraints.push({kind:'bending',a:0,b:1,c:2,d:3,stiffnessNm:12,yieldMomentNm:.5,plasticity:.8});return new StructuralBody({nodes,constraints,projectiveDistances:true,plasticityMode:'stress',iterations:10,internalDamping:0,sleepDelay:10});}

test('reaction-only, empty, zero and rejected pose work retain the exact contact operator while public versions advance',()=>{
 const c=fixture(),q=c.projective;c.wake();c.predictStep(1/240,[0,0,0]);const g=Float64Array.of(0,1,0),row=c.positionGradientConstraint([0],g);row.inverseContactMass();let calls=0,fits=0;const response=q.responseContactGradient.bind(q),fit=q.transport.fit.bind(q.transport);q.responseContactGradient=(...a)=>{calls++;return response(...a);};q.transport.fit=(...a)=>{fits++;return fit(...a);};const before=c.position.slice(),generation=q.contactResponseVersion,version=q.version;
 c.adjustPositionReaction([0],g,.001);row.inverseContactMass();q.beginExternalProjection();q.endExternalProjection();row.inverseContactMass();row.displaceContact(0);row.inverseContactMass();q.external.fill(0);q.project();row.inverseContactMass();
 assert.deepEqual(c.position,before);assert.ok(q.version>=version+4);assert.equal(q.contactResponseVersion,generation);assert.equal(calls,0);assert.equal(fits,0);
 const objective=q.objective;q.objective=()=>Infinity;q.project();q.objective=objective;row.inverseContactMass();assert.deepEqual(c.position,before);assert.equal(calls,0);assert.equal(q.contactResponseVersion,generation);c.disposeNumericalResources();
});

test('one-ULP pose, mutable gradient, mass, fracture, dt and backend changes invalidate the contact cache',()=>{
 const c=fixture(),q=c.projective;c.wake();c.predictStep(1/240,[0,0,0]);const g=Float64Array.of(0,1,0),row=c.positionGradientConstraint([0],g);row.inverseContactMass();let calls=0;const response=q.responseContactGradient.bind(q);q.responseContactGradient=(...a)=>{calls++;return response(...a);};
 c.position[0]+=Number.EPSILON;row.inverseContactMass();assert.equal(calls,1);g[1]=.5;row.inverseContactMass();assert.equal(calls,2);c.mass[0]*=.9;row.inverseContactMass();assert.equal(calls,3);c.broken[0]=1;row.inverseContactMass();assert.equal(calls,4);q.begin(1/480);row.inverseContactMass();assert.equal(calls,5);c.detachNode(3);row.inverseContactMass();assert.equal(calls,6);
 try{setStructuralLinearKernelFactory(undefined);row.inverseContactMass();assert.equal(calls,7);assert.equal(q.linearBackend,'javascript');}finally{setStructuralLinearKernelFactory(structuralSparseWasmFactory);c.disposeNumericalResources();}
});

test('alternating frozen and current rows restores separate owned frames instead of rebuilding COM and inertia',()=>{
 const c=fixture(),q=c.projective;c.wake();c.predictStep(1/240,[0,0,0]);let builds=0;const fill=q.center.fill.bind(q.center);q.center.fill=(...a)=>{builds++;return fill(...a);};
 const frozen=c.positionGradientConstraint([1],Float64Array.of(1,0,0)),current=c.positionGradientConstraint([2],Float64Array.of(1,0,0));frozen.inverseMass();current.inverseContactMass();const initial=builds,F=q.frozenFrame.center.slice(),C=q.currentFrame.center.slice();
 for(let i=0;i<8;i++){q.responseGradient([0],Float64Array.of(0,1,0),new Float64Array(c.position.length));q.responseContactGradient([3],Float64Array.of(0,0,1),new Float64Array(c.position.length));}
 assert.equal(builds,initial);assert.deepEqual(q.frozenFrame.center,F);assert.deepEqual(q.currentFrame.center,C);assert.notEqual(q.frozenFrame.center,q.currentFrame.center);c.disposeNumericalResources();
});

test('24 nonlinear contact steps preserve all material buffers bitwise against the former version-key policy and release native owners',()=>{
 const baseline=structuralSparseWasmDiagnostics(),run=legacy=>{const c=fixture(true),q=c.projective;if(legacy)q.currentPoseVersion=function(){return this.version;};const plane={plane:true,p:[0,0,0],n:[0,1,0],u:[1,0,0],v:[0,0,1],hu:3,hv:3,filter:null},solver=new StructuralSolidContactSolver(4),pin=new StructuralUnilateralContact(c,[0]);pin.gradient.set([0,1,0]);const projector=body=>{solver.project(body,[],[plane]);const gap=body.position[1]-.006;if(gap<0||pin.reaction>0)pin.project(gap);};c.wake();c.velocity[7]=-.7;c.velocity[11]=.2;const frames=[];
  try{for(let step=0;step<24;step++){c.force[0]=step%3===0?.2:0;c.step(step%2?1/240:1/120,[0,-9.81,0],projector);frames.push(Object.fromEntries(['position','previous','velocity','rest','lambda','broken','force','mass','inverseMass'].map(key=>[key,Array.from(c[key])])));}return frames;}finally{c.disposeNumericalResources();}};
 assert.deepEqual(run(false),run(true));const after=structuralSparseWasmDiagnostics();assert.equal(after.liveHandles,baseline.liveHandles);assert.equal(after.liveBytes,baseline.liveBytes);
});
