import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene} from '../dist/index.js';
import {MemoryContentStore} from '../dist/render-ir/index.js';
import {createRenderSequenceBundle,lowerRenderProgram,projectSceneRenderFrame} from '../dist/execution/index.js';
import {MeshWorkerRuntime,TemporalRenderSession,decodeMeshWire,encodeMeshWire} from '../dist/meshwork/index.js';

test('authority -> CAS transfer -> worker -> ordered assembler is complete',async()=>{
 const scene=new Scene({version:1,gravity:[0,0,0],entities:[
  {id:'box',position:[0,0,0],mesh:{kind:'box',size:[1,1,1]},material:{kind:'steel'},body:{motion:'kinematic',mass:1,velocity:[.1,0,0]}},
  {id:'lamp',position:[2,3,1],mesh:{kind:'sphere',radius:.1},light:{kind:'point',intensity:15,range:20}},
 ]});
 const authority=new MemoryContentStore(),frames=[];
 for(let i=0;i<60;i++){frames.push(projectSceneRenderFrame(scene,authority,{epoch:1n,frame:BigInt(i)}).frame);scene.step(1/60);}
 const bundle=createRenderSequenceBundle(authority,frames,{profileHash:'profile:test',warmupFrames:2}),graph=lowerRenderProgram(bundle.program);
 assert.equal(graph.nodes[0].operation,'render.sequence');assert.equal(bundle.graph.graphHash,graph.graphHash);assert.equal(bundle.graphRef.kind,'graph');

 const stream={streamId:'test-stream',targetFps:120,renderProgramHash:bundle.program.programHash};
 const epoch={streamId:stream.streamId,epoch:1n,checkpointHash:bundle.checkpointRef.hash,cameraHash:bundle.cameraHash,profileHash:bundle.program.profileHash};
 const session=new TemporalRenderSession({
  program:bundle.program,graph:bundle.graph,executionGraphRefHash:bundle.graphRef.hash,stream,epoch,resourceManifestHash:bundle.manifestRef.hash,
  workers:[
   {workerId:'A',frameNsBudget:14_000_000n,fixedNsBudget:2_000_000n},
   {workerId:'B',frameNsBudget:15_000_000n,fixedNsBudget:2_000_000n},
   {workerId:'C',frameNsBudget:16_000_000n,fixedNsBudget:2_000_000n},
  ],
  nowNs:0n,firstDisplayNs:2_000_000_000n,firstOutputFrame:0n,totalOutputFrames:60,reserveRatio:.8,guardNs:100_000_000n,
 });
 assert.equal(session.plan.proofEligible,true,{safeFps:session.plan.safeFps,single:session.plan.singleBestFps});

 const source={async fetch(hash){const ref=authority.ref(hash);return ref?{ref,value:authority.require(hash)}:undefined;}};
 let clock=500_000_000n;
 const completed=[];
 for(const workerId of ['A','B','C']){
  const workerStore=new MemoryContentStore();
  const executor={execute:({outputFrames,inputHash})=>({frameCount:outputFrames.length,payload:{inputHash,frames:outputFrames.map(frame=>frame.frame.toString())}})};
  const runtime=new MeshWorkerRuntime(workerId,workerStore,executor,source,()=>clock);
  const lease=session.claim(workerId,0n,1_000_000_000n);assert.ok(lease,workerId);
  const task=decodeMeshWire(encodeMeshWire(lease.task));assert.equal(task.firstOutputFrame,lease.task.firstOutputFrame);
  completed.push({lease,result:await runtime.execute(task),workerStore});
 }
 const assembled=[];
 for(const item of completed.reverse()){const accepted=session.accept(item.lease,item.result,clock);assert.equal(accepted.decision,'accept');assembled.push(...accepted.ready);assert.ok(item.workerStore.has(item.result.outputHash));}
 assert.equal(assembled.length,3);assert.equal(session.leases.pending,0);assert.equal(session.assembler.nextOutputFrame,60n);
 assert.equal(assembled.reduce((sum,result)=>sum+result.frameCount,0),60);
});

test('worker rejects tampered content by recomputing its content hash',async()=>{
 const scene=new Scene({version:1,gravity:[0,0,0],entities:[{id:'box',mesh:{kind:'box'},material:{kind:'steel'}}]}),authority=new MemoryContentStore();
 const frame=projectSceneRenderFrame(scene,authority,{epoch:1n,frame:0n}).frame,bundle=createRenderSequenceBundle(authority,[frame],{profileHash:'profile:test',warmupFrames:0});
 const task={streamId:'s',epoch:1n,segment:0n,attempt:0,firstOutputFrame:0n,outputFrames:1,warmupFrames:0,programHash:bundle.program.programHash,executionGraphRefHash:bundle.graphRef.hash,checkpointHash:bundle.checkpointRef.hash,resourceManifestHash:bundle.manifestRef.hash,cameraHash:bundle.cameraHash,renderProfileHash:bundle.program.profileHash,deadlineNs:1_000_000_000n};
 const badSource={async fetch(hash){const ref=authority.ref(hash);if(!ref)return undefined;return{ref,value:hash===bundle.checkpointRef.hash?{corrupt:true}:authority.require(hash)};}};
 const runtime=new MeshWorkerRuntime('bad',new MemoryContentStore(),{execute:()=>({frameCount:1,payload:{}})},badSource,()=>1n);
 await assert.rejects(()=>runtime.execute(task),/hash verification failed/);
});
