import {PhysicsWorld} from '../physics/world.js';
import {Vehicle,type VehicleControls} from '../vehicles/vehicle.js';
import {lightHelicopter,LIGHT_HELICOPTER_HOVER_COLLECTIVE,LIGHT_HELICOPTER_HOVER_ROLL} from '../vehicles/helicopter.js';

export const HELICOPTER_DT=1/120;
export interface HelicopterSandboxConfig{
 readonly gravity:number;
 readonly altitude:number;
 readonly airDensity:number;
}
export function helicopterSandboxConfig(input:Partial<HelicopterSandboxConfig>={}):Readonly<HelicopterSandboxConfig>{
 const value={gravity:9.81,altitude:40,airDensity:1.225,...input};
 for(const key of Object.keys(input))if(!['gravity','altitude','airDensity'].includes(key))throw new TypeError(`Unknown helicopter parameter ${key}`);
 if(!Number.isFinite(value.gravity)||value.gravity<0||value.gravity>30||!Number.isFinite(value.altitude)||value.altitude<2||value.altitude>10000||!Number.isFinite(value.airDensity)||value.airDensity<.1||value.airDensity>2)throw new RangeError('Invalid helicopter sandbox configuration');
 return Object.freeze(value);
}
/** Public executable helicopter example. It uses the same PhysicsWorld and Vehicle as cars/aircraft. */
export class HelicopterSandbox{
 readonly config:Readonly<HelicopterSandboxConfig>;
 readonly world:PhysicsWorld;
 readonly helicopter:Vehicle;
 tick=0;time=0;
 constructor(input:Partial<HelicopterSandboxConfig>={}){
  this.config=helicopterSandboxConfig(input);
  this.world=new PhysicsWorld([0,-this.config.gravity,0],0);
  this.helicopter=new Vehicle(this.world,lightHelicopter('helicopter:0'),{position:[0,this.config.altitude,0]});
  this.helicopter.setAir({densityKgM3:this.config.airDensity,wind:[0,0,0]});
  this.helicopter.setControls({throttle:1,collective:LIGHT_HELICOPTER_HOVER_COLLECTIVE,roll:LIGHT_HELICOPTER_HOVER_ROLL});
 }
 input(controls:VehicleControls):void{this.helicopter.setControls(controls);}
 step(dt=HELICOPTER_DT):void{
  if(dt!==HELICOPTER_DT)throw new RangeError('Helicopter sandbox uses fixed 120 Hz ticks');
  this.world.step(dt);this.tick++;this.time=this.tick*dt;
 }
 dump(){
  const b=this.helicopter.body;
  return Object.freeze({tick:this.tick,time:this.time,position:[...b.position],velocity:[...b.velocity],rotation:[...b.rotation],angularVelocity:[...b.angularVelocity],
   main:structuredClone(this.helicopter.part('main.rotor')),tail:structuredClone(this.helicopter.part('tail.rotor')),physics:this.world.stats});
 }
 dispose():void{this.helicopter.dispose();this.world.clear();}
}
