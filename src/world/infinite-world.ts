import type {WorldTileDemand} from './tiles.js';

export type InfiniteWorldTileState='loading'|'ready';
export interface InfiniteWorldHooks<T>{
  /** Heavy generation must run in a worker; returning a Promise does not offload it. */
  readonly generate:(demand:WorldTileDemand,signal:AbortSignal)=>T|Promise<T>;
  /** Bounded, synchronous publication. A throwing install is rolled back by uninstall. */
  readonly install?:(demand:WorldTileDemand,value:T)=>void;
  /** Detach a published or partially installed value. Must tolerate partial install. */
  readonly uninstall?:(demand:WorldTileDemand,value:T)=>void;
  /**
   * Release EVERY generated payload, including late/cancelled results, exactly once.
   * Resource-owning adapters must supply this hook. When supplied, uninstall only
   * detaches: it must not also destroy the same payload. Without release, legacy
   * uninstall ownership is preserved, but late GPU/native resources cannot be freed.
   */
  readonly release?:(demand:WorldTileDemand,value:T)=>void;
  readonly onError?:(demand:WorldTileDemand,error:unknown)=>void;
}
export interface InfiniteWorldOptions{
  readonly maxResident?:number;
  readonly maxConcurrent?:number;
  readonly retainUpdates?:number;
}
export interface InfiniteWorldStats{
  readonly update:number;
  readonly wanted:number;
  readonly resident:number;
  /** Loading entries still wanted; cancelled tasks are included in active instead. */
  readonly pending:number;
  readonly deferred:number;
  /** All unsettled generation/lifecycle tasks, including cancelled ones. */
  readonly active:number;
  /** Failed keys blocked from automatic retry until the next explicit update. */
  readonly failed:number;
  /** Cleanup/diagnostic callbacks that threw. Nonzero must fail a lifecycle gate. */
  readonly hookErrors:number;
}
interface Entry<T>{
  readonly key:string;
  demand:WorldTileDemand;
  state:InfiniteWorldTileState;
  lastWanted:number;
  readonly controller:AbortController;
  value?:T;
}

export class InfiniteWorld<T>{
  private readonly entries=new Map<string,Entry<T>>();
  // Cancellation is a request, NOT an acknowledgement that memory/work is gone.
  private readonly tasks=new Set<Promise<void>>();
  private readonly failed=new Set<string>();
  private wanted:readonly WorldTileDemand[]=[];
  private deferredCount=0;
  private updateId=0;
  private hookErrors=0;
  private disposed=false;
  private updating=false;
  readonly maxResident:number;
  readonly maxConcurrent:number;
  readonly retainUpdates:number;

  constructor(private readonly hooks:InfiniteWorldHooks<T>,options:InfiniteWorldOptions={}){
    this.maxResident=options.maxResident??2048;
    this.maxConcurrent=options.maxConcurrent??4;
    this.retainUpdates=options.retainUpdates??2;
    if(!Number.isSafeInteger(this.maxResident)||this.maxResident<1||!Number.isSafeInteger(this.maxConcurrent)||this.maxConcurrent<1||this.maxConcurrent>this.maxResident||!Number.isSafeInteger(this.retainUpdates)||this.retainUpdates<0)throw new RangeError('Invalid infinite-world budgets');
  }

  update(demands:readonly WorldTileDemand[]):InfiniteWorldStats{
    if(this.disposed)throw new Error('InfiniteWorld is disposed');
    if(this.updating)throw new Error('InfiniteWorld.update is not reentrant');
    const unique=new Set<string>();
    // Validate before mutating the current plan or clearing its failure state.
    for(const demand of demands){
      if(unique.has(demand.key))throw new TypeError('duplicate tile demand: '+demand.key);
      if(!Number.isFinite(demand.priority)||!Number.isFinite(demand.distanceM)||demand.distanceM<0)throw new RangeError('Invalid tile priority or distance');
      unique.add(demand.key);
    }
    const wanted=Object.freeze([...demands].sort((a,b)=>b.priority-a.priority||a.distanceM-b.distanceM||(a.key<b.key?-1:a.key>b.key?1:0)).slice(0,this.maxResident).map(d=>Object.freeze({...d,id:Object.freeze({...d.id}),bounds:Object.freeze({...d.bounds})})));
    this.updating=true;
    try{
      this.updateId++;
      this.failed.clear();
      this.wanted=wanted;
      this.deferredCount=Math.max(0,demands.length-this.wanted.length);
      const admitted=new Set(this.wanted.map(d=>d.key));
      for(const demand of this.wanted){
        const entry=this.entries.get(demand.key);
        if(entry){entry.demand=demand;entry.lastWanted=this.updateId;}
      }
      for(const [key,entry] of [...this.entries]){
        if(admitted.has(key))continue;
        if(entry.state==='loading'||this.updateId-entry.lastWanted>this.retainUpdates)this.evict(key,entry);
      }
      const missingWanted=this.wanted.reduce((count,demand)=>count+(this.entries.has(demand.key)?0:1),0);
      if(this.entries.size+missingWanted>this.maxResident){
        const stale=[...this.entries.entries()].filter(([key])=>!admitted.has(key)).sort((a,b)=>a[1].lastWanted-b[1].lastWanted||(a[0]<b[0]?-1:a[0]>b[0]?1:0));
        for(const [key,entry] of stale){if(this.entries.size+missingWanted<=this.maxResident)break;this.evict(key,entry);}
      }
    }finally{this.updating=false;}
    this.startMore();
    return this.inspect();
  }

