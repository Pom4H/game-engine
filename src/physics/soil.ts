import type {Vec3} from '../math.js';
import {finiteVec3} from '../math.js';
import {wheelHit,type WheelHit,type WheelSupport} from './wheel-support.js';

export interface SoilVolumeSpec {
 readonly id:string;
 /** Centre of the undeformed horizontal soil surface. */
 readonly center:Vec3;
 /** X/Z dimensions of the test field. */
 readonly sizeM:readonly [number,number];
 readonly cells?:readonly [number,number];
 /** Pressure scale that produces substantial sinkage. */
 readonly pressureScalePa:number;
 readonly sinkageExponent?:number;
 readonly maxSinkageM:number;
 /** Mohr-Coulomb approximation for available shear traction. */
 readonly cohesionPa?:number;
 readonly frictionAngleDeg:number;
 /** Permanent compaction response rate. */
 readonly compactionRatePerSecond?:number;
 /** Baseline rolling resistance before rut/sinkage contribution. */
 readonly rollingResistance?:number;
}
export interface SoilSample {
 readonly id:string;
 readonly surfaceY:number;
 readonly sinkageM:number;
 readonly compaction:number;
 readonly tractionCoefficient:number;
 readonly rollingResistanceCoefficient:number;
}
export interface SoilContactInput {
 readonly normalLoadN:number;
 readonly contactAreaM2:number;
 readonly wheelRadiusM:number;
 readonly slipRatio:number;
 readonly dt:number;
}
export interface SoilContactResult extends SoilSample {
 readonly pressurePa:number;
 readonly rollingResistanceN:number;
}
interface SoilCell {sinkageM:number;compaction:number}
interface Compiled {
 readonly spec:Readonly<SoilVolumeSpec>;
 readonly halfX:number;readonly halfZ:number;readonly nx:number;readonly nz:number;readonly cells:SoilCell[];
}
const clamp=(x:number,a=0,b=1)=>Math.max(a,Math.min(b,x));
const positive=(x:number,label:string)=>{if(!Number.isFinite(x)||x<=0)throw new RangeError(label);return x;};

export function validateSoilVolume(spec:SoilVolumeSpec):void{
 if(!spec.id||spec.id.length>180)throw new TypeError('Soil id');
 finiteVec3(spec.center,'Soil center');
 if(!Array.isArray(spec.sizeM)||spec.sizeM.length!==2)throw new TypeError('Soil size');
 positive(spec.sizeM[0],'Soil size');positive(spec.sizeM[1],'Soil size');
 positive(spec.pressureScalePa,'Soil pressure scale');positive(spec.maxSinkageM,'Soil max sinkage');
 const exponent=spec.sinkageExponent??1;if(!Number.isFinite(exponent)||exponent<.2||exponent>4)throw new RangeError('Soil sinkage exponent');
 if(!Number.isFinite(spec.cohesionPa??0)||(spec.cohesionPa??0)<0)throw new RangeError('Soil cohesion');
 if(!Number.isFinite(spec.frictionAngleDeg)||spec.frictionAngleDeg<0||spec.frictionAngleDeg>=60)throw new RangeError('Soil friction angle');
 if(!Number.isFinite(spec.compactionRatePerSecond??.8)||(spec.compactionRatePerSecond??.8)<0)throw new RangeError('Soil compaction rate');
 if(!Number.isFinite(spec.rollingResistance??.035)||(spec.rollingResistance??.035)<0||(spec.rollingResistance??.035)>1)throw new RangeError('Soil rolling resistance');
 if(spec.cells){for(const n of spec.cells)if(!Number.isSafeInteger(n)||n<1||n>256)throw new RangeError('Soil cells');}
}

/** Persistent deformable bearing field for wheel/track contact.
 * It stores only terrain state. Vehicle forces remain owned by Vehicle/PhysicsWorld. */
