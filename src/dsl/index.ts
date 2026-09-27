/** Code-first authoring. Only data crosses the compiler worker boundary.
 * RU: Описание сцены независимо от редактора; runtime и тесты используют те же данные. */
import {defineScene} from '../scene/define.js';
import type {SceneSpec,EntitySpec,CameraSpec,MaterialSpec} from '../scene/types.js';
import type {Vec3} from '../math.js';
import {finiteVec3} from '../math.js';
import {compileVehicle,VehicleCompiler,type VehicleDefinition,type CompiledVehicleGeometry} from '../vehicles/framework.js';
import {vehicle,wheel,type VehicleBlueprint} from '../vehicles/components.js';
import type {WheelSpec} from '../vehicles/components.js';
import type {VehicleControls,VehicleAir} from '../vehicles/vehicle.js';
import type {SceneVehicleOptions} from '../vehicles/scene-vehicle.js';
import {M3_VEHICLE_DEFINITION} from '../vehicles/m3.js';
import {PICKUP_CANOPY_VEHICLE_DEFINITION} from '../vehicles/pickup.js';
import type {WalkerSpec,HumanoidBinding,HumanoidJoint} from '../animation/locomotion.js';
export {vehicle,wheel,wing} from '../vehicles/components.js';
export {solveTwoBone} from '../animation/locomotion.js';
export {SpatialHash} from '../core/spatial-hash.js';
export {ModuleScheduler} from '../core/kernel.js';
export {material} from '../materials/catalog.js';
export {hashString,mulberry32} from '../core/random.js';
export type {SceneSpec,EntitySpec,MaterialSpec,Vec3,VehicleControls};
export const M3=M3_VEHICLE_DEFINITION;
export const PICKUP=PICKUP_CANOPY_VEHICLE_DEFINITION;
export type ControlKeyframe={readonly atSeconds:number;readonly value:VehicleControls};
export interface VehicleAssembly {
 readonly blueprint:VehicleBlueprint;readonly geometry:CompiledVehicleGeometry;
 readonly options:SceneVehicleOptions;
 readonly controls:VehicleControls;readonly timeline:readonly ControlKeyframe[];
 readonly air?:VehicleAir;
}
export interface SceneProgram {
 readonly kind:'scene-program/v1';readonly scene:SceneSpec;
 readonly vehicles:readonly VehicleAssembly[];
 /** Playback is bounded; it never selects a second physical model. */
 readonly durationSeconds:number;readonly follow?:string;
}
export type SceneInput=Omit<SceneSpec,'version'>&{readonly vehicles?:readonly VehicleAssembly[];readonly durationSeconds?:number;readonly follow?:string};
const controls=(input:VehicleControls):void=>{
 for(const [k,v] of Object.entries(input))if(!['throttle','brake','steer','roll','pitch','flap'].includes(k)||!Number.isFinite(v)||v<(k==='brake'?0:-1)||v>1)throw new RangeError(`Invalid control ${k}`);
};
/** Compile one vehicle's visuals once. Inputs/outputs are serializable, not closures. */
export type AssemblyOptions=SceneVehicleOptions&{controls?:VehicleControls;timeline?:readonly ControlKeyframe[];air?:VehicleAir};
export function assembly(blueprint:VehicleBlueprint,model:VehicleDefinition,options:AssemblyOptions):VehicleAssembly {
 return compileAssembly(blueprint,model,options,compileVehicle);
}
function compileAssembly(blueprint:VehicleBlueprint,model:VehicleDefinition,options:AssemblyOptions,compile:(model:VehicleDefinition)=>CompiledVehicleGeometry):VehicleAssembly {
 const {controls:input={},timeline=[],air,...pose}=options;
 controls(input);let last=-1;
 for(const frame of timeline){if(!Number.isFinite(frame.atSeconds)||frame.atSeconds<0||frame.atSeconds<=last||frame.atSeconds>60)throw new RangeError('Timeline times must increase within 0..60 s');last=frame.atSeconds;controls(frame.value);}
 if(air){finiteVec3(air.wind,'Air wind');if(!Number.isFinite(air.densityKgM3)||air.densityKgM3<0||air.densityKgM3>100)throw new RangeError('Invalid air density');}
 return {blueprint,geometry:compile(model),options:pose,controls:input,timeline,...(air?{air}:{})};
}
/** Existing wheel force model, shared by front/rear visual and physical mounts. SI units. */
export function roadWheels(model:VehicleDefinition,options:{wearEnergyJ?:number;springNPerM?:number;damperNsPerM?:number;driveTorqueNm?:number;drivePowerW?:number;grip?:number}={}):WheelSpec[]{
 const d=model.family==='three-box'?model.body.dimensions:model.dimensions;
 const parts:WheelSpec[]=[];
 for(const [axle,x] of [['front',d.wheelbase/2+d.axleOffset],['rear',-d.wheelbase/2+d.axleOffset]] as const)for(const [side,z] of [['left',-d.track/2],['right',d.track/2]] as const)parts.push(wheel(`${axle}.${side}`,{
  at:[x,0,z],massKg:20,radiusM:d.wheelRadius,widthM:model.wheel.width,
  suspension:{restM:.5,travelM:.25,springNPerM:options.springNPerM??35000,damperNsPerM:options.damperNsPerM??3200,yieldForceN:30000},
  driveTorqueNm:axle==='rear'?(options.driveTorqueNm??2400):0,drivePowerW:options.drivePowerW??140000,brakeTorqueNm:2000,steerRad:axle==='front'?.5:0,
  ...(options.grip!==undefined?{grip:options.grip}:{}),condition:{wearEnergyJ:options.wearEnergyJ??2e7,heatCapacityJPerK:20000},
 }));
 return parts;
}
/** Dimensions stay sourced from the same model; mass is a deliberate game calibration. */
export function chassis(model:VehicleDefinition,options:{massKg?:number;heightM?:number;dragAreaM2?:number}={}){
 const d=model.family==='three-box'?model.body.dimensions:model.dimensions;
 return {massKg:options.massKg??1500,sizeM:[d.length,options.heightM??.65,d.width] as Vec3,dragAreaM2:options.dragAreaM2??.75};
}
/** RU: Камера вокруг цели; углы в радианах, расстояние в метрах. */
export function orbit(target:Vec3=[0,.7,0],distance=9,yaw=-.75,elevation=.28,fov=40):CameraSpec {
 finiteVec3(target,'Camera target');if(![distance,yaw,elevation,fov].every(Number.isFinite)||distance<=0||fov<=0||fov>=175)throw new RangeError('Invalid orbit');
 return {position:[target[0]+Math.cos(yaw)*Math.cos(elevation)*distance,target[1]+Math.sin(elevation)*distance,target[2]+Math.sin(yaw)*Math.cos(elevation)*distance],target,fov};
}
export function box(id:string,size:Vec3,options:Omit<EntitySpec,'id'|'mesh'>={}):EntitySpec{return{id,mesh:{kind:'box',size},...options};}
export function sphere(id:string,radius:number,options:Omit<EntitySpec,'id'|'mesh'>={}):EntitySpec{return{id,mesh:{kind:'sphere',radius},...options};}
/** Plane used by Vehicle support. Other obstacles use existing PhysicsWorld collision. */
export function floor(size=80,kind:MaterialSpec['kind']='asphalt'):EntitySpec {
 return box('floor',[size,.08,size],{position:[0,-.04,0],collision:'none',material:{kind,roughness:.85,color:[.13,.15,.18,1]}});
}
/** A small visible rig bound to production locomotion/IK, not a docs-only walk cycle. */
export function humanoid(id:string,options:Omit<WalkerSpec,'id'|'bindings'>):{entities:EntitySpec[];rig:WalkerSpec}{
 const entities:EntitySpec[]=[],bindings:HumanoidBinding[]=[];
 const add=(name:string,joint:HumanoidJoint,size:Vec3,boneTo?:HumanoidJoint)=>{
  entities.push(box(`${id}/${name}`,size,{collision:'none',material:{kind:'plastic',color:[.25,.46,.52,1],roughness:.7}}));
  bindings.push({entity:`${id}/${name}`,joint,...(boneTo?{boneTo}:{})});
 };
 add('head','head',[.2,.24,.19]);add('chest','chest',[.23,.32,.4]);add('pelvis','pelvis',[.22,.18,.30]);
 for(const side of ['left','right'] as const){add(`${side}-thigh`,`${side}Hip`,[.13,1,.13],`${side}Knee`);add(`${side}-shin`,`${side}Knee`,[.11,1,.11],`${side}Ankle`);add(`${side}-arm`,`${side}Shoulder`,[.09,1,.09],`${side}Elbow`);add(`${side}-forearm`,`${side}Elbow`,[.08,1,.08],`${side}Hand`);add(`${side}-foot`,`${side}Foot`,[.25,.08,.12]);}
 return {entities,rig:{...options,id,bindings}};
}
/** Validate bounded authoring output before it is allowed into the live preview. */
export function scene(input:SceneInput):SceneProgram{
 const {vehicles=[],durationSeconds=20,follow,...spec}=input;
 const program:SceneProgram={kind:'scene-program/v1',scene:defineScene({
  environment:{temperatureC:20,sunlight:1,humidity:0,groundMoisture:0,precipitation:'arid',snowfall:'none'},
  rendering:{sunDirection:[.4,.8,-.3],sunIntensity:2.5,sunColor:[1,.97,.92],skyColor:[.35,.45,.60],exposure:1,shadowExtent:25,fogDensity:0},
  camera:orbit(),...spec,version:1}),vehicles,durationSeconds,...(follow?{follow}:{})};
 validateProgram(program);return program;
}
export function validateProgram(program:SceneProgram):void {
 if(program?.kind!=='scene-program/v1')throw new TypeError('Export default scene({...})');
 if(!Number.isFinite(program.durationSeconds)||program.durationSeconds<=0||program.durationSeconds>60)throw new RangeError('durationSeconds must be in (0,60]');
 if(!Array.isArray(program.vehicles)||program.vehicles.length>8||program.scene.entities.length>512)throw new RangeError('Preview budget: 8 vehicles / 512 authored entities');
 defineScene(program.scene);
 const ids=new Set(program.scene.entities.map(e=>e.id));let scalars=0;
 const mesh=(e:EntitySpec)=>{for(const m of [e.mesh,e.renderMesh])if(m?.kind==='triangle-mesh')scalars+=m.positions.length+m.normals.length+m.indices.length+(m.colors?.length??0);};
 program.scene.entities.forEach(mesh);
 for(const v of program.vehicles as readonly VehicleAssembly[]){
  // Revalidate descriptors crossing a worker/network boundary. Cached author geometry is still data.
  vehicle(v.blueprint.source.id,v.blueprint.source);controls(v.controls);finiteVec3(v.options.modelOriginM,'Model origin');
  const names=[v.blueprint.source.id,...v.geometry.parts.map(p=>`${v.blueprint.source.id}/${p.id}`),...v.blueprint.parts.filter(p=>p.source.kind==='wing').map(p=>`${v.blueprint.source.id}/${p.source.id}`)];
  for(const id of names){if(ids.has(id))throw new TypeError(`Duplicate scene id ${id}`);ids.add(id);}
  for(const p of v.geometry.parts)mesh({id:p.id,mesh:p.mesh});
 }
 if(scalars>2_000_000)throw new RangeError('Preview mesh budget exceeded');
 if(program.follow&&!program.vehicles.some(v=>v.blueprint.source.id===program.follow))throw new TypeError('follow must reference a vehicle id');
}

/** A bounded editor session; paint/camera edits reuse the actual geometry compiler.
 * RU: Один кэш на сборку; никогда не глобальный кэш всех моделей мира. */
export function authoringSession(){
 const compilers=new Map<string,VehicleCompiler>(),used=new Set<string>();
 return {
  begin(){used.clear();},
  assembly(blueprint:VehicleBlueprint,model:VehicleDefinition,options:AssemblyOptions):VehicleAssembly{
   const id=blueprint.source.id;used.add(id);
   let compiler=compilers.get(id);
   if(!compiler){if(compilers.size>=8){const unused=[...compilers.keys()].find(key=>!used.has(key));if(unused){compilers.get(unused)!.clear();compilers.delete(unused);}else throw new RangeError('8 vehicle compiler budget');}compiler=new VehicleCompiler();compilers.set(id,compiler);}
   return compileAssembly(blueprint,model,options,definition=>compiler!.compile(definition));
  },
  end(){for(const [id,compiler] of compilers)if(!used.has(id)){compiler.clear();compilers.delete(id);}},
  diagnostics(){return [...compilers].map(([id,compiler])=>({id,...compiler.diagnostics}));},
  clear(){for(const compiler of compilers.values())compiler.clear();compilers.clear();used.clear();},
 };
}
