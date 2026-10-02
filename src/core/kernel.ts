import {
 ENGINE_DEPTH,simulationDepth,simulationProfile,simulationProfileKey,simulationTierForDepth,
 type EngineDepth,type SimulationProfile,type SimulationProfileInput,type SimulationTier,
} from './depth.js';
export {
 ENGINE_DEPTH,ENGINE_DEPTH_AXES,SIMULATION_TIERS,simulationDepth,simulationProfile,simulationProfileKey,simulationTierDepth,simulationTierForDepth,validateEngineDepth,
} from './depth.js';
export type {EngineDepth,SimulationProfile,SimulationProfileInput,SimulationProfileSpec,SimulationTier} from './depth.js';

export type EnginePhase='input'|'plan'|'simulate'|'commit'|'publish';
export const ENGINE_PHASES:readonly EnginePhase[]=Object.freeze(['input','plan','simulate','commit','publish']);

export interface ModuleDepthRequirement{
 readonly axis:string;
 readonly min?:EngineDepth;
 readonly max?:EngineDepth;
}
export interface ModuleFrame{
 readonly tick:number;
 readonly deltaSeconds:number;
 readonly tier:SimulationTier;
 readonly depth:EngineDepth;
 readonly profile:SimulationProfile;
 readonly phase:EnginePhase;
}
export interface ModuleDescription{
 readonly id:string;
 /** Variants sharing a slot are mutually exclusive; the deepest eligible implementation is compiled in. */
 readonly slot?:string;
 readonly phase:EnginePhase;
 readonly rateHz:number;
 readonly reads:readonly string[];
 readonly writes:readonly string[];
 /** Compatibility gate. New code should use depth. */
 readonly tiers?:readonly SimulationTier[];
 readonly depth?:ModuleDepthRequirement;
 /** Dependencies may name either a concrete module id or a variant slot. */
 readonly after?:readonly string[];
 readonly context?:'none';
}
export interface EngineModule<Context,Command> extends ModuleDescription{
 readonly run:(context:Readonly<Context>,frame:ModuleFrame)=>readonly Command[]|void;
}
export interface EnginePlugin<Context,Command>{
 readonly id:string;
 readonly modules:readonly EngineModule<Context,Command>[];
}
export interface ModuleBatch{
 readonly phase:EnginePhase;
 readonly modules:readonly ModuleDescription[];
}
export interface KernelRunOptions<Context,Command>{
 readonly commit?:(commands:readonly Command[],context:Readonly<Context>,phase:EnginePhase)=>Readonly<Context>;
 readonly deltaSeconds?:number;
 readonly read?:()=>Readonly<Context>;
 readonly onModule?:(module:ModuleDescription,frame:ModuleFrame)=>void;
}
export interface CompiledSchedule{
 readonly profile:SimulationProfile;
 readonly cycleTicks:number;
 readonly selectedModules:readonly ModuleDescription[];
 plan(tick:number):readonly ModuleBatch[];
}

interface Registered{description:ModuleDescription;periodTicks:number}
interface SelectedRegistered extends Registered{dependencies:readonly string[]}
const phaseIndex=(phase:EnginePhase)=>ENGINE_PHASES.indexOf(phase);
const intersects=(a:readonly string[],b:readonly string[])=>a.length>0&&b.length>0&&(a.includes('*')||b.includes('*')||a.some(key=>b.includes(key)));
function conflicts(a:ModuleDescription,b:ModuleDescription){return intersects(a.writes,b.reads)||intersects(a.writes,b.writes)||intersects(b.writes,a.reads);}
const slotOf=(description:ModuleDescription)=>description.slot??description.id;
const minDepth=(description:ModuleDescription)=>description.depth?.min??0;
const maxDepth=(description:ModuleDescription)=>description.depth?.max??255;
const gcd=(a:number,b:number):number=>{while(b){const t=a%b;a=b;b=t;}return a;};
const lcm=(a:number,b:number)=>a/gcd(a,b)*b;

function stable(description:ModuleDescription):ModuleDescription{
 return Object.freeze({
  ...description,
  reads:Object.freeze([...description.reads]),
  writes:Object.freeze([...description.writes]),
  ...(description.after?{after:Object.freeze([...description.after])}:{}),
  ...(description.tiers?{tiers:Object.freeze([...description.tiers])}:{}),
  ...(description.depth?{depth:Object.freeze({...description.depth})}:{}),
 });
}
function eligible(description:ModuleDescription,profile:SimulationProfile):boolean{
 if(description.tiers&&!description.tiers.includes(simulationTierForDepth(profile.defaultDepth)))return false;
 if(!description.depth)return true;
 const depth=simulationDepth(profile,description.depth.axis);
 return depth>=minDepth(description)&&depth<=maxDepth(description);
}

