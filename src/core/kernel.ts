import type {CpuProfiler} from './profiling.js';

export type EnginePhase = 'input' | 'plan' | 'simulate' | 'commit' | 'publish';
export const ENGINE_PHASES: readonly EnginePhase[] = ['input','plan','simulate','commit','publish'];
export type SimulationTier = 'detailed' | 'active' | 'aggregate' | 'dormant';
export const SIMULATION_TIERS: readonly SimulationTier[] = ['detailed','active','aggregate','dormant'];
export interface ModuleFrame {readonly tick:number;readonly deltaSeconds:number;readonly tier:SimulationTier;readonly phase:EnginePhase}
export interface ModuleDescription {readonly id:string;readonly phase:EnginePhase;readonly rateHz:number;readonly reads:readonly string[];readonly writes:readonly string[];readonly tiers?:readonly SimulationTier[];readonly after?:readonly string[];readonly context?:'none';/** Pure projections only; clocks/physics remain cadence-driven. */readonly incremental?:boolean}
export interface EngineModule<Context,Command> extends ModuleDescription {readonly run:(context:Readonly<Context>,frame:ModuleFrame)=>readonly Command[]|void}
export interface ModuleBatch {readonly phase:EnginePhase;readonly modules:readonly ModuleDescription[]}
export interface KernelRunOptions<Context,Command>{
  /** Commit once per batch; the returned state is the next batch's read snapshot. */
  readonly commit?:(commands:readonly Command[],context:Readonly<Context>,phase:EnginePhase)=>Readonly<Context>;
  readonly deltaSeconds?:number;
  /** Lazily project current state, only for batches that consume a context. */
  readonly read?:()=>Readonly<Context>;
  /** Optional CPU observation; no clock is read by the mathematical modules. */
  readonly profiler?:CpuProfiler;
  readonly onModule?:(module:ModuleDescription,frame:ModuleFrame)=>void;
}
interface Registered {description:ModuleDescription;periodTicks:number}
const phaseIndex=(phase:EnginePhase)=>ENGINE_PHASES.indexOf(phase);
const intersects=(a:readonly string[],b:readonly string[])=>a.length>0&&b.length>0&&(a.includes('*')||b.includes('*')||a.some(key=>b.includes(key)));
function conflicts(a:ModuleDescription,b:ModuleDescription){return intersects(a.writes,b.reads)||intersects(a.writes,b.writes)||intersects(b.writes,a.reads);}
function stable(description:ModuleDescription):ModuleDescription{return Object.freeze({...description,reads:Object.freeze([...description.reads]),writes:Object.freeze([...description.writes]),...(description.after?{after:Object.freeze([...description.after])}:{}),...(description.tiers?{tiers:Object.freeze([...description.tiers])}:{})});}
/** Stable topological planning. Same-phase hazards require an explicit after path;
 * stable IDs break ties only between independent modules. Dependencies can be
 * registered in any order and are checked when the completed graph is planned. */
