import test from 'node:test';
import assert from 'node:assert/strict';
import {defineRenderProgram,MemoryContentStore} from '../dist/render-ir/index.js';
import {lowerRenderProgram} from '../dist/execution/index.js';
import {compileTemporalMeshPlan} from '../dist/meshwork/index.js';

const ms=value=>BigInt(Math.round(value*1e6));
const program=defineRenderProgram({schema:1,programHash:'program:proof',profileHash:'profile:cinematic',partitionability:{kind:'temporal',warmupFrames:4},requiredResources:{resources:[]}});
const graph=lowerRenderProgram(program),graphStore=new MemoryContentStore(),graphRef=graphStore.put('graph',graph);
const stream={streamId:'proof',targetFps:120,renderProgramHash:program.programHash};
const epoch={streamId:'proof',epoch:7n,checkpointHash:'checkpoint:7',cameraHash:'camera:main',profileHash:program.profileHash};
const transport=(bytesPerSecond=500_000_000)=>({
 source:'measured',ingressBytesPerSecond:bytesPerSecond,egressBytesPerSecond:bytesPerSecond,
 inputBytesPerFrameBudget:2_000,outputBytesPerFrameBudget:8_000,segmentInputBytesBudget:4_000,cacheWarm:true,
 encodeNsPerOutputFrameBudget:50_000n,
});

test('temporal compiler proves net aggregate capacity including measured transport',()=>{
 const plan=compileTemporalMeshPlan({
  program,graph,executionGraphRefHash:graphRef.hash,stream,epoch,resourceManifestHash:'manifest:proof',nowNs:0n,firstDisplayNs:ms(2000),firstOutputFrame:1000n,totalOutputFrames:96,reserveRatio:.8,guardNs:ms(100),
  workers:[
   {workerId:'A',frameNsBudget:ms(1000/65),fixedNsBudget:ms(5),transport:transport()},
   {workerId:'B',frameNsBudget:ms(1000/60),fixedNsBudget:ms(5),transport:transport()},
   {workerId:'C',frameNsBudget:ms(1000/55),fixedNsBudget:ms(5),transport:transport()},
  ],
 });
 assert.equal(plan.assignments.length,3);assert.equal(plan.allWorkersBelowTarget,true);assert.equal(plan.transportCalibrated,true);assert.equal(plan.transportWithinBudget,true);
 assert.equal(plan.admitted,true,{safeFps:plan.safeFps,assignments:plan.assignments});assert.equal(plan.proofEligible,true);
 assert.ok(plan.safeFps>=120&&plan.singleBestFps<120,{safeFps:plan.safeFps,single:plan.singleBestFps});
 assert.ok(plan.meshCycleFps<=plan.computeOnlyCycleFps);assert.ok(plan.maxObservedTransportOverheadRatio>0&&plan.maxObservedTransportOverheadRatio<.1);
 let next=1000n,total=0;
 for(const assignment of plan.assignments){
  assert.equal(assignment.task.firstOutputFrame,next);assert.ok(assignment.slackNs>=0n);assert.ok(assignment.predictedInputBytes>0);assert.ok(assignment.predictedOutputBytes>0);
  next+=BigInt(assignment.task.outputFrames);total+=assignment.task.outputFrames;
 }
 assert.equal(total,96);assert.equal(next,1096n);
});

test('compute-only capacity is not a distributed proof without measured transport',()=>{
 const plan=compileTemporalMeshPlan({
  program,graph,executionGraphRefHash:graphRef.hash,stream,epoch,resourceManifestHash:'manifest:proof',nowNs:0n,firstDisplayNs:ms(2000),firstOutputFrame:0n,totalOutputFrames:96,reserveRatio:.8,guardNs:ms(100),
  workers:[
   {workerId:'A',frameNsBudget:ms(1000/65),fixedNsBudget:ms(5)},
   {workerId:'B',frameNsBudget:ms(1000/60),fixedNsBudget:ms(5)},
   {workerId:'C',frameNsBudget:ms(1000/55),fixedNsBudget:ms(5)},
  ],
 });
 assert.equal(plan.admitted,true);assert.equal(plan.transportCalibrated,false);assert.equal(plan.proofEligible,false);
});

test('slow transport can make otherwise sufficient GPUs unprofitable',()=>{
 const slow={source:'measured',ingressBytesPerSecond:1_000_000,egressBytesPerSecond:1_000_000,inputBytesPerFrameBudget:50_000,outputBytesPerFrameBudget:250_000,segmentInputBytesBudget:100_000,cacheWarm:true};
 const plan=compileTemporalMeshPlan({
  program,graph,executionGraphRefHash:graphRef.hash,stream,epoch,resourceManifestHash:'manifest:proof',nowNs:0n,firstDisplayNs:ms(10000),firstOutputFrame:0n,totalOutputFrames:96,reserveRatio:.8,guardNs:ms(100),maxTransportOverheadRatio:.1,
  workers:[
   {workerId:'A',frameNsBudget:ms(1000/65),transport:slow},
   {workerId:'B',frameNsBudget:ms(1000/60),transport:slow},
   {workerId:'C',frameNsBudget:ms(1000/55),transport:slow},
  ],
 });
 assert.equal(plan.transportCalibrated,true);assert.equal(plan.transportWithinBudget,false);assert.equal(plan.admitted,false);assert.equal(plan.proofEligible,false);assert.ok(plan.maxObservedTransportOverheadRatio>.1);
});

test('temporal compiler refuses insufficient aggregate throughput',()=>{
 const plan=compileTemporalMeshPlan({
  program,graph,executionGraphRefHash:graphRef.hash,stream,epoch,resourceManifestHash:'manifest:proof',nowNs:0n,firstDisplayNs:ms(2000),firstOutputFrame:0n,totalOutputFrames:96,reserveRatio:.8,guardNs:ms(100),
  workers:[
   {workerId:'A',frameNsBudget:ms(1000/40),fixedNsBudget:ms(5),transport:transport()},
   {workerId:'B',frameNsBudget:ms(1000/35),fixedNsBudget:ms(5),transport:transport()},
   {workerId:'C',frameNsBudget:ms(1000/30),fixedNsBudget:ms(5),transport:transport()},
  ],
 });
 assert.equal(plan.admitted,false);assert.equal(plan.proofEligible,false);assert.ok(plan.safeFps<120);
});

test('temporal placement rejects incompatible program identity',()=>{
 assert.throws(()=>compileTemporalMeshPlan({
  program:{...program,partitionability:{kind:'atomic'}},graph,executionGraphRefHash:graphRef.hash,stream,epoch,resourceManifestHash:'manifest:proof',nowNs:0n,firstDisplayNs:ms(1000),firstOutputFrame:0n,totalOutputFrames:3,
  workers:[{workerId:'A',frameNsBudget:ms(10)}],
 }),/not temporally partitionable/);
 assert.throws(()=>compileTemporalMeshPlan({
  program,graph,executionGraphRefHash:graphRef.hash,stream:{...stream,renderProgramHash:'program:other'},epoch,resourceManifestHash:'manifest:proof',nowNs:0n,firstDisplayNs:ms(1000),firstOutputFrame:0n,totalOutputFrames:3,
  workers:[{workerId:'A',frameNsBudget:ms(10)}],
 }),/hash mismatch/);
});
