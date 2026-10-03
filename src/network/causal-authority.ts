export interface AuthorityClock{readonly tick:number;readonly time:number}
export interface AuthorityScope{readonly domain:string;readonly id:string}
export interface AuthorityGrant{
 readonly scope:AuthorityScope;readonly ownerId:string;readonly epoch:number;readonly revision:number;
}
export interface AuthorityProposal<T=unknown>{
 readonly proposalId:string;readonly scope:AuthorityScope;readonly ownerId:string;readonly epoch:number;readonly baseRevision:number;
 readonly observedTick:number;readonly validThroughTick?:number;readonly action:string;readonly payload:T;readonly evidence?:readonly string[];
}
export interface AuthorityCommitContext extends AuthorityGrant{readonly tick:number;readonly time:number}
export interface AuthorityCommitAdapter<T>{
 /** Pure validation. Returning false rejects the proposal without touching world state. */
 readonly validate:(payload:Readonly<T>,context:AuthorityCommitContext)=>boolean;
 /** Must commit atomically. It runs only after every authority/invariant gate succeeds. */
 readonly apply:(payload:Readonly<T>,context:AuthorityCommitContext)=>void;
}
export type AuthorityCommitDecision='accept'|'unknown-scope'|'wrong-owner'|'stale-epoch'|'stale-revision'|'future-tick'|'expired'|'duplicate'|'invariant-rejected';

export interface AuthorityClaimRecord{
 readonly kind:'claim';readonly sequence:number;readonly scope:AuthorityScope;readonly ownerId:string;readonly epoch:number;readonly revision:number;readonly tick:number;readonly time:number;
}
export interface AuthorityHandoffRecord{
 readonly kind:'handoff';readonly sequence:number;readonly scope:AuthorityScope;readonly fromOwnerId:string;readonly toOwnerId:string;
 readonly previousEpoch:number;readonly epoch:number;readonly revision:number;readonly tick:number;readonly time:number;
}
export interface AuthorityCommitRecord{
 readonly kind:'commit';readonly sequence:number;readonly scope:AuthorityScope;readonly ownerId:string;readonly epoch:number;
 readonly previousRevision:number;readonly revision:number;readonly proposalId:string;readonly action:string;readonly observedTick:number;
 readonly tick:number;readonly time:number;readonly evidence:readonly string[];
}
export type AuthorityRecord=AuthorityClaimRecord|AuthorityHandoffRecord|AuthorityCommitRecord;
export interface AuthorityCommitResult{readonly decision:AuthorityCommitDecision;readonly grant?:AuthorityGrant;readonly record?:AuthorityCommitRecord}
export interface CausalAuthorityStats{
 readonly scopes:number;readonly ledgerRecords:number;readonly sequence:number;readonly accepted:number;readonly rejected:number;readonly handoffs:number;
}

interface ScopeState{readonly scope:AuthorityScope;ownerId:string;epoch:number;revision:number}
const identity=(value:unknown,max=180):value is string=>typeof value==='string'&&value.length>0&&value.length<=max&&!['__proto__','constructor','prototype'].includes(value);
const natural=(value:number,label:string)=>{if(!Number.isSafeInteger(value)||value<0)throw new RangeError(label+' must be a non-negative safe integer');return value;};
const scopeKey=(scope:AuthorityScope)=>scope.domain+'\0'+scope.id;
const stableScope=(scope:AuthorityScope):AuthorityScope=>{
 if(!scope||!identity(scope.domain,80)||!identity(scope.id,180))throw new TypeError('Authority scope requires stable domain and id');
 return Object.freeze({domain:scope.domain,id:scope.id});
};
const validateOwner=(ownerId:string)=>{if(!identity(ownerId,180))throw new TypeError('Authority owner requires a stable id');return ownerId;};
const validateEvidence=(evidence:readonly string[]|undefined):readonly string[]=>{
 if(!evidence)return Object.freeze([]);
 if(!Array.isArray(evidence)||evidence.length>16||evidence.some(item=>!identity(item,256)))throw new TypeError('Authority evidence must contain at most 16 stable ids');
 return Object.freeze([...evidence]);
};

