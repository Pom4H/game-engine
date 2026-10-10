/** Fixed, continuous 180-frame route through City Benchmark.
 * The route changes camera only, never car velocity or physical state.
 */
export const CITY_ROUTE_TICKS=180;
export const CITY_ROUTE_SECONDS=CITY_ROUTE_TICKS/60;
export const cityRoute=Object.freeze([
 {id:'sidewalk',from:0,to:59,description:'Eye-level sidewalk and pedestrians'},
 {id:'traffic',from:60,to:119,description:'Road-level vehicles and contacts'},
 {id:'overlook',from:120,to:179,description:'High-angle dense skyline'},
]);
const lerp=(a,b,t)=>a+(b-a)*t;
const mix=(a,b,t)=>a.map((v,i)=>lerp(v,b[i],t));
export function cityCameraAtTick(tick){
 if(!Number.isSafeInteger(tick)||tick<0||tick>=CITY_ROUTE_TICKS)
  throw new RangeError('Camera tick out of fixed route');
 let start,end,t,position,target;
 if(tick<60){
  start=[-61,2.1,6.2];end=[-10,1.9,5.5];t=tick/60;
  position=mix(start,end,t);
  target=[position[0]+17,1.6,position[2]-3.5];
 }else if(tick<120){
  start=[-10,1.9,5.5];end=[80,1.8,1.4];t=(tick-60)/60;
  position=mix(start,end,t);
  target=[position[0]+17,1.3,position[2]-.8];
 }else{
  start=[80,1.8,1.4];end=[118,16,18];t=(tick-120)/59;
  position=mix(start,end,t);
  target=[position[0]+16,5+2*t,position[2]+9];
 }
 return {position,target,fov:56,focusDistance:32,aperture:.015};
}