export class SoilField {
 private readonly volumes:readonly Compiled[];
 constructor(specs:readonly SoilVolumeSpec[]=[]){
  const ids=new Set<string>();
  this.volumes=Object.freeze(specs.map(raw=>{
   const spec=structuredClone(raw);validateSoilVolume(spec);if(ids.has(spec.id))throw new TypeError(`Duplicate soil ${spec.id}`);ids.add(spec.id);
   const nx=spec.cells?.[0]??16,nz=spec.cells?.[1]??16;
   return{spec:Object.freeze(spec),halfX:spec.sizeM[0]/2,halfZ:spec.sizeM[1]/2,nx,nz,cells:Array.from({length:nx*nz},()=>({sinkageM:0,compaction:0}))};
  }));
 }
 get size():number{return this.volumes.length;}
 private locate(x:number,z:number):{volume:Compiled;cell:SoilCell}|undefined{
  for(const volume of this.volumes){
   const {spec,halfX,halfZ,nx,nz}=volume,u=(x-(spec.center[0]-halfX))/(halfX*2),v=(z-(spec.center[2]-halfZ))/(halfZ*2);
   if(u<0||u>1||v<0||v>1)continue;
   const ix=Math.min(nx-1,Math.floor(u*nx)),iz=Math.min(nz-1,Math.floor(v*nz));
   return{volume,cell:volume.cells[iz*nx+ix]!};
  }
  return undefined;
 }
 sample(x:number,z:number):SoilSample|undefined{
  if(!Number.isFinite(x)||!Number.isFinite(z))throw new TypeError('Soil sample coordinates');
  const located=this.locate(x,z);if(!located)return undefined;
  const {volume,cell}=located,s=volume.spec,pressure=s.pressureScalePa;
  const traction=clamp(Math.tan(s.frictionAngleDeg*Math.PI/180)*(.62+.38*cell.compaction)+(s.cohesionPa??0)/pressure,.08,1.35);
  const rr=clamp((s.rollingResistance??.035)+cell.sinkageM/Math.max(.05,s.maxSinkageM)*.18,0,.8);
  return Object.freeze({id:s.id,surfaceY:s.center[1]-cell.sinkageM,sinkageM:cell.sinkageM,compaction:cell.compaction,tractionCoefficient:traction,rollingResistanceCoefficient:rr});
 }
 contact(x:number,z:number,input:SoilContactInput):SoilContactResult|undefined{
  const located=this.locate(x,z);if(!located)return undefined;
  for(const [value,label] of [[input.normalLoadN,'Soil load'],[input.contactAreaM2,'Soil contact area'],[input.wheelRadiusM,'Wheel radius'],[input.dt,'Soil dt']] as const)if(!Number.isFinite(value)||value<0)throw new RangeError(label);
  if(input.contactAreaM2<=0||input.wheelRadiusM<=0||input.dt<=0)return undefined;
  const {volume,cell}=located,s=volume.spec,pressure=Math.max(0,input.normalLoadN/input.contactAreaM2),ratio=pressure/s.pressureScalePa,p=Math.pow(Math.max(0,ratio),1/(s.sinkageExponent??1)),target=s.maxSinkageM*p/(1+p);
  const rate=(s.compactionRatePerSecond??.8)*(1+Math.min(4,Math.abs(input.slipRatio)*2));
  cell.sinkageM=Math.max(cell.sinkageM,cell.sinkageM+(target-cell.sinkageM)*(1-Math.exp(-rate*input.dt)));
  cell.compaction=clamp(cell.compaction+(1-cell.compaction)*(1-Math.exp(-rate*Math.min(3,ratio)*input.dt)));
  const sample=this.sample(x,z)!;
  return Object.freeze({...sample,pressurePa:pressure,rollingResistanceN:sample.rollingResistanceCoefficient*input.normalLoadN});
 }
 /** Wheel-support projection through the current rut surface. */
 cast(origin:Vec3,direction:Vec3,maxDistance:number,hit:WheelHit):boolean{
  if(direction[1]>=-1e-8)return false;
  let best=maxDistance,found:SoilSample|undefined,bx=0,bz=0;
  for(const volume of this.volumes){
   // One fixed-point refinement is enough because each grid cell is horizontal.
   let t=(volume.spec.center[1]-origin[1])/direction[1];if(t<0||t>best)continue;
   let x=origin[0]+direction[0]*t,z=origin[2]+direction[2]*t,sample=this.sample(x,z);if(!sample||sample.id!==volume.spec.id)continue;
   t=(sample.surfaceY-origin[1])/direction[1];if(t<0||t>best)continue;x=origin[0]+direction[0]*t;z=origin[2]+direction[2]*t;sample=this.sample(x,z);if(!sample||sample.id!==volume.spec.id)continue;
   best=t;found=sample;bx=x;bz=z;
  }
  if(!found)return false;
  hit.id=found.id;hit.distance=best;hit.point.splice(0,3,bx,origin[1]+direction[1]*best,bz);hit.normal.splice(0,3,0,1,0);hit.velocity.fill(0);hit.body=null;hit.triangle=-1;hit.u=hit.v=0;return true;
 }
}

/** Combine ordinary rigid support with deformable soil and select the nearest hit. */
export function soilWheelSupport(base:WheelSupport,soil:SoilField):WheelSupport{
 const scratch=wheelHit();
 return(origin,direction,maxDistance,hit,exclude)=>{
  const rigid=base(origin,direction,maxDistance,hit,exclude),limit=rigid?hit.distance:maxDistance;
  if(!soil.cast(origin,direction,limit,scratch))return rigid;
  hit.id=scratch.id;hit.distance=scratch.distance;hit.point.splice(0,3,...scratch.point);hit.normal.splice(0,3,...scratch.normal);hit.velocity.fill(0);hit.body=null;hit.triangle=-1;hit.u=hit.v=0;return true;
 };
}
