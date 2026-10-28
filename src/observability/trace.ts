import {BUDGET_METRICS,engineBudgets,type EngineBudgetOptions,type EngineBudgets,type BudgetMetric} from './technologies.js';

export const ENGINE_TRACE_SCHEMA='engine.trace.v1' as const;
export type TraceArgs=Readonly<Record<string,string|number|boolean|null>>;
export interface TraceEvent {
  readonly name:string;readonly category:string;readonly phase:'X'|'i'|'C'|'s'|'f';
  readonly atMs:number;readonly durationMs?:number;readonly id?:string;readonly args:TraceArgs;
}
export interface EngineTraceCapture {
  readonly schema:typeof ENGINE_TRACE_SCHEMA;readonly source:string;readonly clock:{readonly originMs:number;readonly uncertaintyMs:number|null};
  readonly capacity:number;readonly written:number;readonly dropped:number;
  readonly state:'recording'|'stopped';readonly trigger:string|null;
  readonly budgets:EngineBudgets;readonly metadata:TraceArgs;readonly events:readonly TraceEvent[];
}
export interface EngineTraceOptions {
  readonly source?:string;readonly capacity?:number;readonly enabled?:boolean;
  readonly now?:()=>number;readonly originMs?:number;readonly clockUncertaintyMs?:number;
  readonly budgets?:EngineBudgetOptions;readonly metadata?:TraceArgs;
  readonly triggerMs?:number;readonly postTriggerFrames?:number;
}
const label=(value:string)=>{if(typeof value!=='string'||!value.length||value.length>256)throw new TypeError('Invalid trace label');return value;};
function args(value:TraceArgs):TraceArgs{
  const entries=Object.entries(value);if(entries.length>24)throw new RangeError('Trace arguments exceed capacity');
  for(const [key,v] of entries){label(key);if(!(v===null||typeof v==='boolean'||typeof v==='string'&&v.length<=512||typeof v==='number'&&Number.isFinite(v)))throw new TypeError('Trace arguments must be bounded finite scalars');}
  return Object.freeze({...value});
}
const finite=(value:number)=>{if(!Number.isFinite(value))throw new RangeError('Invalid trace timestamp');return value;};

/** Explicit, bounded recorder. Never enables force tracing or changes simulation state. */
export class EngineTrace {
  readonly source:string;readonly capacity:number;readonly budgets:EngineBudgets;
  readonly originMs:number;readonly clockUncertaintyMs:number|null;readonly metadata:TraceArgs;
  private readonly clock:()=>number;private readonly ring:(TraceEvent|undefined)[];
  private written=0;private count=0;private cursor=0;private active:boolean;
  private triggerReason:string|null=null;private remainingFrames:number|null=null;
  private readonly triggerMs:number|undefined;private readonly postFrames:number;
  constructor(options:EngineTraceOptions={}){
    this.source=label(options.source??'engine');this.capacity=options.capacity??32768;
    if(!Number.isSafeInteger(this.capacity)||this.capacity<64||this.capacity>262144)throw new RangeError('Trace capacity must be 64..262144');
    this.clock=options.now??(()=>performance.now());this.originMs=finite(options.originMs??performance.timeOrigin);
    this.clockUncertaintyMs=options.clockUncertaintyMs??null;
    if(this.clockUncertaintyMs!==null&&(!Number.isFinite(this.clockUncertaintyMs)||this.clockUncertaintyMs<0))throw new RangeError('Invalid clock uncertainty');
    this.budgets=engineBudgets(options.budgets);this.metadata=args(options.metadata??{});
    this.triggerMs=options.triggerMs;if(this.triggerMs!==undefined&&(!Number.isFinite(this.triggerMs)||this.triggerMs<=0))throw new RangeError('Invalid triggerMs');
    this.postFrames=options.postTriggerFrames??30;if(!Number.isSafeInteger(this.postFrames)||this.postFrames<0||this.postFrames>10000)throw new RangeError('Invalid postTriggerFrames');
    this.ring=new Array(this.capacity);this.active=options.enabled??true;
  }
  get recording():boolean{return this.active;}
  now():number{return this.clock();}
  stop():void{this.active=false;}
  private append(event:TraceEvent):void{
    if(!this.active)return;this.ring[this.cursor]=Object.freeze(event);this.cursor=(this.cursor+1)%this.capacity;
    this.written++;this.count=Math.min(this.count+1,this.capacity);
  }
  complete(name:string,category:string,startMs:number,endMs:number,context:TraceArgs={}):void{
    if(!this.active)return;finite(startMs);finite(endMs);if(endMs<startMs)throw new RangeError('Negative trace duration');
    this.append({name:label(name),category:label(category),phase:'X',atMs:startMs,durationMs:endMs-startMs,args:args(context)});
  }
  measure<T>(name:string,category:string,run:()=>T,context:TraceArgs={}):T{
    if(!this.active)return run();const start=this.now();try{return run();}finally{this.complete(name,category,start,this.now(),context);}
  }
  instant(name:string,category:string,context:TraceArgs={},atMs?:number):void{
    if(this.active)this.append({name:label(name),category:label(category),phase:'i',atMs:finite(atMs??this.now()),args:args(context)});
  }
  sample(name:string,value:number,context:TraceArgs={},atMs?:number):void{
    if(!this.active)return;finite(value);if(Object.hasOwn(BUDGET_METRICS,name)&&value<0)throw new RangeError('Negative budget measurement');this.append({name:label(name),category:'metric',phase:'C',atMs:finite(atMs??this.now()),args:args({...context,value})});
  }
  flow(name:string,id:string,phase:'s'|'f',context:TraceArgs={},atMs?:number):void{
    if(!this.active)return;if(phase!=='s'&&phase!=='f')throw new TypeError('Invalid flow phase');
    this.append({name:label(name),category:'flow',phase,id:label(id),atMs:finite(atMs??this.now()),args:args(context)});
  }
  /** Actual RAF interval, not renderer CPU duration. Calling this advances the trigger. */
  frame(startMs:number,endMs:number,context:TraceArgs={}):void{
    if(!this.active)return;finite(startMs);finite(endMs);if(endMs<startMs)throw new RangeError('Negative frame interval');this.sample('frame.interval.ms',endMs-startMs,context,endMs);
    if(this.remainingFrames!==null){if(--this.remainingFrames<=0)this.stop();}
    else if(this.triggerMs!==undefined&&endMs-startMs>=this.triggerMs){
      this.triggerReason=`frame >= ${this.triggerMs} ms`;this.instant('capture.trigger','diagnostic',context,endMs);
      this.remainingFrames=this.postFrames;if(!this.postFrames)this.stop();
    }
  }
  snapshot():EngineTraceCapture{
    const events:TraceEvent[]=[];const start=(this.cursor-this.count+this.capacity)%this.capacity;
    for(let i=0;i<this.count;i++)events.push(this.ring[(start+i)%this.capacity]!);
    return Object.freeze({schema:ENGINE_TRACE_SCHEMA,source:this.source,clock:Object.freeze({originMs:this.originMs,uncertaintyMs:this.clockUncertaintyMs}),
      capacity:this.capacity,written:this.written,dropped:this.written-this.count,state:this.active?'recording':'stopped',trigger:this.triggerReason,
      budgets:this.budgets,metadata:this.metadata,events:Object.freeze(events)});
  }
}

