import type {Vec3} from '../math.js';
import {finiteVec3} from '../math.js';

export interface FluidVolumeSpec {
 readonly id:string;
 readonly center:Vec3;
 readonly shape:'box'|'cylinder';
 /** Box dimensions. */
 readonly sizeM?:Vec3;
 /** Cylinder radius in XZ. */
 readonly radiusM?:number;
 /** Cylinder vertical depth. */
 readonly depthM?:number;
 readonly densityKgM3:number;
 readonly velocity?:Vec3;
 readonly dragCoefficient?:number;
}
export interface FluidSample {
 readonly id:string;
 readonly bottomY:number;
 readonly surfaceY:number;
 readonly densityKgM3:number;
 readonly velocity:Vec3;
 readonly dragCoefficient:number;
}
interface CompiledFluid extends FluidSample {
 readonly shape:'box'|'cylinder';readonly centerX:number;readonly centerZ:number;readonly halfX:number;readonly halfZ:number;readonly radiusM:number;
}
const finitePositive=(x:number,label:string)=>{if(!Number.isFinite(x)||x<=0)throw new RangeError(label);return x;};

export function validateFluidVolume(spec:FluidVolumeSpec):void{
 if(!spec.id||spec.id.length>180)throw new TypeError('Fluid volume id');
 finiteVec3(spec.center,'Fluid center');finitePositive(spec.densityKgM3,'Fluid density');
 if(spec.velocity)finiteVec3(spec.velocity,'Fluid velocity');
 if(!Number.isFinite(spec.dragCoefficient??1)||(spec.dragCoefficient??1)<0||(spec.dragCoefficient??1)>10)throw new RangeError('Fluid drag coefficient');
 if(spec.shape==='box'){
  if(!spec.sizeM)throw new TypeError('Box fluid requires sizeM');finiteVec3(spec.sizeM,'Fluid size');for(const x of spec.sizeM)finitePositive(x,'Fluid size');
 }else if(spec.shape==='cylinder'){
  finitePositive(spec.radiusM??0,'Fluid radius');finitePositive(spec.depthM??0,'Fluid depth');
 }else throw new TypeError('Unknown fluid shape');
}

/** Immutable spatial field. It resolves only authored fluid state; forces stay in PhysicsWorld. */
export class FluidField {
 private readonly volumes:readonly CompiledFluid[];
 constructor(specs:readonly FluidVolumeSpec[]=[]){
  const ids=new Set<string>();
  this.volumes=Object.freeze(specs.map(raw=>{
   const spec=structuredClone(raw);validateFluidVolume(spec);if(ids.has(spec.id))throw new TypeError(`Duplicate fluid ${spec.id}`);ids.add(spec.id);
   const velocity=Object.freeze([...(spec.velocity??[0,0,0])]) as Vec3,dragCoefficient=spec.dragCoefficient??1;
   if(spec.shape==='box'){
    const size=spec.sizeM!,bottomY=spec.center[1]-size[1]/2,surfaceY=spec.center[1]+size[1]/2;
    return Object.freeze({id:spec.id,shape:'box' as const,centerX:spec.center[0],centerZ:spec.center[2],halfX:size[0]/2,halfZ:size[2]/2,radiusM:0,bottomY,surfaceY,densityKgM3:spec.densityKgM3,velocity,dragCoefficient});
   }
   const depth=spec.depthM!,bottomY=spec.center[1]-depth/2,surfaceY=spec.center[1]+depth/2;
   return Object.freeze({id:spec.id,shape:'cylinder' as const,centerX:spec.center[0],centerZ:spec.center[2],halfX:0,halfZ:0,radiusM:spec.radiusM!,bottomY,surfaceY,densityKgM3:spec.densityKgM3,velocity,dragCoefficient});
  }));
 }
 sampleXZ(x:number,z:number):FluidSample|undefined{
  if(!Number.isFinite(x)||!Number.isFinite(z))throw new TypeError('Fluid sample coordinates');
  let best:CompiledFluid|undefined;
  for(const v of this.volumes){
   const inside=v.shape==='box'?Math.abs(x-v.centerX)<=v.halfX&&Math.abs(z-v.centerZ)<=v.halfZ:Math.hypot(x-v.centerX,z-v.centerZ)<=v.radiusM;
   if(inside&&(!best||v.surfaceY>best.surfaceY))best=v;
  }
  return best;
 }
 get size():number{return this.volumes.length;}
}