export class ModuleScheduler{
  private readonly modules=new Map<string,Registered>();
  private readonly plans=new Map<string,readonly ModuleBatch[]>();
  private order:Registered[]|null=null;private planBuilds=0;private planHits=0;
  constructor(readonly tickRate=60,readonly capacity=64){if(!Number.isSafeInteger(tickRate)||tickRate<1||!Number.isSafeInteger(capacity)||capacity<1)throw new RangeError('Invalid module scheduler budget');}
  use(module:ModuleDescription):this{
    if(typeof module.id!=='string'||!module.id||module.id.length>180||this.modules.has(module.id))throw new TypeError('Modules require distinct stable IDs');
    if(this.modules.size>=this.capacity)throw new RangeError('Module scheduler is full');
    if(!ENGINE_PHASES.includes(module.phase))throw new TypeError('Unknown engine phase');
    const periodTicks=this.tickRate/module.rateHz;
    if(!Number.isFinite(module.rateHz)||module.rateHz<=0||!Number.isSafeInteger(periodTicks)||periodTicks<1)throw new RangeError(`Module ${module.id} rate must divide the engine tick rate`);
    if([...module.reads,...module.writes,...module.after??[]].some(key=>typeof key!=='string'||!key))throw new TypeError('Resources and dependencies require stable names');
    if(module.tiers?.some(t=>!SIMULATION_TIERS.includes(t)))throw new TypeError('Unknown simulation tier');
    this.modules.set(module.id,{description:stable(module),periodTicks});this.order=null;this.plans.clear();return this;
  }
  private sorted():Registered[]{
    if(this.order)return this.order;
    const modules=[...this.modules.values()];
    for(const {description:m} of modules)for(const id of m.after??[]){const parent=this.modules.get(id)?.description;if(!parent)throw new TypeError(`Module ${m.id}: unknown dependency ${id}`);if(phaseIndex(parent.phase)>phaseIndex(m.phase))throw new TypeError(`Module ${m.id}: dependency ${id} is in a later phase`);}
    const remaining=new Set(modules),done=new Set<string>(),order:Registered[]=[];
    while(remaining.size){
      const ready=[...remaining].filter(m=>(m.description.after??[]).every(id=>done.has(id))).sort((a,b)=>phaseIndex(a.description.phase)-phaseIndex(b.description.phase)||(a.description.id<b.description.id?-1:1));
      if(!ready.length)throw new TypeError('Module dependency cycle');
      const next=ready[0]!;remaining.delete(next);done.add(next.description.id);order.push(next);
    }
    const precedes=(a:string,b:string):boolean=>{const visited=new Set<string>(),queue=[b];while(queue.length){const id=queue.pop()!;if(visited.has(id))continue;visited.add(id);for(const dependency of this.modules.get(id)!.description.after??[]){if(dependency===a)return true;queue.push(dependency);}}return false;};
    for(let i=0;i<modules.length;i++)for(let j=i+1;j<modules.length;j++){
      const a=modules[i]!.description,b=modules[j]!.description;
      if(a.phase===b.phase&&conflicts(a,b)&&!precedes(a.id,b.id)&&!precedes(b.id,a.id))throw new TypeError(`Ambiguous resource hazard: ${a.id} / ${b.id}; declare after`);
    }
    return this.order=order;
  }
  plan(tick:number,tier:SimulationTier='detailed'):readonly ModuleBatch[]{
    if(!Number.isSafeInteger(tick)||tick<0)throw new RangeError('tick must be a non-negative safe integer');
    if(!SIMULATION_TIERS.includes(tier))throw new TypeError('Unknown simulation tier');
    const ordered=this.sorted(),key=tier+':'+ordered.map(m=>tick%m.periodTicks===0?'1':'0').join('');
    const found=this.plans.get(key);if(found){this.planHits++;return found;}
    const batches:ModuleBatch[]=[];let batch:ModuleDescription[]=[];
    const flush=()=>{if(batch.length)batches.push(Object.freeze({phase:batch[0]!.phase,modules:Object.freeze(batch)}));batch=[];};
    for(const {description:m,periodTicks} of ordered){
      if(tick%periodTicks!==0||(m.tiers&&!m.tiers.includes(tier)))continue;
      if(batch.some(other=>other.phase!==m.phase||conflicts(other,m)||(m.after??[]).includes(other.id)))flush();
      batch.push(m);
    }
    flush();const plan=Object.freeze(batches);if(this.plans.size>=256)this.plans.delete(this.plans.keys().next().value!);this.plans.set(key,plan);this.planBuilds++;return plan;
  }
  get diagnostics(){return{modules:this.modules.size,cachedPlans:this.plans.size,planBuilds:this.planBuilds,planHits:this.planHits};}
}
/** Context is a portable data snapshot. Nested mutations and normal Map/Set
 * mutators fail instead of leaking results into an independent reader. */
