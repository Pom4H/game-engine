import type {Scene} from '../../../src/scene/scene.js';
import type {Vec3} from '../shared.js';
import type {CanonicalFrame,CanonicalTireMark,CanonicalBuilding} from './canonical-types.js';
export const MAX_CANONICAL_TIRE_MARKS=128;
const vector=(v:unknown):v is Vec3=>Array.isArray(v)&&v.length===3&&v.every(n=>typeof n==='number'&&Number.isFinite(n));
/** Sparse original wheel stamps. Future events remain valid data: the source
 * drawer clips them against the single presentation time before rendering. */
export function readCanonicalTireMarks(value:unknown):CanonicalTireMark[]|undefined{
 if(value===undefined)return undefined;if(!Array.isArray(value)||value.length>MAX_CANONICAL_TIRE_MARKS)throw TypeError('Invalid original tyre-mark budget');
 const seen=new Set<number>();for(const mark of value){const m=mark as CanonicalTireMark;if(!m||!Number.isSafeInteger(m.id)||m.id<1||seen.has(m.id)||!Number.isFinite(m.at)||m.at<0||!vector(m.a)||!vector(m.b)||!vector(m.n)||Math.hypot(...m.n)<.1||Math.hypot(...m.n)>2||!Number.isFinite(m.width)||m.width<.01||m.width>2||!Number.isFinite(m.strength)||m.strength<0||m.strength>1||typeof m.dirt!=='boolean'||m.kind!==undefined&&!['rubber','scuff','dirt'].includes(m.kind))throw TypeError('Invalid original tyre mark');seen.add(m.id);}return value;
}
export type CanonicalSurfaceContext={origin:Vec3;yaw:number;offsetZ:number;focus:Vec3;visible:boolean};
export type CanonicalWeatherContext={eye:Vec3;floor:(x:number,y:number,z:number,range:number)=>number|null;terrain:(x:number,z:number)=>number;building?:CanonicalBuilding};
export type CanonicalRainStats={source:'thegame';time:number;precipitation:number;intensity:number;openFraction:number;visible:number;considered:number;queries:number;instances:number};
export interface CanonicalSurfaceEffects{
 update(frame:CanonicalFrame,context:CanonicalSurfaceContext):void;
 updateWeather?(context:CanonicalWeatherContext):void;
 isEffectMesh(id:string):boolean;
 inspect():{source:'thegame';available:boolean;received:number;cached:number;drawn:number;meshes:number;time:number;rain?:CanonicalRainStats};
 dispose():void;
}
export type CanonicalSurfaceFactory=(scene:Scene)=>CanonicalSurfaceEffects;
