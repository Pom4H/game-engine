import type {Primitive} from '../scene/types.js';
import {freezeVehicleMesh} from './geometry.js';
import {passengerPartMaterial,type ParametricVehiclePart} from './passenger.js';
import type {CompiledVehicleGeometry,VehicleDefinition} from './framework.js';
import {RoadWheelCompiler} from './wheels.js';

export type VehicleMesh = Extract<Primitive,{kind:'triangle-mesh'}>;
export interface VehicleSurfaces { readonly body:VehicleMesh; readonly glass:VehicleMesh; }
export interface WheelMounts {
  readonly wheelRadius:number;
  readonly wheelbase:number;
  readonly track:number;
  readonly axleOffset:number;
}

/** Small data snapshot: caller edits must not relabel previously compiled meshes. */
function definitionSnapshot(definition:VehicleDefinition):VehicleDefinition {
  const snapshot = structuredClone(definition);
  const freeze = (value:unknown):void => {
    if (value && typeof value==='object') {
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    }
  };
  freeze(snapshot);
  return snapshot;
}

/** Shared assembly contract; family-specific builders only produce surfaces. */
export function assembleVehicleGeometry(
  definition:VehicleDefinition,mounts:WheelMounts,surfaces:VehicleSurfaces,
  wheels = new RoadWheelCompiler(),
):CompiledVehicleGeometry {
  const {body,glass} = surfaces;
  // These meshes are compiler-owned. Never freeze an input definition or a scene.
  if (!Object.isFrozen(body)) freezeVehicleMesh(body);
  if (!Object.isFrozen(glass)) freezeVehicleMesh(glass);
  const parts:ParametricVehiclePart[] = [];
  const add = (id:string,role:ParametricVehiclePart['role'],mesh:VehicleMesh,position:readonly[number,number,number],wheel=false) => {
    parts.push(Object.freeze({id,role,mesh,position:Object.freeze(position),
      ...(wheel?{wheel:true}:{}),material:Object.freeze(passengerPartMaterial(role))}));
  };
  add('body','paint',body,[0,0,0]);
  add('glass','glass',glass,[0,0,0]);
  const front = mounts.wheelbase/2+mounts.axleOffset;
  const rear = -mounts.wheelbase/2+mounts.axleOffset;
  for (const [axle,x] of [['front',front],['rear',rear]] as const) {
    for (const [side,sign] of [['left',-1],['right',1]] as const) {
      const wheel = wheels.compile({...definition.wheel,radius:mounts.wheelRadius},sign);
      const position = [x,mounts.wheelRadius,sign*mounts.track/2] as const;
      add(`tire-${axle}-${side}`,'tire',wheel.tire,position,true);
      add(`rim-${axle}-${side}`,'rim',wheel.rim,position,true);
    }
  }
  const generatedTriangles = parts.reduce((sum,part)=>sum+(part.mesh.kind==='triangle-mesh'?part.mesh.indices.length/3:0),0);
  return Object.freeze({definition:definitionSnapshot(definition),parts:Object.freeze(parts),body,bodyTriangles:body.indices.length/3,generatedTriangles});
}

export type VehiclePartPath = 'body' | 'glass' | `wheels.${'front'|'rear'}.${'left'|'right'}.${'tire'|'rim'}`;

/** Typed semantic address; the engine still receives its existing flat parts. */
export function vehiclePart(vehicle:CompiledVehicleGeometry,path:VehiclePartPath):ParametricVehiclePart {
  const match = /^wheels\.(front|rear)\.(left|right)\.(tire|rim)$/.exec(path);
  const id = match ? `${match[3]}-${match[1]}-${match[2]}` : path;
  if (!match && path!=='body' && path!=='glass') throw new TypeError(`Unknown vehicle part path: ${path}`);
  const part = vehicle.parts.find(part=>part.id===id);
  if (!part) throw new TypeError(`Missing vehicle part: ${path}`);
  return part;
}
