/** Portable render contract. This package deliberately imports neither Scene,
 * renderer backends, execution placement nor Meshwork. Local renderers do not
 * materialize these packets unless a caller explicitly asks for a portable job. */
export type ContentHash=string;
export type RenderResourceKind='mesh'|'texture'|'material'|'shader'|'environment'|'observation'|'surface-field'|'buffer'|'temporal'|'frame'|'checkpoint'|'program'|'graph'|'manifest'|'segment';

export interface ContentRef {readonly kind:RenderResourceKind;readonly hash:ContentHash}
export interface ResourceManifest {readonly resources:readonly ContentRef[]}
export interface RenderDeterminism {readonly epoch:bigint;readonly frame:bigint;readonly stochasticSequence:bigint}
export interface TemporalInputs {
  readonly previousTransforms?:ContentRef;readonly taaHistory?:ContentRef;readonly giHistory?:ContentRef;readonly exposureState?:ContentRef;readonly reflectionHistory?:ContentRef;
}
export interface TemporalOutputs {
  readonly taaHistory?:ContentRef;readonly giHistory?:ContentRef;readonly exposureState?:ContentRef;readonly reflectionHistory?:ContentRef;
}

/** Stable semantic boundary between authoritative world/physics state and any renderer.
 * Render backends may approximate appearance, but must not invent persistent world state. */
export const CAUSAL_RENDER_CONTRACT_VERSION=1 as const;
export interface CausalSurfaceIdentity {
  readonly entityId:string;
  readonly surfaceId:string;
  readonly partId?:string;
}
export interface CausalSurfaceEnvironment {
  readonly use:'generic'|'road'|'sidewalk'|'curb';
  readonly temperatureC:number;
  readonly wetness:number;
  readonly snowDepthM:number;
  readonly waterDepthM:number;
  readonly iceDepthM:number;
  readonly slush:number;
  readonly dirt:number;
  readonly wear:number;
  readonly trackMelt:number;
  readonly puddle:number;
  readonly snowFreshness:number;
  readonly snowLiquidFraction:number;
  readonly snowIceFraction:number;
  readonly snowGrainSizeMm:number;
  readonly snowCrust:number;
}
export interface CausalBodySurfaceState {
  readonly snowCoverage:number;
  readonly rearSnow:number;
  readonly wetness:number;
  readonly roadDirt:number;
  readonly directionX:number;
  readonly directionZ:number;
}
export interface CausalSurfaceFieldCell {
  readonly temperatureC:number;
  readonly snowDepthM:number;
  readonly waterDepthM:number;
  readonly iceDepthM:number;
  readonly slush:number;
  readonly wetness:number;
  readonly dirt:number;
  readonly wear:number;
  readonly trackMelt:number;
  readonly puddle:number;
  readonly frictionScale:number;
  readonly displacementM:number;
  readonly compaction:number;
  readonly shear:number;
  readonly history:number;
}
export interface CausalSurfaceField {
  readonly schema:1;
  readonly centerM:readonly [number,number];
  readonly sizeM:readonly [number,number];
  readonly nx:number;
  readonly nz:number;
  readonly cells:readonly CausalSurfaceFieldCell[];
}
export function defineCausalSurfaceField(value:CausalSurfaceField):CausalSurfaceField{
  if(value.schema!==1||value.centerM.length!==2||value.sizeM.length!==2||value.centerM.some(v=>!Number.isFinite(v))||value.sizeM.some(v=>!Number.isFinite(v)||v<=0))throw new TypeError('Invalid causal surface field bounds');
  if(!Number.isSafeInteger(value.nx)||!Number.isSafeInteger(value.nz)||value.nx<1||value.nz<1||value.cells.length!==value.nx*value.nz)throw new RangeError('Invalid causal surface field dimensions');
  for(const cell of value.cells)if(Object.values(cell).some(component=>typeof component!=='number'||!Number.isFinite(component)))throw new TypeError('Causal surface field cells must be finite');
  return deepFreeze(structuredClone(value));
}
export interface CausalSurfaceObservation {
  readonly identity:CausalSurfaceIdentity;
  /** Authoritative physical/collision source. Omitted only for render-only entities. */
  readonly physicalGeometry?:ContentRef;
  /** Geometry used to bound/query visible surface detail for this projection. */
  readonly visualGeometry:ContentRef;
  readonly material:ContentRef;
  /** Persistent local surface state such as ruts, snow redistribution and compaction. */
  readonly field?:ContentRef;
  /** Column-major world transform; translation metres, rotation radians upstream. */
  readonly transform:readonly number[];
  readonly linearVelocityMps:readonly [number,number,number];
  readonly angularVelocityRadps:readonly [number,number,number];
  readonly surface?:CausalSurfaceEnvironment;
  readonly bodySurface?:CausalBodySurfaceState;
}
export interface CausalRenderObservation {
  readonly schema:1;
  readonly contractVersion:typeof CAUSAL_RENDER_CONTRACT_VERSION;
  readonly simulationTick:bigint;
  readonly simulationTimeSeconds:number;
  /** World is right-handed with +Y up. Geometry and dynamics use SI units. */
  readonly world:Readonly<{handedness:'right';up:'+Y';positionUnit:'m';timeUnit:'s';angleUnit:'rad';radiance:'scene-linear'}>;
  readonly surfaces:readonly CausalSurfaceObservation[];
  readonly environment?:ContentRef;
}