/**
 * Minimal server-side source of truth for distributed simulation.
 *
 * Meshwork/execution decide where work runs. CausalAuthority decides whether a
 * result is still allowed to mutate authoritative state. Per-scope epochs fence
 * handoffs; per-scope revisions fence concurrent/stale results.
 */
export class CausalAuthority{
 private readonly scopes=new Map<string,ScopeState>();
 private readonly ring:(AuthorityRecord|undefined)[];
 private ringStart=0;private ringCount=0;private sequence=0;
 private readonly recentProposalIds=new Set<string>();private readonly proposalRing:(string|undefined)[];private proposalStart=0;private proposalCount=0;
 private accepted=0;private rejected=0;private handoffs=0;
 constructor(readonly clock:AuthorityClock,readonly maxScopes=8192,readonly maxLedgerRecords=65536){
  if(!clock||!Number.isSafeInteger(maxScopes)||maxScopes<1||maxScopes>1_000_000||!Number.isSafeInteger(maxLedgerRecords)||maxLedgerRecords<1||maxLedgerRecords>1_000_000)throw new RangeError('Invalid causal authority capacity');
  this.ring=Array<AuthorityRecord|undefined>(maxLedgerRecords);this.proposalRing=Array<string|undefined>(maxLedgerRecords);
  this.readClock();
 }
 claim(scope:AuthorityScope,ownerId:string):AuthorityGrant{
  const stable=stableScope(scope),key=scopeKey(stable);validateOwner(ownerId);
  if(this.scopes.has(key))throw new TypeError('Authority scope is already claimed');
  if(this.scopes.size>=this.maxScopes)throw new RangeError('Authority scope capacity exceeded');
  const state:ScopeState={scope:stable,ownerId,epoch:1,revision:0};this.scopes.set(key,state);
  const at=this.readClock();this.append(Object.freeze({kind:'claim',sequence:++this.sequence,scope:stable,ownerId,epoch:state.epoch,revision:state.revision,...at}));
  return this.snapshot(state);
 }
 grant(scope:AuthorityScope):AuthorityGrant|undefined{
  const stable=stableScope(scope),state=this.scopes.get(scopeKey(stable));return state?this.snapshot(state):undefined;
 }
 handoff(current:AuthorityGrant,toOwnerId:string):AuthorityGrant{
  validateOwner(toOwnerId);const state=this.requireCurrentGrant(current);
  if(state.ownerId===toOwnerId)throw new TypeError('Authority handoff requires a different owner');
  if(state.epoch===Number.MAX_SAFE_INTEGER)throw new RangeError('Authority epoch exhausted');
  const fromOwnerId=state.ownerId,previousEpoch=state.epoch;state.ownerId=toOwnerId;state.epoch++;this.handoffs++;
  const at=this.readClock();this.append(Object.freeze({kind:'handoff',sequence:++this.sequence,scope:state.scope,fromOwnerId,toOwnerId,previousEpoch,epoch:state.epoch,revision:state.revision,...at}));
  return this.snapshot(state);
 }
 commit<T>(proposal:AuthorityProposal<T>,adapter:AuthorityCommitAdapter<T>):AuthorityCommitResult{
  this.validateProposal(proposal);if(!adapter||typeof adapter.validate!=='function'||typeof adapter.apply!=='function')throw new TypeError('Authority commit requires validate/apply adapter');
  if(this.recentProposalIds.has(proposal.proposalId))return this.reject('duplicate');
  const state=this.scopes.get(scopeKey(proposal.scope));if(!state)return this.reject('unknown-scope');
  if(proposal.epoch!==state.epoch)return this.reject('stale-epoch',state);
  if(proposal.ownerId!==state.ownerId)return this.reject('wrong-owner',state);
  if(proposal.baseRevision!==state.revision)return this.reject('stale-revision',state);
  const at=this.readClock();
  if(proposal.observedTick>at.tick)return this.reject('future-tick',state);
  if(proposal.validThroughTick!==undefined&&at.tick>proposal.validThroughTick)return this.reject('expired',state);
  const context=Object.freeze({...this.snapshot(state),tick:at.tick,time:at.time});
  if(!adapter.validate(proposal.payload,context))return this.reject('invariant-rejected',state);
  adapter.apply(proposal.payload,context);
  if(state.revision===Number.MAX_SAFE_INTEGER)throw new RangeError('Authority revision exhausted');
  const previousRevision=state.revision;state.revision++;this.accepted++;
  this.rememberProposal(proposal.proposalId);
  const record:AuthorityCommitRecord=Object.freeze({
   kind:'commit',sequence:++this.sequence,scope:state.scope,ownerId:state.ownerId,epoch:state.epoch,previousRevision,revision:state.revision,
   proposalId:proposal.proposalId,action:proposal.action,observedTick:proposal.observedTick,tick:at.tick,time:at.time,evidence:validateEvidence(proposal.evidence),
  });
  this.append(record);return Object.freeze({decision:'accept',grant:this.snapshot(state),record});
 }
 ledger(afterSequence=0):readonly AuthorityRecord[]{
  natural(afterSequence,'afterSequence');const result:AuthorityRecord[]=[];
  for(let i=0;i<this.ringCount;i++){const record=this.ring[(this.ringStart+i)%this.maxLedgerRecords]!;if(record.sequence>afterSequence)result.push(record);}
  return Object.freeze(result);
 }
 inspect():CausalAuthorityStats{return Object.freeze({scopes:this.scopes.size,ledgerRecords:this.ringCount,sequence:this.sequence,accepted:this.accepted,rejected:this.rejected,handoffs:this.handoffs});}
 private reject(decision:Exclude<AuthorityCommitDecision,'accept'>,state?:ScopeState):AuthorityCommitResult{
  this.rejected++;return Object.freeze({decision,...(state?{grant:this.snapshot(state)}:{})});
 }
 private requireCurrentGrant(grant:AuthorityGrant):ScopeState{
  if(!grant)throw new TypeError('Authority grant is required');const scope=stableScope(grant.scope),state=this.scopes.get(scopeKey(scope));
  natural(grant.epoch,'grant.epoch');natural(grant.revision,'grant.revision');validateOwner(grant.ownerId);
  if(!state||grant.ownerId!==state.ownerId||grant.epoch!==state.epoch||grant.revision!==state.revision)throw new Error('Authority grant is stale');
  return state;
 }
 private validateProposal<T>(proposal:AuthorityProposal<T>):void{
  if(!proposal||!identity(proposal.proposalId,220)||!identity(proposal.action,180))throw new TypeError('Authority proposal requires stable identity and action');
  stableScope(proposal.scope);validateOwner(proposal.ownerId);natural(proposal.epoch,'proposal.epoch');natural(proposal.baseRevision,'proposal.baseRevision');natural(proposal.observedTick,'proposal.observedTick');
  if(proposal.validThroughTick!==undefined){natural(proposal.validThroughTick,'proposal.validThroughTick');if(proposal.validThroughTick<proposal.observedTick)throw new RangeError('Proposal validity cannot end before observation');}
  validateEvidence(proposal.evidence);
 }
 private readClock():{readonly tick:number;readonly time:number}{
  const tick=this.clock.tick,time=this.clock.time;natural(tick,'authority clock tick');if(!Number.isFinite(time)||time<0)throw new RangeError('Authority clock time must be finite and non-negative');return{tick,time};
 }
 private snapshot(state:ScopeState):AuthorityGrant{return Object.freeze({scope:state.scope,ownerId:state.ownerId,epoch:state.epoch,revision:state.revision});}
 private append(record:AuthorityRecord):void{
  if(this.ringCount<this.maxLedgerRecords){this.ring[(this.ringStart+this.ringCount)%this.maxLedgerRecords]=record;this.ringCount++;return;}
  this.ring[this.ringStart]=record;this.ringStart=(this.ringStart+1)%this.maxLedgerRecords;
 }
 private rememberProposal(id:string):void{
  this.recentProposalIds.add(id);
  if(this.proposalCount<this.maxLedgerRecords){this.proposalRing[(this.proposalStart+this.proposalCount)%this.maxLedgerRecords]=id;this.proposalCount++;return;}
  const old=this.proposalRing[this.proposalStart];if(old!==undefined)this.recentProposalIds.delete(old);
  this.proposalRing[this.proposalStart]=id;this.proposalStart=(this.proposalStart+1)%this.maxLedgerRecords;
 }
}
