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
 input=idleInput();boost=100;grounded=false;jumps=0;airTime=0;private held=0;private lock=0;private consumedJump=0;private flip=0;private resetContact=0;
 readonly supportNormal:[number,number,number]=[0,1,0];wheelContacts=0;
 /** Arcade adhesion only while wheels contact an authored surface. */
 adhesionAcceleration=28;
 private readonly flipAxis:[number,number,number]=[0,0,0];
 readonly stats={jumps:0,dodges:0,boostSeconds:0,resets:0};
 override evaluate(dt:number):void {
  const b=this.body,i=this.input;this.frame.update(b.rotation);const basis=this.frame.basis;
  const speed=b.velocity[0]*basis[0]!+b.velocity[1]*basis[1]!+b.velocity[2]*basis[2]!;
  this.setControls({throttle:i.throttle*(Math.abs(speed)>32&&Math.sign(speed)===Math.sign(i.throttle)?0:1),steer:i.steer,handbrake:i.slide?1:0,brake:i.throttle===0?0:Math.sign(speed)!==Math.sign(i.throttle)&&Math.abs(speed)>1?1:0});
  super.evaluate(dt);
  this.lock=Math.max(0,this.lock-dt);
  let supported=0;this.supportNormal.fill(0);
  for(const p of this.blueprint.parts)if(p.source.kind==='wheel'){
   const sample=this.part(p.source.id);if(sample.contact){supported++;for(let k=0;k<3;k++)this.supportNormal[k]!+=sample.contactNormal[k]!;}
  }
  this.wheelContacts=supported;const norm=Math.hypot(...this.supportNormal);if(norm>1e-8)for(let k=0;k<3;k++)this.supportNormal[k]!/=norm;
  this.grounded=this.lock===0&&supported>=2;
  this.resetContact=this.lock===0&&supported===4?this.resetContact+dt:0;
  if(this.resetContact>=.02){if(this.jumps>0)this.stats.resets++;this.jumps=0;this.airTime=0;this.flip=0;}
  else if(!this.grounded)this.airTime+=dt;
  if(this.grounded){
   const n=this.supportNormal,adhesion=this.adhesionAcceleration*(1-Math.max(0,n[1]));
   for(let k=0;k<3;k++)this.force[k]!-=n[k]!*b.mass*adhesion;
   // Steer the wheel-supported chassis toward the mean surface normal using torque, not pose snaps.
   const up=[basis[3]!,basis[4]!,basis[5]!],error=[up[1]!*n[2]-up[2]!*n[1],up[2]!*n[0]-up[0]!*n[2],up[0]!*n[1]-up[1]!*n[0]];
   for(const axis of [0,2]){
    const base=axis*3,rate=b.angularVelocity[0]*basis[base]!+b.angularVelocity[1]*basis[base+1]!+b.angularVelocity[2]*basis[base+2]!;
    const angle=error[0]!*basis[base]!+error[1]!*basis[base+1]!+error[2]!*basis[base+2]!;
    const acceleration=angle*45-rate*5;
    for(let k=0;k<3;k++)this.torque[k]!+=basis[base+k]!*acceleration/b.invInertiaLocal[axis]!;
   }
  }
  // A queued rising edge is consumed once, including when it is too late to jump.
  if(i.jumpSerial>this.consumedJump){
   this.consumedJump++;
   if(this.grounded&&this.jumps===0||!this.grounded&&this.jumps<2&&this.airTime<1.25){
    const first=this.grounded&&this.jumps===0;this.jumps=first?1:2;this.lock=.12;this.grounded=false;this.held=first?.18:0;
    if(first)this.airTime=0;
    const amount=Math.hypot(i.pitch,i.steer);
    if(!first&&amount>.2){
     const x=-i.pitch/amount,z=i.steer/amount;
     for(let k=0;k<3;k++)b.velocity[k]!+=(basis[k]!*x+basis[6+k]!*z)*8;
     this.flip=.23;this.flipAxis.splice(0,3,z,0,-x);this.stats.dodges++;
    }else for(let k=0;k<3;k++)b.velocity[k]!+=(first?this.supportNormal[k]!:basis[3+k]!)*6;
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
  this.grounded=false;this.wheelContacts=0;this.resetContact=0;this.boost=100;this.jumps=0;this.airTime=0;this.held=this.flip=this.lock=0;this.consumedJump=this.input.jumpSerial;
 }
}
