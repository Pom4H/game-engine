import test from 'node:test';
import assert from 'node:assert/strict';
import {StructuralBody} from '../dist/physics/structure.js';

function fixture(){const material={youngModulusPa:190e9,yieldStressPa:210e6,failureStressPa:420e6,failureStrain:.35,plasticity:.8,brittle:false};return new StructuralBody({nodes:[[-.5,0,0],[.5,0,0],[0,0,1],[0,.02,-1]].map(position=>({position,mass:2})),constraints:[...[[0,1],[0,2],[1,2],[0,3],[1,3]].map(([a,b])=>({kind:'distance',a,b,areaM2:.0001,material})),{kind:'bending',a:0,b:1,c:2,d:3,stiffnessNm:12,yieldMomentNm:.5,plasticity:.8}],projectiveDistances:true,plasticityMode:'stress',iterations:10,internalDamping:0,sleepDelay:10});}

test('an exactly unchanged material pose reuses the factor while a one-ULP change, retirement, fracture and dt invalidate it',()=>{
 const body=fixture();body.wake();body.predictStep(1/240,[0,0,0]);const q=body.projective,native=q.native;assert.ok(native);let calls=0;const factor=native.factor.bind(native);native.factor=A=>{calls++;factor(A);};
 q.factorize(true);q.factorize(true);assert.equal(calls,0);const version=q.responseVersion;body.position[0]+=Number.EPSILON;q.factorize(true);assert.equal(calls,1);assert.ok(q.responseVersion>version);
 body.mass[0]*=.9;q.factorize(true);assert.equal(calls,2);body.broken[0]=1;q.factorize(true);assert.equal(calls,3);q.begin(1/480);assert.equal(calls,4);q.dispose();
});

test('exact pose-factor reuse preserves every nonlinear material buffer against the former always-refactor policy',()=>{
 const run=force=>{const b=fixture(),q=b.projective;if(force){const factor=q.factorize;q.factorize=function(refresh){if(refresh&&this.size<=64)this.factorizedThisStep=false;return factor.call(this,refresh);};}b.wake();b.velocity[7]=.7;const frames=[];for(let step=0;step<24;step++){b.step(step%2?1/240:1/120,[0,-9.81,0]);frames.push(Object.fromEntries(['position','previous','velocity','mass','rest','lambda','broken'].map(key=>[key,Array.from(b[key])])));}q.dispose();return frames;};assert.deepEqual(run(false),run(true));
});
