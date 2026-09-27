import {freezePrimitive} from '../procedural/mesh.js';
import {detailedRoadWheelMeshes,type RoadWheelGeometrySpec} from './passenger-wheel.js';

export type WheelSide = -1 | 1;
export type CompiledRoadWheel = Readonly<ReturnType<typeof detailedRoadWheelMeshes>>;

/** Validate authoring data before geometry allocation. All lengths are metres. */
export function validateRoadWheel(spec:RoadWheelGeometrySpec):void {
  for (const key of ['radius','width','rimRatio','spokes','dish'] as const) {
    if (!Number.isFinite(spec[key])) throw new RangeError(`wheel.${key} must be finite`);
  }
  if (spec.radius<=0 || spec.width<=0) throw new RangeError('wheel.radius and wheel.width must be positive');
  if (spec.rimRatio<=0 || spec.rimRatio>=1) throw new RangeError('wheel.rimRatio must be between 0 and 1');
  if (!Number.isInteger(spec.spokes) || spec.spokes<3 || spec.spokes>256) throw new RangeError('wheel.spokes must be an integer from 3 to 256');
  if (spec.dish<0 || !Number.isFinite(spec.split??0) || (spec.split??0)<0) throw new RangeError('wheel.dish and wheel.split must be finite and non-negative');
}

/**
 * One authoring/compiler session, not one runtime system per wheel.
 * Owns at most one immutable mesh pair per side; equal values reuse geometry even
 * when the caller supplies new objects. No global cache and no per-frame work.
 * RU: Компилятор колёс одной сессии. Оси используют общую геометрию своей стороны.
 */
export class RoadWheelCompiler {
  private readonly cache = new Map<WheelSide,{key:string;value:CompiledRoadWheel}>();
  private builds = 0;
  private hits = 0;

  compile(spec:RoadWheelGeometrySpec,side:WheelSide):CompiledRoadWheel {
    validateRoadWheel(spec);
    if (side!==-1 && side!==1) throw new RangeError('wheel.side must be -1 or 1');
    const key = JSON.stringify([spec.radius,spec.width,spec.rimRatio,spec.spokes,spec.split??0,spec.dish]);
    const previous = this.cache.get(side);
    if (previous?.key===key) { this.hits++; return previous.value; }
    const mesh = detailedRoadWheelMeshes(spec,side);
    freezePrimitive(mesh.tire);
    freezePrimitive(mesh.rim);
    const value = Object.freeze(mesh);
    this.cache.set(side,{key,value});
    this.builds++;
    return value;
  }

  get diagnostics() {
    return Object.freeze({wheelBuilds:this.builds,wheelCacheHits:this.hits,residentWheelSides:this.cache.size});
  }

  /** Release this session's cache and reset its counters. Old results remain valid. */
  clear():void { this.cache.clear(); this.builds=0; this.hits=0; }
}
