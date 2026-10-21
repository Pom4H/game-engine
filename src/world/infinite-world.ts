import type {WorldTileDemand} from './tiles.js';

export type InfiniteWorldTileState='loading'|'ready';
export interface InfiniteWorldHooks<T>{
  readonly generate:(demand:WorldTileDemand,signal:AbortSignal)=>T|Promise<T>;
  readonly install?:(demand:WorldTileDemand,value:T)=>void;
  readonly uninstall?:(demand:WorldTileDemand,value:T)=>void;
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
  readonly pending:number;
  readonly deferred:number;
}
interface Entry<T>{
  demand:WorldTileDemand;
  state:InfiniteWorldTileState;
  lastWanted:number;
  generation:number;
  controller:AbortController;
  value?:T;
  task?:Promise<void>;
}

export class InfiniteWorld<T>{
  private readonly entries=new Map<string,Entry<T>>();
  private readonly failed=new Set<string>();
  private wanted:readonly WorldTileDemand[]=[];
  private deferredCount=0;
  private updateId=0;
  private generation=0;
  private disposed=false;
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
    this.updateId++;
    this.failed.clear();
    const unique=new Set<string>();
    for(const demand of demands){if(unique.has(demand.key))throw new TypeError('duplicate tile demand: '+demand.key);unique.add(demand.key);}
    this.wanted=Object.freeze([...demands].sort((a,b)=>b.priority-a.priority||a.distanceM-b.distanceM||(a.key<b.key?-1:a.key>b.key?1:0)).slice(0,this.maxResident));
    this.deferredCount=Math.max(0,demands.length-this.wanted.length);
    const admitted=new Set(this.wanted.map(d=>d.key));
    for(const demand of this.wanted){
      const entry=this.entries.get(demand.key);
      if(entry){entry.demand=demand;entry.lastWanted=this.updateId;}
    }
    for(const [key,entry] of [...this.entries]){
      if(admitted.has(key))continue;
      if(entry.state==='loading'){entry.controller.abort();this.entries.delete(key);continue;}
      if(this.updateId-entry.lastWanted>this.retainUpdates)this.evict(key,entry);
    }
    // Hard memory invariant: retained stale entries are best-effort and are evicted
    // before they can prevent newly wanted tiles from entering the bounded set.
    const missingWanted=this.wanted.reduce((count,demand)=>count+(this.entries.has(demand.key)?0:1),0);
    if(this.entries.size+missingWanted>this.maxResident){
      const stale=[...this.entries.entries()].filter(([key])=>!admitted.has(key)).sort((a,b)=>a[1].lastWanted-b[1].lastWanted||(a[0]<b[0]?-1:a[0]>b[0]?1:0));
      for(const [key,entry] of stale){if(this.entries.size+missingWanted<=this.maxResident)break;this.evict(key,entry);}
    }
    this.startMore();
    return this.inspect();
  }

  has(key:string):boolean{return this.entries.get(key)?.state==='ready';}
  value(key:string):T|undefined{return this.entries.get(key)?.value;}
  ready():readonly{demand:WorldTileDemand;value:T}[]{
    const result:{demand:WorldTileDemand;value:T}[]=[];
    for(const entry of this.entries.values())if(entry.state==='ready'&&entry.value!==undefined)result.push({demand:entry.demand,value:entry.value});
    return result.sort((a,b)=>a.demand.distanceM-b.demand.distanceM||a.demand.key.localeCompare(b.demand.key));
  }
  inspect():InfiniteWorldStats{
    let resident=0,pending=0;
    for(const entry of this.entries.values())entry.state==='ready'?resident++:pending++;
    return{update:this.updateId,wanted:this.wanted.length,resident,pending,deferred:this.deferredCount};
  }
  async flush():Promise<void>{
    for(;;){
      const tasks=[...this.entries.values()].flatMap(entry=>entry.task?[entry.task]:[]);
      if(!tasks.length)return;
      await Promise.allSettled(tasks);
    }
  }
  dispose():void{
    if(this.disposed)return;
    this.disposed=true;
    for(const [key,entry] of [...this.entries]){entry.controller.abort();if(entry.state==='ready'&&entry.value!==undefined)this.hooks.uninstall?.(entry.demand,entry.value);this.entries.delete(key);}
    this.wanted=[];this.deferredCount=0;
  }

  private startMore():void{
    if(this.disposed)return;
    let pending=0;for(const entry of this.entries.values())if(entry.state==='loading')pending++;
    for(const demand of this.wanted){
      if(pending>=this.maxConcurrent||this.entries.size>=this.maxResident)break;
      if(this.entries.has(demand.key)||this.failed.has(demand.key))continue;
      const controller=new AbortController(),generation=++this.generation,entry:Entry<T>={demand,state:'loading',lastWanted:this.updateId,generation,controller};
      this.entries.set(demand.key,entry);pending++;
      entry.task=Promise.resolve().then(()=>this.hooks.generate(demand,controller.signal)).then(value=>{
        if(this.disposed||controller.signal.aborted||this.entries.get(demand.key)!==entry||entry.generation!==generation)return;
        entry.value=value;entry.state='ready';this.hooks.install?.(entry.demand,value);
      }).catch(error=>{
        if(this.entries.get(demand.key)===entry)this.entries.delete(demand.key);
        if(!controller.signal.aborted){this.failed.add(demand.key);this.hooks.onError?.(demand,error);}
      }).finally(()=>{
        // Keep the task visible until the next generation batch has been started,
        // otherwise flush can finish in the gap between then and finally.
        delete entry.task;
        if(this.entries.get(demand.key)===entry&&entry.state==='loading')this.entries.delete(demand.key);
        this.startMore();
      });
    }
  }
  private evict(key:string,entry:Entry<T>):void{
    entry.controller.abort();
    if(entry.state==='ready'&&entry.value!==undefined)this.hooks.uninstall?.(entry.demand,entry.value);
    this.entries.delete(key);
  }
}
