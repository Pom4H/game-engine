/** Shared Engine kinematic character motion, promoted from the full TheGame motor.
 * Source SHA-256 04951e21553dd62bd1561bb7c79dc90311a8f2b69e6da88f13d3ece44b3850de. Metres/seconds, +Y up, yaw 0 faces +Z; Y is feet.
 * The owning application supplies action locks and applies jump gameplay effects. */
export const CHARACTER_MOTION_BACKEND='the-engine' as const;
export const CHARACTER_MOTION_MODE={LOCKED:1,IMMOBILIZED:2,BRACING:4,STRIKING:8,LOOK_HEADING:16} as const;
export const CHARACTER_MOTION_EVENT={JUMPED:1} as const;
export interface CharacterMotionInput{readonly forward:number;readonly right:number;readonly yaw:number;readonly sprint:boolean;readonly jump:boolean;readonly pitch?:number;readonly crouch?:boolean;readonly aim?:boolean;}
export interface CharacterMotionState{
 x:number;y:number;z:number;vx:number;vy:number;vz:number;yaw:number;lookYaw:number;grounded:boolean;phase:number;speed:number;coyote:number;jumpBuffer:number;jumpHeld:boolean;landTime:number;
 pitch?:number;crouch?:boolean;animation?:string;stamina?:number;impulseX?:number;impulseZ?:number;
}
export interface CharacterMotionWorld{
 blocked(x:number,y:number,z:number,height:number,radius:number):boolean;
 floor(x:number,y:number,z:number,range:number):{y:number;normal:readonly [number,number,number]}|null;
 footing?(x:number,y:number,z:number,range:number):{y:number;normal:readonly [number,number,number]}|null;
 recover?(x:number,y:number,z:number,height:number,radius:number):{x:number;y:number;z:number}|null;
}
export interface CharacterMotionTuning{readonly walkSpeed:number;readonly runSpeed:number;readonly gravity:number;readonly jumpSpeed:number;}
export const CHARACTER_MOTION_TUNING:CharacterMotionTuning=Object.freeze({walkSpeed:3.35,runSpeed:6.8,gravity:16,jumpSpeed:5.4});
const clamp=(v:number,min:number,max:number)=>Math.max(min,Math.min(max,v));
const damp=(a:number,b:number,rate:number,dt:number)=>a+(b-a)*(1-Math.exp(-rate*dt));
const angleDelta=(a:number,b:number)=>Math.atan2(Math.sin(b-a),Math.cos(b-a));
/** Shared fixed-step motor. y denotes feet; the camera or rendering origin never becomes authority. */
export function stepCharacterMotion(p:CharacterMotionState,input:CharacterMotionInput,world:CharacterMotionWorld,dt=1/60,tuning=CHARACTER_MOTION_TUNING,mode=0):number{
 if(!(dt>0&&dt<=1/30))throw new RangeError('Character motor requires a fixed step <= 1/30 s');
 if(mode&CHARACTER_MOTION_MODE.IMMOBILIZED)input={forward:0,right:0,sprint:false,crouch:false,jump:false,aim:false,yaw:p.lookYaw,pitch:p.pitch??0};
 const floorAt=(x:number,y:number,z:number,range:number)=>world.footing?world.footing(x,y,z,range):world.floor(x,y,z,range);
 p.lookYaw=input.yaw;if(input.pitch!==undefined)p.pitch=clamp(input.pitch,-1.15,1.15);
 if(mode&CHARACTER_MOTION_MODE.LOCKED){p.vx=p.vz=0;return 0;}
 let events=0;p.impulseX??=0;p.impulseZ??=0;
 if(input.jump&&!p.jumpHeld)p.jumpBuffer=.12;p.jumpHeld=input.jump;p.jumpBuffer=Math.max(0,p.jumpBuffer-dt);
 p.coyote=p.grounded?.1:Math.max(0,p.coyote-dt);
 const standingBlocked=world.blocked(p.x,p.y,p.z,1.8,.29);
 // A restored body under a low ceiling can adopt a legal posture before gravity
 // runs. An unresolved standing overlap must not send it through its floor.
 p.crouch=(!input.aim&&!!input.crouch)||(standingBlocked&&((p.crouch??false)||!world.blocked(p.x,p.y,p.z,1.15,.29)));
 const height=p.crouch?1.15:1.8,magnitude=Math.min(1,Math.hypot(input.forward,input.right)),norm=Math.max(1,Math.hypot(input.forward,input.right)),running=input.sprint&&!input.aim&&!p.crouch&&(p.stamina??1)>.04&&magnitude>.1,top=mode&CHARACTER_MOTION_MODE.IMMOBILIZED?0:mode&CHARACTER_MOTION_MODE.BRACING?1.15:input.aim&&p.grounded?2.35:p.crouch?1.65:running?tuning.runSpeed:tuning.walkSpeed;
 if(world.recover&&(p.crouch?world.blocked(p.x,p.y,p.z,height,.29):standingBlocked)){
  const free=world.recover(p.x,p.y,p.z,height,.29);
  if(free){p.x=free.x;p.y=free.y;p.z=free.z;}
 }
 const fx=Math.sin(input.yaw),fz=Math.cos(input.yaw),rx=-fz,rz=fx;
 p.vx=damp(p.vx,(fx*input.forward+rx*input.right)/norm*top,p.grounded?((mode&CHARACTER_MOTION_MODE.STRIKING)&&!input.aim?3:magnitude>0?12:18):input.aim?.35:3.2,dt);
 p.vz=damp(p.vz,(fz*input.forward+rz*input.right)/norm*top,p.grounded?((mode&CHARACTER_MOTION_MODE.STRIKING)&&!input.aim?3:magnitude>0?12:18):input.aim?.35:3.2,dt);
 if(running&&p.stamina!==undefined)p.stamina=clamp(p.stamina-.09*dt,0,1);
 if(p.jumpBuffer>0&&p.coyote>0&&!p.crouch&&(p.stamina??1)>=.08){if(p.stamina!==undefined)p.stamina-=.08;events|=CHARACTER_MOTION_EVENT.JUMPED;p.vy=tuning.jumpSpeed;p.grounded=false;p.coyote=0;p.jumpBuffer=0;}
 const beforeX=p.x,beforeZ=p.z,steps=Math.max(1,Math.ceil(Math.hypot(p.vx+p.impulseX,p.vz+p.impulseZ)*dt/.10));
 for(let i=0;i<steps;i++){
  const dx=(p.vx+p.impulseX)*dt/steps,dz=(p.vz+p.impulseZ)*dt/steps;
  if(!world.blocked(p.x+dx,p.y,p.z+dz,height,.29)){p.x+=dx;p.z+=dz;continue;}
  const step=floorAt(p.x+dx,p.y+.34,p.z+dz,.38);
  if(p.grounded&&step&&step.normal[1]>.65&&step.y>p.y+.005&&step.y<=p.y+.32&&!world.blocked(p.x+dx,step.y+.015,p.z+dz,height,.29)){p.x+=dx;p.z+=dz;p.y=step.y;continue;}
  if(!world.blocked(p.x+dx,p.y,p.z,height,.29))p.x+=dx;else {p.vx=0;p.impulseX=0;}
  if(!world.blocked(p.x,p.y,p.z+dz,height,.29))p.z+=dz;else {p.vz=0;p.impulseZ=0;}
 }
 const friction=(p.grounded?5.5:.35)*dt;
 const impulse=Math.hypot(p.impulseX,p.impulseZ),factor=impulse>0?Math.max(0,impulse-friction)/impulse:0;p.impulseX*=factor;p.impulseZ*=factor;
 const oldY=p.y,wasGrounded=p.grounded;p.vy=Math.max(-35,p.vy-tuning.gravity*dt);let y=p.y+p.vy*dt;
 if(p.vy>0&&world.blocked(p.x,y,p.z,height,.29)){p.vy=0;y=p.y;}
 const floor=floorAt(p.x,Math.max(oldY,y)+.32,p.z,Math.abs(y-oldY)+.65);p.grounded=false;
 // A head/body overlap cannot remove the floor's vertical constraint. Recovery
 // handles that overlap independently; rejecting support here lets an already
 // intersecting restored body fall through an otherwise solid ground plane.
 if(floor&&floor.normal[1]>.62&&p.vy<=0&&floor.y>=y-.13&&floor.y<=oldY+.32){y=floor.y;p.vy=0;p.grounded=true;}
 // The centre floor ray can miss the edge of a bench/table under the actor's footprint.
 // Sweep the full body vertically so gravity cannot insert it into that edge.
 if(y<oldY){
  const verticalSteps=Math.max(1,Math.ceil((oldY-y)/.1));let free=oldY;
  for(let i=1;i<=verticalSteps;i++){
   let candidate=oldY+(y-oldY)*i/verticalSteps;
   if(!world.blocked(p.x,candidate,p.z,height,.29)){free=candidate;continue;}
   if(!world.blocked(p.x,free,p.z,height,.29)){
    for(let j=0;j<12;j++){const mid=(free+candidate)/2;if(world.blocked(p.x,mid,p.z,height,.29))candidate=mid;else free=mid;}
    y=free;p.vy=0;p.grounded=true;
   }
   break;
  }
 }
 p.y=y;if(p.grounded&&!wasGrounded)p.landTime=.12;p.landTime=Math.max(0,p.landTime-dt);
 p.speed=Math.hypot(p.x-beforeX,p.z-beforeZ)/dt;const heading=(input.aim||!!(mode&CHARACTER_MOTION_MODE.LOOK_HEADING))?input.yaw:p.speed>.06?Math.atan2(p.x-beforeX,p.z-beforeZ):p.yaw;
 p.yaw+=angleDelta(p.yaw,heading)*Math.min(1,dt*14);p.phase+=p.speed*dt*(p.crouch?7:running?5:6);
 p.animation=!p.grounded?(p.vy>0?'jump':'fall'):p.landTime>0?'land':p.speed<.09?'idle':p.crouch?'crouch':running?'run':'walk';
 return events;
}

/** Bounded authority-owned intervals (e.g. lower-frequency NPC decisions) use
 * the same fixed-step kernel; caller time is never forwarded as one oversized step. */
export function advanceCharacterMotion(p:CharacterMotionState,input:CharacterMotionInput,world:CharacterMotionWorld,interval:number,tuning=CHARACTER_MOTION_TUNING,mode=0):number {
 if(!(interval>0&&interval<=.1))throw new RangeError('Character motion interval must be <= 0.1 s');
 const steps=Math.ceil(interval/(1/30)),dt=interval/steps;let events=0;
 for(let i=0;i<steps;i++)events|=stepCharacterMotion(p,input,world,dt,tuning,mode);
 return events;
}