function snapshot<T>(context:T):Readonly<T>{
  const value=structuredClone(context),seen=new WeakSet<object>();
  const freeze=(value:unknown):void=>{
    if(!value||typeof value!=='object'||seen.has(value))return;seen.add(value);
    const deny=()=>{throw new TypeError('Module context is read-only; return commands');};
    if(value instanceof Map){for(const [key,item] of value){freeze(key);freeze(item);}for(const key of ['set','delete','clear'])Object.defineProperty(value,key,{value:deny});}
    else if(value instanceof Set){for(const item of value)freeze(item);for(const key of ['add','delete','clear'])Object.defineProperty(value,key,{value:deny});}
    else {if(Object.getPrototypeOf(value)!==Object.prototype&&!Array.isArray(value)&&Object.getPrototypeOf(value)!==null)throw new TypeError('Module context must contain plain data, arrays, Maps or Sets');for(const item of Object.values(value))freeze(item);}
    Object.freeze(value);
  };freeze(value);return value;
}
interface VersionCell {value:number}
interface IncrementalRecord {reads:VersionCell[];writes:VersionCell[];seen:Float64Array;pending:Float64Array;initialized:boolean;wildcard:boolean}
export class EngineKernel<Context,Command>{
  readonly scheduler:ModuleScheduler;private readonly modules=new Map<string,EngineModule<Context,Command>>();
  private versions:Map<string,VersionCell>|undefined;
  private readonly prepared=new Map<string,IncrementalRecord>();
  private readonly anyVersion:VersionCell={value:0};private readonly wildcardVersion:VersionCell={value:0};
  private prepareIncremental():void {
    if(![...this.modules.values()].some(m=>m.incremental))return;
    this.versions=new Map();this.prepared.clear();
    const cell=(key:string)=>{let c=this.versions!.get(key);if(!c)this.versions!.set(key,c={value:0});return c;};
    for(const module of this.modules.values()){
      const reads=module.reads.includes('*')?[this.anyVersion]:[this.wildcardVersion,...module.reads.map(cell)];
      this.prepared.set(module.id,{reads,writes:module.writes.filter(k=>k!=='*').map(cell),wildcard:module.writes.includes('*'),seen:new Float64Array(reads.length),pending:new Float64Array(reads.length),initialized:false});
    }
  }
  /** Unknown channels do not grow a cache. Wildcard readers still observe any external change. */
  invalidate(...resources:string[]):this {
    if(!this.versions||!resources.length)return this;
    this.anyVersion.value++;for(const key of resources){if(key==='*')this.wildcardVersion.value++;else{const c=this.versions.get(key);if(c)c.value++;}}return this;
  }
  private due(module:ModuleDescription):boolean {
    if(!module.incremental)return true;const record=this.prepared.get(module.id)!;
    if(!record.initialized)return true;
    for(let i=0;i<record.reads.length;i++)if(record.reads[i]!.value!==record.seen[i])return true;
    return false;
  }
  constructor(tickRate=60,capacity=64){this.scheduler=new ModuleScheduler(tickRate,capacity);}
  use(module:EngineModule<Context,Command>):this{if(typeof module.run!=='function')throw new TypeError('Kernel modules require a synchronous implementation');this.scheduler.use(module);this.modules.set(module.id,Object.freeze({...stable(module),run:module.run}));this.prepareIncremental();return this;}
  run(tick:number,context:Readonly<Context>,tier:SimulationTier='detailed',options:KernelRunOptions<Context,Command>={}):Command[]{
    const dt=options.deltaSeconds??1/this.scheduler.tickRate;if(!Number.isFinite(dt)||dt<=0)throw new RangeError('Kernel delta must be positive and finite');
    const commands:Command[]=[];let current=context;
    const profiler=options.profiler?.enabled?options.profiler:undefined;
    const plan=profiler?profiler.measure('kernel:plan',()=>this.scheduler.plan(tick,tier)):this.scheduler.plan(tick,tier);
    for(const batch of plan){
      const active=this.versions?batch.modules.filter(m=>this.due(m)):batch.modules;if(!active.length)continue;
      const view=active.every(m=>m.context==='none')?Object.freeze({}) as Readonly<Context>:profiler?profiler.measure('kernel:read',()=>snapshot(options.read?.()??current)):snapshot(options.read?.()??current),pending:Command[]=[];
      for(const description of active){const module=this.modules.get(description.id)!;if(!module)throw new TypeError(`No implementation: ${description.id}`);
        if(module.incremental){const record=this.prepared.get(module.id)!;for(let i=0;i<record.reads.length;i++)record.pending[i]=record.reads[i]!.value;}
        const frame=Object.freeze({tick,deltaSeconds:dt*this.scheduler.tickRate/module.rateHz,tier,phase:module.phase});options.onModule?.(description,frame);
        const result=profiler?profiler.measure(`module:${module.id}`,()=>module.run(view,frame)):module.run(view,frame);if(result&&!Array.isArray(result))throw new TypeError(`Module ${module.id} must return synchronous commands`);if(result)pending.push(...result);
      }
      if(pending.length){commands.push(...pending);if(options.commit)current=profiler?profiler.measure('kernel:commit',()=>options.commit!(pending,view,batch.phase)):options.commit(pending,view,batch.phase);}
      // No version/seen update before a successful batch commit. Failed work is retryable.
      if(this.versions)for(const module of active){const record=this.prepared.get(module.id)!;if(module.incremental){record.seen.set(record.pending);record.initialized=true;}if(module.writes.length){this.anyVersion.value++;if(record.wildcard)this.wildcardVersion.value++;for(const cell of record.writes)cell.value++;}}
    }
    return commands;
  }
}
