import type {Vec3} from '../math.js';
import type {MaterialKind} from '../materials/catalog.js';
import type {EnvironmentSpec} from '../environment/types.js';
import type {MaterialFinish,MaterialTreatment} from '../materials/surface.js';

export type Color = readonly [number,number,number,number];
export type Primitive =
  | {kind:'box'; size?:Vec3}
  | {kind:'sphere'; radius?:number; segments?:number}
  | {kind:'plane'; size?:readonly [number,number]}
  /** Engine-generated triangular prism used for brittle fracture debris. */
  | {kind:'shard'; size:Vec3; axis?:0|1|2; skew?:number}
  | {kind:'polygon-prism'; points:readonly (readonly [number,number])[]; thickness:number; axis?:0|1|2};
export interface MaterialSpec { kind?:MaterialKind; color?:Color; finish?:MaterialFinish; ageYears?:number; treatment?:MaterialTreatment }
export type SurfaceUse='generic'|'road'|'sidewalk'|'curb';
export interface EnvironmentalSpec { surfaceUse?:SurfaceUse }
export interface BodySpec {
  /** 0 is static. Dynamic mass may be explicit; material density is available to engine-generated fragments. */
  mass?:number;
  motion?:'dynamic'|'kinematic';
  velocity?:Vec3;
  angularVelocity?:Vec3;
  restitution?:number;
  friction?:number;
  shape?:'auto'|'box'|'sphere';
}
export interface EntitySpec {
  id:string;
  position?:Vec3;
  rotation?:Vec3;
  scale?:Vec3;
  mesh?:Primitive;
  material?:MaterialSpec;
  environmental?:EnvironmentalSpec;
  body?:BodySpec;
}
export interface CameraSpec { position:Vec3; target:Vec3; fov?:number }
export interface SceneSpec {
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
