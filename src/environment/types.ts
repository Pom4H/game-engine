import type {Vec3} from '../math.js';

export type Precipitation='arid'|'rare'|'occasional'|'frequent';
export type Snowfall='none'|'light'|'moderate'|'heavy';

export interface EnvironmentClockSpec {
  /** Civil hour at simulation t=0, 0..24. */
  startHour?:number;
  /** Demo/accelerated-world clock. 1 means one simulated hour per real second. */
  hoursPerSecond?:number;
}

export interface WeatherKeyframe {
  /** Civil hour, 0..24. Keyframes are interpolated in chronological order. */
  hour:number;
  temperatureC?:number;
  snowfall?:Snowfall;
  sunlight?:number;
  humidity?:number;
  wind?:Vec3;
}

export interface EnvironmentSpec {
  /** Relative humidity, 0..1. */
  humidity?:number;
  temperatureC?:number;
  precipitation?:Precipitation;
  snowfall?:Snowfall;
  /** Long-term/current direct + indirect solar exposure, 0..1. */
  sunlight?:number;
  wind?:Vec3;
  /** Soil / persistent near-ground moisture, 0..1. */
  groundMoisture?:number;
  clock?:EnvironmentClockSpec;
  weather?:readonly WeatherKeyframe[];
}

export interface EnvironmentState {
  readonly hour:number;
  readonly humidity:number;
  readonly temperatureC:number;
  readonly precipitation:Precipitation;
  readonly precipitationLoad:number;
  readonly snowfall:Snowfall;
  /** Approximate fresh-snow water-equivalent deposition in m/s. */
  readonly snowfallRate:number;
  readonly sunlight:number;
  readonly wind:Vec3;
  readonly groundMoisture:number;
}

export function resolveEnvironment(spec:EnvironmentSpec={}):EnvironmentState{return resolveEnvironmentAt(spec,0);}
export function environmentTimeScale(spec:EnvironmentSpec={}):number{const hoursPerSecond=Math.max(0,finite(spec.clock?.hoursPerSecond,0));return hoursPerSecond>0?hoursPerSecond*3600:1;}

export function resolveEnvironmentAt(spec:EnvironmentSpec={},timeSeconds=0):EnvironmentState{
  const precipitation=spec.precipitation??'occasional',clock=spec.clock??{},startHour=wrapHour(clock.startHour??12),hoursPerSecond=Math.max(0,finite(clock.hoursPerSecond,0));
  const hour=wrapHour(startHour+Math.max(0,timeSeconds)*hoursPerSecond);
  const base={
    temperatureC:finite(spec.temperatureC,18),
    snowfall:spec.snowfall??'none' as Snowfall,
    sunlight:clamp01(spec.sunlight??defaultSunlight(hour)),
    humidity:clamp01(spec.humidity??.55),
    wind:(spec.wind??[0,0,0]) as Vec3,
  };
  const weather=interpolateWeather(spec.weather??[],hour,base),snowfall=weather.snowfall;
  return Object.freeze({
    hour,
    humidity:weather.humidity,
    temperatureC:weather.temperatureC,
    precipitation,
    precipitationLoad:precipitation==='arid'?0:precipitation==='rare'?.18:precipitation==='occasional'?.48:.82,
    snowfall,
    snowfallRate:snowfallRate(snowfall),
    sunlight:weather.sunlight,
    wind:weather.wind,
    groundMoisture:clamp01(spec.groundMoisture??.35),
  });
}

function interpolateWeather(keyframes:readonly WeatherKeyframe[],hour:number,base:{temperatureC:number;snowfall:Snowfall;sunlight:number;humidity:number;wind:Vec3}){
  const frames=[...keyframes].filter(frame=>Number.isFinite(frame.hour)).sort((a,b)=>a.hour-b.hour);
  if(!frames.length)return base;
  let previous:WeatherKeyframe|undefined,next:WeatherKeyframe|undefined;
  for(const frame of frames){if(frame.hour<=hour)previous=frame;if(frame.hour>hour){next=frame;break;}}
  previous??=frames[0];next??=frames.at(-1);
  if(!previous||!next)return base;
  const span=Math.max(1e-9,next.hour-previous.hour),t=previous===next?0:clamp01((hour-previous.hour)/span);
  const lerp=(a:number,b:number)=>a+(b-a)*t;
  const previousWind=previous.wind??base.wind,nextWind=next.wind??previousWind;
  return{
    temperatureC:lerp(previous.temperatureC??base.temperatureC,next.temperatureC??previous.temperatureC??base.temperatureC),
    // Snowfall changes discretely at the midpoint; precipitation phase is not a numeric blend.
    snowfall:t<.5?(previous.snowfall??base.snowfall):(next.snowfall??previous.snowfall??base.snowfall),
    sunlight:clamp01(lerp(previous.sunlight??defaultSunlight(previous.hour),next.sunlight??defaultSunlight(next.hour))),
    humidity:clamp01(lerp(previous.humidity??base.humidity,next.humidity??previous.humidity??base.humidity)),
    wind:[lerp(previousWind[0],nextWind[0]),lerp(previousWind[1],nextWind[1]),lerp(previousWind[2],nextWind[2])] as Vec3,
  };
}
function snowfallRate(value:Snowfall):number{return value==='heavy'?2.2e-5:value==='moderate'?1.1e-5:value==='light'?4e-6:0;}
function defaultSunlight(hour:number):number{const daylight=Math.sin(Math.PI*clamp01((hour-6)/12));return Math.max(0,daylight);}
function wrapHour(value:number){const wrapped=value%24;return wrapped<0?wrapped+24:wrapped;}
function clamp01(value:number){return Math.max(0,Math.min(1,Number.isFinite(value)?value:0));}
function finite(value:number|undefined,fallback:number){return value!==undefined&&Number.isFinite(value)?value:fallback;}