/** Stable topological planning plus profile compilation. Variant/depth/plugin decisions happen
 * only here; KernelProgram executes direct module references with no LOD/plugin dispatch. */
export class ModuleScheduler{
 private readonly modules=new Map<string,Registered>();
 private readonly compiled=new Map<string,CompiledSchedule>();
 private compileBuilds=0;private compileHits=0;
 constructor(readonly tickRate=60,readonly capacity=64){
  if(!Number.isSafeInteger(tickRate)||tickRate<1||!Number.isSafeInteger(capacity)||capacity<1)throw new RangeError('Invalid module scheduler budget');
 }
 private prepare(module:ModuleDescription,seen:Set<string>):Registered{
  if(typeof module.id!=='string'||!module.id||module.id.length>180||seen.has(module.id))throw new TypeError('Modules require distinct stable IDs');
  if(!ENGINE_PHASES.includes(module.phase))throw new TypeError('Unknown engine phase');
  const periodTicks=this.tickRate/module.rateHz;
  if(!Number.isFinite(module.rateHz)||module.rateHz<=0||!Number.isSafeInteger(periodTicks)||periodTicks<1)throw new RangeError(`Module ${module.id} rate must divide the engine tick rate`);
  const slot=module.slot??module.id;if(typeof slot!=='string'||!slot||slot.length>180)throw new TypeError('Module slots require stable names');
  if([...module.reads,...module.writes,...module.after??[]].some(key=>typeof key!=='string'||!key))throw new TypeError('Resources and dependencies require stable names');
  if(module.tiers?.some(t=>!['detailed','active','aggregate','dormant'].includes(t)))throw new TypeError('Unknown simulation tier');
  if(module.depth){
   if(typeof module.depth.axis!=='string'||!module.depth.axis||module.depth.axis.length>180)throw new TypeError('Module depth axis requires a stable name');
   const min=module.depth.min??0,max=module.depth.max??255;
   if(!Number.isSafeInteger(min)||min<0||min>255||!Number.isSafeInteger(max)||max<0||max>255||min>max)throw new RangeError(`Module ${module.id} has invalid depth range`);
  }
  seen.add(module.id);return{description:stable({...module,slot}),periodTicks};
 }
 use(module:ModuleDescription):this{return this.useMany([module]);}
 useMany(modules:readonly ModuleDescription[]):this{
  if(this.modules.size+modules.length>this.capacity)throw new RangeError('Module scheduler is full');
  const seen=new Set(this.modules.keys()),prepared=modules.map(module=>this.prepare(module,seen));
  for(const registered of prepared)this.modules.set(registered.description.id,registered);
  this.compiled.clear();return this;
 }
 compile(input:SimulationProfileInput='detailed'):CompiledSchedule{
  const profile=simulationProfile(input),key=simulationProfileKey(profile),cached=this.compiled.get(key);
  if(cached){this.compileHits++;return cached;}
  const all=[...this.modules.values()],known=new Set<string>();
  for(const {description} of all){known.add(description.id);known.add(slotOf(description));}
  const groups=new Map<string,Registered[]>();
  for(const registered of all){const slot=slotOf(registered.description),group=groups.get(slot);if(group)group.push(registered);else groups.set(slot,[registered]);}
  const selected:Registered[]=[];
  for(const [slot,group] of groups){
   const candidates=group.filter(item=>eligible(item.description,profile));
   if(!candidates.length)continue;
   candidates.sort((a,b)=>minDepth(b.description)-minDepth(a.description)||maxDepth(a.description)-maxDepth(b.description)||(a.description.id<b.description.id?-1:1));
   if(candidates.length>1&&minDepth(candidates[0]!.description)===minDepth(candidates[1]!.description)&&maxDepth(candidates[0]!.description)===maxDepth(candidates[1]!.description))throw new TypeError(`Ambiguous module variants for slot ${slot}`);
   selected.push(candidates[0]!);
  }
  const byId=new Map(selected.map(item=>[item.description.id,item])),bySlot=new Map(selected.map(item=>[slotOf(item.description),item]));
  const chosen:SelectedRegistered[]=selected.map(item=>{
   const dependencies:string[]=[];
   for(const reference of item.description.after??[]){
    const target=byId.get(reference)??bySlot.get(reference);
    if(target){if(target.description.id!==item.description.id)dependencies.push(target.description.id);}
    else if(!known.has(reference))throw new TypeError(`Module ${item.description.id}: unknown dependency ${reference}`);
    // Known but inactive dependency is intentionally vacuous: independent depth axes stay independent.
   }
   return{...item,dependencies:Object.freeze(dependencies)};
  });
  const byChosenId=new Map(chosen.map(item=>[item.description.id,item]));
  for(const item of chosen)for(const dependency of item.dependencies){
   const parent=byChosenId.get(dependency)!;
   if(phaseIndex(parent.description.phase)>phaseIndex(item.description.phase))throw new TypeError(`Module ${item.description.id}: dependency ${dependency} is in a later phase`);
  }
  const remaining=new Set(chosen),done=new Set<string>(),order:SelectedRegistered[]=[];
  while(remaining.size){
   const ready=[...remaining].filter(item=>item.dependencies.every(id=>done.has(id))).sort((a,b)=>phaseIndex(a.description.phase)-phaseIndex(b.description.phase)||(a.description.id<b.description.id?-1:1));
   if(!ready.length)throw new TypeError('Module dependency cycle');
   const next=ready[0]!;remaining.delete(next);done.add(next.description.id);order.push(next);
  }
  const precedes=(a:string,b:string):boolean=>{
   const visited=new Set<string>(),queue=[b];
   while(queue.length){const id=queue.pop()!;if(visited.has(id))continue;visited.add(id);for(const dependency of byChosenId.get(id)?.dependencies??[]){if(dependency===a)return true;queue.push(dependency);}}
   return false;
  };
  for(let i=0;i<chosen.length;i++)for(let j=i+1;j<chosen.length;j++){
   const a=chosen[i]!.description,b=chosen[j]!.description;
   if(a.phase===b.phase&&conflicts(a,b)&&!precedes(a.id,b.id)&&!precedes(b.id,a.id))throw new TypeError(`Ambiguous resource hazard: ${a.id} / ${b.id}; declare after`);
  }
  const cycleTicks=order.reduce((cycle,item)=>lcm(cycle,item.periodTicks),1),plans:ModuleBatch[][]=[];
  for(let tick=0;tick<cycleTicks;tick++){
   const batches:ModuleBatch[]=[];let batch:ModuleDescription[]=[];
   const flush=()=>{if(batch.length)batches.push(Object.freeze({phase:batch[0]!.phase,modules:Object.freeze(batch)}));batch=[];};
   for(const item of order){
    const m=item.description;if(tick%item.periodTicks!==0)continue;
    if(batch.some(other=>other.phase!==m.phase||conflicts(other,m)||item.dependencies.includes(other.id)))flush();
    batch.push(m);
   }
   flush();plans.push(Object.freeze(batches));
  }
  const frozenPlans=Object.freeze(plans),schedule:Object.freeze({
   profile,cycleTicks,selectedModules:Object.freeze(order.map(item=>item.description)),
   plan:(tick:number)=>{if(!Number.isSafeInteger(tick)||tick<0)throw new RangeError('tick must be a non-negative safe integer');return frozenPlans[tick%cycleTicks]!;},
  }) as CompiledSchedule;
  if(this.compiled.size>=64)this.compiled.delete(this.compiled.keys().next().value!);
  this.compiled.set(key,schedule);this.compileBuilds++;return schedule;
 }
 plan(tick:number,input:SimulationProfileInput='detailed'):readonly ModuleBatch[]{return this.compile(input).plan(tick);}
 get diagnostics(){return{modules:this.modules.size,slots:new Set([...this.modules.values()].map(item=>slotOf(item.description))).size,cachedProfiles:this.compiled.size,compileBuilds:this.compileBuilds,compileHits:this.compileHits};}
}

