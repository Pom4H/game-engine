import type {ContentHash,RenderProgramDescriptor} from '../render-ir/index.js';
import type {ExecutionGraph} from '../execution/index.js';
import {defineSegmentTask,type MeshEpoch,type MeshRenderSegmentTask,type MeshStream} from './protocol.js';

const NS_PER_SECOND=1_000_000_000n;

export interface MeshTransportCalibration {
 readonly source:'measured'|'assumed';
 readonly ingressBytesPerSecond:number;
 readonly egressBytesPerSecond:number;
 readonly inputBytesPerFrameBudget:number;
 readonly outputBytesPerFrameBudget:number;
 readonly segmentInputBytesBudget?:number;
 readonly coldStartInputBytesBudget?:number;
 readonly cacheWarm?:boolean;
 readonly fixedNsBudget?:bigint;
 readonly encodeNsPerOutputFrameBudget?:bigint;
}
export interface MeshWorkerCalibration {
 readonly workerId:string;
 readonly frameNsBudget:bigint;
 readonly fixedNsBudget?:bigint;
 readonly transport?:MeshTransportCalibration;
}
export interface TemporalMeshPlanInput {
 readonly program:RenderProgramDescriptor;readonly graph:ExecutionGraph;readonly executionGraphRefHash:ContentHash;readonly stream:MeshStream;readonly epoch:MeshEpoch;readonly resourceManifestHash:ContentHash;
 readonly workers:readonly MeshWorkerCalibration[];readonly nowNs:bigint;readonly firstDisplayNs:bigint;readonly firstOutputFrame:bigint;
 readonly firstSegment?:bigint;readonly totalOutputFrames:number;readonly reserveRatio?:number;readonly guardNs?:bigint;readonly maxTransportOverheadRatio?:number;
}
export interface TemporalWorkerAssignment {
 readonly workerId:string;readonly task:MeshRenderSegmentTask;readonly outputOffset:number;
 readonly usefulRenderNs:bigint;readonly renderNs:bigint;readonly fixedNs:bigint;readonly transportNs:bigint;
 readonly predictedInputBytes:number;readonly predictedOutputBytes:number;readonly transportOverheadRatio:number;readonly distributedOverheadRatio:number;
 readonly predictedDurationNs:bigint;readonly predictedFinishNs:bigint;readonly slackNs:bigint;readonly usefulFps:number;
}
export interface TemporalMeshPlan {
 readonly targetFps:number;readonly warmupFrames:number;readonly reserveRatio:number;readonly maxTransportOverheadRatio:number;
 readonly singleBestFps:number;readonly computeOnlyCycleFps:number;readonly meshCycleFps:number;readonly safeFps:number;readonly netUsefulFps:number;
 readonly transportCalibrated:boolean;readonly transportWithinBudget:boolean;readonly maxObservedTransportOverheadRatio:number;readonly profitable:boolean;
 readonly admitted:boolean;readonly allWorkersBelowTarget:boolean;readonly proofEligible:boolean;readonly assignments:readonly TemporalWorkerAssignment[];
}

const safeInt=(value:number,label:string,min=0)=>{if(!Number.isSafeInteger(value)||value<min)throw new RangeError(label+' must be a safe integer >= '+min);return value;};
const positiveNs=(value:bigint,label:string,allowZero=false)=>{if(typeof value!=='bigint'||value<(allowZero?0n:1n))throw new RangeError(label+' must be '+(allowZero?'non-negative':'positive'));return value;};
const finitePositive=(value:number,label:string)=>{if(!Number.isFinite(value)||value<=0)throw new RangeError(label+' must be positive and finite');return value;};
const ratio=(value:number,label:string)=>{if(!Number.isFinite(value)||value<0||value>=1)throw new RangeError(label+' must be within [0, 1)');return value;};
const fpsFor=(frameNs:bigint)=>1e9/Number(frameNs);
const bytesToNs=(bytes:number,bytesPerSecond:number)=>BigInt(Math.ceil(bytes*1e9/bytesPerSecond));

