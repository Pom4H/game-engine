import {
 contentHash,
 type ContentAddressedRepository,
 type ContentRef,
 type ResourceManifest,
} from '../content/index.js';
import type {AuthorityGrant,AuthorityScope} from '../network/causal-authority.js';

export type CausalStorageKind='causal-state'|'causal-mutation-payload'|'causal-mutation'|'causal-checkpoint';
export type CausalRef<K extends CausalStorageKind=CausalStorageKind>=ContentRef<K>;

export interface CausalMutation {
 readonly schema:1;
 readonly scope:AuthorityScope;
 readonly ownerId:string;
 readonly epoch:number;
 readonly baseRevision:number;
 readonly revision:number;
 readonly tick:number;
 readonly time:number;
 readonly action:string;
 readonly payload:CausalRef<'causal-mutation-payload'>;
 readonly previous?:CausalRef<'causal-mutation'>;
}
export interface CausalCheckpoint {
 readonly schema:1;
 readonly scope:AuthorityScope;
 readonly ownerId:string;
 readonly epoch:number;
 readonly revision:number;
 readonly tick:number;
 readonly time:number;
 readonly state:CausalRef<'causal-state'>;
 readonly dependencies:ResourceManifest<string>;
 readonly logTail?:CausalRef<'causal-mutation'>;
 readonly parent?:CausalRef<'causal-checkpoint'>;
}
export interface CausalScopeHead {
 readonly schema:1;
 readonly scope:AuthorityScope;
 readonly ownerId:string;
 readonly epoch:number;
 readonly revision:number;
 readonly tick:number;
 readonly time:number;
 readonly checkpoint:CausalRef<'causal-checkpoint'>;
 readonly logTail?:CausalRef<'causal-mutation'>;
}
export interface ScopeHeadStore {
 read(scope:AuthorityScope):CausalScopeHead|undefined;
 compareAndSwap(expected:CausalScopeHead|undefined,next:CausalScopeHead):boolean;
 readonly size:number;
}
export interface CausalAppendInput<T=unknown>{readonly tick:number;readonly time:number;readonly action:string;readonly payload:T}
export interface CausalAppendResult{readonly decision:'accept'|'stale-head';readonly head:CausalScopeHead;readonly mutation?:CausalRef<'causal-mutation'>}
export interface CausalCheckpointResult{readonly decision:'accept'|'stale-head';readonly head:CausalScopeHead;readonly checkpoint?:CausalRef<'causal-checkpoint'>}
export interface RestoredMutation<T=unknown>{readonly record:CausalMutation;readonly payload:T}
export interface CausalRestore<TState=unknown,TMutation=unknown>{readonly head:CausalScopeHead;readonly checkpoint:CausalCheckpoint;readonly state:TState;readonly mutations:readonly RestoredMutation<TMutation>[]}
export interface CausalHydrationProof{
 readonly schema:1;readonly scope:AuthorityScope;readonly epoch:number;readonly revision:number;
 readonly checkpointHash:string;readonly logTailHash?:string;readonly stateHash:string;readonly proofHash:string;
}

