import type {Vec3} from '../math.js';

export type Precipitation='arid'|'rare'|'occasional'|'frequent';

export interface EnvironmentSpec {
  /** Relative humidity, 0..1. */
  humidity?:number;
  temperatureC?:number;
  precipitation?:Precipitation;
  /** Long-term average direct/indirect solar exposure, 0..1. */
  sunlight?:number;
  wind?:Vec3;
  /** Soil / persistent near-ground moisture, 0..1. */
  groundMoisture?:number;
}

export interface EnvironmentState {
  readonly humidity:number;
  readonly temperatureC:number;
  readonly precipitation:Precipitation;
  readonly precipitationLoad:number;
  readonly sunlight:number;
  readonly wind:Vec3;
  readonly groundMoisture:number;
}

export function resolveEnvironment(spec:EnvironmentSpec={}):EnvironmentState{
  const precipitation=spec.precipitation??'occasional';
  const wind:Vec3=spec.wind??[0,0,0];
  return Object.freeze({
    humidity:clamp01(spec.humidity??.55),
    temperatureC:finite(spec.temperatureC,18),
    precipitation,
    precipitationLoad:precipitation==='arid'?0:precipitation==='rare'?.18:precipitation==='occasional'?.48:.82,
    sunlight:clamp01(spec.sunlight??.65),
    wind,
    groundMoisture:clamp01(spec.groundMoisture??.35),
  });
}
function clamp01(value:number){return Math.max(0,Math.min(1,Number.isFinite(value)?value:0));}
function finite(value:number|undefined,fallback:number){return value!==undefined&&Number.isFinite(value)?value:fallback;}