  has(key:string):boolean{return this.entries.get(key)?.state==='ready';}
  value(key:string):T|undefined{return this.entries.get(key)?.value;}
  ready():readonly{demand:WorldTileDemand;value:T}[]{
    const result:{demand:WorldTileDemand;value:T}[]=[];
    for(const entry of this.entries.values())if(entry.state==='ready')result.push({demand:entry.demand,value:entry.value as T});
    return result.sort((a,b)=>a.demand.distanceM-b.demand.distanceM||(a.demand.key<b.demand.key?-1:a.demand.key>b.demand.key?1:0));
  }
  inspect():InfiniteWorldStats{
    let resident=0,pending=0;
    for(const entry of this.entries.values())entry.state==='ready'?resident++:pending++;
    return{update:this.updateId,wanted:this.wanted.length,resident,pending,deferred:this.deferredCount,active:this.tasks.size,failed:this.failed.size,hookErrors:this.hookErrors};
  }
  /** Offline/test drain, never await this from the frame loop. Also drains cancelled tasks. */
  async flush():Promise<void>{
    while(this.tasks.size)await Promise.allSettled([...this.tasks]);
  }
  dispose():void{
    if(this.disposed)return;
    this.disposed=true;
    this.wanted=[];this.deferredCount=0;this.failed.clear();
    for(const [key,entry] of [...this.entries])this.evict(key,entry);
    // Keep tasks tracked: late results still need release, even after dispose().
  }

  private current(entry:Entry<T>):boolean{
    return !this.disposed&&!entry.controller.signal.aborted&&this.entries.get(entry.key)===entry;
  }
  private startMore():void{
    if(this.disposed)return;
    for(const demand of this.wanted){
      if(this.tasks.size>=this.maxConcurrent||this.entries.size>=this.maxResident)break;
      if(this.entries.has(demand.key)||this.failed.has(demand.key))continue;
      const entry:Entry<T>={key:demand.key,demand,state:'loading',lastWanted:this.updateId,controller:new AbortController()};
      this.entries.set(entry.key,entry);
      // Register before invoking user code; catch synchronous throws and thenables too.
      const task=Promise.resolve().then(()=>this.generate(entry)).finally(()=>{
        this.tasks.delete(task);
        this.startMore();
      });
      this.tasks.add(task);
    }
  }
  private async generate(entry:Entry<T>):Promise<void>{
    if(!this.current(entry))return;
    let value:T;
    try{value=await this.hooks.generate(entry.demand,entry.controller.signal);}
    catch(error){this.fail(entry,error);return;}
    if(!this.current(entry)){this.release(entry.demand,value);return;}
    try{this.hooks.install?.(entry.demand,value);}
    catch(error){
      // Detach a partial install, release its payload, and never republish it.
      const report=this.current(entry);
      if(report){this.entries.delete(entry.key);this.failed.add(entry.key);}
      this.detach(entry.demand,value);
      if(report)this.reportError(entry.demand,error);
      return;
    }
    // A hook may have disposed the world or changed the requested tile.
    if(!this.current(entry)){this.detach(entry.demand,value);return;}
    entry.value=value;entry.state='ready';
  }
  private fail(entry:Entry<T>,error:unknown):void{
    if(!this.current(entry))return;
    this.entries.delete(entry.key);this.failed.add(entry.key);
    this.reportError(entry.demand,error);
  }
  private reportError(demand:WorldTileDemand,error:unknown):void{
    try{this.hooks.onError?.(demand,error);}catch{this.hookErrors++;}
  }
  private release(demand:WorldTileDemand,value:T):void{
    try{this.hooks.release?.(demand,value);}catch(error){this.hookErrors++;this.reportError(demand,error);}
  }
  private detach(demand:WorldTileDemand,value:T):void{
    try{this.hooks.uninstall?.(demand,value);}catch(error){this.hookErrors++;this.reportError(demand,error);}
    // One failed detach must not prevent payload release or cleanup of other tiles.
    this.release(demand,value);
  }
  private evict(key:string,entry:Entry<T>):void{
    if(this.entries.get(key)!==entry)return;
    this.entries.delete(key);entry.controller.abort();
    if(entry.state==='ready'){
      const value=entry.value as T;delete entry.value;
      this.detach(entry.demand,value);
    }
  }
}
