import type {Vec3} from '../math.js';
/** Visual detail is derived from full 3D camera distance, never authority residency/AOI or xz distance. */
export function projectedRadiusPx(center:Vec3,radiusM:number,eye:Vec3,verticalFovRad:number,heightPx:number):number{
 if([...center,...eye,radiusM,verticalFovRad,heightPx].some(v=>!Number.isFinite(v))||radiusM<=0||heightPx<=0||verticalFovRad<=0||verticalFovRad>=Math.PI)throw new RangeError('Invalid LOD bounds');
 const d=Math.hypot(center[0]-eye[0],center[1]-eye[1],center[2]-eye[2]);
 return d<=radiusM?Infinity:heightPx*.5/Math.tan(verticalFovRad*.5)*radiusM/Math.sqrt(d*d-radiusM*radiusM);
}
/** Asset producers prepare away from render. Keep the old representation until the requested
 * level of the SAME geometry revision is complete. Transform/height is not a property of a LOD. */
export class PresentationLOD<T>{
 private ready=new Map<number,T>();private pending=1;private revision=0;
 level:number;requested:number;switches=0;
 constructor(readonly thresholdsPx:readonly number[],initial:T,initialLevel=0,readonly hysteresis=.12){
  if(thresholdsPx.some((n,i)=>!Number.isFinite(n)||n<=0||i>0&&n>=thresholdsPx[i-1]!)||!Number.isSafeInteger(initialLevel)||initialLevel<0||initialLevel>thresholdsPx.length||!Number.isFinite(hysteresis)||hysteresis<0||hysteresis>=.5)throw new RangeError('Invalid LOD bands');
  this.level=this.requested=initialLevel;this.ready.set(initialLevel,initial);
 }
 want(radiusPx:number):{level:number;ticket:number;revision:number}{
  if(Number.isNaN(radiusPx)||radiusPx<0)throw new RangeError('Invalid projected size');let level=this.requested;
  while(level<this.thresholdsPx.length&&radiusPx<this.thresholdsPx[level]!*(1-this.hysteresis))level++;
  while(level>0&&radiusPx>this.thresholdsPx[level-1]!*(1+this.hysteresis))level--;
  if(level!==this.requested){this.requested=level;this.pending++;}return{level,ticket:this.pending,revision:this.revision};
 }
 prepared(request:{level:number;ticket:number;revision:number},asset:T):boolean{
  if(request.ticket!==this.pending||request.level!==this.requested||request.revision!==this.revision)return false;
  this.ready.set(request.level,asset);return true;
 }
 /** Geometry change invalidates ALL old LOD variants; caller provides one usable new representation. */
 revise(revision:number,asset:T,level=0):void{
  if(!Number.isSafeInteger(revision)||revision<=this.revision||!Number.isSafeInteger(level)||level<0||level>this.thresholdsPx.length)throw new RangeError('Invalid LOD revision');
  this.revision=revision;this.pending++;this.ready.clear();this.ready.set(level,asset);this.level=this.requested=level;
 }
 current():T{if(this.ready.has(this.requested)&&this.level!==this.requested){this.level=this.requested;this.switches++;}return this.ready.get(this.level)!;}
}
