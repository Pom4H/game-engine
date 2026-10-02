import {canonicalContent,contentHash,type ContentAddressedRepository,type ContentHash,type ContentRef,type PortableRenderFrame,type RenderProgramDescriptor,type ResourceManifest} from '../render-ir/index.js';
import type {ExecutionGraph,RenderSequenceCheckpoint} from '../execution/index.js';
import type {MeshRenderSegmentResult,MeshRenderSegmentTask,MeshSegmentTransportTelemetry} from './protocol.js';

export interface MeshContentEntry{readonly ref:ContentRef;readonly value:unknown;readonly transferredBytes?:number}
export interface MeshContentSource{fetch(hash:ContentHash):Promise<MeshContentEntry|undefined>}
export interface MeshSegmentExecutionInput{
 readonly task:MeshRenderSegmentTask;readonly program:RenderProgramDescriptor;readonly graph:ExecutionGraph;readonly checkpoint:RenderSequenceCheckpoint;
 readonly frames:readonly PortableRenderFrame[];readonly warmupFrames:readonly PortableRenderFrame[];readonly outputFrames:readonly PortableRenderFrame[];readonly inputHash:ContentHash;
}
export interface MeshSegmentExecutionOutput{
 readonly frameCount:number;readonly payload:unknown;readonly encodedBytes?:number;readonly encodeNs?:bigint;readonly uploadNs?:bigint;
}
export interface MeshSegmentExecutor{execute(input:MeshSegmentExecutionInput):MeshSegmentExecutionOutput|Promise<MeshSegmentExecutionOutput>}

interface MutableHydrationAccounting{cacheHits:number;cacheMisses:number;fetchedBytes:number;fetchedBytesMeasured:boolean}
const byteLength=(value:unknown)=>new TextEncoder().encode(canonicalContent(value)).byteLength;
const elapsed=(start:bigint,end:bigint)=>end>=start?end-start:0n;

