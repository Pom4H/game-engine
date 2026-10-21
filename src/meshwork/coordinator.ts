import {defineSegmentTask,decideSegmentResult,type MeshAttemptDecision,type MeshRenderSegmentResult,type MeshRenderSegmentTask} from './protocol.js';

export interface MeshTaskLease{readonly leaseId:string;readonly workerId:string;readonly task:MeshRenderSegmentTask;readonly expiresNs:bigint}
interface TaskState{task:MeshRenderSegmentTask;preferredWorkerId?:string;lease?:MeshTaskLease;committed:boolean;missed:boolean}
const keyOf=(task:MeshRenderSegmentTask)=>task.streamId+'\0'+task.epoch+'\0'+task.segment;
const minBig=(a:bigint,b:bigint)=>a<b?a:b;

export class MeshLeasePool{
 private readonly tasks=new Map<string,TaskState>();
 constructor(readonly epoch:bigint){if(epoch<0n)throw new RangeError('Epoch must be non-negative');}
 add(task:MeshRenderSegmentTask,preferredWorkerId?:string):this{
  if(task.epoch!==this.epoch)throw new TypeError('Task belongs to another epoch');const key=keyOf(task);if(this.tasks.has(key))throw new TypeError('Duplicate mesh segment');
  this.tasks.set(key,{task,...(preferredWorkerId?{preferredWorkerId}:{}),committed:false,missed:false});return this;
 }
 claim(workerId:string,nowNs:bigint,leaseDurationNs:bigint):MeshTaskLease|undefined{
  if(!workerId||nowNs<0n||leaseDurationNs<=0n)throw new RangeError('Invalid lease claim');this.expire(nowNs);
  const available=[...this.tasks.values()].filter(state=>!state.committed&&!state.missed&&!state.lease&&state.task.deadlineNs>nowNs);
  const own=available.filter(state=>state.preferredWorkerId===workerId),unassigned=available.filter(state=>!state.preferredWorkerId);
  const candidates=(own.length?own:unassigned.length?unassigned:available).sort((a,b)=>a.task.segment<b.task.segment?-1:a.task.segment>b.task.segment?1:0);
  const state=candidates[0];if(!state)return undefined;
  const expiresNs=minBig(nowNs+leaseDurationNs,state.task.deadlineNs),lease=Object.freeze({leaseId:keyOf(state.task)+'\0'+state.task.attempt+'\0'+workerId,workerId,task:state.task,expiresNs});
  state.lease=lease;return lease;
 }
 heartbeat(lease:MeshTaskLease,nowNs:bigint,extendNs:bigint):MeshTaskLease{
  const state=this.tasks.get(keyOf(lease.task));if(!state?.lease||state.lease.leaseId!==lease.leaseId||state.committed||state.missed)throw new Error('Lease is no longer active');
  if(nowNs>state.task.deadlineNs){state.missed=true;delete state.lease;throw new Error('Task deadline passed');}
  if(nowNs>state.lease.expiresNs)throw new Error('Lease expired');if(extendNs<=0n)throw new RangeError('Heartbeat extension must be positive');
  const renewed=Object.freeze({...state.lease,expiresNs:minBig(nowNs+extendNs,state.task.deadlineNs)});state.lease=renewed;return renewed;
 }
 accept(lease:MeshTaskLease,result:MeshRenderSegmentResult,nowNs:bigint):MeshAttemptDecision{
  const state=this.tasks.get(keyOf(lease.task));if(!state)return'wrong-task';if(state.committed)return'already-committed';if(state.missed)return'late';
  if(!state.lease||state.lease.leaseId!==lease.leaseId||state.lease.workerId!==lease.workerId)return'wrong-task';
  if(nowNs>state.task.deadlineNs){state.missed=true;delete state.lease;return'late';}
  if(nowNs>state.lease.expiresNs){this.expire(nowNs);return'wrong-task';}
  const decision=decideSegmentResult(state.task,result,this.epoch,false);if(decision==='accept'){state.committed=true;delete state.lease;}return decision;
 }
 expire(nowNs:bigint):number{
  let affected=0;
  for(const state of this.tasks.values()){
   if(state.committed||state.missed)continue;
   if(nowNs>state.task.deadlineNs){state.missed=true;if(state.lease)delete state.lease;affected++;continue;}
   if(state.lease&&nowNs>state.lease.expiresNs){state.task=defineSegmentTask({...state.task,attempt:state.task.attempt+1});delete state.lease;affected++;}
  }
  return affected;
 }
 get pending(){return[...this.tasks.values()].filter(state=>!state.committed&&!state.missed).length;}
 get committed(){return[...this.tasks.values()].filter(state=>state.committed).length;}
 get missed(){return[...this.tasks.values()].filter(state=>state.missed).length;}
}

export class OrderedSegmentAssembler{
 private readonly waiting=new Map<bigint,MeshRenderSegmentResult>();private nextFrame:bigint;
 constructor(firstFrame:bigint){if(firstFrame<0n)throw new RangeError('Assembler first frame must be non-negative');this.nextFrame=firstFrame;}
 push(result:MeshRenderSegmentResult):void{
  if(result.firstFrame<this.nextFrame)throw new TypeError('Segment overlaps already assembled output');if(this.waiting.has(result.firstFrame))throw new TypeError('Duplicate segment start');
  const end=result.firstFrame+BigInt(result.frameCount);for(const existing of this.waiting.values()){const existingEnd=existing.firstFrame+BigInt(existing.frameCount);if(result.firstFrame<existingEnd&&existing.firstFrame<end)throw new TypeError('Overlapping segment ranges');}
  this.waiting.set(result.firstFrame,result);
 }
 drainReady():readonly MeshRenderSegmentResult[]{
  const ready:MeshRenderSegmentResult[]=[];for(;;){const result=this.waiting.get(this.nextFrame);if(!result)break;this.waiting.delete(this.nextFrame);ready.push(result);this.nextFrame+=BigInt(result.frameCount);}return Object.freeze(ready);
 }
 get nextOutputFrame(){return this.nextFrame;}
 get buffered(){return this.waiting.size;}
}
