import type {RuntimeTimeline} from './runtime-timeline.js';
/** CPU wall-time sampling at synchronous execution boundaries, never inside a solver.
 * RU: Измеряется время исполнения на границах; часы не участвуют в симуляции. */
export interface QuantumStats {readonly meanMs:number;readonly p50Ms:number;readonly p95Ms:number;readonly maxMs:number}
/** Shared by CPU systems and renderer CPU/GPU samples. Sorting happens only on inspection. */
export function timingStats(values:readonly number[]):QuantumStats{
  if(!values.length)return{meanMs:0,p50Ms:0,p95Ms:0,maxMs:0};
  const sorted=[...values].sort((a,b)=>a-b);
  return{meanMs:values.reduce((a,b)=>a+b,0)/values.length,p50Ms:sorted[Math.floor((sorted.length-1)*.5)]!,p95Ms:sorted[Math.floor((sorted.length-1)*.95)]!,maxMs:sorted[sorted.length-1]!};
}
export interface CpuScopeSnapshot {
  readonly id:string;readonly calls:number;readonly failures:number;readonly samples:number;
  readonly totalMs:number;readonly selfTotalMs:number;readonly latestMs:number;readonly latestSelfMs:number;
  readonly inclusive:QuantumStats;readonly self:QuantumStats;
}
export interface CpuProfileSnapshot {readonly enabled:boolean;readonly capacity:number;readonly scopes:readonly CpuScopeSnapshot[];readonly droppedScopes:number}
interface Scope {id:string;calls:number;failures:number;count:number;cursor:number;total:number;selfTotal:number;inclusive:Float64Array;self:Float64Array}
export interface CpuProfilerOptions {enabled?:boolean;capacity?:number;maxScopes?:number;now?:()=>number;timeline?:RuntimeTimeline}
/** Bounded per-operation windows; each sample is one call, NOT one render frame.
 * Nested inclusive samples overlap. Use self time to avoid counting child work twice.
 * Promise lifetimes, GPU execution and worker time need their own execution-side adapter. */
export class CpuProfiler {
  readonly enabled:boolean;readonly capacity:number;private readonly maxScopes:number;private readonly now:()=>number;
  private readonly scopes=new Map<string,Scope>();private childMs=0;private depth=0;private droppedScopes=0;private readonly timeline:RuntimeTimeline|undefined;private traceParent=0;
  constructor(options:CpuProfilerOptions={}){
    this.timeline=options.timeline?.enabled?options.timeline:undefined;this.enabled=options.enabled??false;this.capacity=options.capacity??256;this.maxScopes=options.maxScopes??128;this.now=options.now??(()=>performance.now());
    if(!Number.isSafeInteger(this.capacity)||this.capacity<1||this.capacity>4096||!Number.isSafeInteger(this.maxScopes)||this.maxScopes<1||this.maxScopes>1024)throw new RangeError('Invalid CPU profiler budget');
  }
  measure<T>(id:string,run:()=>T):T{
    if(!this.enabled)return run();
    let scope=this.scopes.get(id);
    if(!scope){
      if(this.scopes.size>=this.maxScopes||!id||id.length>256){this.droppedScopes++;return run();}
      scope={id,calls:0,failures:0,count:0,cursor:0,total:0,selfTotal:0,inclusive:new Float64Array(this.capacity),self:new Float64Array(this.capacity)};
      this.scopes.set(id,scope);
    }
    const parentChildMs=this.childMs,start=this.now(),parentTrace=this.traceParent;const span=this.timeline?.begin({owner:'CpuProfiler',kind:'cpu',name:id,at:start,...(parentTrace?{cause:parentTrace}:{})})??0;this.traceParent=span;this.childMs=0;this.depth++;let completed=false;
    try{const result=run();completed=true;return result;}
    finally{
      const elapsed=Math.max(0,this.now()-start);this.timeline?.end(span,start+elapsed,!completed);this.traceParent=parentTrace;const self=Math.max(0,elapsed-this.childMs);this.childMs=parentChildMs+elapsed;this.depth--;
      scope.inclusive[scope.cursor]=elapsed;scope.self[scope.cursor]=self;scope.cursor=(scope.cursor+1)%this.capacity;
      scope.count=Math.min(this.capacity,scope.count+1);scope.calls++;if(!completed)scope.failures++;scope.total+=elapsed;scope.selfTotal+=self;
      if(!this.depth)this.childMs=0;
    }
  }
  inspect():CpuProfileSnapshot{
    const scopes=[...this.scopes.values()].map(s=>Object.freeze({
      id:s.id,calls:s.calls,failures:s.failures,samples:s.count,totalMs:s.total,selfTotalMs:s.selfTotal,
      latestMs:s.inclusive[(s.cursor+this.capacity-1)%this.capacity]??0,latestSelfMs:s.self[(s.cursor+this.capacity-1)%this.capacity]??0,
      inclusive:Object.freeze(timingStats(Array.from(s.inclusive.subarray(0,s.count)))),self:Object.freeze(timingStats(Array.from(s.self.subarray(0,s.count)))),
    }));
    return Object.freeze({enabled:this.enabled,capacity:this.capacity,scopes:Object.freeze(scopes),droppedScopes:this.droppedScopes});
  }
  reset():void{if(this.depth)throw new Error('Cannot reset an active CPU measurement');this.scopes.clear();this.childMs=0;this.droppedScopes=0;}
}
