import type {Primitive} from '../scene/types.js';
import type {ParametricVehiclePart} from './passenger.js';
import {passengerPartMaterial} from './passenger.js';
import {generateDetailedThreeBoxBody,generateDetailedThreeBoxGlass,type DetailedThreeBoxParameters} from './m3-detailed-procedural.js';
import {detailedRoadWheelMeshes,type RoadWheelGeometrySpec} from './passenger-wheel.js';
import {compileDoubleCabPickupVehicle,type DoubleCabPickupVehicleDefinition} from './pickup.js';

export type VehicleFamily='three-box'|'double-cab-pickup';
export interface VehicleReferenceProvenance { readonly url?:string; readonly sha256?:string; readonly license?:string; readonly sourceBytes?:number; readonly triangles?:number; }
export interface ThreeBoxVehicleDefinition {
  readonly id:string;
  readonly family:'three-box';
  readonly body:DetailedThreeBoxParameters;
  readonly wheel:Omit<RoadWheelGeometrySpec,'radius'>;
  readonly reference?:VehicleReferenceProvenance;
}
export type VehicleDefinition=ThreeBoxVehicleDefinition|DoubleCabPickupVehicleDefinition;
export interface CompiledVehicleGeometry {
  readonly definition:VehicleDefinition;
  readonly parts:readonly ParametricVehiclePart[];
  readonly body:Extract<Primitive,{kind:'triangle-mesh'}>;
  readonly bodyTriangles:number;
  readonly generatedTriangles:number;
}
const triangles=(mesh:Primitive)=>mesh.kind==='triangle-mesh'?mesh.indices.length/3:mesh.kind==='box'?12:mesh.kind==='cylinder'?(mesh.segments??16)*4:mesh.kind==='torus'?(mesh.segments??16)*8:0;

function compileThreeBoxVehicle(definition:ThreeBoxVehicleDefinition):CompiledVehicleGeometry{
  const body=generateDetailedThreeBoxBody(definition.body),glass=generateDetailedThreeBoxGlass(definition.body),d=definition.body.dimensions,parts:ParametricVehiclePart[]=[
    {id:'body',role:'paint',mesh:body,position:[0,0,0],material:passengerPartMaterial('paint')},
    {id:'glass',role:'glass',mesh:glass,position:[0,0,0],material:passengerPartMaterial('glass')},
  ];
  const front=d.wheelbase/2+d.axleOffset,rear=-d.wheelbase/2+d.axleOffset;
  for(const [axle,x] of [['front',front],['rear',rear]] as const)for(const [side,z,sign] of [['left',-d.track/2,-1],['right',d.track/2,1]] as const){
    const wheel=detailedRoadWheelMeshes({radius:d.wheelRadius,...definition.wheel},sign);
    parts.push({id:`tire-${axle}-${side}`,role:'tire',mesh:wheel.tire,position:[x,d.wheelRadius,z],wheel:true,material:passengerPartMaterial('tire')});
    parts.push({id:`rim-${axle}-${side}`,role:'rim',mesh:wheel.rim,position:[x,d.wheelRadius,z],wheel:true,material:passengerPartMaterial('rim')});
  }
  return Object.freeze({definition,parts:Object.freeze(parts.map(part=>Object.freeze(part))),body,bodyTriangles:body.indices.length/3,generatedTriangles:parts.reduce((n,p)=>n+triangles(p.mesh),0)});
}
export function compileVehicle(definition:VehicleDefinition):CompiledVehicleGeometry{
  if(definition.family==='three-box')return compileThreeBoxVehicle(definition);
  return compileDoubleCabPickupVehicle(definition);
}
