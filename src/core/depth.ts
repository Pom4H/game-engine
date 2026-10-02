import {ENGINE_DOMAINS} from './domains.js';
export type SimulationTier='detailed'|'active'|'aggregate'|'dormant';
export const SIMULATION_TIERS:readonly SimulationTier[]=Object.freeze(['detailed','active','aggregate','dormant']);

export type EngineDepth=number;
/** 0..255 leaves room for subsystem-specific LODs between the compatibility tiers. */
export const ENGINE_DEPTH=Object.freeze({
 dormant:0,
 aggregate:64,
 active:160,
 detailed:255,
} as const);

/** Compatibility name for the canonical domain axes. Plugins may still add stable custom axes. */
export const ENGINE_DEPTH_AXES=ENGINE_DOMAINS;

export interface SimulationProfile{
 readonly defaultDepth:EngineDepth;
 readonly axes:Readonly<Record<string,EngineDepth>>;
}
export interface SimulationProfileSpec{
 readonly defaultDepth?:EngineDepth;
 readonly axes?:Readonly<Record<string,EngineDepth>>;
}
export type SimulationProfileInput=SimulationTier|EngineDepth|SimulationProfileSpec;

const tierDepth:Readonly<Record<SimulationTier,EngineDepth>>=Object.freeze({
 dormant:ENGINE_DEPTH.dormant,
 aggregate:ENGINE_DEPTH.aggregate,
 active:ENGINE_DEPTH.active,
 detailed:ENGINE_DEPTH.detailed,
});

export function validateEngineDepth(value:number,label='depth'):EngineDepth{
 if(!Number.isSafeInteger(value)||value<0||value>255)throw new RangeError(`${label} must be an integer within 0..255`);
 return value;
}
export function simulationTierDepth(tier:SimulationTier):EngineDepth{
 if(!SIMULATION_TIERS.includes(tier))throw new TypeError('Unknown simulation tier');
 return tierDepth[tier];
}
export function simulationTierForDepth(depth:EngineDepth):SimulationTier{
 validateEngineDepth(depth);
 if(depth>=ENGINE_DEPTH.detailed)return'detailed';
 if(depth>=ENGINE_DEPTH.active)return'active';
 if(depth>=ENGINE_DEPTH.aggregate)return'aggregate';
 return'dormant';
}
export function simulationProfile(input:SimulationProfileInput='detailed'):SimulationProfile{
 let defaultDepth:EngineDepth,rawAxes:Readonly<Record<string,EngineDepth>>={};
 if(typeof input==='string')defaultDepth=simulationTierDepth(input);
 else if(typeof input==='number')defaultDepth=validateEngineDepth(input,'defaultDepth');
 else{
  if(!input||typeof input!=='object'||Array.isArray(input))throw new TypeError('Simulation profile must be a tier, depth, or profile object');
  defaultDepth=validateEngineDepth(input.defaultDepth??ENGINE_DEPTH.detailed,'defaultDepth');
  rawAxes=input.axes??{};
 }
 const axes:Record<string,EngineDepth>={};
 for(const key of Object.keys(rawAxes).sort()){
  if(!key||key.length>180)throw new TypeError('Depth axes require stable names');
  axes[key]=validateEngineDepth(rawAxes[key]!,'depth axis '+key);
 }
 return Object.freeze({defaultDepth,axes:Object.freeze(axes)});
}
export function simulationDepth(profile:SimulationProfile,axis:string):EngineDepth{
 if(!axis)throw new TypeError('Depth axis requires a stable name');
 return profile.axes[axis]??profile.defaultDepth;
}
export function simulationProfileKey(profile:SimulationProfile):string{
 return profile.defaultDepth+'|'+Object.entries(profile.axes).map(([key,value])=>key+'='+value).join(',');
}