const finite3=(value:readonly number[],label:string)=>{
  if(value.length!==3||value.some(component=>!Number.isFinite(component)))throw new TypeError(label+' must contain three finite numbers');
};
const finiteMat4=(value:readonly number[],label:string)=>{
  if(value.length!==16||value.some(component=>!Number.isFinite(component)))throw new TypeError(label+' must be a finite mat4');
};
export function defineCausalRenderObservation(value:CausalRenderObservation):CausalRenderObservation{
  if(value.schema!==1||value.contractVersion!==CAUSAL_RENDER_CONTRACT_VERSION)throw new TypeError('Unsupported causal render observation schema');
  if(value.simulationTick<0n||!Number.isFinite(value.simulationTimeSeconds)||value.simulationTimeSeconds<0)throw new RangeError('Invalid causal render observation time');
  if(value.world.handedness!=='right'||value.world.up!=='+Y'||value.world.positionUnit!=='m'||value.world.timeUnit!=='s'||value.world.angleUnit!=='rad'||value.world.radiance!=='scene-linear')throw new TypeError('Unsupported causal render world convention');
  const ids=new Set<string>();
  for(const surface of value.surfaces){
    const identity=surface.identity,key=identity.entityId+'\0'+identity.surfaceId+'\0'+(identity.partId??'');
    if(!identity.entityId||!identity.surfaceId||ids.has(key))throw new TypeError('Causal surfaces require stable unique identities');
    ids.add(key);finiteMat4(surface.transform,'surface.transform');finite3(surface.linearVelocityMps,'surface.linearVelocityMps');finite3(surface.angularVelocityRadps,'surface.angularVelocityRadps');
    if(surface.visualGeometry.kind!=='mesh'||surface.physicalGeometry&&surface.physicalGeometry.kind!=='mesh'||surface.material.kind!=='material'||surface.field&&surface.field.kind!=='surface-field')throw new TypeError('Causal surface resource kinds do not match their semantics');
    for(const state of [surface.surface,surface.bodySurface])if(state&&Object.values(state).some(component=>typeof component!=='number'||!Number.isFinite(component)))throw new TypeError('Causal surface state must be finite');
  }
  if(value.environment&&value.environment.kind!=='environment')throw new TypeError('Causal environment must reference an environment resource');
  return deepFreeze(structuredClone(value));
}
export interface PortableRenderObject {readonly id:string;readonly mesh:ContentRef;readonly material:ContentRef;readonly transform:readonly number[]}
export interface PortableRenderLight {readonly id:string;readonly kind:'directional'|'point'|'spot';readonly state:readonly number[]}
export interface PortableRenderFrame {
  readonly schema:1;readonly simulationTick:bigint;readonly frame:bigint;readonly camera:readonly number[];
  readonly objects:readonly PortableRenderObject[];readonly lights:readonly PortableRenderLight[];readonly environment?:ContentRef;
  readonly observation:ContentRef;readonly resources:ResourceManifest;readonly temporal:TemporalInputs;readonly determinism:RenderDeterminism;
}
export type RenderPartitionability=
 |{readonly kind:'atomic'}
 |{readonly kind:'temporal';readonly warmupFrames:number}
 |{readonly kind:'spatial';readonly haloPixels:number}
 |{readonly kind:'samples';readonly associativeReduction:string};
export interface RenderProgramDescriptor {
  readonly schema:1;readonly programHash:ContentHash;readonly profileHash:ContentHash;readonly partitionability:RenderPartitionability;readonly requiredResources:ResourceManifest;
}

const stableHash=(value:string,label:string)=>{if(!value||value.length>256||!/^[A-Za-z0-9._:+/-]+$/.test(value))throw new TypeError(label+' requires a stable content hash');return value;};
export function contentRef(kind:RenderResourceKind,hash:ContentHash):ContentRef{return Object.freeze({kind,hash:stableHash(hash,'contentRef.hash')});}
export function defineRenderProgram(value:RenderProgramDescriptor):RenderProgramDescriptor{
  stableHash(value.programHash,'programHash');stableHash(value.profileHash,'profileHash');
  if(value.partitionability.kind==='temporal'&&(!Number.isSafeInteger(value.partitionability.warmupFrames)||value.partitionability.warmupFrames<0))throw new RangeError('warmupFrames must be a non-negative integer');
  if(value.partitionability.kind==='spatial'&&(!Number.isSafeInteger(value.partitionability.haloPixels)||value.partitionability.haloPixels<0))throw new RangeError('haloPixels must be a non-negative integer');
  return deepFreeze(structuredClone(value));
}
export function defineRenderFrame(value:PortableRenderFrame):PortableRenderFrame{
  if(value.schema!==1)throw new TypeError('Unsupported portable render frame schema');
  if(value.simulationTick<0n||value.frame<0n||value.determinism.epoch<0n||value.determinism.frame!==value.frame)throw new RangeError('Invalid render frame identity');
  if(value.observation.kind!=='observation')throw new TypeError('Portable render frame requires a causal observation resource');
  const ids=new Set<string>();for(const object of value.objects){if(!object.id||ids.has(object.id))throw new TypeError('Portable render objects require unique stable IDs');ids.add(object.id);if(object.transform.length!==16||object.transform.some(v=>!Number.isFinite(v)))throw new TypeError('Portable render object transform must be a finite mat4');}
  return deepFreeze(structuredClone(value));
}
function deepFreeze<T>(value:T):T{
  if(value&&typeof value==='object'&&!Object.isFrozen(value)&&!ArrayBuffer.isView(value)){for(const child of Object.values(value as Record<string,unknown>))deepFreeze(child);Object.freeze(value);}
  return value;
}
export {canonicalContent,contentHash,MemoryContentStore,type ContentAddressedRepository} from './content.js';
