import type {Vec3} from '../math.js';
import {Vehicle} from './vehicle.js';

/** Full control state. jumpSerial preserves edges when continuous inputs coalesce. */
export interface ArcadeInput {throttle:number;steer:number;pitch:number;roll:number;boost:boolean;slide:boolean;jump:boolean;jumpSerial:number;}
export const idleInput=():ArcadeInput=>({throttle:0,steer:0,pitch:0,roll:0,boost:false,slide:false,jump:false,jumpSerial:0});
export function readArcadeInput(raw:unknown):ArcadeInput {
 if(!raw||typeof raw!=='object')throw new TypeError('Expected controls');
 const r=raw as Record<string,unknown>,out=idleInput();
 if(Object.keys(r).some(k=>!Object.hasOwn(out,k)))throw new TypeError('Unknown control');
 for(const k of ['throttle','steer','pitch','roll'] as const){const v=r[k];if(typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>1)throw new RangeError(k);out[k]=v;}
 for(const k of ['boost','slide','jump'] as const){if(typeof r[k]!=='boolean')throw new TypeError(k);out[k]=r[k];}
 if(!Number.isSafeInteger(r.jumpSerial)||Number(r.jumpSerial)<0||Number(r.jumpSerial)>0x7fffffff)throw new RangeError('jumpSerial');
 out.jumpSerial=Number(r.jumpSerial);return out;
}
/** Rocket-car force recipe on the existing four-wheel vehicle and ONE world integrator.
 * +X forward, +Y up. Values tune a game, not a claim of Rocket League numerical parity. */
export class ArcadeVehicle extends Vehicle {
 input=idleInput();boost=100;grounded=false;jumps=0;airTime=0;private held=0;private lock=0;private consumedJump=0;private flip=0;
 private readonly flipAxis:[number,number,number]=[0,0,0];
 readonly stats={jumps:0,dodges:0,boostSeconds:0};
 override evaluate(dt:number):void {
  const b=this.body,i=this.input;this.frame.update(b.rotation);const basis=this.frame.basis;
  const speed=b.velocity[0]*basis[0]!+b.velocity[1]*basis[1]!+b.velocity[2]*basis[2]!;
  this.setControls({throttle:i.throttle*(Math.abs(speed)>32&&Math.sign(speed)===Math.sign(i.throttle)?0:1),steer:i.steer,handbrake:i.slide?1:0,brake:i.throttle===0?0:Math.sign(speed)!==Math.sign(i.throttle)&&Math.abs(speed)>1?1:0});
  super.evaluate(dt);
  this.lock=Math.max(0,this.lock-dt);
  let supported=0;for(const p of this.blueprint.parts)if(p.source.kind==='wheel'&&this.part(p.source.id).loadN>this.body.mass*.4)supported++;
  this.grounded=this.lock===0&&supported>=2;
  if(this.grounded){this.airTime=0;this.jumps=0;}else this.airTime+=dt;
  // A queued rising edge is consumed once, including when it is too late to jump.
  if(i.jumpSerial>this.consumedJump){
   this.consumedJump++;
   if(this.grounded||this.jumps===1&&this.airTime<1.25){
    const first=this.grounded;this.jumps=first?1:2;this.lock=.12;this.grounded=false;this.held=first?.18:0;
    if(first)this.airTime=0;
    const amount=Math.hypot(i.pitch,i.steer);
    if(!first&&amount>.2){
     const x=-i.pitch/amount,z=i.steer/amount;
     for(let k=0;k<3;k++)b.velocity[k]!+=(basis[k]!*x+basis[6+k]!*z)*8;
     this.flip=.23;this.flipAxis.splice(0,3,z,0,-x);this.stats.dodges++;
    }else for(let k=0;k<3;k++)b.velocity[k]!+=basis[3+k]!*6;
    b.wake();this.stats.jumps++;
   }
  }
  if(!i.jump)this.held=0;
  if(this.held>0){this.held=Math.max(0,this.held-dt);for(let k=0;k<3;k++)this.force[k]!+=basis[3+k]!*b.mass*32;}
  if(i.boost&&this.boost>0){
   const used=Math.min(this.boost,33.3*dt),gain=used/(33.3*dt);this.boost-=used;this.stats.boostSeconds+=used/33.3;
   for(let k=0;k<3;k++)this.force[k]!+=basis[k]!*b.mass*28*gain;b.wake();
  }
  if(!this.grounded){
   const local:Vec3=[i.roll*11,-(i.slide?0:i.steer)*7,i.pitch*11];
   for(let a=0;a<3;a++){
    const w=b.angularVelocity[0]*basis[a*3]!+b.angularVelocity[1]*basis[a*3+1]!+b.angularVelocity[2]*basis[a*3+2]!;
    const acceleration=this.flip>0?this.flipAxis[a]!*40-w*3:local[a]!-w*(Math.abs(local[a]!)>.1?1.5:3);
    for(let k=0;k<3;k++)this.torque[k]!+=basis[a*3+k]!*acceleration/b.invInertiaLocal[a]!;
   }
  }
  this.flip=Math.max(0,this.flip-dt);
  const v=Math.hypot(...b.velocity);if(v>46)for(let k=0;k<3;k++)this.force[k]!-=b.velocity[k]!/v*(v-46)*b.mass*15;
 }
 /** Kickoff reset preserves the published input serial, so an old edge cannot fire again. */
 discardJumpEdges():void {this.consumedJump=this.input.jumpSerial;}
 reset(position:Vec3,rotation:Vec3):void {
  const b=this.body;b.position.splice(0,3,...position);b.rotation.splice(0,3,...rotation);b.velocity.fill(0);b.angularVelocity.fill(0);b.wake();
  this.boost=100;this.jumps=0;this.airTime=0;this.held=this.flip=this.lock=0;this.consumedJump=this.input.jumpSerial;
 }
}
