import test from 'node:test';
import assert from 'node:assert/strict';
import {defineRenderProgram} from '../dist/render-ir/index.js';
import {compileTemporalMeshPlan} from '../dist/meshwork/index.js';

const ms=value=>BigInt(Math.round(value*1e6));
const program=defineRenderProgram({schema:1,programHash:'program:proof',profileHash:'profile:cinematic',partitionability:{kind:'temporal',warmupFrames:4},requiredResources:{resources:[]}});
const stream={streamId:'proof',targetFps:120,renderProgramHash:program.programHash};
const epoch={streamId:'proof',epoch:7n,checkpointHash:'checkpoint:7',cameraHash:'camera:main',profileHash:program.profileHash};

test('temporal compiler proves aggregate capacity without pretending a single worker reaches target',()=>{
 const plan=compileTemporalMeshPlan({
  program,stream,epoch,resourceManifestHash:'manifest:proof',nowNs:0n,firstDisplayNs:ms(2000),firstOutputFrame:1000n,totalOutputFrames:96,reserveRatio:.8,guardNs:ms(100),
  workers:[
   {workerId:'A',frameNsBudget:ms(1000/65),fixedNsBudget:ms(5)},
   {workerId:'B',frameNsBudget:ms(1000/60),fixedNsBudget:ms(5)},
   {workerId:'C',frameNsBudget:ms(1000/55),fixedNsBudget:ms(5)},
  ],
 });
 assert.equal(plan.assignments.length,3);
 assert.equal(plan.allWorkersBelowTarget,true);
 assert.equal(plan.admitted,true,{safeFps:plan.safeFps,assignments:plan.assignments});
 assert.equal(plan.proofEligible,true);
 assert.ok(plan.safeFps>=120&&plan.singleBestFps<120,{safeFps:plan.safeFps,single:plan.singleBestFps});
 let next=1000n,total=0;
 for(const assignment of plan.assignments){
  assert.equal(assignment.task.firstOutputFrame,next);
  assert.ok(assignment.slackNs>=0n);
  next+=BigInt(assignment.task.outputFrames);total+=assignment.task.outputFrames;
 }
 assert.equal(total,96);assert.equal(next,1096n);
});

test('temporal compiler refuses to call insufficient aggregate throughput admitted',()=>{
 const plan=compileTemporalMeshPlan({
  program,stream,epoch,resourceManifestHash:'manifest:proof',nowNs:0n,firstDisplayNs:ms(2000),firstOutputFrame:0n,totalOutputFrames:96,reserveRatio:.8,guardNs:ms(100),
  workers:[
   {workerId:'A',frameNsBudget:ms(1000/40),fixedNsBudget:ms(5)},
   {workerId:'B',frameNsBudget:ms(1000/35),fixedNsBudget:ms(5)},
   {workerId:'C',frameNsBudget:ms(1000/30),fixedNsBudget:ms(5)},
  ],
 });
 assert.equal(plan.admitted,false);assert.equal(plan.proofEligible,false);assert.ok(plan.safeFps<120);
});

test('temporal placement rejects incompatible program identity',()=>{
 assert.throws(()=>compileTemporalMeshPlan({
  program:{...program,partitionability:{kind:'atomic'}},stream,epoch,resourceManifestHash:'manifest:proof',nowNs:0n,firstDisplayNs:ms(1000),firstOutputFrame:0n,totalOutputFrames:3,
  workers:[{workerId:'A',frameNsBudget:ms(10)}],
 }),/not temporally partitionable/);
 assert.throws(()=>compileTemporalMeshPlan({
  program,stream:{...stream,renderProgramHash:'program:other'},epoch,resourceManifestHash:'manifest:proof',nowNs:0n,firstDisplayNs:ms(1000),firstOutputFrame:0n,totalOutputFrames:3,
  workers:[{workerId:'A',frameNsBudget:ms(10)}],
 }),/hash mismatch/);
});
