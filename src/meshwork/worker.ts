import {canonicalContent,contentHash,type ContentAddressedRepository,type ContentHash,type ContentRef,type PortableRenderFrame,type RenderProgramDescriptor,type ResourceManifest} from '../render-ir/index.js';
import type {RenderSequenceCheckpoint} from '../execution/index.js';
import type {MeshRenderSegmentResult,MeshRenderSegmentTask} from './protocol.js';

export interface MeshContentEntry{readonly ref:ContentRef;readonly value:unknown}
export interface MeshContentSource{fetch(hash:ContentHash):Promise<MeshContentEntry|undefined>}
export interface MeshSegmentExecutionInput{
 readonly task:MeshRenderSegmentTask;readonly program:RenderProgramDescriptor;readonly checkpoint:RenderSequenceCheckpoint;
 readonly frames:readonly PortableRenderFrame[];readonly warmupFrames:readonly PortableRenderFrame[];readonly outputFrames:readonly PortableRenderFrame[];readonly inputHash:ContentHash;
}
export interface MeshSegmentExecutionOutput{readonly frameCount:number;readonly payload:unknown}
export interface MeshSegmentExecutor{execute(input:MeshSegmentExecutionInput):MeshSegmentExecutionOutput|Promise<MeshSegmentExecutionOutput>}

export class MeshWorkerRuntime{
 constructor(readonly workerId:string,private readonly store:ContentAddressedRepository,private readonly executor:MeshSegmentExecutor,private readonly contentSource?:MeshContentSource,private readonly clockNs:()=>bigint=()=>BigInt(Math.floor(performance.now()*1e6))){
  if(!workerId)throw new TypeError('Mesh worker requires a stable ID');
 }
 async execute(task:MeshRenderSegmentTask):Promise<MeshRenderSegmentResult>{
  const checkpoint=await this.requireContent<RenderSequenceCheckpoint>(task.checkpointHash);
  if(checkpoint.schema!==1)throw new TypeError('Unsupported render checkpoint');
  if(checkpoint.profileHash!==task.renderProfileHash||checkpoint.cameraHash!==task.cameraHash)throw new TypeError('Task/checkpoint identity mismatch');
  if(checkpoint.resourceManifestRef.hash!==task.resourceManifestHash)throw new TypeError('Task/resource manifest mismatch');

  const [program,manifest]=await Promise.all([
   this.requireContent<RenderProgramDescriptor>(checkpoint.programRef.hash),
   this.requireContent<ResourceManifest>(task.resourceManifestHash),
  ]);
  if(program.programHash!==task.programHash||program.profileHash!==task.renderProfileHash)throw new TypeError('Task/program identity mismatch');
  if(canonicalContent(manifest)!==canonicalContent(program.requiredResources))throw new TypeError('Program/resource manifest mismatch');
  await Promise.all(program.requiredResources.resources.map(ref=>this.requireContent(ref.hash)));

  const firstOutput=task.firstOutputFrame;
  if(firstOutput<checkpoint.firstFrame||firstOutput+BigInt(task.outputFrames)>checkpoint.lastFrameExclusive)throw new RangeError('Task frame range is outside checkpoint');
  const desiredWarmupStart=firstOutput-BigInt(task.warmupFrames),warmupStart=desiredWarmupStart<checkpoint.firstFrame?checkpoint.firstFrame:desiredWarmupStart;
  if(desiredWarmupStart<checkpoint.firstFrame&&firstOutput!==checkpoint.firstFrame)throw new RangeError('Checkpoint does not contain required temporal warmup');

  const startIndex=Number(warmupStart-checkpoint.firstFrame),outputIndex=Number(firstOutput-checkpoint.firstFrame),endIndex=outputIndex+task.outputFrames;
  const refs=checkpoint.frames.slice(startIndex,endIndex),frames=await Promise.all(refs.map(ref=>this.requireContent<PortableRenderFrame>(ref.hash)));
  for(let i=1;i<frames.length;i++)if(frames[i]!.frame!==frames[i-1]!.frame+1n)throw new TypeError('Checkpoint frame sequence is not contiguous');

  const warmupCount=outputIndex-startIndex,warmupFrames=Object.freeze(frames.slice(0,warmupCount)),outputFrames=Object.freeze(frames.slice(warmupCount));
  if(outputFrames.length!==task.outputFrames||outputFrames[0]?.frame!==task.firstOutputFrame)throw new RangeError('Checkpoint does not contain exact output range');

  const inputHash=contentHash({task,frameHashes:refs.map(ref=>ref.hash),programHash:program.programHash},'input');
  const output=await this.executor.execute(Object.freeze({task,program,checkpoint,frames:Object.freeze(frames),warmupFrames,outputFrames,inputHash}));
  if(!Number.isSafeInteger(output.frameCount)||output.frameCount!==task.outputFrames)throw new TypeError('Segment executor returned wrong frame count');
  const outputRef=this.store.put('segment',output.payload),finishedNs=this.clockNs();
  return Object.freeze({streamId:task.streamId,epoch:task.epoch,segment:task.segment,attempt:task.attempt,firstFrame:task.firstOutputFrame,frameCount:output.frameCount,inputHash,outputHash:outputRef.hash,finishedNs});
 }
 private async requireContent<T=unknown>(hash:ContentHash):Promise<T>{
  const local=this.store.get<T>(hash);if(local!==undefined)return local;if(!this.contentSource)throw new Error('Missing worker content '+hash);
  const fetched=await this.contentSource.fetch(hash);if(!fetched||fetched.ref.hash!==hash)throw new Error('Content source did not return '+hash);
  const stored=this.store.put(fetched.ref.kind,fetched.value);if(stored.hash!==hash)throw new Error('Content hash verification failed for '+hash);return this.store.require<T>(hash);
 }
}