function validateTransport(transport:MeshTransportCalibration|undefined):void{
 if(!transport)return;
 if(transport.source!=='measured'&&transport.source!=='assumed')throw new TypeError('Transport calibration source is invalid');
 finitePositive(transport.ingressBytesPerSecond,'ingressBytesPerSecond');finitePositive(transport.egressBytesPerSecond,'egressBytesPerSecond');
 safeInt(transport.inputBytesPerFrameBudget,'inputBytesPerFrameBudget');safeInt(transport.outputBytesPerFrameBudget,'outputBytesPerFrameBudget');
 safeInt(transport.segmentInputBytesBudget??0,'segmentInputBytesBudget');safeInt(transport.coldStartInputBytesBudget??0,'coldStartInputBytesBudget');
 positiveNs(transport.fixedNsBudget??0n,'transport.fixedNsBudget',true);positiveNs(transport.encodeNsPerOutputFrameBudget??0n,'encodeNsPerOutputFrameBudget',true);
}
function transportCost(worker:MeshWorkerCalibration,count:number,warmup:number){
 const transport=worker.transport;
 if(!transport)return{inputBytes:0,outputBytes:0,ingressNs:0n,egressNs:0n,encodeNs:0n,fixedNs:0n,totalNs:0n};
 const frameCount=count+warmup;
 const inputBytes=(transport.segmentInputBytesBudget??0)+frameCount*transport.inputBytesPerFrameBudget+(transport.cacheWarm?0:(transport.coldStartInputBytesBudget??0));
 const outputBytes=count*transport.outputBytesPerFrameBudget;
 const ingressNs=bytesToNs(inputBytes,transport.ingressBytesPerSecond),egressNs=bytesToNs(outputBytes,transport.egressBytesPerSecond);
 const encodeNs=BigInt(count)*(transport.encodeNsPerOutputFrameBudget??0n),fixedNs=transport.fixedNsBudget??0n;
 return{inputBytes,outputBytes,ingressNs,egressNs,encodeNs,fixedNs,totalNs:ingressNs+egressNs+encodeNs+fixedNs};
}
function segmentCost(worker:MeshWorkerCalibration,count:number,warmup:number){
 const usefulRenderNs=BigInt(count)*worker.frameNsBudget,renderNs=BigInt(count+warmup)*worker.frameNsBudget,fixedNs=worker.fixedNsBudget??0n,transport=transportCost(worker,count,warmup);
 const durationNs=renderNs+fixedNs+transport.totalNs;
 return{usefulRenderNs,renderNs,fixedNs,transport,durationNs,computeOnlyNs:renderNs+fixedNs};
}
function allocateCounts(total:number,workers:readonly MeshWorkerCalibration[],warmup:number):Map<string,number>{
 if(total<workers.length)throw new RangeError('totalOutputFrames must be >= worker count');
 const counts=new Map<string,number>(workers.map(worker=>[worker.workerId,1] as const));
 for(let remaining=total-workers.length;remaining>0;remaining--){
  let best=workers[0]!,bestDuration=segmentCost(best,(counts.get(best.workerId)??0)+1,warmup).durationNs;
  for(let i=1;i<workers.length;i++){
   const worker=workers[i]!,duration=segmentCost(worker,(counts.get(worker.workerId)??0)+1,warmup).durationNs;
   if(duration<bestDuration||(duration===bestDuration&&worker.workerId.localeCompare(best.workerId)<0)){best=worker;bestDuration=duration;}
  }
  counts.set(best.workerId,(counts.get(best.workerId)??0)+1);
 }
 return counts;
}
export function compileTemporalMeshPlan(input:TemporalMeshPlanInput):TemporalMeshPlan{
 const fps=safeInt(input.stream.targetFps,'targetFps',1),partition=input.program.partitionability;
 if(partition.kind!=='temporal')throw new TypeError('Render program is not temporally partitionable');
 if(input.graph.programHash!==input.program.programHash)throw new TypeError('Execution graph/program hash mismatch');
 const renderNode=input.graph.nodes.find(node=>node.operation==='render.sequence');
 if(!renderNode||renderNode.partitionability.kind!=='temporal'||renderNode.partitionability.warmupFrames!==partition.warmupFrames)throw new TypeError('Execution graph/render partition mismatch');
 if(input.stream.renderProgramHash!==input.program.programHash)throw new TypeError('Stream/program hash mismatch');
 if(input.epoch.streamId!==input.stream.streamId)throw new TypeError('Epoch belongs to another stream');
 if(input.epoch.profileHash!==input.program.profileHash)throw new TypeError('Epoch/profile hash mismatch');
 safeInt(input.totalOutputFrames,'totalOutputFrames',1);positiveNs(input.nowNs,'nowNs',true);positiveNs(input.firstDisplayNs,'firstDisplayNs');
 if(input.firstOutputFrame<0n||(input.firstSegment??0n)<0n)throw new RangeError('Frame/segment identity must be non-negative');
 const reserve=input.reserveRatio??.8;if(!Number.isFinite(reserve)||reserve<=0||reserve>1)throw new RangeError('reserveRatio must be in (0, 1]');
 const guard=input.guardNs??0n;positiveNs(guard,'guardNs',true);
 const maxTransportOverheadRatio=ratio(input.maxTransportOverheadRatio??.1,'maxTransportOverheadRatio');
 if(input.firstDisplayNs<=input.nowNs+guard)throw new RangeError('First display deadline leaves no execution window');
 if(!input.workers.length)throw new RangeError('Temporal Meshwork requires at least one worker');
 const ids=new Set<string>(),workers=input.workers.map(worker=>{
  if(!worker.workerId||ids.has(worker.workerId))throw new TypeError('Workers require unique stable IDs');ids.add(worker.workerId);
  positiveNs(worker.frameNsBudget,'frameNsBudget');positiveNs(worker.fixedNsBudget??0n,'fixedNsBudget',true);validateTransport(worker.transport);return worker;
 });
 const counts=allocateCounts(input.totalOutputFrames,workers,partition.warmupFrames);
 const ordered=[...workers].sort((a,b)=>{
  const da=segmentCost(a,counts.get(a.workerId)!,partition.warmupFrames).durationNs,db=segmentCost(b,counts.get(b.workerId)!,partition.warmupFrames).durationNs;
  return da<db?-1:da>db?1:a.workerId.localeCompare(b.workerId);
 });
 let offset=0,maxDuration=0n,maxComputeOnly=0n,maxObservedTransportOverheadRatio=0;const assignments:TemporalWorkerAssignment[]=[];
 for(let i=0;i<ordered.length;i++){
  const worker=ordered[i]!,count=counts.get(worker.workerId)!,displayOffsetNs=BigInt(offset)*NS_PER_SECOND/BigInt(fps),deadlineNs=input.firstDisplayNs+displayOffsetNs-guard,cost=segmentCost(worker,count,partition.warmupFrames);
  const finish=input.nowNs+cost.durationNs,transportOverheadRatio=cost.durationNs===0n?0:Number(cost.transport.totalNs)/Number(cost.durationNs);
  const distributedOverheadRatio=cost.durationNs===0n?0:Number(cost.durationNs-cost.usefulRenderNs)/Number(cost.durationNs);
  const task=defineSegmentTask({
   streamId:input.stream.streamId,epoch:input.epoch.epoch,segment:(input.firstSegment??0n)+BigInt(i),attempt:0,
   firstOutputFrame:input.firstOutputFrame+BigInt(offset),outputFrames:count,warmupFrames:partition.warmupFrames,
   programHash:input.program.programHash,executionGraphRefHash:input.executionGraphRefHash,checkpointHash:input.epoch.checkpointHash,resourceManifestHash:input.resourceManifestHash,
   cameraHash:input.epoch.cameraHash,renderProfileHash:input.epoch.profileHash,deadlineNs,
  });
  assignments.push(Object.freeze({
   workerId:worker.workerId,task,outputOffset:offset,usefulRenderNs:cost.usefulRenderNs,renderNs:cost.renderNs,fixedNs:cost.fixedNs,transportNs:cost.transport.totalNs,
   predictedInputBytes:cost.transport.inputBytes,predictedOutputBytes:cost.transport.outputBytes,transportOverheadRatio,distributedOverheadRatio,
   predictedDurationNs:cost.durationNs,predictedFinishNs:finish,slackNs:deadlineNs-finish,usefulFps:count/(Number(cost.durationNs)/1e9),
  }));
  if(cost.durationNs>maxDuration)maxDuration=cost.durationNs;if(cost.computeOnlyNs>maxComputeOnly)maxComputeOnly=cost.computeOnlyNs;
  if(transportOverheadRatio>maxObservedTransportOverheadRatio)maxObservedTransportOverheadRatio=transportOverheadRatio;offset+=count;
 }
 const computeOnlyCycleFps=input.totalOutputFrames/(Number(maxComputeOnly)/1e9),meshCycleFps=input.totalOutputFrames/(Number(maxDuration)/1e9),safeFps=meshCycleFps*reserve;
 const singleBestFps=Math.max(...workers.map(worker=>fpsFor(worker.frameNsBudget))),allWorkersBelowTarget=workers.every(worker=>fpsFor(worker.frameNsBudget)<fps);
 const transportCalibrated=workers.every(worker=>worker.transport?.source==='measured'),transportWithinBudget=maxObservedTransportOverheadRatio<=maxTransportOverheadRatio;
 const profitable=safeFps>singleBestFps,admitted=safeFps>=fps&&transportWithinBudget&&assignments.every(assignment=>assignment.slackNs>=0n);
 return Object.freeze({
  targetFps:fps,warmupFrames:partition.warmupFrames,reserveRatio:reserve,maxTransportOverheadRatio,singleBestFps,computeOnlyCycleFps,meshCycleFps,safeFps,netUsefulFps:safeFps,
  transportCalibrated,transportWithinBudget,maxObservedTransportOverheadRatio,profitable,admitted,allWorkersBelowTarget,
  proofEligible:workers.length>=3&&allWorkersBelowTarget&&admitted&&profitable&&transportCalibrated,assignments:Object.freeze(assignments),
 });
}
export interface TemporalDepthCandidate{readonly depth:number;readonly plan:TemporalMeshPlan}
export function selectHighestAdmittedTemporalPlan(candidates:readonly TemporalDepthCandidate[]):TemporalDepthCandidate|undefined{
 const valid=candidates.filter(candidate=>{if(!Number.isSafeInteger(candidate.depth)||candidate.depth<0||candidate.depth>255)throw new RangeError('Temporal depth must be within 0..255');return candidate.plan.admitted;});
 return [...valid].sort((a,b)=>b.depth-a.depth)[0];
}