const identity=(value:unknown,max=180):value is string=>typeof value==='string'&&value.length>0&&value.length<=max&&!['__proto__','constructor','prototype'].includes(value);
const natural=(value:number,label:string)=>{if(!Number.isSafeInteger(value)||value<0)throw new RangeError(label+' must be a non-negative safe integer');return value;};
const finiteTime=(value:number,label:string)=>{if(!Number.isFinite(value)||value<0)throw new RangeError(label+' must be finite and non-negative');return value;};
const stableScope=(scope:AuthorityScope):AuthorityScope=>{
 if(!scope||!identity(scope.domain,80)||!identity(scope.id,180))throw new TypeError('Causal storage scope requires stable domain and id');
 return Object.freeze({domain:scope.domain,id:scope.id});
};
const keyOf=(scope:AuthorityScope)=>scope.domain+'\0'+scope.id;
const sameScope=(a:AuthorityScope,b:AuthorityScope)=>a.domain===b.domain&&a.id===b.id;
const sameRef=(a:ContentRef<string>|undefined,b:ContentRef<string>|undefined)=>a?.kind===b?.kind&&a?.hash===b?.hash;
const validateRef=(ref:ContentRef<string>,kind?:string)=>{
 if(!ref||!identity(ref.kind,80)||!identity(ref.hash,256))throw new TypeError('Invalid content reference');
 if(kind!==undefined&&ref.kind!==kind)throw new TypeError('Expected '+kind+' content reference');
};
const freezeRef=<K extends string>(ref:ContentRef<K>):ContentRef<K>=>Object.freeze({kind:ref.kind,hash:ref.hash});
const validateHead=(head:CausalScopeHead):void=>{
 if(!head||head.schema!==1||!identity(head.ownerId))throw new TypeError('Invalid causal scope head');
 stableScope(head.scope);natural(head.epoch,'head.epoch');natural(head.revision,'head.revision');natural(head.tick,'head.tick');finiteTime(head.time,'head.time');
 validateRef(head.checkpoint,'causal-checkpoint');if(head.logTail)validateRef(head.logTail,'causal-mutation');
};
const freezeHead=(head:CausalScopeHead):CausalScopeHead=>{
 validateHead(head);
 return Object.freeze({
  schema:1,scope:stableScope(head.scope),ownerId:head.ownerId,epoch:head.epoch,revision:head.revision,tick:head.tick,time:head.time,
  checkpoint:freezeRef(head.checkpoint),...(head.logTail?{logTail:freezeRef(head.logTail)}:{}),
 });
};
const sameHead=(a:CausalScopeHead,b:CausalScopeHead)=>sameScope(a.scope,b.scope)&&a.ownerId===b.ownerId&&a.epoch===b.epoch&&a.revision===b.revision&&a.tick===b.tick&&a.time===b.time&&sameRef(a.checkpoint,b.checkpoint)&&sameRef(a.logTail,b.logTail);
const validateGrant=(grant:AuthorityGrant):void=>{
 if(!grant||!identity(grant.ownerId))throw new TypeError('Invalid authority grant');
 stableScope(grant.scope);natural(grant.epoch,'grant.epoch');natural(grant.revision,'grant.revision');
};

export class MemoryScopeHeadStore implements ScopeHeadStore{
 private readonly heads=new Map<string,CausalScopeHead>();
 constructor(readonly maxScopes=8192){if(!Number.isSafeInteger(maxScopes)||maxScopes<1||maxScopes>1_000_000)throw new RangeError('Invalid head-store capacity');}
 read(scope:AuthorityScope):CausalScopeHead|undefined{const stable=stableScope(scope);return this.heads.get(keyOf(stable));}
 compareAndSwap(expected:CausalScopeHead|undefined,next:CausalScopeHead):boolean{
  const prepared=freezeHead(next),key=keyOf(prepared.scope),current=this.heads.get(key);
  if(expected===undefined){if(current)return false;if(this.heads.size>=this.maxScopes)throw new RangeError('Head-store capacity exceeded');this.heads.set(key,prepared);return true;}
  validateHead(expected);if(!sameScope(expected.scope,prepared.scope)||!current||!sameHead(current,expected))return false;
  this.heads.set(key,prepared);return true;
 }
 get size(){return this.heads.size;}
}

/** Immutable CAS blobs + one compare-and-swap head per causal scope. */
export class CausalStorage{
 constructor(readonly content:ContentAddressedRepository<string>,readonly heads:ScopeHeadStore){}

 bootstrap<T>(grant:AuthorityGrant,state:T,input:{readonly tick:number;readonly time:number;readonly dependencies?:readonly ContentRef<string>[]}):CausalScopeHead{
  validateGrant(grant);natural(input.tick,'bootstrap.tick');finiteTime(input.time,'bootstrap.time');
  const dependencies=this.content.manifest(input.dependencies??[]),stateRef=this.put('causal-state',state);
  const checkpoint:CausalCheckpoint=Object.freeze({
   schema:1,scope:stableScope(grant.scope),ownerId:grant.ownerId,epoch:grant.epoch,revision:grant.revision,tick:input.tick,time:input.time,state:stateRef,dependencies,
  });
  const checkpointRef=this.put('causal-checkpoint',checkpoint),head=freezeHead({
   schema:1,scope:grant.scope,ownerId:grant.ownerId,epoch:grant.epoch,revision:grant.revision,tick:input.tick,time:input.time,checkpoint:checkpointRef,
  });
  if(!this.heads.compareAndSwap(undefined,head))throw new Error('Causal scope already has a head');
  return head;
 }

