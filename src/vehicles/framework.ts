import type {Primitive} from '../scene/types.js';
import type {ParametricVehiclePart} from './passenger.js';
import {generateDetailedThreeBoxBody,generateDetailedThreeBoxGlass,type DetailedThreeBoxParameters} from './m3-detailed-procedural.js';
import type {RoadWheelGeometrySpec} from './passenger-wheel.js';
import {generateDoubleCabPickupBody,generateDoubleCabPickupGlass,type DoubleCabPickupVehicleDefinition} from './pickup.js';
import {assembleVehicleGeometry,type VehicleSurfaces,type WheelMounts} from './assembly.js';
import {RoadWheelCompiler,validateRoadWheel} from './wheels.js';

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
  /** Immutable authoring geometry; runtime deformation must use a scene-owned copy. */
  readonly parts:readonly ParametricVehiclePart[];
  readonly body:Extract<Primitive,{kind:'triangle-mesh'}>;
  readonly bodyTriangles:number;
  readonly generatedTriangles:number;
}

function surfaceKey(value:unknown):string {
  return JSON.stringify(value,(_key,item:unknown)=>{
    if (typeof item==='number' && !Number.isFinite(item)) throw new RangeError('Vehicle shape parameters must be finite');
    return item;
  });
}

function wheelMounts(definition:VehicleDefinition):WheelMounts {
  if (definition.family==='three-box') return definition.body.dimensions;
  if (definition.family==='double-cab-pickup') return definition.dimensions;
  throw new TypeError('Unknown vehicle family');
}

/**
 * Incremental authoring compiler. Surfaces depend on body causes; wheel geometry
 * depends on the wheel package; mount transforms depend on dimensions. Changing
 * spokes/dish cannot invalidate the body, glass or wheel openings.
 * RU: Хранит только текущие поверхности и по одному комплекту колёс на сторону.
 * No scheduler, frame callbacks, registry, mesh-key hashing or dependency scan at runtime.
 */
export class VehicleCompiler {
  private readonly wheels = new RoadWheelCompiler();
  private surfaceKey:string|undefined;
  private surfaces:VehicleSurfaces|undefined;
  private bodyBuilds = 0;

  compile(definition:VehicleDefinition):CompiledVehicleGeometry {
    const mounts = wheelMounts(definition);
    if (typeof definition.id!=='string' || !definition.id.trim()) throw new TypeError('vehicle.id must be non-empty');
    for (const key of ['wheelRadius','wheelbase','track','axleOffset'] as const) {
      if (!Number.isFinite(mounts[key]) || (key!=='axleOffset' && mounts[key]<=0)) throw new RangeError(`vehicle.${key} is invalid`);
    }
    // Reject malformed wheel edits before doing expensive body work or changing caches.
    validateRoadWheel({...definition.wheel,radius:mounts.wheelRadius});
    const key = definition.family==='three-box'
      ? surfaceKey(['three-box',definition.body])
      : surfaceKey(['double-cab-pickup',definition.dimensions,definition.hardpoints,definition.body]);
    if (!this.surfaces || this.surfaceKey!==key) {
      const surfaces = definition.family==='three-box'
        ? {body:generateDetailedThreeBoxBody(definition.body),glass:generateDetailedThreeBoxGlass(definition.body)}
        : {body:generateDoubleCabPickupBody(definition),glass:generateDoubleCabPickupGlass(definition)};
      this.surfaces = surfaces;
      this.surfaceKey = key;
      this.bodyBuilds++;
    }
    return assembleVehicleGeometry(definition,mounts,this.surfaces,this.wheels);
  }

  get diagnostics() {
    return Object.freeze({bodyBuilds:this.bodyBuilds,glassBuilds:this.bodyBuilds,...this.wheels.diagnostics});
  }

  /** Release compiler-owned references. Previously compiled results remain usable. */
  clear():void { this.surfaceKey=undefined; this.surfaces=undefined; this.bodyBuilds=0; this.wheels.clear(); }
}

/** Stateless compatibility API. Keep a VehicleCompiler only for repeated edits. */
export function compileVehicle(definition:VehicleDefinition):CompiledVehicleGeometry {
  return new VehicleCompiler().compile(definition);
}
