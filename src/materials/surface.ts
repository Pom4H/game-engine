import type {EnvironmentState} from '../environment/types.js';
import type {PhysicalMaterial} from './catalog.js';

export type MaterialFinish='raw'|'rough'|'smooth'|'polished'|'weathered';
export type MaterialTreatment='none'|'sealed'|'biocide'|'galvanized'|'painted';

/** GPU optical wetness supplied by another simulation. No contact/friction state
 * is changed; an authored material roughness is already the final wet roughness. */
/** Read-only projection of the native surface model, including its snowpack history. */
export interface SurfaceSnowAppearance {
 readonly snowDepthM:number;readonly waterDepthM:number;readonly iceDepthM:number;readonly slush:number;
 readonly freshness:number;readonly liquidFraction:number;readonly crust:number;readonly grainSizeMm:number;
}
export interface SurfaceAppearance {readonly wetness:number;readonly darkening:number;readonly snow?:SurfaceSnowAppearance}
export function validateSurfaceAppearance(value:unknown):asserts value is SurfaceAppearance{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError('surfaceAppearance must be an object');
 const fields=value as Record<string,unknown>;
 if(Object.keys(fields).some(key=>key!=='wetness'&&key!=='darkening'&&key!=='snow'))throw new TypeError('surfaceAppearance contains an unknown optical field');
 for(const key of ['wetness','darkening']){const n=fields[key];if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>1)throw new TypeError(`surfaceAppearance.${key} must be finite within 0..1`);}
 if(fields.snow!==undefined){
  if(!fields.snow||typeof fields.snow!=='object'||Array.isArray(fields.snow))throw new TypeError('surfaceAppearance.snow must be an object');
  const snow=fields.snow as Record<string,unknown>,depths=['snowDepthM','waterDepthM','iceDepthM','grainSizeMm'],fractions=['slush','freshness','liquidFraction','crust'];
  if(Object.keys(snow).some(key=>!depths.includes(key)&&!fractions.includes(key)))throw new TypeError('surfaceAppearance.snow contains an unknown field');
  for(const key of [...depths,...fractions]){const n=snow[key];if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>(depths.includes(key)?100:1))throw new TypeError(`Invalid surfaceAppearance.snow.${key}`);}
 }
}

export interface MaterialSurfaceSpec {
  finish?:MaterialFinish;
  /** Existing exposure history. The environment determines what that history produced. */
  ageYears?:number;
  treatment?:MaterialTreatment;
}

export interface SurfaceState {
  readonly wetness:number;
  readonly moss:number;
  readonly dirt:number;
  readonly wear:number;
  readonly roughness:number;
  readonly frictionScale:number;
  readonly acousticDamping:number;
  readonly darkening:number;
}

export function deriveSurfaceState(profile:PhysicalMaterial,spec:MaterialSurfaceSpec,environment:EnvironmentState):SurfaceState{
  const finish=spec.finish??'raw',age=Math.max(0,Number.isFinite(spec.ageYears)?spec.ageYears??0:0),treatment=spec.treatment??'none';
  const finishRoughness=finish==='polished'?.18:finish==='smooth'?.38:finish==='rough'?.82:finish==='weathered'?.9:.62;
  const seal=treatment==='sealed'?.18:treatment==='painted'?.3:treatment==='galvanized'?.45:1;
  const biocide=treatment==='biocide'?.05:1;
  const windSpeed=Math.hypot(...environment.wind),drying=Math.min(1,environment.sunlight*.62+Math.min(1,windSpeed/12)*.38);
  const moistureDrive=environment.humidity*.5+environment.precipitationLoad*.36+environment.groundMoisture*.14;
  const wetness=clamp01(moistureDrive*(.45+profile.surface.waterRetention*.65)*(1-drying*.48)*seal);
  const ageMaturity=1-Math.exp(-age/2.8),temperatureSuitability=Math.exp(-Math.pow((environment.temperatureC-14)/17,2));
  const shade=1-environment.sunlight,roughCapture=.45+finishRoughness*.55;
  const mossPotential=profile.surface.bioAffinity*ageMaturity*temperatureSuitability*roughCapture*biocide*clamp01((wetness-.22)/.58)*(.45+shade*.75);
  const moss=clamp01(mossPotential*1.28);
  const dirt=clamp01((1-Math.exp(-age/5))*profile.surface.dirtAffinity*(.42+finishRoughness*.38+shade*.2));
  const wear=clamp01((1-Math.exp(-age/12))*profile.surface.weathering*(treatment==='sealed'?.55:1));
  const roughness=clamp01(profile.surface.baseRoughness*.62+finishRoughness*.38+wear*.12+moss*.08-wetness*.08);
  const frictionScale=Math.max(.38,Math.min(1.18,1-wetness*.18-moss*.38+dirt*.035));
  const acousticDamping=clamp01(profile.acoustic.damping+wetness*.2+moss*.34);
  const darkening=clamp01(wetness*.3+moss*.08+dirt*.1);
  return Object.freeze({wetness,moss,dirt,wear,roughness,frictionScale,acousticDamping,darkening});
}

export function effectiveFriction(profile:PhysicalMaterial,state:SurfaceState):number{return Math.max(.02,profile.friction*state.frictionScale);}

function clamp01(value:number){return Math.max(0,Math.min(1,Number.isFinite(value)?value:0));}
