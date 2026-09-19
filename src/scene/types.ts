import type {Vec3} from '../math.js';

export type Color = readonly [number,number,number,number];
export type Primitive =
  | {kind:'box'; size?:Vec3}
  | {kind:'sphere'; radius?:number; segments?:number}
  | {kind:'plane'; size?:readonly [number,number]};
export interface MaterialSpec { color?:Color }
export interface BodySpec { mass?:number; velocity?:Vec3; restitution?:number; friction?:number; shape?:'auto'|'box'|'sphere' }
export interface EntitySpec {
  id:string;
  position?:Vec3;
  rotation?:Vec3;
  scale?:Vec3;
  mesh?:Primitive;
  material?:MaterialSpec;
  body?:BodySpec;
}
export interface CameraSpec { position:Vec3; target:Vec3; fov?:number }
export interface SceneSpec {
  version:1;
  seed?:number;
  gravity?:Vec3;
  ground?:number;
  clearColor?:Color;
  camera?:CameraSpec;
  entities:readonly EntitySpec[];
}
export interface SceneSnapshot {
  version:1;
  time:number;
  tick:number;
  entities:readonly {id:string;position:Vec3;rotation:Vec3;velocity:Vec3}[];
}