/** Context is a portable data snapshot. Nested mutations and Map/Set mutators fail
 * instead of leaking results into an independent reader. */
function snapshot<T>(context:T):Readonly<T>{
 const value=structuredClone(context),seen=new WeakSet<object>();
 const freeze=(value:unknown):void=>{
  if(!value||typeof value!=='object'||seen.has(value))return;seen.add(value);
  const deny=()=>{throw new TypeError('Module context is read-only; return commands');};
  if(value instanceof Map){for(const [key,item] of value){freeze(key);freeze(item);}for(const key of ['set','delete','clear'])Object.defineProperty(value,key,{value:deny});}
  else if(value instanceof Set){for(const item of value)freeze(item);for(const key of ['add','delete','clear'])Object.defineProperty(value,key,{value:deny});}
  else{if(Object.getPrototypeOf(value)!==Object.prototype&&!Array.isArray(value)&&Object.getPrototypeOf(value)!==null)throw new TypeError('Module context must contain plain data, arrays, Maps or Sets');for(const item of Object.values(value))freeze(item);}
  Object.freeze(value);
 };freeze(value);return value;
}

interface ExecutableModule<Context,Command>{readonly module:EngineModule<Context,Command>;readonly depth:EngineDepth}
interface ExecutableBatch<Context,Command>{readonly phase:EnginePhase;readonly modules:readonly ExecutableModule<Context,Command>[]}

/** Immutable direct-call program for one depth profile. All plugin flattening, variant
 * selection, dependency resolution and LOD decisions are already compiled out. */