/** Four-timestamp exchange, all values in milliseconds. Repeat and retain low-RTT exchanges. */
export function traceClockSync(localSendMs:number,remoteReceiveMs:number,remoteSendMs:number,localReceiveMs:number){
  [localSendMs,remoteReceiveMs,remoteSendMs,localReceiveMs].forEach(finite);
  if(localReceiveMs<localSendMs||remoteSendMs<remoteReceiveMs)throw new RangeError('Invalid clock exchange');
  const roundTripMs=localReceiveMs-localSendMs-(remoteSendMs-remoteReceiveMs);
  if(roundTripMs<0)throw new RangeError('Invalid clock exchange delay');
  return Object.freeze({remoteToLocalMs:((localSendMs-remoteReceiveMs)+(localReceiveMs-remoteSendMs))/2,uncertaintyMs:roundTripMs/2,roundTripMs});
}

export function validateTraceCapture(input:EngineTraceCapture):void{
  if(input?.schema!==ENGINE_TRACE_SCHEMA||!Array.isArray(input.events)||input.events.length>262144)throw new TypeError('Invalid trace capture');
  label(input.source);finite(input.clock?.originMs);
  if(input.clock.uncertaintyMs!==null&&(!Number.isFinite(input.clock.uncertaintyMs)||input.clock.uncertaintyMs<0))throw new TypeError('Invalid trace clock');
  if(!Number.isSafeInteger(input.capacity)||input.capacity<64||input.capacity>262144||input.events.length>input.capacity||!Number.isSafeInteger(input.written)||input.written<input.events.length||input.dropped!==input.written-input.events.length)throw new TypeError('Invalid trace accounting');
  args(input.metadata);
  const b=input.budgets;if(!b||b.revision!=='engine-technologies.v1'||!b.target||!b.limits||!Array.isArray(b.required))throw new TypeError('Invalid trace budgets');
  engineBudgets({...b.target,limits:b.limits,required:b.required,minSamples:b.minSamples,percentile:b.percentile});
  if(Object.keys(b.limits).length!==Object.keys(BUDGET_METRICS).length)throw new TypeError('Incomplete trace budgets');
  for(const e of input.events){label(e.name);label(e.category);args(e.args);finite(e.atMs);
    if(!['X','i','C','s','f'].includes(e.phase))throw new TypeError('Invalid trace phase');
    if(e.phase==='X'&&(!Number.isFinite(e.durationMs)||e.durationMs!<0))throw new TypeError('Invalid duration');
    if(e.phase==='s'||e.phase==='f')label(e.id!);
    if(e.phase==='C'&&typeof e.args.value!=='number')throw new TypeError('Invalid metric');
    if(e.phase==='C'&&Object.hasOwn(BUDGET_METRICS,e.name)&&(e.args.value as number)<0)throw new TypeError('Negative budget measurement');
  }
}

