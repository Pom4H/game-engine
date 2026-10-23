/** Smooth seeded forcing on one absolute simulation clock. No per-frame RNG. */
export type WeatherTimeline={epochMinute:number;initialTemperatureC:number;minimumC:number;maximumC:number};
const smooth=(v:number)=>v*v*(3-2*v),clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
function random(seed:number,slot:number,salt:number){let n=Math.imul(seed^salt,374761393)^Math.imul(slot,668265263);n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967295;}
export const DEFAULT_WEATHER_TIMELINE:WeatherTimeline=Object.freeze({epochMinute:480,initialTemperatureC:0,minimumC:-10,maximumC:25});
export function weatherTemperature(seed:number,minute:number,timeline:WeatherTimeline=DEFAULT_WEATHER_TIMELINE):number{
 if(![minute,...Object.values(timeline)].every(Number.isFinite)||timeline.minimumC>timeline.maximumC)throw RangeError('Invalid weather timeline');
 const time=Math.max(0,minute-timeline.epochMinute)/360,slot=Math.floor(time),blend=smooth(time-slot);
 const knot=(index:number)=>index===0?timeline.initialTemperatureC:timeline.minimumC+random(seed,index,971)* (timeline.maximumC-timeline.minimumC);
 return clamp(knot(slot)*(1-blend)+knot(slot+1)*blend,timeline.minimumC,timeline.maximumC);
}
export function weatherFront(seed:number,minute:number,x:number,z:number,timeline:WeatherTimeline=DEFAULT_WEATHER_TIMELINE){
 const elapsed=Math.max(0,minute-timeline.epochMinute),phase=(elapsed+x/28+z/43)/240,slot=Math.floor(phase),blend=smooth(phase-slot);
 const knot=(i:number)=>({cloud:random(seed,i,977),moisture:random(seed,i,983)}),a=knot(slot),b=knot(slot+1);
 const cloud=a.cloud*(1-blend)+b.cloud*blend,moisture=a.moisture*(1-blend)+b.moisture*blend;
 return {cloudCoverage:clamp(.08+cloud*.98,0,1),precipitation:clamp((cloud-.58)*2.8,0,1)*clamp((moisture-.25)*1.8,0,1),fog:clamp((moisture-.78)*3,0,1)*(1-cloud*.4)};
}
