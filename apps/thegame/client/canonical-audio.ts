import {validateCausalSound,sampleCausalSound,causalDefinitionKey} from '../../../src/network/causal-acoustics.js';
import type {Vec3} from '../shared.js';
import type {CanonicalFrame,CanonicalGeometry,CanonicalEntity} from './canonical-types.js';
export type CanonicalVehicleSound=[id:string,rpm:number,load:number,tires:[number,number,number,number,number,number,number,number][],gear:number,startTick:number];
export function readCanonicalAudio(value:unknown,entities:readonly CanonicalEntity[]):CanonicalVehicleSound[]|undefined{
 if(value===undefined)return undefined;if(!Array.isArray(value)||value.length>8)throw TypeError('Invalid source acoustic budget');const seen=new Set<string>();for(const raw of value){const id=raw?.[0];if(typeof id!=='string'||seen.has(id)||!entities.some(e=>e.id===id&&e.kind==='vehicle'))throw TypeError('Invalid source acoustic owner');validateCausalSound(raw,id);seen.add(id);}return value;
}
/** Same discrete source selection, definition barrier and RPM/load blend as Game. */
export function sampleCanonicalAudio(a:CanonicalFrame,b:CanonicalFrame,alpha:number):CanonicalVehicleSound[]|undefined{
 const selected=alpha<1?a:b;if(selected.audio===undefined)return a.audio!==undefined||b.audio!==undefined?[]:undefined;const previous=new Map(a.audio?.map(s=>[s[0],s])),next=new Map(b.audio?.map(s=>[s[0],s]));return selected.audio.filter(s=>b.entities.some(e=>e.id===s[0])).map(s=>{const p=a.entities.find(e=>e.id===s[0]),n=b.entities.find(e=>e.id===s[0]);return sampleCausalSound(s,previous.get(s[0]),next.get(s[0]),alpha,!!p&&!!n&&causalDefinitionKey(p)===causalDefinitionKey(n));});
}
export type CanonicalAudioHost={context:AudioContext;destination:AudioNode;workletUrl:string};
export type CanonicalAudioContext={now:number;eye:Vec3;target:Vec3;geometry:CanonicalGeometry|null;subjectId:string|null;rain:number;precipitation:number;openFraction:number;blocked:(from:Vec3,to:Vec3,id?:string)=>boolean;active:boolean};
export interface CanonicalWorldAudio{
 unlock():Promise<void>;setEnabled(value:boolean):void;update(frame:CanonicalFrame,context:CanonicalAudioContext):void;dispose():void;
 inspect():{source:'thegame';time:number;tick:number;enabled:boolean;ready:boolean;listener:Vec3;target:Vec3;audio:Record<string,unknown>};
}
export type CanonicalAudioFactory=(host:CanonicalAudioHost)=>CanonicalWorldAudio;