 append<T>(expected:CausalScopeHead,input:CausalAppendInput<T>):CausalAppendResult{
  validateHead(expected);natural(input.tick,'mutation.tick');finiteTime(input.time,'mutation.time');
  if(input.tick<expected.tick||input.time<expected.time)throw new RangeError('Causal mutation cannot go backwards in time');
  if(!identity(input.action))throw new TypeError('Causal mutation requires a stable action');
  if(expected.revision===Number.MAX_SAFE_INTEGER)throw new RangeError('Causal revision exhausted');
  const payload=this.put('causal-mutation-payload',input.payload);
  const record:CausalMutation=Object.freeze({
   schema:1,scope:stableScope(expected.scope),ownerId:expected.ownerId,epoch:expected.epoch,baseRevision:expected.revision,revision:expected.revision+1,
   tick:input.tick,time:input.time,action:input.action,payload,...(expected.logTail?{previous:expected.logTail}:{}),
  });
  const mutation=this.put('causal-mutation',record),next=freezeHead({...expected,revision:record.revision,tick:input.tick,time:input.time,logTail:mutation});
  if(!this.heads.compareAndSwap(expected,next))return Object.freeze({decision:'stale-head',head:this.heads.read(expected.scope)??expected});
  return Object.freeze({decision:'accept',head:next,mutation});
 }

 checkpoint<T>(expected:CausalScopeHead,state:T,dependencies:readonly ContentRef<string>[]=[]):CausalCheckpointResult{
  validateHead(expected);const manifest=this.content.manifest(dependencies),stateRef=this.put('causal-state',state);
  const value:CausalCheckpoint=Object.freeze({
   schema:1,scope:stableScope(expected.scope),ownerId:expected.ownerId,epoch:expected.epoch,revision:expected.revision,tick:expected.tick,time:expected.time,
   state:stateRef,dependencies:manifest,...(expected.logTail?{logTail:expected.logTail}:{}),parent:expected.checkpoint,
  });
  const checkpoint=this.put('causal-checkpoint',value),next=freezeHead({...expected,checkpoint});
  if(!this.heads.compareAndSwap(expected,next))return Object.freeze({decision:'stale-head',head:this.heads.read(expected.scope)??expected});
  return Object.freeze({decision:'accept',head:next,checkpoint});
 }

 restore<TState=unknown,TMutation=unknown>(head:CausalScopeHead):CausalRestore<TState,TMutation>{
  validateHead(head);return this.restoreFrom<TState,TMutation>(this.content,head);
 }

 replicate(head:CausalScopeHead,target:ContentAddressedRepository<string>):CausalHydrationProof{
  validateHead(head);const restored=this.restore(head);
  this.copy(restored.checkpoint.state,target);
  for(const ref of restored.checkpoint.dependencies.resources)this.copy(ref,target);
  for(const item of restored.mutations){this.copy(item.record.payload,target);this.copy(this.mutationRef(item.record),target);}
  this.copy(head.checkpoint,target);
  const verified=this.restoreFrom(target,head);
  const raw={schema:1 as const,scope:stableScope(head.scope),epoch:head.epoch,revision:head.revision,checkpointHash:head.checkpoint.hash,...(head.logTail?{logTailHash:head.logTail.hash}:{}),stateHash:verified.checkpoint.state.hash};
  return Object.freeze({...raw,proofHash:contentHash(raw,'hydration')});
 }

 handoff(expected:CausalScopeHead,toOwnerId:string,proof:CausalHydrationProof):CausalScopeHead{
  validateHead(expected);if(!identity(toOwnerId)||toOwnerId===expected.ownerId)throw new TypeError('Handoff requires a distinct stable owner');
  if(expected.epoch===Number.MAX_SAFE_INTEGER)throw new RangeError('Causal epoch exhausted');
  this.validateProof(expected,proof);
  const next=freezeHead({...expected,ownerId:toOwnerId,epoch:expected.epoch+1});
  if(!this.heads.compareAndSwap(expected,next))throw new Error('Causal head changed during handoff');
  return next;
 }

