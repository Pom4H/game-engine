import type {MaterialKind} from '../materials/catalog.js';
import type {Vec3} from '../math.js';

export interface ContactSurfaceAcoustics {
  readonly wetness:number;
  readonly moss:number;
  readonly damping:number;
}

export interface ImpactEvent {
  readonly type:'impact';
  readonly id:number;
  readonly time:number;
  readonly point:Vec3;
  readonly normal:Vec3;
  readonly a:string;
  readonly b:string|'ground';
  readonly materialA:MaterialKind;
  readonly materialB:MaterialKind;
  readonly surfaceA?:ContactSurfaceAcoustics;
  readonly surfaceB?:ContactSurfaceAcoustics;
  readonly energy:number;
  readonly impulse:number;
  readonly speed:number;
  readonly size:number;
}

export interface FractureEvent {
  readonly type:'fracture';
  readonly id:number;
  readonly time:number;
  readonly entity:string;
  readonly material:MaterialKind;
  readonly point:Vec3;
  readonly normal:Vec3;
  readonly energy:number;
  readonly requiredEnergy:number;
  readonly thickness:number;
  readonly shardCount:number;
  readonly size:number;
}

export interface MechanismEvent {
  readonly type:'mechanism';
  readonly id:number;
  readonly time:number;
  readonly point:Vec3;
  readonly mechanism:'door-latch'|'door-stop'|'suspension'|'panel-flex';
  readonly energy:number;
  readonly speed:number;
  readonly size:number;
}

export interface HornEvent {
  readonly type:'horn';readonly id:number;readonly time:number;readonly point:Vec3;
  readonly entity:string;readonly durationSeconds:number;readonly frequencyHz:number;
}
export type EngineEvent=ImpactEvent|FractureEvent|MechanismEvent|HornEvent;
