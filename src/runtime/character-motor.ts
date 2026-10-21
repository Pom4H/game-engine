import {stepCharacterMotion} from './character-motion.js';
/** On-foot subset migrated from Pom4H/thegame character.ts (blob 1d19ad8662ab).
 * Metres/seconds, +Y up, yaw=0 faces +Z, y is feet height. Rendering is not authority.
 * This compatibility state retains its existing wire shape; integration uses the full shared Engine kernel. */
export interface CharacterInput { readonly forward:number; readonly right:number; readonly yaw:number; readonly sprint:boolean; readonly jump:boolean }
export interface CharacterState {
 x:number;y:number;z:number;vx:number;vy:number;vz:number;yaw:number;lookYaw:number;
 grounded:boolean;phase:number;speed:number;coyote:number;jumpBuffer:number;jumpHeld:boolean;landTime:number;
}
export interface CharacterWorld {
 blocked(x:number,y:number,z:number,height:number,radius:number):boolean;
 floor(x:number,y:number,z:number,range:number):{y:number;normal:readonly [number,number,number]}|null;
}
export interface CharacterTuning {readonly walkSpeed:number;readonly runSpeed:number;readonly gravity:number;readonly jumpSpeed:number}
export const CHARACTER_TUNING:CharacterTuning=Object.freeze({walkSpeed:3.35,runSpeed:6.8,gravity:16,jumpSpeed:5.4});
export const idleCharacterInput=(yaw=0):CharacterInput=>({forward:0,right:0,yaw,sprint:false,jump:false});
export function characterState(x:number,y:number,z:number,yaw=0):CharacterState {
 if(![x,y,z,yaw].every(Number.isFinite))throw new TypeError('Invalid character placement');
 return {x,y,z,vx:0,vy:0,vz:0,yaw,lookYaw:yaw,grounded:true,phase:0,speed:0,coyote:.1,jumpBuffer:0,jumpHeld:false,landTime:0};
}
/** Compatibility API for the original small character state; no second motion solver. */
export function stepCharacter(p:CharacterState,input:CharacterInput,world:CharacterWorld,dt=1/60,tuning=CHARACTER_TUNING):void {
 const phase=p.phase,next={...p};stepCharacterMotion(next,input,world,dt,tuning);
 const {x,y,z,vx,vy,vz,yaw,lookYaw,grounded,speed,coyote,jumpBuffer,jumpHeld,landTime}=next;
 Object.assign(p,{x,y,z,vx,vy,vz,yaw,lookYaw,grounded,speed,coyote,jumpBuffer,jumpHeld,landTime});
 p.yaw=Math.atan2(Math.sin(p.yaw),Math.cos(p.yaw));
 p.phase=(phase+p.speed*dt*(input.sprint?5:6))%(Math.PI*2000);
}
