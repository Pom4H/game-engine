/** Portable render contract. This package deliberately imports neither Scene,
 * renderer backends, execution placement nor Meshwork. Local renderers do not
 * materialize these packets unless a caller explicitly asks for a portable job. */
export type ContentHash=string;
export type RenderResourceKind='mesh'|'texture'|'material'|'shader'|'environment'|'buffer'|'temporal'|'frame'|'checkpoint'|'program'|'manifest'|'segment';

export interface ContentRef {readonly kind:RenderResourceKind;readonly hash:ContentHash}
export interface ResourceManifest {readonly resources:readonly ContentRef[]}
export interface RenderDeterminism {readonly epoch:bigint;readonly frame:bigint;readonly stochasticSequence:bigint}
export interface TemporalInputs {
  readonly previousTransforms?:ContentRef;readonly taaHistory?:ContentRef;readonly giHistory?:ContentRef;readonly exposureState?:ContentRef;readonly reflectionHistory?:ContentRef;
}
export interface TemporalOutputs {
  readonly taaHistory?:ContentRef;readonly giHistory?:ContentRef;readonly exposureState?:ContentRef;readonly reflectionHistory?:ContentRef;
}
export interface PortableRenderObject {readonly id:string;readonly mesh:ContentRef;readonly material:ContentRef;readonly transform:readonly number[]}
export interface PortableRenderLight {readonly id:string;readonly kind:'directional'|'point'|'spot';readonly state:readonly number[]}
export interface PortableRenderFrame {
  readonly schema:1;readonly simulationTick:bigint;readonly frame:bigint;readonly camera:readonly number[];
  readonly objects:readonly PortableRenderObject[];readonly lights:readonly PortableRenderLight[];readonly environment?:ContentRef;
  readonly resources:ResourceManifest;readonly temporal:TemporalInputs;readonly determinism:RenderDeterminism;
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
  const ids=new Set<string>();for(const object of value.objects){if(!object.id||ids.has(object.id))throw new TypeError('Portable render objects require unique stable IDs');ids.add(object.id);if(object.transform.length!==16||object.transform.some(v=>!Number.isFinite(v)))throw new TypeError('Portable render object transform must be a finite mat4');}
  return deepFreeze(structuredClone(value));
}
function deepFreeze<T>(value:T):T{
  if(value&&typeof value==='object'&&!Object.isFrozen(value)&&!ArrayBuffer.isView(value)){for(const child of Object.values(value as Record<string,unknown>))deepFreeze(child);Object.freeze(value);}
  return value;
}
export {canonicalContent,contentHash,MemoryContentStore,type ContentAddressedRepository} from './content.js';
