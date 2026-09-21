export type GeometryResidualKind='packed-mesh'|'explicit-mesh'|'learned-residual'|'dynamic-state';

export interface GeometryResidualLayer {
  readonly id:string;
  readonly kind:GeometryResidualKind;
  /** Per-instance encoded payload. Shared decoder/generator code is intentionally excluded. */
  readonly bytes:number;
  readonly triangles?:number;
  readonly note?:string;
}

export interface GeometryFidelity {
  readonly scope:string;
  readonly normalizedFit?:number;
  readonly meanPositionErrorMm?:number;
  readonly p99PositionErrorMm?:number;
  readonly maxPositionErrorMm?:number;
  readonly meanNormalErrorDeg?:number;
  readonly p99NormalErrorDeg?:number;
  readonly maxNormalErrorDeg?:number;
}

export interface CausalGeometryRepresentation<Parameters=unknown> {
  readonly id:string;
  /** Stable shared decoder/generator identity. Its code size is not charged per instance. */
  readonly generator:string;
  /** Small authored causes from which reusable geometry/physics can be derived. */
  readonly parameters:Parameters;
  readonly reference:{
    readonly sourceBytes:number;
    readonly expandedBytes?:number;
    readonly triangles?:number;
  };
  /** Information not yet explained by the shared generator. */
  readonly residuals?:readonly GeometryResidualLayer[];
  readonly compiled?:{
    readonly triangles?:number;
    readonly vertices?:number;
  };
  readonly fidelity?:GeometryFidelity;
}

export interface GeometryRepresentationReport {
  readonly id:string;
  readonly generator:string;
  readonly parameterBytes:number;
  readonly parameterLeaves:number;
  readonly residualBytes:number;
  readonly storedBytes:number;
  readonly sourceBytes:number;
  readonly sourceToParametersRatio:number;
  readonly sourceToStoredRatio:number;
  readonly expandedToStoredRatio?:number;
  readonly storedResidualShare:number;
  readonly sourceTriangleRetention?:number;
  readonly residuals:readonly GeometryResidualLayer[];
  readonly fidelity?:GeometryFidelity;
  readonly accounting:'per-instance payload; shared generator/decoder code excluded';
}

function encodedBytes(value:unknown):number{
  const json=JSON.stringify(value);
  if(json===undefined)throw new TypeError('Geometry parameters must be JSON-serializable');
  return new TextEncoder().encode(json).byteLength;
}

function leaves(value:unknown,seen=new Set<object>()):number{
  if(value===null||value===undefined)return 1;
  if(typeof value!=='object')return 1;
  if(seen.has(value as object))throw new TypeError('Geometry parameters must not contain cycles');
  seen.add(value as object);
  let count=0;
  if(Array.isArray(value))for(const child of value)count+=leaves(child,seen);
  else for(const child of Object.values(value as Record<string,unknown>))count+=leaves(child,seen);
  seen.delete(value as object);
  return count;
}

function finiteNonNegative(value:number,label:string):number{
  if(!Number.isFinite(value)||value<0)throw new RangeError(label+' must be finite and non-negative');
  return value;
}

/**
 * Measures the information boundary of a generated asset.
 *
 * "parameters" are causes shared with simulation/authoring. "residuals" are the
 * remaining object-specific information that the generator cannot reconstruct yet.
 * The compiled vertex/index buffers are deliberately not counted as stored source:
 * they are cache/output, analogous to machine code produced from source code.
 */
export function geometryRepresentationReport<Parameters>(input:CausalGeometryRepresentation<Parameters>):GeometryRepresentationReport{
  if(!input.id||!input.generator)throw new TypeError('Geometry representation requires id and generator');
  const sourceBytes=finiteNonNegative(input.reference.sourceBytes,'reference.sourceBytes');
  if(sourceBytes<=0)throw new RangeError('reference.sourceBytes must be positive');
  const parameterBytes=encodedBytes(input.parameters),parameterLeaves=leaves(input.parameters);
  const residuals=Object.freeze([...(input.residuals??[])]);
  let residualBytes=0;
  for(const residual of residuals){
    if(!residual.id)throw new TypeError('Geometry residual requires an id');
    residualBytes+=finiteNonNegative(residual.bytes,'residual.bytes');
    if(residual.triangles!==undefined)finiteNonNegative(residual.triangles,'residual.triangles');
  }
  const storedBytes=parameterBytes+residualBytes;
  if(storedBytes<=0)throw new RangeError('Geometry representation stores no information');
  const expanded=input.reference.expandedBytes;
  if(expanded!==undefined)finiteNonNegative(expanded,'reference.expandedBytes');
  const referenceTriangles=input.reference.triangles,compiledTriangles=input.compiled?.triangles;
  if(referenceTriangles!==undefined)finiteNonNegative(referenceTriangles,'reference.triangles');
  if(compiledTriangles!==undefined)finiteNonNegative(compiledTriangles,'compiled.triangles');
  return Object.freeze({
    id:input.id,
    generator:input.generator,
    parameterBytes,
    parameterLeaves,
    residualBytes,
    storedBytes,
    sourceBytes,
    sourceToParametersRatio:sourceBytes/parameterBytes,
    sourceToStoredRatio:sourceBytes/storedBytes,
    ...(expanded!==undefined?{expandedToStoredRatio:expanded/storedBytes}:{}),
    storedResidualShare:residualBytes/storedBytes,
    ...(referenceTriangles&&compiledTriangles!==undefined?{sourceTriangleRetention:compiledTriangles/referenceTriangles}:{}),
    residuals,
    ...(input.fidelity?{fidelity:Object.freeze({...input.fidelity})}:{}),
    accounting:'per-instance payload; shared generator/decoder code excluded' as const,
  });
}