export class KernelProgram<Context,Command>{
 readonly profile:SimulationProfile;
 readonly cycleTicks:number;
 readonly selectedModules:readonly ModuleDescription[];
 private readonly plans:readonly (readonly ExecutableBatch<Context,Command>[])[];
 private readonly tier:SimulationTier;
 constructor(
  readonly tickRate:number,
  schedule:CompiledSchedule,
  implementations:ReadonlyMap<string,EngineModule<Context,Command>>,
 ){
  this.profile=schedule.profile;this.cycleTicks=schedule.cycleTicks;this.selectedModules=schedule.selectedModules;this.tier=simulationTierForDepth(schedule.profile.defaultDepth);
  const plans:(readonly ExecutableBatch<Context,Command>[])[]=[];
  for(let tick=0;tick<schedule.cycleTicks;tick++)plans.push(Object.freeze(schedule.plan(tick).map(batch=>Object.freeze({
   phase:batch.phase,
   modules:Object.freeze(batch.modules.map(description=>{
    const module=implementations.get(description.id);if(!module)throw new TypeError(`No implementation: ${description.id}`);
    return Object.freeze({module,depth:description.depth?simulationDepth(schedule.profile,description.depth.axis):schedule.profile.defaultDepth});
   })),
  }))));
  this.plans=Object.freeze(plans);
 }
 run(tick:number,context:Readonly<Context>,options:KernelRunOptions<Context,Command>={}):Command[]{
  if(!Number.isSafeInteger(tick)||tick<0)throw new RangeError('tick must be a non-negative safe integer');
  const dt=options.deltaSeconds??1/this.tickRate;if(!Number.isFinite(dt)||dt<=0)throw new RangeError('Kernel delta must be positive and finite');
  const commands:Command[]=[];let current=context;
  for(const batch of this.plans[tick%this.cycleTicks]!){
   const view=batch.modules.every(item=>item.module.context==='none')?Object.freeze({}) as Readonly<Context>:snapshot(options.read?.()??current),pending:Command[]=[];
   for(const item of batch.modules){
    const module=item.module,frame=Object.freeze({tick,deltaSeconds:dt*this.tickRate/module.rateHz,tier:this.tier,depth:item.depth,profile:this.profile,phase:module.phase});
    options.onModule?.(module,frame);
    const result=module.run(view,frame);if(result&&!Array.isArray(result))throw new TypeError(`Module ${module.id} must return synchronous commands`);if(result)pending.push(...result);
   }
   if(pending.length){commands.push(...pending);if(options.commit)current=options.commit(pending,view,batch.phase);}
  }
  return commands;
 }
}

export class EngineKernel<Context,Command>{
 readonly scheduler:ModuleScheduler;
 private readonly modules=new Map<string,EngineModule<Context,Command>>();
 private readonly plugins=new Set<string>();
 private readonly programs=new Map<string,KernelProgram<Context,Command>>();
 constructor(tickRate=60,capacity=64){this.scheduler=new ModuleScheduler(tickRate,capacity);}
 use(module:EngineModule<Context,Command>):this{
  if(typeof module.run!=='function')throw new TypeError('Kernel modules require a synchronous implementation');
  this.scheduler.use(module);this.modules.set(module.id,Object.freeze({...stable(module),run:module.run}));this.programs.clear();return this;
 }
 usePlugin(plugin:EnginePlugin<Context,Command>):this{
  if(!plugin||typeof plugin.id!=='string'||!plugin.id||plugin.id.length>180||this.plugins.has(plugin.id))throw new TypeError('Plugins require distinct stable IDs');
  if(!Array.isArray(plugin.modules)||!plugin.modules.length)throw new TypeError('Plugin must contain at least one module');
  for(const module of plugin.modules)if(typeof module.run!=='function')throw new TypeError('Kernel modules require a synchronous implementation');
  this.scheduler.useMany(plugin.modules);
  for(const module of plugin.modules)this.modules.set(module.id,Object.freeze({...stable(module),run:module.run}));
  this.plugins.add(plugin.id);this.programs.clear();return this;
 }
 compile(input:SimulationProfileInput='detailed'):KernelProgram<Context,Command>{
  const profile=simulationProfile(input),key=simulationProfileKey(profile),found=this.programs.get(key);if(found)return found;
  const program=new KernelProgram(this.scheduler.tickRate,this.scheduler.compile(profile),this.modules);
  if(this.programs.size>=64)this.programs.delete(this.programs.keys().next().value!);this.programs.set(key,program);return program;
 }
 run(tick:number,context:Readonly<Context>,profile:SimulationProfileInput='detailed',options:KernelRunOptions<Context,Command>={}):Command[]{
  return this.compile(profile).run(tick,context,options);
 }
 get diagnostics(){return{...this.scheduler.diagnostics,plugins:this.plugins.size,compiledPrograms:this.programs.size};}
}
