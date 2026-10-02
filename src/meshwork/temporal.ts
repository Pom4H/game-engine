import type {ContentHash,RenderProgramDescriptor} from '../render-ir/index.js';
import {defineSegmentTask,type MeshEpoch,type MeshRenderSegmentTask,type MeshStream} from './protocol.js';

const NS_PER_SECOND=1_000_000_000n;

export interface MeshWorkerCalibration {
 readonly workerId:string;
 readonly frameNsBudget:bigint;
 readonly fixedNsBudget?:bigint;
}
export interface TemporalMeshPlanInput {
 readonly program:RenderProgramDescriptor;
 readonly stream:MeshStream;
 readonly epoch:MeshEpoch;
 readonly resourceManifestHash:ContentHash;
 readonly workers:readonly MeshWorkerCalibration[];
 readonly nowNs:bigint;
 readonly firstDisplayNs:bigint;
 readonly firstOutputFrame:bigint;
 readonly firstSegment?:bigint;
 readonly totalOutputFrames:number;
 readonly reserveRatio?:number;
 readonly guardNs?:bigint;
}
export interface TemporalWorkerAssignment {
 readonly workerId:string;
 readonly task:MeshRenderSegmentTask;
 readonly outputOffset:number;
 readonly predictedDurationNs:bigint;
 readonly predictedFinishNs:bigint;
 readonly slackNs:bigint;
 readonly usefulFps:number;
}
export interface TemporalMeshPlan {
 readonly targetFps:number;
 readonly warmupFrames:number;
 readonly reserveRatio:number;
 readonly singleBestFps:number;
 readonly meshCycleFps:number;
 readonly safeFps:number;
 readonly admitted:boolean;
 readonly allWorkersBelowTarget:boolean;
 readonly proofEligible:boolean;
 readonly assignments:readonly TemporalWorkerAssignment[];
}

const safeInt=(value:number,label:string,min=0)=>{if(!Number.isSafeInteger(value)||value<min)throw new RangeError(label+' must be a safe integer >= '+min);return value;};
const positiveNs=(value:bigint,label:string,allowZero=false)=>{if(typeof value!=='bigint'||value<(allowZero?0n:1n))throw new RangeError(label+' must be '+(allowZero?'non-negative':'positive'));return value;};
const fpsFor=(frameNs:bigint)=>1e9/Number(frameNs);
const segmentDuration=(worker:MeshWorkerCalibration,count:number,warmup:number)=>(worker.fixedNsBudget??0n)+BigInt(count+warmup)*worker.frameNsBudget;

function allocateCounts(total:number,workers:readonly MeshWorkerCalibration[]):Map<string,number>{
 if(total<workers.length)throw new RangeError('totalOutputFrames must be >= worker count');
 const weights=workers.map(worker=>1/Number(worker.frameNsBudget)),sum=weights.reduce((a,b)=>a+b,0);
 const counts=new Map(workers.map(worker=>[worker.workerId,1] as const)),remaining=total-workers.length;
 const ideals=weights.map(weight=>remaining*weight/sum),floors=ideals.map(Math.floor);
 let assigned=0;
 for(let i=0;i<workers.length;i++){counts.set(workers[i]!.workerId,1+floors[i]!);assigned+=floors[i]!;}
 const order=workers.map((worker,i)=>({worker,i,remainder:ideals[i]!-floors[i]!})).sort((a,b)=>b.remainder-a.remainder||a.worker.workerId.localeCompare(b.worker.workerId));
 for(let i=0;i<remaining-assigned;i++){const worker=order[i%order.length]!.worker;counts.set(worker.workerId,counts.get(worker.workerId)!+1);}
 return counts;
}

