import {compose} from '../../dist/math.js';
import {clamp,wrapAngle} from './math.mjs';
/** Road corridor lookahead and traction-limited braking, following TheGame's
 * receding-horizon driver boundary: forecasts choose controls; native wheels
 * alone integrate the car. Recovery measures progress instead of replaying a turn. */
export class SnowDriver {
 constructor(car,world){this.car=car;this.world=world;this.stalled=0;this.reverseOrigin=null;this.steer=0;}
 step(dt){
  const c=this.car,b=c.rig.body,p=b.position,velocity=b.velocity,speed=Math.hypot(velocity[0],velocity[2]);
  const goal=c.destination,from=c.segmentStart,dx=goal[0]-from[0],dz=goal[1]-from[1],length=Math.hypot(dx,dz)||1,ux=dx/length,uz=dz/length;
  const progress=clamp((p[0]-from[0])*ux+(p[2]-from[1])*uz,0,length),look=Math.max(5,Math.min(14,5+speed*.65)),along=Math.min(length,progress+look);
  const target=[from[0]+ux*along,from[1]+uz*along],basis=compose([0,0,0],b.rotation,[1,1,1]),heading=Math.atan2(-basis[2],basis[0]),desired=Math.atan2(-(target[1]-p[2]),target[0]-p[0]),error=wrapAngle(desired-heading);
  const side=velocity[0]*Math.sin(heading)+velocity[2]*Math.cos(heading),forward=velocity[0]*Math.cos(heading)-velocity[2]*Math.sin(heading),slip=Math.atan2(side,Math.max(3,Math.abs(forward)));
  const friction=this.world.snow.sample(p[0],p[2]).friction,remaining=Math.max(0,length-progress),lateral=Math.abs((p[0]-from[0])*uz-(p[2]-from[1])*ux);
  const desiredSpeed=Math.min(22,Math.sqrt(49+2*Math.max(1.3,friction*7)*Math.max(0,remaining-9)),lateral>7?5:22);
  let steer=clamp(-error*1.55+b.angularVelocity[1]*.5+slip*.55,-1,1),brake=clamp((speed-desiredSpeed)*.5,0,1),throttle=brake>.05?0:1;
  // A persistent lack of progress activates a spatially bounded reverse path.
  this.stalled=speed<.7?this.stalled+dt:Math.max(0,this.stalled-dt*.25);
  if(this.stalled>1.4&&!this.reverseOrigin){this.reverseOrigin=[...p];this.reverseTime=0;c.rig.setGear(-1);}
  if(this.reverseOrigin){
   this.reverseTime+=dt;steer=-steer;throttle=.75;brake=forward>1?.6:0;
   if(Math.hypot(p[0]-this.reverseOrigin[0],p[2]-this.reverseOrigin[2])>5||this.reverseTime>4){this.reverseOrigin=null;this.stalled=0;c.rig.setGear(1);}
  }else{
   const state=c.rig.drivetrainState,gear=Math.max(1,state.gear);if(state.gear<1)c.rig.setGear(1);
   if(state.engineRpm>6600&&speed>gear*8&&gear<4)c.rig.setGear(gear+1);else if(gear>1&&speed<(gear-1)*7)c.rig.setGear(gear-1);
   // Wheelspin reduces the pedal near the limiter; traction returning releases it.
   const power=c.wheelIds.reduce((sum,id)=>sum+c.rig.part(id).slipPowerW,0);
   if(state.engineRpm>7000&&power>90000)throttle*=.35;
  }
  this.steer+=clamp(steer-this.steer,-dt*4,dt*4);c.steer=this.steer;c.throttle=throttle;
  const rpm=c.rig.drivetrainState.engineRpm,clutch=rpm<1100?0:rpm<1800?.15:rpm<2600?.45:1;
  if(rpm<1100)throttle=Math.max(.18,throttle);
  c.rig.setControls({throttle,clutch,starter:rpm<800?1:0,steer:c.steer,brake,handbrake:0});
  if(throttle>.95)c.fullThrottleTicks++;if(speed>5&&Math.abs(slip)>.2)c.driftTicks++;
  c.distanceM+=Math.hypot(p[0]-c.lastPosition[0],p[2]-c.lastPosition[2]);c.lastPosition=[...p];
 }
}
