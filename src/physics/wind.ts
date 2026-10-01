import type {Vec3} from '../math.js';
import {finiteVec3} from '../math.js';

export interface WindVolumeSpec {
 readonly id:string;
 readonly center:Vec3;
 readonly sizeM:Vec3;
 /** Absolute air velocity inside the volume, m/s. */
 readonly wind:Vec3;
 readonly densityKgM3?:number;
 /** Smooth blend from volume boundary toward authored wind. */
 readonly blendM?:number;
}
export interface AirSample {readonly densityKgM3:number;readonly wind:Vec3}

const finitePositive=(x:number,label:string)=>{if(!Number.isFinite(x)||x<=0)throw new RangeError(label);return x;};
export function validateWindVolume(spec:WindVolumeSpec):void{
 if(!spec.id||spec.id.length>180)throw new TypeError('Wind volume id');
 finiteVec3(spec.center,'Wind center');finiteVec3(spec.sizeM,'Wind size');finiteVec3(spec.wind,'Wind velocity');
 for(const x of spec.sizeM)finitePositive(x,'Wind size');
 if(spec.densityKgM3!==undefined)finitePositive(spec.densityKgM3,'Air density');
 if(spec.blendM!==undefined&&(!Number.isFinite(spec.blendM)||spec.blendM<0||spec.blendM>Math.min(...spec.sizeM)/2))throw new RangeError('Wind blend');
}
interface Compiled {readonly id:string;readonly center:Vec3;readonly half:Vec3;readonly wind:Vec3;readonly densityKgM3?:number;readonly blendM:number}
const smooth=(t:number)=>{const x=Math.max(0,Math.min(1,t));return x*x*(3-2*x);};

/** Deterministic bounded spatial air field. Volumes blend in declaration order;
 * no turbulence noise or gameplay state is hidden here. */
export class WindField {
 private readonly volumes:readonly Compiled[];
 constructor(specs:readonly WindVolumeSpec[]=[]){
  const ids=new Set<string>();
  this.volumes=Object.freeze(specs.map(raw=>{
   const s=structuredClone(raw);validateWindVolume(s);if(ids.has(s.id))throw new TypeError(`Duplicate wind volume ${s.id}`);ids.add(s.id);
   return Object.freeze({id:s.id,center:Object.freeze([...s.center]) as Vec3,half:Object.freeze(s.sizeM.map(x=>x/2)) as unknown as Vec3,wind:Object.freeze([...s.wind]) as Vec3,...(s.densityKgM3!==undefined?{densityKgM3:s.densityKgM3}:{}),blendM:s.blendM??0});
  }));
 }
 sample(point:Vec3,baseWind:Vec3=[0,0,0],baseDensity=1.225):AirSample{
  finiteVec3(point,'Air sample point');finiteVec3(baseWind,'Base wind');finitePositive(baseDensity,'Base density');
  let wind:[number,number,number]=[baseWind[0],baseWind[1],baseWind[2]],density=baseDensity;
  for(const v of this.volumes){
   const dx=v.half[0]-Math.abs(point[0]-v.center[0]),dy=v.half[1]-Math.abs(point[1]-v.center[1]),dz=v.half[2]-Math.abs(point[2]-v.center[2]),inside=Math.min(dx,dy,dz);
   if(inside<0)continue;
   const weight=v.blendM>0?smooth(inside/v.blendM):1;
   wind=[wind[0]+(v.wind[0]-wind[0])*weight,wind[1]+(v.wind[1]-wind[1])*weight,wind[2]+(v.wind[2]-wind[2])*weight];
   if(v.densityKgM3!==undefined)density+= (v.densityKgM3-density)*weight;
  }
  return Object.freeze({densityKgM3:density,wind:Object.freeze(wind) as Vec3});
 }
 get size():number{return this.volumes.length;}
}
