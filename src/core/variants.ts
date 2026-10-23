import {simulationDepth,simulationProfile,simulationProfileKey,validateEngineDepth,type EngineDepth,type SimulationProfile,type SimulationProfileInput} from './depth.js';

export interface DepthRange{
 readonly axis:string;
 readonly min?:EngineDepth;
 readonly max?:EngineDepth;
}
export interface DepthVariant<T>{
 readonly id:string;
 readonly slot:string;
 readonly depth?:DepthRange;
 readonly value:T;
}
export interface DepthVariantPlugin<T>{
 readonly id:string;
 readonly variants:readonly DepthVariant<T>[];
}
export interface CompiledDepthVariant<T>{
 readonly id:string;
 readonly slot:string;
 readonly depth:EngineDepth;
 readonly value:T;
}
export interface CompiledDepthVariants<T>{
 readonly profile:SimulationProfile;
 readonly selected:ReadonlyMap<string,CompiledDepthVariant<T>>;
 get(slot:string):T|undefined;
 require(slot:string):T;
}

const minDepth=(variant:DepthVariant<unknown>)=>variant.depth?.min??0;
const maxDepth=(variant:DepthVariant<unknown>)=>variant.depth?.max??255;

function validateVariant<T>(variant:DepthVariant<T>,seen:Set<string>):DepthVariant<T>{
 if(!variant||typeof variant!=='object')throw new TypeError('Depth variant must be an object');
 if(typeof variant.id!=='string'||!variant.id||variant.id.length>180||seen.has(variant.id))throw new TypeError('Depth variants require distinct stable IDs');
 if(typeof variant.slot!=='string'||!variant.slot||variant.slot.length>180)throw new TypeError('Depth variants require stable slots');
 if(variant.depth){
  if(typeof variant.depth.axis!=='string'||!variant.depth.axis||variant.depth.axis.length>180)throw new TypeError('Depth variant axis requires a stable name');
  const min=validateEngineDepth(variant.depth.min??0,variant.id+'.min'),max=validateEngineDepth(variant.depth.max??255,variant.id+'.max');
  if(min>max)throw new RangeError(`Depth variant ${variant.id} has inverted range`);
 }
 seen.add(variant.id);
 return Object.freeze({...variant,...(variant.depth?{depth:Object.freeze({...variant.depth})}:{})});
}
function eligible<T>(variant:DepthVariant<T>,profile:SimulationProfile):boolean{
 if(!variant.depth)return true;
 const depth=simulationDepth(profile,variant.depth.axis);
 return depth>=minDepth(variant)&&depth<=maxDepth(variant);
}

/** Selects one implementation per slot once. The selected value is then a direct
 * reference; callers do not pay depth/plugin dispatch in their hot path. */
export function compileDepthVariants<T>(input:SimulationProfileInput,variants:readonly DepthVariant<T>[]):CompiledDepthVariants<T>{
 const profile=simulationProfile(input),groups=new Map<string,DepthVariant<T>[]>();
 for(const variant of variants){
  const list=groups.get(variant.slot);if(list)list.push(variant);else groups.set(variant.slot,[variant]);
 }
 const selected=new Map<string,CompiledDepthVariant<T>>();
 for(const [slot,group] of groups){
  const candidates=group.filter(variant=>eligible(variant,profile));
  if(!candidates.length)continue;
  candidates.sort((a,b)=>minDepth(b)-minDepth(a)||maxDepth(a)-maxDepth(b)||(a.id<b.id?-1:a.id>b.id?1:0));
  if(candidates.length>1&&minDepth(candidates[0]!)===minDepth(candidates[1]!)&&maxDepth(candidates[0]!)===maxDepth(candidates[1]!))throw new TypeError(`Ambiguous depth variants for slot ${slot}`);
  const variant=candidates[0]!,depth=variant.depth?simulationDepth(profile,variant.depth.axis):profile.defaultDepth;
  selected.set(slot,Object.freeze({id:variant.id,slot,depth,value:variant.value}));
 }
 const frozen=selected as ReadonlyMap<string,CompiledDepthVariant<T>>;
 return Object.freeze({
  profile,selected:frozen,
  get:(slot:string)=>frozen.get(slot)?.value,
  require:(slot:string)=>{
   const found=frozen.get(slot);if(!found)throw new TypeError(`No compiled implementation for slot ${slot}`);return found.value;
  },
 });
}

export class DepthVariantRegistry<T>{
 private readonly variants:DepthVariant<T>[]=[];
 private readonly ids=new Set<string>();
 private readonly plugins=new Set<string>();
 private readonly compiled=new Map<string,CompiledDepthVariants<T>>();
 constructor(readonly capacity=256){if(!Number.isSafeInteger(capacity)||capacity<1)throw new RangeError('Invalid depth variant capacity');}
 use(variant:DepthVariant<T>):this{return this.useMany([variant]);}
 useMany(variants:readonly DepthVariant<T>[]):this{
  if(this.variants.length+variants.length>this.capacity)throw new RangeError('Depth variant registry is full');
  const seen=new Set(this.ids),prepared=variants.map(variant=>validateVariant(variant,seen));
  for(const variant of prepared){this.ids.add(variant.id);this.variants.push(variant);}
  this.compiled.clear();return this;
 }
 usePlugin(plugin:DepthVariantPlugin<T>):this{
  if(!plugin||typeof plugin.id!=='string'||!plugin.id||plugin.id.length>180||this.plugins.has(plugin.id))throw new TypeError('Depth plugins require distinct stable IDs');
  if(!Array.isArray(plugin.variants)||!plugin.variants.length)throw new TypeError('Depth plugin must contain variants');
  this.useMany(plugin.variants);this.plugins.add(plugin.id);return this;
 }
 compile(input:SimulationProfileInput='detailed'):CompiledDepthVariants<T>{
  const profile=simulationProfile(input),key=simulationProfileKey(profile),found=this.compiled.get(key);if(found)return found;
  const result=compileDepthVariants(profile,this.variants);
  if(this.compiled.size>=64)this.compiled.delete(this.compiled.keys().next().value!);
  this.compiled.set(key,result);return result;
 }
 get diagnostics(){return Object.freeze({variants:this.variants.length,plugins:this.plugins.size,compiledProfiles:this.compiled.size});}
}
