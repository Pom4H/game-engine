import {projection,scalar,vector3,type Frame} from '../../src/network/projection.js';
import type {Vec3} from '../../src/math.js';
import type {CharacterInput,CharacterState} from '../../src/runtime/character-motor.js';
export type {CharacterInput,CharacterState,Vec3};

export const INTEGRATION_REVISION='thegame-lite/5-office';
export const DEFAULT_PORT=4317;
export type Binding={worldId:string;revision:string;epoch:number;seed:number;buildingId:string;origin:Vec3;yaw:number;floorHeight:number;floorCount:number;officeFloor:number};
export const bindingFor=(seed=29,epoch=1):Binding=>({worldId:`thegame:${seed}`,revision:INTEGRATION_REVISION,epoch,seed,buildingId:'office:roman',origin:[-224,0,-32],yaw:0,floorHeight:3.3,floorCount:6,officeFloor:2});
export type Bounds={id:string;x:number;z:number;width:number;depth:number;height:number;rotation:number;kind:string;baseY?:number};
export type OfficeObject={id:string;kind:string;floor:string;x:number;z:number;rotation:number;color:string;label:string;width?:number;depth?:number;height?:number;shape?:'straight'|'ring';material?:'oak'|'plaster'|'linen'|'glass'|'ceramic'|'concrete';host?:string;parent?:string;from?:string;to?:string;species?:'cat'|'dog';fish?:number};
export type OfficePlacement={worldId:string;buildingId:string;offsetZ:number;width:number;depth:number;entryWidth:number;floorHeight:number;firstFloor:number;floors:{id:string;index:number}[]};
export type OfficeState={version:number;revision:number;floors:{id:string;name:string;wallpaper:string}[];objects:OfficeObject[];activeFloor:string;selection:string|null;placement?:OfficePlacement};
export type LiftState={floor:number;target:number;elevation:number;door:number;phase:'idle'|'closing'|'moving'|'opening';velocity:number};
export type Weather={temperatureC:number;humidity:number;wind:Vec3;sunlight:number;groundMoisture:number;precipitation:'arid'|'rare'|'occasional'|'frequent';snowfall:'none'|'light'|'moderate'|'heavy';sunDirection:Vec3;sunIntensity:number;skyColor:Vec3};
export type Person={id:string;residentId:string;name:string;position:Vec3;yaw:number;phase:number;speed:number;kind:number};
export type Traffic={id:string;position:Vec3;yaw:number;speed:number;mode:number;doors:number};
export type Self={id:string;position:Vec3;yaw:number;ack:number;state:CharacterState};
export type WorldPresentation={binding:Binding;tick:number;time:number;worldMinute:number;actors:Person[];vehicles:Traffic[];lift:LiftState;liftInteraction?:import('./client/canonical-lifts.js').CanonicalLiftInteraction|null;weather:Weather;self?:Self;viewSubject?:Self;account?:import('../../../thegame/src/game/account-model.ts').AccountView;connected:boolean;layoutRevision:number;layout?:OfficeState;canonical?:import('./client/canonical-types.js').CanonicalFrame};
export type WorldPacket={type:'world';binding:Binding;tick:number;time:number;worldMinute:number;actors:Frame;vehicles:Frame;names:{id:string;residentId:string;name:string}[];lift:LiftState;weather:Weather;self?:Self;layoutRevision:number};
export type ConnectionStatus={state:'connecting'|'connected'|'closed'|'error';message?:string;controlling:boolean;voice:boolean;voiceAllowed?:boolean};
export const actorsProjection=projection('thegame-office/actors/1',{position:vector3('linear',-1_000_000,1_000_000),yaw:scalar('angle',-Math.PI*2000,Math.PI*2000),phase:scalar('angle',0,Math.PI*2000+1),speed:scalar('linear',0,100),kind:scalar('step',0,2)},{maxEntities:96,maxBytes:64_000});
export const vehiclesProjection=projection('thegame-office/traffic/1',{position:vector3('linear',-1_000_000,1_000_000),yaw:scalar('angle',-Math.PI*2000,Math.PI*2000),speed:scalar('linear',0,100),mode:scalar('step',0,2),doors:scalar('linear',0,1)},{maxEntities:16,maxBytes:16_000});
export function worldPoint(binding:Binding,local:Vec3,floor=0):Vec3{const c=Math.cos(binding.yaw),s=Math.sin(binding.yaw);return[binding.origin[0]+c*local[0]+s*local[2],binding.origin[1]+floor*binding.floorHeight+local[1],binding.origin[2]-s*local[0]+c*local[2]];}
export function localPoint(binding:Binding,p:Vec3,floor=0):Vec3{const x=p[0]-binding.origin[0],z=p[2]-binding.origin[2],c=Math.cos(binding.yaw),s=Math.sin(binding.yaw);return[c*x-s*z,p[1]-binding.origin[1]-floor*binding.floorHeight,s*x+c*z];}
export function serverWeather(minute:number,seed:number):Weather{
 const hour=(minute%1440)/60,a=(hour-6)*Math.PI/12,elevation=Math.sin(a),day=Math.max(.035,elevation),cloud=.3+.22*Math.sin(minute/173+seed);
 return{temperatureC:8+7*elevation,humidity:.48+cloud*.4,wind:[1.5*Math.sin(minute/41),0,1.2*Math.cos(minute/57)],sunlight:day*(1-cloud*.7),groundMoisture:.15+cloud*.3,precipitation:cloud>.5?'occasional':'rare',snowfall:'none',sunDirection:[Math.cos(a)*.65,Math.max(.06,elevation),.36],sunIntensity:day*(1-cloud*.7)*1.5,skyColor:[.12+day*.3,.18+day*.4,.29+day*.42]};
}
export function readBinding(raw:unknown):Binding{
 const b=raw as Binding;if(!b||b.revision!==INTEGRATION_REVISION||b.buildingId!=='office:roman'||!Number.isSafeInteger(b.epoch)||b.epoch<1||!Number.isSafeInteger(b.seed)||!Array.isArray(b.origin)||b.origin.length!==3||!b.origin.every(Number.isFinite)||b.floorHeight!==3.3||b.floorCount<1||b.floorCount>16||!Number.isInteger(b.officeFloor)||b.officeFloor<0||b.officeFloor>=b.floorCount||!Number.isFinite(b.yaw))throw new TypeError('Incompatible world binding');return structuredClone(b);
}
