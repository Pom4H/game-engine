import type {ContentHash} from '../render-ir/index.js';

export interface MeshStream {
 readonly streamId:string;
 readonly targetFps:number;
 readonly renderProgramHash:ContentHash;
}
export interface MeshEpoch {
 readonly streamId:string;
 readonly epoch:bigint;
 readonly checkpointHash:ContentHash;
 readonly cameraHash:ContentHash;
 readonly profileHash:ContentHash;
}
export interface MeshRenderSegmentTask {
 readonly streamId:string;
 readonly epoch:bigint;
 readonly segment:bigint;
 readonly attempt:number;
 readonly firstOutputFrame:bigint;
 readonly outputFrames:number;
 readonly warmupFrames:number;
 readonly programHash:ContentHash;
 readonly checkpointHash:ContentHash;
 readonly resourceManifestHash:ContentHash;
 readonly cameraHash:ContentHash;
 readonly renderProfileHash:ContentHash;
 readonly deadlineNs:bigint;
}
export interface MeshRenderSegmentResult {
 readonly streamId:string;
 readonly epoch:bigint;
 readonly segment:bigint;
 readonly attempt:number;
 readonly firstFrame:bigint;
 readonly frameCount:number;
 readonly inputHash:ContentHash;
 readonly outputHash:ContentHash;
 readonly finishedNs:bigint;
}
export type MeshAttemptDecision='accept'|'stale-epoch'|'wrong-task'|'late'|'already-committed';

export function defineSegmentTask(task:MeshRenderSegmentTask):MeshRenderSegmentTask{
 if(!task.streamId||task.epoch<0n||task.segment<0n||task.firstOutputFrame<0n||task.deadlineNs<=0n)throw new RangeError('Invalid Meshwork task identity');
 for(const [label,value] of [['attempt',task.attempt],['outputFrames',task.outputFrames],['warmupFrames',task.warmupFrames]] as const)if(!Number.isSafeInteger(value)||value<(label==='outputFrames'?1:0))throw new RangeError(label+' is invalid');
 return Object.freeze(structuredClone(task));
}
export function decideSegmentResult(task:MeshRenderSegmentTask,result:MeshRenderSegmentResult,currentEpoch:bigint,alreadyCommitted:boolean):MeshAttemptDecision{
 if(result.epoch!==currentEpoch||task.epoch!==currentEpoch)return'stale-epoch';
 if(alreadyCommitted)return'already-committed';
 if(result.streamId!==task.streamId||result.segment!==task.segment||result.attempt!==task.attempt||result.firstFrame!==task.firstOutputFrame||result.frameCount!==task.outputFrames)return'wrong-task';
 if(result.finishedNs>task.deadlineNs)return'late';
 return'accept';
}