 private restoreFrom<TState,TMutation>(content:ContentAddressedRepository<string>,head:CausalScopeHead):CausalRestore<TState,TMutation>{
  const checkpoint=content.require<CausalCheckpoint>(head.checkpoint.hash);this.validateCheckpoint(checkpoint,head);
  const state=content.require<TState>(checkpoint.state.hash);
  for(const dependency of checkpoint.dependencies.resources)content.require(dependency.hash);
  const stop=checkpoint.logTail?.hash,backwards:RestoredMutation<TMutation>[]=[];let cursor=head.logTail,guard=0;
  while(cursor&&cursor.hash!==stop){
   if(++guard>Math.max(1,head.revision-checkpoint.revision+1))throw new Error('Causal mutation chain exceeds revision span');
   const record=content.require<CausalMutation>(cursor.hash);this.validateMutation(record,head.scope);
   const payload=content.require<TMutation>(record.payload.hash);backwards.push(Object.freeze({record,payload}));cursor=record.previous;
  }
  if((cursor?.hash??null)!==(stop??null))throw new Error('Causal mutation chain does not reach checkpoint');
  const mutations=backwards.reverse();let revision=checkpoint.revision;
  for(const item of mutations){if(item.record.baseRevision!==revision||item.record.revision!==revision+1)throw new Error('Causal mutation revisions are not contiguous');revision=item.record.revision;}
  if(revision!==head.revision)throw new Error('Restored causal revision does not match head');
  return Object.freeze({head,checkpoint,state,mutations:Object.freeze(mutations)});
 }

 private validateCheckpoint(checkpoint:CausalCheckpoint,head:CausalScopeHead):void{
  if(!checkpoint||checkpoint.schema!==1||!sameScope(checkpoint.scope,head.scope)||!identity(checkpoint.ownerId))throw new TypeError('Invalid causal checkpoint');
  natural(checkpoint.epoch,'checkpoint.epoch');natural(checkpoint.revision,'checkpoint.revision');natural(checkpoint.tick,'checkpoint.tick');finiteTime(checkpoint.time,'checkpoint.time');
  if(checkpoint.revision>head.revision||checkpoint.tick>head.tick||checkpoint.time>head.time)throw new Error('Checkpoint is newer than scope head');
  validateRef(checkpoint.state,'causal-state');if(checkpoint.logTail)validateRef(checkpoint.logTail,'causal-mutation');if(checkpoint.parent)validateRef(checkpoint.parent,'causal-checkpoint');
  if(!checkpoint.dependencies||!Array.isArray(checkpoint.dependencies.resources))throw new TypeError('Checkpoint requires a dependency manifest');
 }
 private validateMutation(record:CausalMutation,scope:AuthorityScope):void{
  if(!record||record.schema!==1||!sameScope(record.scope,scope)||!identity(record.ownerId)||!identity(record.action))throw new TypeError('Invalid causal mutation');
  natural(record.epoch,'mutation.epoch');natural(record.baseRevision,'mutation.baseRevision');natural(record.revision,'mutation.revision');natural(record.tick,'mutation.tick');finiteTime(record.time,'mutation.time');
  if(record.revision!==record.baseRevision+1)throw new Error('Mutation must advance exactly one revision');
  validateRef(record.payload,'causal-mutation-payload');if(record.previous)validateRef(record.previous,'causal-mutation');
 }
 private validateProof(expected:CausalScopeHead,proof:CausalHydrationProof):void{
  if(!proof||proof.schema!==1||!sameScope(proof.scope,expected.scope)||proof.epoch!==expected.epoch||proof.revision!==expected.revision||proof.checkpointHash!==expected.checkpoint.hash||(proof.logTailHash??null)!==(expected.logTail?.hash??null))throw new Error('Hydration proof does not match causal head');
  const checkpoint=this.content.require<CausalCheckpoint>(expected.checkpoint.hash);
  if(proof.stateHash!==checkpoint.state.hash)throw new Error('Hydration proof state hash mismatch');
  const raw={schema:1 as const,scope:stableScope(expected.scope),epoch:expected.epoch,revision:expected.revision,checkpointHash:expected.checkpoint.hash,...(expected.logTail?{logTailHash:expected.logTail.hash}:{}),stateHash:checkpoint.state.hash};
  if(proof.proofHash!==contentHash(raw,'hydration'))throw new Error('Hydration proof hash mismatch');
 }
 private copy(ref:ContentRef<string>,target:ContentAddressedRepository<string>):void{
  validateRef(ref);const value=this.content.require(ref.hash),copied=target.put(ref.kind,value);if(copied.hash!==ref.hash)throw new Error('Replicated content hash mismatch');
 }
 private mutationRef(record:CausalMutation):CausalRef<'causal-mutation'>{
  const hash=contentHash({kind:'causal-mutation',value:record}),ref=this.content.ref(hash);if(!ref||ref.kind!=='causal-mutation')throw new Error('Mutation record is not present in source CAS');
  return ref as CausalRef<'causal-mutation'>;
 }
 private put<K extends CausalStorageKind,T>(kind:K,value:T):CausalRef<K>{return this.content.put(kind,value) as CausalRef<K>;}
}