export class MeshWorkerRuntime{
 constructor(readonly workerId:string,private readonly store:ContentAddressedRepository,private readonly executor:MeshSegmentExecutor,private readonly contentSource?:MeshContentSource,private readonly clockNs:()=>bigint=()=>BigInt(Math.floor(performance.now()*1e6))){
  if(!workerId)throw new TypeError('Mesh worker requires a stable ID');
 }
 async execute(task:MeshRenderSegmentTask):Promise<MeshRenderSegmentResult>{
  const accounting:MutableHydrationAccounting={cacheHits:0,cacheMisses:0,fetchedBytes:0,fetchedBytesMeasured:true},hydrationStarted=this.clockNs();
  const checkpoint=await this.requireContent<RenderSequenceCheckpoint>(task.checkpointHash,accounting);
  if(checkpoint.schema!==1)throw new TypeError('Unsupported render checkpoint');
  if(checkpoint.profileHash!==task.renderProfileHash||checkpoint.cameraHash!==task.cameraHash)throw new TypeError('Task/checkpoint identity mismatch');
  if(checkpoint.resourceManifestRef.hash!==task.resourceManifestHash)throw new TypeError('Task/resource manifest mismatch');
  if(checkpoint.graphRef.hash!==task.executionGraphRefHash)throw new TypeError('Task/execution graph identity mismatch');

  const [program,graph,manifest]=await Promise.all([
   this.requireContent<RenderProgramDescriptor>(checkpoint.programRef.hash,accounting),
   this.requireContent<ExecutionGraph>(checkpoint.graphRef.hash,accounting),
   this.requireContent<ResourceManifest>(task.resourceManifestHash,accounting),
  ]);
  if(program.programHash!==task.programHash||program.profileHash!==task.renderProfileHash)throw new TypeError('Task/program identity mismatch');
  if(graph.programHash!==program.programHash||!graph.nodes.some(node=>node.operation==='render.sequence'))throw new TypeError('Execution graph/program mismatch');
  if(canonicalContent(manifest)!==canonicalContent(program.requiredResources))throw new TypeError('Program/resource manifest mismatch');
  await Promise.all(program.requiredResources.resources.map(ref=>this.requireContent(ref.hash,accounting)));

  const firstOutput=task.firstOutputFrame;
  if(firstOutput<checkpoint.firstFrame||firstOutput+BigInt(task.outputFrames)>checkpoint.lastFrameExclusive)throw new RangeError('Task frame range is outside checkpoint');
  const desiredWarmupStart=firstOutput-BigInt(task.warmupFrames),warmupStart=desiredWarmupStart<checkpoint.firstFrame?checkpoint.firstFrame:desiredWarmupStart;
  if(desiredWarmupStart<checkpoint.firstFrame&&firstOutput!==checkpoint.firstFrame)throw new RangeError('Checkpoint does not contain required temporal warmup');

  const startIndex=Number(warmupStart-checkpoint.firstFrame),outputIndex=Number(firstOutput-checkpoint.firstFrame),endIndex=outputIndex+task.outputFrames;
  const refs=checkpoint.frames.slice(startIndex,endIndex),frames=await Promise.all(refs.map(ref=>this.requireContent<PortableRenderFrame>(ref.hash,accounting)));
  for(let i=1;i<frames.length;i++)if(frames[i]!.frame!==frames[i-1]!.frame+1n)throw new TypeError('Checkpoint frame sequence is not contiguous');

  const warmupCount=outputIndex-startIndex,warmupFrames=Object.freeze(frames.slice(0,warmupCount)),outputFrames=Object.freeze(frames.slice(warmupCount));
  if(outputFrames.length!==task.outputFrames||outputFrames[0]?.frame!==task.firstOutputFrame)throw new RangeError('Checkpoint does not contain exact output range');
  const hydrationFinished=this.clockNs(),inputHash=contentHash({task,frameHashes:refs.map(ref=>ref.hash),programHash:program.programHash},'input');
  const executionStarted=this.clockNs(),output=await this.executor.execute(Object.freeze({task,program,graph,checkpoint,frames:Object.freeze(frames),warmupFrames,outputFrames,inputHash})),executionFinished=this.clockNs();
  if(!Number.isSafeInteger(output.frameCount)||output.frameCount!==task.outputFrames)throw new TypeError('Segment executor returned wrong frame count');
  if(output.encodedBytes!==undefined&&(!Number.isSafeInteger(output.encodedBytes)||output.encodedBytes<0))throw new RangeError('encodedBytes must be a non-negative safe integer');
  const outputRef=this.store.put('segment',output.payload),finishedNs=this.clockNs(),transport:MeshSegmentTransportTelemetry=Object.freeze({
   cacheHits:accounting.cacheHits,cacheMisses:accounting.cacheMisses,fetchedBytes:accounting.fetchedBytes,fetchedBytesMeasured:accounting.fetchedBytesMeasured,
   hydrationNs:elapsed(hydrationStarted,hydrationFinished),executionNs:elapsed(executionStarted,executionFinished),
   outputBytes:output.encodedBytes??byteLength(output.payload),outputBytesMeasured:output.encodedBytes!==undefined,encodeNs:output.encodeNs??0n,uploadNs:output.uploadNs??0n,
  });
  return Object.freeze({streamId:task.streamId,epoch:task.epoch,segment:task.segment,attempt:task.attempt,firstFrame:task.firstOutputFrame,frameCount:output.frameCount,inputHash,outputHash:outputRef.hash,finishedNs,transport});
 }
 private async requireContent<T=unknown>(hash:ContentHash,accounting:MutableHydrationAccounting):Promise<T>{
  const local=this.store.get<T>(hash);if(local!==undefined){accounting.cacheHits++;return local;}
  accounting.cacheMisses++;if(!this.contentSource)throw new Error('Missing worker content '+hash);
  const fetched=await this.contentSource.fetch(hash);if(!fetched||fetched.ref.hash!==hash)throw new Error('Content source did not return '+hash);
  if(fetched.transferredBytes!==undefined){
   if(!Number.isSafeInteger(fetched.transferredBytes)||fetched.transferredBytes<0)throw new RangeError('transferredBytes must be a non-negative safe integer');
   accounting.fetchedBytes+=fetched.transferredBytes;
  }else{accounting.fetchedBytes+=byteLength(fetched.value);accounting.fetchedBytesMeasured=false;}
  const stored=this.store.put(fetched.ref.kind,fetched.value);if(stored.hash!==hash)throw new Error('Content hash verification failed for '+hash);return this.store.require<T>(hash);
 }
}
