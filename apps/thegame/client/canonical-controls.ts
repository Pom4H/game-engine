import type {CharacterInput} from '../shared.js';

/** Physical intent only. The existing GameAuthority decides seats and actions. */
export type CanonicalKeyboard={keys:readonly string[];yaw:number;pitch:number;mouseButtons?:number};
export type CanonicalControlCamera={yaw:number;pitch:number;look(dx:number,dy:number,time:number):void};
export type CanonicalControlInput=CharacterInput&{pitch:number;crouch:boolean;interact:boolean;passenger:boolean;door:boolean;aim:boolean;handbrake:boolean;attack:boolean;block:boolean;forwardBrake?:boolean;vehicle?:string;flight?:{throttle:number;pitch:number;roll:number;yaw:number;flap:number;brake:number}};
export type CanonicalControlSampler={clear():void;sample(keys:ReadonlySet<string>,context:{camera:CanonicalControlCamera;seated:boolean;aircraft:boolean;altitudeAgl?:number;mouseButtons?:number;aiming?:boolean;gamepad?:Gamepad|null;now?:number;pulses?:ReadonlySet<string>}):CanonicalControlInput};
export const CANONICAL_CONTROL_KEYS=new Set(['KeyW','KeyA','KeyS','KeyD','KeyE','KeyG','KeyF','KeyC','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft','ShiftRight','ControlLeft','ControlRight','Space']);
