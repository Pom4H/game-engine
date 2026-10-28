import {finiteVec3,type Vec3} from '../math.js';

/** Closed world-space centreline. Parts are authored relative to points[0],
 * with local +X forward. Distance sampling keeps wheel roll and replay aligned. */
export interface VehicleRouteSpec {readonly points:readonly Vec3[];readonly offsetM?:number}
export interface RoutePose {readonly position:Vec3;readonly heading:number;readonly distanceM:number}
export class VehicleRoute {
  readonly lengthM:number;
  private readonly points:readonly Vec3[];
  private readonly lengths:number[]=[0];
  private readonly samples:Vec3[]=[];
  private readonly resolution=48;
  constructor(spec:VehicleRouteSpec){
    if(!Array.isArray(spec.points)||spec.points.length<4||spec.points.length>128)throw new TypeError('Vehicle route needs 4..128 points');
    if(!Number.isFinite(spec.offsetM??0))throw new RangeError('Route offset must be finite');
    for(const point of spec.points)finiteVec3(point,'Route point');
    this.points=spec.points.map(p=>Object.freeze([...p]) as Vec3);
    for(let i=0;i<=this.points.length*this.resolution;i++){
      const point=this.point(i/this.resolution),previous=this.samples.at(-1);
      if(previous)this.lengths.push(this.lengths.at(-1)!+Math.hypot(...point.map((v,k)=>v-previous[k]!)));
      this.samples.push(point);
    }
    this.lengthM=this.lengths.at(-1)!;
    if(!Number.isFinite(this.lengthM)||this.lengthM<.01)throw new RangeError('Vehicle route must have finite nonzero length');
  }
  private point(at:number):Vec3{
    const n=this.points.length,i=Math.floor(at),u=at-i;
    const p=(j:number)=>this.points[(j%n+n)%n]!;
    const a=p(i-1),b=p(i),c=p(i+1),d=p(i+2);
    return [0,1,2].map(k=>.5*((2*b[k]!)+(-a[k]!+c[k]!)*u+(2*a[k]!-5*b[k]!+4*c[k]!-d[k]!)*u*u+(-a[k]!+3*b[k]!-3*c[k]!+d[k]!)*u*u*u)) as unknown as Vec3;
  }
  sample(distanceM:number):RoutePose{
    if(!Number.isFinite(distanceM))throw new RangeError('Route distance must be finite');
    const distance=(distanceM%this.lengthM+this.lengthM)%this.lengthM;
    let low=0,high=this.lengths.length-1;
    while(high-low>1){const mid=(low+high)>>1;if(this.lengths[mid]!<=distance)low=mid;else high=mid;}
    const u=(distance-this.lengths[low]!)/Math.max(1e-9,this.lengths[high]!-this.lengths[low]!);
    const at=(low+u)/this.resolution,position=this.point(at),a=this.point(at-.0001),b=this.point(at+.0001);
    return {position,heading:Math.atan2(-(b[2]-a[2]),b[0]-a[0]),distanceM:distance};
  }
}