export function compileTemporalMeshPlan(input:TemporalMeshPlanInput):TemporalMeshPlan{
 const fps=safeInt(input.stream.targetFps,'targetFps',1);
 if(input.program.partitionability.kind!=='temporal')throw new TypeError('Render program is not temporally partitionable');
 if(input.stream.renderProgramHash!==input.program.programHash)throw new TypeError('Stream/program hash mismatch');
 if(input.epoch.streamId!==input.stream.streamId)throw new TypeError('Epoch belongs to another stream');
 if(input.epoch.profileHash!==input.program.profileHash)throw new TypeError('Epoch/profile hash mismatch');
 safeInt(input.totalOutputFrames,'totalOutputFrames',1);positiveNs(input.nowNs,'nowNs',true);positiveNs(input.firstDisplayNs,'firstDisplayNs');
 if(input.firstOutputFrame<0n||(input.firstSegment??0n)<0n)throw new RangeError('Frame/segment identity must be non-negative');
 const reserve=input.reserveRatio??.8;if(!Number.isFinite(reserve)||reserve<=0||reserve>1)throw new RangeError('reserveRatio must be in (0, 1]');
 const guard=input.guardNs??0n;positiveNs(guard,'guardNs',true);
 if(input.firstDisplayNs<=input.nowNs+guard)throw new RangeError('First display deadline leaves no execution window');
 if(!input.workers.length)throw new RangeError('Temporal Meshwork requires at least one worker');
 const ids=new Set<string>();
 const workers=input.workers.map(worker=>{
  if(!worker.workerId||ids.has(worker.workerId))throw new TypeError('Workers require unique stable IDs');ids.add(worker.workerId);
  positiveNs(worker.frameNsBudget,'frameNsBudget');positiveNs(worker.fixedNsBudget??0n,'fixedNsBudget',true);
  return Object.freeze({...worker,fixedNsBudget:worker.fixedNsBudget??0n});
 });
 const counts=allocateCounts(input.totalOutputFrames,workers);
 const ordered=[...workers].sort((a,b)=>{
  const da=segmentDuration(a,counts.get(a.workerId)!,input.program.partitionability.warmupFrames);
  const db=segmentDuration(b,counts.get(b.workerId)!,input.program.partitionability.warmupFrames);
  return da<db?-1:da>db?1:a.workerId.localeCompare(b.workerId);
 });
 let offset=0;const assignments:TemporalWorkerAssignment[]=[];let maxDuration=0n;
 for(let i=0;i<ordered.length;i++){
  const worker=ordered[i]!,count=counts.get(worker.workerId)!;
  const displayOffsetNs=BigInt(offset)*NS_PER_SECOND/BigInt(fps);
  const deadlineNs=input.firstDisplayNs+displayOffsetNs-guard;
  const duration=segmentDuration(worker,count,input.program.partitionability.warmupFrames),finish=input.nowNs+duration;
  const task=defineSegmentTask({
   streamId:input.stream.streamId,epoch:input.epoch.epoch,segment:(input.firstSegment??0n)+BigInt(i),attempt:0,
   firstOutputFrame:input.firstOutputFrame+BigInt(offset),outputFrames:count,warmupFrames:input.program.partitionability.warmupFrames,
   programHash:input.program.programHash,checkpointHash:input.epoch.checkpointHash,resourceManifestHash:input.resourceManifestHash,
   cameraHash:input.epoch.cameraHash,renderProfileHash:input.epoch.profileHash,deadlineNs,
  });
  assignments.push(Object.freeze({workerId:worker.workerId,task,outputOffset:offset,predictedDurationNs:duration,predictedFinishNs:finish,slackNs:deadlineNs-finish,usefulFps:count/(Number(duration)/1e9)}));
  if(duration>maxDuration)maxDuration=duration;offset+=count;
 }
 const meshCycleFps=input.totalOutputFrames/(Number(maxDuration)/1e9),safeFps=meshCycleFps*reserve;
 const singleBestFps=Math.max(...workers.map(worker=>fpsFor(worker.frameNsBudget)));
 const allWorkersBelowTarget=workers.every(worker=>fpsFor(worker.frameNsBudget)<fps);
 const admitted=safeFps>=fps&&assignments.every(assignment=>assignment.slackNs>=0n);
 return Object.freeze({
  targetFps:fps,warmupFrames:input.program.partitionability.warmupFrames,reserveRatio:reserve,
  singleBestFps,meshCycleFps,safeFps,admitted,allWorkersBelowTarget,
  proofEligible:workers.length>=3&&allWorkersBelowTarget&&admitted,
  assignments:Object.freeze(assignments),
 });
}
