import {AuthoritySession,type AuthorityAdapter, type DebugAction} from './authority.js';
import {Projection,type Frame} from './projection.js';

export interface MeshworkShardAssignment {
 readonly shard:{readonly id:string;readonly epoch:number;readonly startTick:number};
 readonly leaseId:string;
 readonly leaseUntil:number;
 readonly resumeTick:number;
 readonly snapshotHash?:string;
 readonly publication?:unknown;
}
export interface MeshworkShardRevoke {
 readonly type:'shard.revoke';
 readonly shardId:string;
 readonly leaseId:string;
 readonly epoch:number;
 readonly reason:string;
}
export interface MeshworkShardHeartbeat {
 readonly type:'shard.heartbeat';
 readonly workerId:string;
 readonly shardId:string;
 readonly leaseId:string;
 readonly epoch:number;
 readonly tick:number;
}
export interface MeshworkShardPublication {
 readonly type:'shard.publish';
 readonly shardId:string;
 readonly leaseId:string;
 readonly epoch:number;
 readonly tick:number;
 readonly snapshotHash?:string;
 readonly output:Frame;
}

function identity(value:string,label:string):void{
 if(!value||value.length>160)throw new TypeError(`Invalid ${label}`);
}
function previousSequence(input:unknown,epoch:number,tick:number):number{
 if(input===undefined)return 0;
 if(!input||typeof input!=='object')throw new TypeError('Invalid shard publication');
 const frame=input as Partial<Frame>,sequence=frame.sequence;
 if(frame.epoch!==epoch||frame.tick!==tick||typeof sequence!=='number'||!Number.isSafeInteger(sequence)||sequence<0)throw new TypeError('Shard publication does not match resume fence');
 return sequence;
}

/** Transport-neutral adapter between a Meshwork shard lease and AuthoritySession.
 * The caller restores the bounded world snapshot before construction; this class
 * refuses a lease whose epoch/tick do not exactly match that restored authority.
 * Meshwork remains responsible for lease expiry and stale-owner rejection. */
export class AuthorityShardLease {
 private active=true;
 readonly session:AuthoritySession;
 constructor(
  readonly workerId:string,
  readonly assignment:MeshworkShardAssignment,
  world:AuthorityAdapter,
  projection:Projection,
  options:{
   readonly authorize?:(peer:string,action:DebugAction)=>boolean;
   readonly stepSeconds?:number;
  }={},
 ){
  identity(workerId,'worker id');identity(assignment.shard.id,'shard id');identity(assignment.leaseId,'lease id');
  if(!Number.isSafeInteger(assignment.shard.epoch)||assignment.shard.epoch<0||
     !Number.isSafeInteger(assignment.shard.startTick)||assignment.shard.startTick<0||
     !Number.isSafeInteger(assignment.resumeTick)||assignment.resumeTick<assignment.shard.startTick||
     !Number.isFinite(assignment.leaseUntil))throw new TypeError('Invalid shard lease');
  if(world.tick!==assignment.resumeTick)throw new Error(`Shard resume tick ${assignment.resumeTick} does not match restored world tick ${world.tick}`);
  const sequence=previousSequence(assignment.publication,assignment.shard.epoch,assignment.resumeTick);
  this.session=new AuthoritySession(
   world,projection,assignment.shard.epoch,
   options.authorize,options.stepSeconds,sequence,
  );
 }
 private assertActive():void{if(!this.active)throw new Error('Shard lease revoked');}
 advance(count=1):number{
  this.assertActive();
  this.session.paused=false;
  return this.session.advance(count);
 }
 heartbeat():MeshworkShardHeartbeat{
  this.assertActive();
  return{type:'shard.heartbeat',workerId:this.workerId,shardId:this.assignment.shard.id,leaseId:this.assignment.leaseId,epoch:this.assignment.shard.epoch,tick:this.session.world.tick};
 }
 publish(snapshotHash?:string):MeshworkShardPublication{
  this.assertActive();
  const publication=this.session.publish();
  return{type:'shard.publish',shardId:this.assignment.shard.id,leaseId:this.assignment.leaseId,epoch:this.assignment.shard.epoch,tick:this.session.world.tick,...(snapshotHash!==undefined?{snapshotHash}:{}),output:publication.frame};
 }
 revoke(message:MeshworkShardRevoke):boolean{
  if(message.shardId!==this.assignment.shard.id||message.leaseId!==this.assignment.leaseId||message.epoch!==this.assignment.shard.epoch)return false;
  this.active=false;this.session.paused=true;return true;
 }
 get revoked():boolean{return !this.active;}
}
