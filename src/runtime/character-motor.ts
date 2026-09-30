/** On-foot subset migrated from Pom4H/thegame character.ts (blob 1d19ad8662ab).
 * Metres/seconds, +Y up, yaw=0 faces +Z, y is feet height. Rendering is not authority.
 * Combat, boarding and stamina exhaustion are intentionally outside this lite motor. */
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
/** The same function is run on authority ticks and during bounded local input replay. */
export function stepCharacter(p:CharacterState,input:CharacterInput,world:CharacterWorld,dt=1/60,tuning=CHARACTER_TUNING):void {
 if(!Number.isFinite(dt)||dt<=0||dt>1/30)throw new RangeError('Character motor requires fixed dt <= 1/30');
 p.lookYaw=input.yaw;
 if(input.jump&&!p.jumpHeld)p.jumpBuffer=.12;p.jumpHeld=input.jump;p.jumpBuffer=Math.max(0,p.jumpBuffer-dt);
 p.coyote=p.grounded?.1:Math.max(0,p.coyote-dt);
 const norm=Math.max(1,Math.hypot(input.forward,input.right)),moving=norm>1||input.forward!==0||input.right!==0;
 const top=input.sprint?tuning.runSpeed:tuning.walkSpeed,fx=Math.sin(input.yaw),fz=Math.cos(input.yaw);
 const blend=1-Math.exp(-(p.grounded?(moving?12:18):3.2)*dt);
 p.vx+=((fx*input.forward-fz*input.right)/norm*top-p.vx)*blend;
 p.vz+=((fz*input.forward+fx*input.right)/norm*top-p.vz)*blend;
 if(p.jumpBuffer>0&&p.coyote>0){p.vy=tuning.jumpSpeed;p.grounded=false;p.coyote=0;p.jumpBuffer=0;}
 const oldX=p.x,oldZ=p.z,height=1.8,radius=.29,steps=Math.max(1,Math.ceil(Math.hypot(p.vx,p.vz)*dt/.1));
 for(let i=0;i<steps;i++){
  const dx=p.vx*dt/steps,dz=p.vz*dt/steps;
  if(!world.blocked(p.x+dx,p.y,p.z+dz,height,radius)){p.x+=dx;p.z+=dz;continue;}
  const step=world.floor(p.x+dx,p.y+.34,p.z+dz,.38);
  if(p.grounded&&step&&step.normal[1]>.65&&step.y>p.y+.005&&step.y<=p.y+.32&&!world.blocked(p.x+dx,step.y+.015,p.z+dz,height,radius)){p.x+=dx;p.z+=dz;p.y=step.y;continue;}
  if(!world.blocked(p.x+dx,p.y,p.z,height,radius))p.x+=dx;else p.vx=0;
  if(!world.blocked(p.x,p.y,p.z+dz,height,radius))p.z+=dz;else p.vz=0;
 }
 const oldY=p.y,wasGrounded=p.grounded;p.vy=Math.max(-35,p.vy-tuning.gravity*dt);let y=p.y+p.vy*dt;
 if(p.vy>0&&world.blocked(p.x,y,p.z,height,radius)){p.vy=0;y=p.y;}
 const floor=world.floor(p.x,Math.max(oldY,y)+.32,p.z,Math.abs(y-oldY)+.65);p.grounded=false;
 if(floor&&floor.normal[1]>.62&&p.vy<=0&&floor.y>=y-.13&&floor.y<=oldY+.32&&!world.blocked(p.x,floor.y,p.z,height,radius)){y=floor.y;p.vy=0;p.grounded=true;}
 if(y<oldY){
  const count=Math.max(1,Math.ceil((oldY-y)/.1));let free=oldY;
  for(let i=1;i<=count;i++){
   let candidate=oldY+(y-oldY)*i/count;
   if(!world.blocked(p.x,candidate,p.z,height,radius)){free=candidate;continue;}
   if(!world.blocked(p.x,free,p.z,height,radius)){
    for(let j=0;j<12;j++){const mid=(free+candidate)/2;if(world.blocked(p.x,mid,p.z,height,radius))candidate=mid;else free=mid;}
    y=free;p.vy=0;p.grounded=true;
   }break;
  }
 }
 p.y=y;if(p.grounded&&!wasGrounded)p.landTime=.12;p.landTime=Math.max(0,p.landTime-dt);
 p.speed=Math.hypot(p.x-oldX,p.z-oldZ)/dt;
 if(p.speed>.06){const heading=Math.atan2(p.x-oldX,p.z-oldZ);p.yaw+=Math.atan2(Math.sin(heading-p.yaw),Math.cos(heading-p.yaw))*Math.min(1,dt*14);}
 p.yaw=Math.atan2(Math.sin(p.yaw),Math.cos(p.yaw));p.phase=(p.phase+p.speed*dt*(input.sprint?5:6))%(Math.PI*2000);
}
