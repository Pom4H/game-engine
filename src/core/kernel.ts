export type EnginePhase = 'input' | 'plan' | 'simulate' | 'commit' | 'publish';
export const ENGINE_PHASES: readonly EnginePhase[] = ['input','plan','simulate','commit','publish'];
export type SimulationTier = 'detailed' | 'active' | 'aggregate' | 'dormant';
export const SIMULATION_TIERS: readonly SimulationTier[] = ['detailed','active','aggregate','dormant'];

export interface ModuleFrame { readonly tick:number; readonly deltaSeconds:number; readonly tier:SimulationTier; readonly phase:EnginePhase }
export interface ModuleDescription { readonly id:string; readonly phase:EnginePhase; readonly rateHz:number; readonly reads:readonly string[]; readonly writes:readonly string[]; readonly tiers?:readonly SimulationTier[] }
export interface EngineModule<Context,Command> extends ModuleDescription { readonly run:(context:Readonly<Context>,frame:ModuleFrame)=>readonly Command[]|void }
export interface ModuleBatch { readonly phase:EnginePhase; readonly modules:readonly ModuleDescription[] }

interface RegisteredModule { readonly description:ModuleDescription; readonly periodTicks:number; readonly writes:ReadonlySet<string> }
function compareIds(a:string,b:string){return a<b?-1:a>b?1:0;}
function assertCounter(value:number,label:string){if(!Number.isSafeInteger(value)||value<0)throw new RangeError(`${label} must be a non-negative safe integer`);}
function period(module:ModuleDescription,tickRate:number){const ticks=tickRate/module.rateHz;if(!Number.isFinite(module.rateHz)||module.rateHz<=0||!Number.isSafeInteger(ticks)||ticks<1)throw new RangeError(`Module ${module.id} rate must divide the engine tick rate`);return ticks;}
function conflicts(a:RegisteredModule,b:RegisteredModule){const aw=a.writes,bw=b.writes;if(aw.has('*')||bw.has('*'))return true;return b.description.reads.some(k=>aw.has(k)||(k==='*'&&aw.size>0))||b.description.writes.some(k=>aw.has(k))||a.description.reads.some(k=>bw.has(k)||(k==='*'&&bw.size>0));}

/** Dependency-aware deterministic module planner extracted from TheGame's world kernel. */
export class ModuleScheduler {
  private readonly modules=new Map<string,RegisteredModule>();
  private readonly phases=ENGINE_PHASES.map(phase=>({phase,modules:[] as RegisteredModule[]}));
  private readonly periods:number[]=[];
  private readonly plans=new Map<string,readonly ModuleBatch[]>();
  private planBuilds=0;private planHits=0;
  constructor(readonly tickRate=60,readonly capacity=64){if(!Number.isSafeInteger(tickRate)||tickRate<1||!Number.isSafeInteger(capacity)||capacity<1)throw new RangeError('Invalid module scheduler budget');}
  use(module:ModuleDescription):this{
    if(!module.id||module.id.length>180||this.modules.has(module.id))throw new TypeError('Modules require distinct stable IDs');
    if(this.modules.size>=this.capacity)throw new RangeError('Module scheduler is full');
    if(!ENGINE_PHASES.includes(module.phase))throw new TypeError('Unknown engine phase');
    const periodTicks=period(module,this.tickRate);
    if([...module.reads,...module.writes].some(k=>typeof k!=='string'||!k))throw new TypeError('Resources must have stable names');
    if(module.tiers?.some(t=>!SIMULATION_TIERS.includes(t)))throw new TypeError('Unknown simulation tier');
    const description:ModuleDescription=Object.freeze({id:module.id,phase:module.phase,rateHz:module.rateHz,reads:Object.freeze([...module.reads]),writes:Object.freeze([...module.writes]),...(module.tiers?{tiers:Object.freeze([...module.tiers])}:{})});
    const registered:RegisteredModule={description,periodTicks,writes:new Set(description.writes)};this.modules.set(description.id,registered);
    const phase=this.phases.find(x=>x.phase===description.phase)!;phase.modules.push(registered);phase.modules.sort((a,b)=>compareIds(a.description.id,b.description.id));
    if(!this.periods.includes(periodTicks))this.periods.push(periodTicks);this.plans.clear();return this;
  }
  plan(tick:number,tier:SimulationTier='detailed'):readonly ModuleBatch[]{
    assertCounter(tick,'tick');if(!SIMULATION_TIERS.includes(tier))throw new TypeError('Unknown simulation tier');
    let key=tier;for(const ticks of this.periods)key+=tick%ticks===0?'1':'0';const cached=this.plans.get(key);if(cached){this.planHits++;return cached;}
    const batches:ModuleBatch[]=[];for(const {phase,modules} of this.phases){let batch:RegisteredModule[]=[];const flush=()=>{if(batch.length)batches.push(Object.freeze({phase,modules:Object.freeze(batch.map(x=>x.description))}));};for(const module of modules){const d=module.description;if(tick%module.periodTicks!==0||(d.tiers&&!d.tiers.includes(tier)))continue;if(batch.some(other=>conflicts(module,other))){flush();batch=[];}batch.push(module);}flush();}
    const plan=Object.freeze(batches);if(this.plans.size>=256)this.plans.delete(this.plans.keys().next().value!);this.plans.set(key,plan);this.planBuilds++;return plan;
  }
  get diagnostics(){return{modules:this.modules.size,cachedPlans:this.plans.size,planBuilds:this.planBuilds,planHits:this.planHits};}
}

export class EngineKernel<Context,Command>{
  readonly scheduler:ModuleScheduler;private readonly modules=new Map<string,EngineModule<Context,Command>>();private readonly executions=new WeakMap<readonly ModuleBatch[],readonly EngineModule<Context,Command>[]>();
  constructor(tickRate=60,capacity=64){this.scheduler=new ModuleScheduler(tickRate,capacity);}
  use(module:EngineModule<Context,Command>):this{if(typeof module.run!=='function')throw new TypeError('Kernel modules require a synchronous implementation');this.scheduler.use(module);this.modules.set(module.id,Object.freeze({...module,reads:Object.freeze([...module.reads]),writes:Object.freeze([...module.writes]),...(module.tiers?{tiers:Object.freeze([...module.tiers])}:{})}));return this;}
  run(tick:number,context:Readonly<Context>,tier:SimulationTier='detailed'):Command[]{const commands:Command[]=[];const plan=this.scheduler.plan(tick,tier);let execution=this.executions.get(plan);if(!execution){execution=plan.flatMap(batch=>batch.modules.map(d=>{const module=this.modules.get(d.id);if(!module)throw new Error(`Module ${d.id} has no implementation`);return module;}));this.executions.set(plan,execution);}for(const module of execution){const frame=Object.freeze({tick,deltaSeconds:1/module.rateHz,tier,phase:module.phase});const result=module.run(context,frame);if(result&&!Array.isArray(result))throw new TypeError(`Module ${module.id} must return synchronous commands`);if(result)commands.push(...result);}return commands;}
}
