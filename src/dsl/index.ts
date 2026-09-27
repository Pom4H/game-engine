import type {Vec3} from '../math.js';
import type {EntitySpec,SceneSpec,MaterialSpec,CameraSpec,Color} from '../scene/types.js';
import {vehicle,wheel,type VehicleSpec,type WingSpec,type VehicleBlueprint} from '../vehicles/components.js';
export {vehicle,wheel,wing} from '../vehicles/components.js';
export type {VehicleSpec,VehicleBlueprint,WheelSpec,WingSpec} from '../vehicles/components.js';
export type {Vec3,SceneSpec,EntitySpec,MaterialSpec};

export interface Placement {
  kind:'vehicle';blueprint:VehicleBlueprint;model:'m3'|'pickup';position:Vec3;
  controls:{throttle?:number;brake?:number;steer?:number;flap?:number;pitch?:number;roll?:number};
  paint?:MaterialSpec;damage:boolean;velocity?:Vec3;
}
export interface Walker {kind:'walker';id:string;position:Vec3;speed:number;heading:number;height:number;color:Color}
export interface KinematicArm {kind:'arm';id:string;root:Vec3;target:Vec3;pole:Vec3;upper:number;lower:number;swing:number}
export interface SpatialQuery {kind:'spatial';id:string;seed:number;count:number;cell:number;radius:number;at:Vec3}
export interface Schedule {kind:'schedule';id:string;rate:number;conflict:boolean}
export interface Structure {kind:'structure';id:string;height:number;mass:number;stiffness:number;yieldStrain:number;velocity:Vec3}
export type Item=EntitySpec|Placement|Walker|KinematicArm|SpatialQuery|Schedule|Structure;
export interface Preview {resolutionScale?:number;maxPixelRatio?:number}
export interface Program {version:1;preview?:Preview;stage:Omit<SceneSpec,'version'|'entities'>;items:readonly Item[];input?:string;follow?:string}
export interface Stage extends Omit<SceneSpec,'version'|'entities'> {preview?:Preview;input?:string;follow?:string}
const finite=(x:number,min:number,max:number,label:string)=>{if(!Number.isFinite(x)||x<min||x>max)throw new RangeError(label);return x;};
/** RU: Исполняемое описание сцены. EN: A serializable scene program; no second runtime. */
export function scene(stage:Stage,items:readonly Item[]):Program {
 const {input,follow,preview,...rest}=stage;
 return {version:1,stage:rest,items,...(preview?{preview}:{}),...(input?{input}:{}),...(follow?{follow}:{})};
}
/** RU: Коллизионный объект из штатных примитивов. EN: An ordinary engine entity. */
export function body(id:string,spec:Omit<EntitySpec,'id'>):EntitySpec{return {id,...spec};}
export function ground(id='ground',options:{size?:readonly[number,number];wetness?:number;snowM?:number}={}):EntitySpec {
 const snow=finite(options.snowM??0,0,.5,'Snow depth');
 return {id,mesh:{kind:'box',size:[options.size?.[0]??32,.15,options.size?.[1]??24]},position:[0,-.075,0],material:{kind:'asphalt',color:[.28,.29,.3,1],roughness:.82},environmental:{surfaceUse:'road',snowDepthM:snow,waterDepthM:finite(options.wetness??0,0,1,'Wetness')*.004}};
}
/** RU: Геометрия и физическая конструкция независимы. EN: Place an already compiled construction. */
export function place(blueprint:VehicleBlueprint,options:Partial<Omit<Placement,'kind'|'blueprint'>>={}):Placement {
 return {kind:'vehicle',blueprint,model:options.model??'m3',position:options.position??[0,.75,0],controls:options.controls??{},damage:options.damage??true,...(options.paint?{paint:options.paint}:{}),...(options.velocity?{velocity:options.velocity}:{})};
}
/** RU: Калибровочный седан на том же vehicle/wheel DSL. Не паспортная BMW. */
export function sedan(id:string,options:{massKg?:number;radiusM?:number;springNPerM?:number;damperNsPerM?:number;wearEnergyJ?:number;parts?:readonly WingSpec[];controls?:Placement['controls'];position?:Vec3;paint?:MaterialSpec;damage?:boolean;model?:Placement['model'];velocity?:Vec3}={}):Placement {
 const radius=finite(options.radiusM??.346,.2,.6,'Wheel radius'),wheels=[];
 for(const [axle,x] of [['front',1.4185],['rear',-1.4185]] as const)for(const [side,z] of [['left',-.787],['right',.787]] as const)wheels.push(wheel(`${axle}.${side}`,{
  at:[x,0,z],massKg:20,radiusM:radius,widthM:.3,
  suspension:{restM:.5,travelM:.25,springNPerM:options.springNPerM??35000,damperNsPerM:options.damperNsPerM??3200,yieldForceN:30000},
  driveTorqueNm:axle==='rear'?2400:0,drivePowerW:140000,brakeTorqueNm:2000,steerRad:axle==='front'?.5:0,
  condition:{wearEnergyJ:options.wearEnergyJ??2e7,heatCapacityJPerK:20000},
 }));
 return place(vehicle(id,{chassis:{massKg:options.massKg??1500,sizeM:[4.794,.65,1.888],dragAreaM2:.75},parts:[...wheels,...(options.parts??[])]}),options);
}
export function walker(id:string,options:Partial<Omit<Walker,'kind'|'id'>>={}):Walker{return {kind:'walker',id,position:[-3,0,0],speed:1.2,heading:0,height:1,color:[.24,.28,.32,1],...options};}
export function arm(id:string,options:Partial<Omit<KinematicArm,'kind'|'id'>>={}):KinematicArm{return {kind:'arm',id,root:[0,2,0],target:[1,.9,0],pole:[1,0,1],upper:1,lower:1,swing:0,...options};}
export function spatial(id:string,options:Partial<Omit<SpatialQuery,'kind'|'id'>>={}):SpatialQuery{return {kind:'spatial',id,seed:42,count:120,cell:2,radius:3,at:[0,.15,0],...options};}
export function schedule(id:string,options:Partial<Omit<Schedule,'kind'|'id'>>={}):Schedule{return {kind:'schedule',id,rate:20,conflict:false,...options};}
export function softBody(id:string,options:Partial<Omit<Structure,'kind'|'id'>>={}):Structure{return {kind:'structure',id,height:3,mass:120,stiffness:1e6,yieldStrain:.04,velocity:[0,-4,0],...options};}
export function camera(position:Vec3=[7,3,8],target:Vec3=[0,.8,0],fov=42):CameraSpec{return {position,target,fov};}
