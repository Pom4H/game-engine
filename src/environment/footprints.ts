import type {Vec3} from '../math.js';
export interface FootContact {readonly id:string;readonly position:Vec3;readonly grounded:boolean;readonly yaw?:number}
export interface SnowFootprint {readonly sequence:number;readonly foot:string;readonly position:Vec3;readonly yaw:number;readonly time:number;readonly depth:number;readonly ellipse?:readonly[number,number]}
/** Foot planting, not elapsed time, creates a stamp. Airborne feet and bare ground
 * cannot leave snow impressions. Bounded storage keeps long sessions finite. */
export class SnowFootprints {
 private readonly planted=new Set<string>();private sequence=0;private lastTime=-Infinity;
 private readonly records:SnowFootprint[]=[];
 constructor(readonly capacity=256){if(!Number.isSafeInteger(capacity)||capacity<1||capacity>10000)throw new RangeError('Invalid footprint capacity');}
 update(time:number,contacts:readonly FootContact[],surface:(position:Vec3)=>{height:number;snowDepth:number}|undefined):readonly SnowFootprint[]{
  if(!Number.isFinite(time)||time<this.lastTime)throw new RangeError('Footprint time must increase');
  const live=new Set<string>();
  // Validate the whole submitted frame before changing persistent contact state.
  for(const foot of contacts){
   if(typeof foot.id!=='string'||!foot.id||live.has(foot.id)||typeof foot.grounded!=='boolean'||foot.position.length!==3||foot.position.some(v=>!Number.isFinite(v))||!Number.isFinite(foot.yaw??0))throw new TypeError('Invalid foot contact');
   live.add(foot.id);
  }
  const grounds=contacts.map(foot=>surface(foot.position));
  for(const ground of grounds)if(ground&&(!Number.isFinite(ground.height)||!Number.isFinite(ground.snowDepth)||ground.snowDepth<0))throw new TypeError('Invalid snow surface');
  this.lastTime=time;const created:SnowFootprint[]=[];
  for(let index=0;index<contacts.length;index++){
   const foot=contacts[index]!,ground=grounds[index],touching=foot.grounded&&ground&&ground.snowDepth>=.005&&Math.abs(foot.position[1]-ground.height)<.025;
   if(touching&&!this.planted.has(foot.id)){
    const stamp=Object.freeze({sequence:this.sequence++,foot:foot.id,position:Object.freeze([...foot.position]) as Vec3,yaw:foot.yaw??0,time,depth:Math.min(.025,ground.snowDepth*.5)});
    this.records.push(stamp);created.push(stamp);if(this.records.length>this.capacity)this.records.shift();
   }
   if(touching)this.planted.add(foot.id);else this.planted.delete(foot.id);
  }
  for(const id of this.planted)if(!live.has(id))this.planted.delete(id);
  return created;
 }
 snapshot():readonly SnowFootprint[]{return this.records.slice();}
}
