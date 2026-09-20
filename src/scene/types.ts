import type {WalkerSpec,VehicleMotionSpec} from '../animation/locomotion.js';
import type {SnowContactSurfaceOptions} from '../environment/surface-contacts.js';
import type {Vec3} from '../math.js';
import type {MaterialKind} from '../materials/catalog.js';
import type {EnvironmentSpec} from '../environment/types.js';
import type {MaterialFinish,MaterialTreatment} from '../materials/surface.js';
import type {SceneDeformationSpec} from '../physics/deformation.js';

export type Color = readonly [number,number,number,number];
export type Primitive =
  | {kind:'box'; size?:Vec3}
  | {kind:'triangle-mesh';positions:readonly number[];normals:readonly number[];indices:readonly number[]}
  | {kind:'torus';radius:number;tube:number;segments?:number}
  | {kind:'cylinder'; radius:number; height:number; topRadius?:number; segments?:number}
  | {kind:'snowdrift'; size:Vec3; seed:number; segments?:number; continuous?:boolean; offset?:number}
  | {kind:'sphere'; radius?:number; segments?:number}
  | {kind:'plane'; size?:readonly [number,number]}
  /** Engine-generated triangular prism used for brittle fracture debris. */
  | {kind:'shard'; size:Vec3; axis?:0|1|2; skew?:number}
  | {kind:'polygon-prism'; points:readonly (readonly [number,number])[]; thickness:number; axis?:0|1|2};
/** Optional image surface detail, projected in world metres by the renderer.
 * Relative URLs resolve against the document URL. The renderer owns image/GPU
 * loading and cache lifetime; authoring code supplies only this descriptor. */
export interface SurfaceTextureSpec {
  readonly url:string;
  /** World-space repeat size in metres; defaults to 1. */
  readonly sizeM?:number;
  /** Height-derived bump amplitude; defaults to 0.5. */
  readonly bumpStrength?:number;
  /** Blend of image albedo with the base material; defaults to 1. */
  readonly albedoStrength?:number;
}
export interface MaterialSpec { texture?:SurfaceTextureSpec; label?:string; roughness?:number; metalness?:number; emissive?:readonly[number,number,number]; pattern?:'plain'|'brick'|'plaster'|'rubber'|'window'|'fabric';  kind?:MaterialKind; color?:Color; finish?:MaterialFinish; ageYears?:number; treatment?:MaterialTreatment }
export type SurfaceUse='generic'|'road'|'sidewalk'|'curb';
export interface EnvironmentalSpec { /** Appearance inherited by engine-generated snow cover; the base surface retains its own material. */ snowMaterial?:MaterialSpec; surfaceUse?:SurfaceUse; /** Initial settled snow, in metres. */ snowDepthM?:number; iceDepthM?:number; waterDepthM?:number }
export interface BodySpec {
  /** 0 is static. Dynamic mass may be explicit; material density is available to engine-generated fragments. */
  mass?:number;
  motion?:'dynamic'|'kinematic';
  velocity?:Vec3;
  angularVelocity?:Vec3;
  restitution?:number;
  friction?:number;
  shape?:'auto'|'box'|'sphere';
  /** Explicit collision envelope for body-only proxies. */
  collisionSize?:Vec3;
}
export interface EntitySpec {
  id:string;
  position?:Vec3;
  rotation?:Vec3;
  scale?:Vec3;
  mesh?:Primitive;
  material?:MaterialSpec;
  environmental?:EnvironmentalSpec;
  light?:LightSpec;
  body?:BodySpec;
}
export interface LightSpec { kind:'point'; color?:readonly[number,number,number]; intensity?:number; range?:number }
export interface CameraSpec { position:Vec3; target:Vec3; fov?:number; focusDistance?:number; aperture?:number }
export interface RenderingSpec {
  sunDirection?:Vec3; sunColor?:Vec3; skyColor?:Vec3;
  sunIntensity?:number; fogDensity?:number; exposure?:number; shadowExtent?:number;
}
export interface SceneAnimationSpec {
  readonly walkers?:readonly WalkerSpec[];
  readonly vehicles?:readonly VehicleMotionSpec[];
}
export interface SceneSurfaceContactsSpec {
  readonly snow?:readonly (SnowContactSurfaceOptions & {readonly surfaceId:string})[];
  readonly wheels?:readonly {readonly entityId:string;readonly radius?:number;readonly lateral?:Vec3}[];
}
export interface SceneSpec {
  /** Declarative rig/routes restored by Scene construction, URL loading and reset. */
  animation?:SceneAnimationSpec;
  /** Author contact bindings once; native systems own every subsequent update. */
  surfaceContacts?:SceneSurfaceContactsSpec;
  /** Persistent plastic deformation groups driven by physics contacts. */
  deformation?:SceneDeformationSpec;
  rendering?:RenderingSpec;
  version:1;
  seed?:number;
  gravity?:Vec3;
  ground?:number;
  clearColor?:Color;
  environment?:EnvironmentSpec;
  camera?:CameraSpec;
  entities:readonly EntitySpec[];
}
export interface SceneSnapshot {
  version:1;
  time:number;
  tick:number;
  entities:readonly {id:string;position:Vec3;rotation:Vec3;velocity:Vec3;material:MaterialKind}[];
}
