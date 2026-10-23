/** External facts remain authoritative in their source system.
 * This bounded journal is an inspectable projection, never a task scheduler.
 * Domain names are open so economic and physical observatories share one wire format. */
export const ACTIVITY_FACT_SCHEMA='engine.activity.v1' as const;
export interface ActivityRef {readonly domain:string;readonly id:string}
export interface ActivityUsage {readonly tokens?:number;readonly costUsd?:number;readonly durationMs?:number}
export interface ActivityFact {
  readonly schema:typeof ACTIVITY_FACT_SCHEMA;
  readonly id:string;
  /** Milliseconds on the source timeline, UTC epoch for observed events. */
  readonly atMs:number;
  readonly actor:ActivityRef;
  /** Namespaced verb, e.g. agent.task.started or economy.trade.settled. */
  readonly kind:string;
  readonly origin:'observed'|'demo';
  readonly target?:ActivityRef;
  readonly causeId?:string;
  readonly label?:string;
  /** Incremental accounting, not cumulative totals. */
  readonly usage?:ActivityUsage;
}
const identifier=/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]*$/;
const domain=/^[a-z][a-z0-9-]*$/;
const verb=/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
function record(value:unknown,path:string):Record<string,unknown>{
  if(value===null||typeof value!=='object'||Array.isArray(value))throw new TypeError(path+' must be an object');
  const prototype=Object.getPrototypeOf(value);
  if(prototype!==Object.prototype&&prototype!==null)throw new TypeError(path+' must contain plain data');
  return value as Record<string,unknown>;
}
function keys(value:Record<string,unknown>,allowed:readonly string[],path:string):void{
  for(const key of Object.keys(value))if(!allowed.includes(key))throw new TypeError(path+'.'+key+' is not supported');
}
function string(value:unknown,path:string,pattern:RegExp,max=180):string{
  if(typeof value!=='string'||value.length===0||value.length>max||!pattern.test(value))throw new TypeError(path+' is not a valid bounded identifier');
  return value;
}
function nonnegative(value:unknown,path:string):number{
  if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw new TypeError(path+' must be finite and nonnegative');
  return value;
}
function ref(value:unknown,path:string):ActivityRef{
  const r=record(value,path);
  keys(r,['domain','id'],path);
  return Object.freeze({domain:string(r.domain,path+'.domain',domain,48),id:string(r.id,path+'.id',identifier)});
}
export function validateActivityFact(input:unknown):ActivityFact{
  const r=record(input,'ActivityFact');
  keys(r,['schema','id','atMs','actor','kind','origin','target','causeId','label','usage'],'ActivityFact');
  if(r.schema!==ACTIVITY_FACT_SCHEMA)throw new TypeError('Unsupported ActivityFact schema');
  if(r.origin!=='observed'&&r.origin!=='demo')throw new TypeError('ActivityFact.origin must distinguish observed facts from demos');
  const id=string(r.id,'ActivityFact.id',identifier);
  const atMs=nonnegative(r.atMs,'ActivityFact.atMs');
  if(!Number.isSafeInteger(atMs))throw new RangeError('ActivityFact.atMs must be an integer');
  const kind=string(r.kind,'ActivityFact.kind',verb,96);
  const actor=ref(r.actor,'ActivityFact.actor');
  const target=r.target===undefined?undefined:ref(r.target,'ActivityFact.target');
  const causeId=r.causeId===undefined?undefined:string(r.causeId,'ActivityFact.causeId',identifier);
  const label=r.label;
  if(label!==undefined&&(typeof label!=='string'||label.length>240||/[\u0000-\u001f\u007f]/.test(label)))
    throw new TypeError('ActivityFact.label must be printable and at most 240 characters');
  let usage:ActivityUsage|undefined;
  if(r.usage!==undefined){
    const u=record(r.usage,'ActivityFact.usage');keys(u,['tokens','costUsd','durationMs'],'ActivityFact.usage');
    const tokens=u.tokens===undefined?undefined:nonnegative(u.tokens,'usage.tokens');
    if(tokens!==undefined&&!Number.isSafeInteger(tokens))throw new RangeError('usage.tokens must be an integer');
    const costUsd=u.costUsd===undefined?undefined:nonnegative(u.costUsd,'usage.costUsd');
    const durationMs=u.durationMs===undefined?undefined:nonnegative(u.durationMs,'usage.durationMs');
    usage=Object.freeze({...tokens===undefined?{}:{tokens},...costUsd===undefined?{}:{costUsd},...durationMs===undefined?{}:{durationMs}});
  }
  return Object.freeze({schema:ACTIVITY_FACT_SCHEMA,id,atMs,actor,kind,origin:r.origin,
    ...(target?{target}:{}),...(causeId?{causeId}:{}),...(label!==undefined?{label}:{}),...(usage?{usage}:{})});
}
const order=(a:ActivityFact,b:ActivityFact)=>a.atMs-b.atMs||(a.id<b.id?-1:a.id>b.id?1:0);
export interface ActivityLineage {
  readonly chain:readonly ActivityFact[];
  /** A missing cause may have been evicted, or never delivered by the source. */
  readonly unresolvedCauseId?:string;
}
export class ActivityJournal {
  readonly capacity:number;
  private facts:ActivityFact[]=[];
  private byId=new Map<string,ActivityFact>();
  dropped=0;
  constructor(capacity=4096){
    if(!Number.isSafeInteger(capacity)||capacity<16||capacity>65536)throw new RangeError('Activity capacity must be 16..65536');
    this.capacity=capacity;
  }
  ingest(input:unknown):ActivityFact{return this.ingestMany([input])[0]!;}
  /** Batch validation is atomic: one malformed fact changes nothing. */
  ingestMany(input:readonly unknown[]):readonly ActivityFact[]{
    if(!Array.isArray(input)||input.length>this.capacity)throw new RangeError('Activity batch exceeds capacity');
    const validated=input.map(validateActivityFact),batch=new Set<string>();
    for(const fact of validated){
      if(batch.has(fact.id)||this.byId.has(fact.id))throw new TypeError('Duplicate ActivityFact: '+fact.id);
      batch.add(fact.id);
    }
    this.facts.push(...validated);
    this.facts.sort(order);
    if(this.facts.length>this.capacity){
      this.dropped+=this.facts.length-this.capacity;
      this.facts.splice(0,this.facts.length-this.capacity);
    }
    this.byId=new Map(this.facts.map(fact=>[fact.id,fact]));
    return validated;
  }
  has(id:string):boolean{return this.byId.has(id);}
  get(id:string):ActivityFact|undefined{return this.byId.get(id);}
  snapshot(asOfMs=Infinity):readonly ActivityFact[]{
    if(asOfMs!==Infinity&&(!Number.isFinite(asOfMs)||asOfMs<0))throw new RangeError('Invalid Activity timeline cursor');
    return Object.freeze(this.facts.filter(fact=>fact.atMs<=asOfMs));
  }
  lineage(id:string,maxDepth=64):ActivityLineage{
    if(!Number.isSafeInteger(maxDepth)||maxDepth<1||maxDepth>1024)throw new RangeError('Invalid lineage depth');
    const chain:ActivityFact[]=[],seen=new Set<string>();
    let cursor:string|undefined=id,unresolvedCauseId:string|undefined;
    while(cursor&&chain.length<maxDepth){
      if(seen.has(cursor)){unresolvedCauseId=cursor;break;}
      seen.add(cursor);
      const fact=this.byId.get(cursor);
      if(!fact){unresolvedCauseId=cursor;break;}
      chain.push(fact);cursor=fact.causeId;
    }
    if(cursor&&chain.length===maxDepth)unresolvedCauseId=cursor;
    return Object.freeze({chain:Object.freeze(chain),...(unresolvedCauseId?{unresolvedCauseId}:{})});
  }
  get stats(){return Object.freeze({retained:this.facts.length,capacity:this.capacity,dropped:this.dropped});}
}