/** Perfetto/Chrome trace JSON. GPU values are counters, never invented host-time GPU spans. */
export function exportChromeTrace(captures:readonly EngineTraceCapture[]){
  if(!captures.length||captures.length>64)throw new RangeError('Expected 1..64 captures');captures.forEach(validateTraceCapture);
  const origin=Math.min(...captures.map(c=>c.clock.originMs));
  const traceEvents:Record<string,unknown>[]=[];
  captures.forEach((capture,index)=>{
    const pid=index+1;
    traceEvents.push({name:'process_name',ph:'M',pid,tid:0,args:{name:capture.source}});
    for(const e of capture.events){
      const tid=e.category==='metric'?2:e.category==='flow'?3:1;
      traceEvents.push({name:e.name,cat:e.category,ph:e.phase,pid,tid,ts:(capture.clock.originMs-origin+e.atMs)*1000,
        ...(e.durationMs===undefined?{}:{dur:e.durationMs*1000}),...(e.id===undefined?{}:{id:e.id}),...(e.phase==='i'?{s:'t'}:{}),args:e.phase==='C'?{value:e.args.value}:e.args});
      if(e.phase==='C'&&Object.keys(e.args).length>1)traceEvents.push({name:e.name,cat:'metric.context',ph:'i',s:'t',pid,tid,ts:(capture.clock.originMs-origin+e.atMs)*1000,args:e.args});
    }
  });
  return {traceEvents,displayTimeUnit:'ms',metadata:{schema:ENGINE_TRACE_SCHEMA,originMs:origin,
    sources:captures.map(c=>({source:c.source,clock:c.clock,dropped:c.dropped,metadata:c.metadata})),
    clockWarning:captures.length>1&&captures.some(c=>c.clock.uncertaintyMs===null)?'Cross-source clocks are not calibrated; do not infer network latency or critical path from alignment.':null}};
}

function distribution(values:number[]){
  values.sort((a,b)=>a-b);const quantile=(q:number)=>values[Math.ceil(q*values.length)-1]??null;
  return {count:values.length,mean:values.length?values.reduce((a,b)=>a+b,0)/values.length:null,p50:quantile(.5),p95:quantile(.95),p99:quantile(.99),max:values.at(-1)??null};
}
export function traceReport(capture:EngineTraceCapture,options?:EngineBudgetOptions){
  validateTraceCapture(capture);const budgets=options?engineBudgets(options):capture.budgets;
  const metrics=new Map<string,number[]>(),spans=new Map<string,number[]>();
  for(const e of capture.events){
    if(e.phase==='C'){const values=metrics.get(e.name)??[];values.push(e.args.value as number);metrics.set(e.name,values);}
    if(e.phase==='X'){const key=`${e.category}/${e.name}`,values=spans.get(key)??[];values.push(e.durationMs!);spans.set(key,values);}
  }
  metrics.set('trace.dropped',[capture.dropped]);
  const evidenceIssues:string[]=[];
  if(capture.dropped)evidenceIssues.push('Trace history was overwritten');
  if(capture.metadata.qualityStable===false)evidenceIssues.push('Quality settings changed during capture');
  if(capture.metadata.hidden===true)evidenceIssues.push('Page was hidden during capture');
  if(typeof capture.metadata.captureDroppedSamples==='number'&&capture.metadata.captureDroppedSamples>0)evidenceIssues.push('Browser capture exceeded sample capacity');
  if(typeof capture.metadata.width==='number'&&capture.metadata.width!==budgets.target.width||typeof capture.metadata.height==='number'&&capture.metadata.height!==budgets.target.height)evidenceIssues.push('Observed resolution differs from budget target');
  const rows=Object.entries(BUDGET_METRICS).map(([key,definition])=>{
    const name=key as BudgetMetric,values=metrics.get(name)??[],stats=distribution(values);
    const limit=budgets.limits[name],required=budgets.required.includes(name);
    const value=name==='trace.dropped'?capture.dropped:values[Math.ceil(budgets.percentile*values.length)-1]??null;
    const enough=name==='trace.dropped'||values.length>=budgets.minSamples;
    const status=value===null?'missing':!enough?'insufficient':value>limit?'exceeded':'within';
    return {metric:name,...definition,limit,required,percentile:budgets.percentile,value,status,...stats};
  });
  return {schema:'engine.performance-report.v1',source:capture.source,budgets,
    complete:capture.dropped===0,evidenceIssues,passed:!evidenceIssues.length&&rows.every(r=>r.status!=='exceeded'&&(!r.required||r.status==='within')),
    rows,hotspots:[...spans].map(([name,values])=>({name,...distribution(values)})).sort((a,b)=>(b.p95??0)-(a.p95??0)).slice(0,30),
    slowFrames:capture.events.filter(e=>e.name==='frame.interval.ms'&&(e.args.value as number)>budgets.limits['frame.interval.ms']).slice(-30),
    interpretation:'Hotspot durations are inclusive. CPU and GPU overlap; GPU counters report elapsed pass time without execution positions. Missing evidence is not a pass; this report does not establish visual or physical correctness.'};
}
