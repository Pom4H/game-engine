import {SnowSurface} from '../../dist/environment/snow-surface.js';
import {clamp,mix,smooth,yawPoint} from './math.mjs';
import {makePedestrian,pedestrianAnimation} from './pedestrian.mjs';
import {sampleWalker,bindHumanoid,solveTwoBone} from '../../dist/animation/locomotion.js';
import {freezePrimitive} from '../../dist/procedural/mesh.js';
const snow={kind:'snow',color:[.9,.94,.98,1],roughness:.96};
const pedestrian=makePedestrian();for(const e of pedestrian)freezePrimitive(e.mesh);
const bindings=pedestrianAnimation().bindings;
export class SnowPeople{
 constructor(scene,origin,sector){this.scene=scene;this.origin=origin;this.prefix='people:'+sector;this.owned=new Set();this.projectiles=[];this.lastThrow=-1;this.stamp=0;this.liftRelease=null;this.action='snowballs';this.stockM3=2;this.usedM3=0;this.knocked=false;this.built=false;
  this.skin=new SnowSurface({id:this.prefix+':snow',center:[origin[0]+28,origin[2]+26],size:[18,16],height:.60,snowDepth:.48,tileSize:4,coarseCellSize:.45,detailedCellSize:.12,maxTiles:32,maxDetailedTiles:6,capacity:100});
  this.flushSnow();this.actors=[];
  const colors=[[.9,.25,.12,1],[.05,.5,.56,1],[.45,.2,.64,1],[.83,.63,.13,1],[.12,.19,.25,1],[.65,.12,.16,1]];
  for(let i=0;i<6;i++){const id=this.prefix+':actor'+i,parts=[];
   for(const e of pedestrian){const key=e.id.slice(7),pid=id+':'+key;this.add({...e,id:pid,position:[0,-100,0],material:{...e.material,...(/coat|Arm|forearm|hood|hat/.test(key)?{color:colors[i]}:{})}});parts.push(pid);}
   this.actors.push({id,parts,bindings:bindings.map(b=>({...b,entity:id+':'+b.entity.slice(7)})),position:[origin[0]+20+i*2,.15,origin[2]+22+(i%2)*5]});
  }
  this.balls=[.62,.18,.29].map((r,i)=>{this.stockM3-=4*Math.PI*r**3/3;this.usedM3+=4*Math.PI*r**3/3;return this.add({id:this.prefix+':man'+i,position:[origin[0]+29+i*1.1,r+.25,origin[2]+29],mesh:{kind:'sphere',radius:r,segments:14},material:snow,body:{mass:4*Math.PI*r**3/3*280,friction:.9,restitution:.015}});});
  this.rollingRadius=.18;this.lastRoll=[...this.balls[1].body.position];this.rollDistance=0;this.rollRevision=0;
  this.pushDriver={maxStepSeconds:1/120,force:[0,0,0],torque:[0,0,0],evaluate:()=>{const b=this.balls[1].body;b.wake();const t=this.scene.time%32;this.pushDriver.force[0]=b.mass*((origin[0]+30.1-b.position[0])*5-b.velocity[0]*4);this.pushDriver.force[2]=b.mass*((origin[2]+29+Math.sin(t*.8)*1.8-b.position[2])*5-b.velocity[2]*4);}};
  this.pushRelease=scene.physics.drive(this.balls[1].body,this.pushDriver);
  // Snow stock is tracked by volume; the lift is a force driver, never a pose write.
  this.liftDriver={maxStepSeconds:1/120,force:[0,0,0],torque:[0,0,0],evaluate:()=>{const upper=this.balls[1].body;upper.wake();const t=this.scene.time%32,u=smooth((t-15)/5),base=this.balls[0].body.position,target=[mix(origin[0]+30.1,base[0],u),mix(.7,base[1]+1.05,u),mix(origin[2]+29,base[2],u)];for(let k=0;k<3;k++)this.liftDriver.force[k]=upper.mass*((target[k]-upper.position[k])*65-upper.velocity[k]*13+(k===1?9.81:0));}};
  this.decor=[];for(const [name,mesh,color,offset]of [['nose',{kind:'cylinder',radius:.045,topRadius:0,height:.24,segments:8},[1,.36,.02,1],[0,0,-.35]],['eye-l',{kind:'sphere',radius:.027,segments:6},[.02,.025,.03,1],[-.10,.10,-.265]],['eye-r',{kind:'sphere',radius:.027,segments:6},[.02,.025,.03,1],[.10,.10,-.265]]]){const id=this.prefix+':'+name;this.add({id,position:[0,-100,0],mesh,material:{kind:'default',color}});this.decor.push({id,offset});}
 }
 add(spec){this.owned.add(spec.id);return this.scene.add(spec);}
 flushSnow(){for(const spec of this.skin.drainMeshes()){if(this.scene.entities.has(spec.id))this.scene.remove(spec.id);this.add(spec);}}
 pose(actor,p,yaw,phase,mode){actor.position=p;actor.presentation={p,yaw,phase,mode};}
 publish(){for(const actor of this.actors){const {p,yaw,phase,mode}=actor.presentation,localTime=phase/5,speed=mode==='walk'?.55:0,heading=mode==='angel'?0:yaw;
  const pose=sampleWalker({id:actor.id,root:[p[0]-Math.cos(heading)*speed*localTime,p[1],p[2]+Math.sin(heading)*speed*localTime],heading,speed,period:1.18},localTime);
  if(mode==='build'||mode==='throw'||mode==='angel'){for(const [side,sign]of [['left',-1],['right',1]]){const shoulder=pose.joints[side+'Shoulder'],local=mode==='angel'?[.04,.9,sign*(.48+.19*Math.sin(phase))]:mode==='build'?[.5,1.12,sign*.22]:[.20+.22*Math.sin(phase),1.35+.12*Math.cos(phase),sign*.24],target=yawPoint(local,p,heading),arm=solveTwoBone(shoulder,target,.295,.27,[-Math.cos(heading),0,Math.sin(heading)]);pose.joints[side+'Elbow']=arm.joint;pose.joints[side+'Hand']=arm.end;}}
  for(const v of bindHumanoid(pose,actor.bindings)){let position=v.position,rotation=v.rotation;if(mode==='angel'){const dx=position[0]-p[0],dy=position[1]-p[1],dz=position[2]-p[2];position=[p[0]+dz,p[1]+.42-dx,p[2]-dy];rotation=[Math.PI/2+rotation[0],yaw+rotation[1],rotation[2]];}this.scene.setVisualTransform(v.entity,position,rotation,v.scale);}
 }}
 update(time){const t=time%32,o=this.origin;this.action=t<13?'snowballs':t<17?'snow-angel':t<25?'snowman-lift':'snowman-smash';
  if(t<13){const old=this.balls[1],b=old.body,distance=Math.hypot(b.position[0]-this.lastRoll[0],b.position[2]-this.lastRoll[2]);this.lastRoll=[...b.position];this.rollDistance+=distance;
   if(Math.floor(t*2)>this.rollRevision&&distance>0&&this.rollingRadius<.43){this.rollRevision=Math.floor(t*2);const oldVolume=4*Math.PI*this.rollingRadius**3/3,desired=Math.min(4*Math.PI*.43**3/3,.02443+this.rollDistance*.09),pickup=Math.min(this.stockM3,Math.max(0,desired-oldVolume));if(pickup>0){const radius=Math.cbrt((oldVolume+pickup)*3/(4*Math.PI)),newMass=(oldVolume+pickup)*280,ratio=b.mass/newMass,inertiaRatio=b.mass*this.rollingRadius**2/(newMass*radius**2),position=[...b.position];position[1]+=radius-this.rollingRadius;const velocity=b.velocity.map(v=>v*ratio),angularVelocity=b.angularVelocity.map(v=>v*inertiaRatio);this.pushRelease?.();this.scene.remove(old.id);this.balls[1]=this.add({id:old.id,position,rotation:[...b.rotation],mesh:{kind:'sphere',radius,segments:14},material:snow,body:{mass:newMass,velocity,angularVelocity,friction:.9,restitution:.015}});this.rollingRadius=radius;this.stockM3-=pickup;this.usedM3+=pickup;this.pushRelease=this.scene.physics.drive(this.balls[1].body,this.pushDriver);this.skin.stamp({sequence:++this.stamp,foot:'rolling-snow',position,yaw:0,time,depth:.06,ellipse:[radius,radius]});}}
  }else if(this.pushRelease){this.pushRelease();this.pushRelease=null;}
  for(let i=0;i<this.actors.length;i++){const a=this.actors[i];let p=[o[0]+20+i*2,.15,o[2]+22+(i%2)*5],mode='walk',yaw=i%2?Math.PI:0;
   if(i<2){p[0]+=Math.sin(time*.5+i)*1.2;mode=t<13?'throw':'walk';}
   if(i===2){p=[o[0]+24,.15,o[2]+31];mode='angel';if(t>12&&t<17&&Math.floor(t*4)>this.stamp){this.stamp=Math.floor(t*4);const angle=Math.sin(t*3)*.6;for(const [dx,dz,rx,rz,y]of [[0,-.85,.3,.62,0],[-.7,-1.2,.53,.13,angle],[.7,-1.2,.53,.13,-angle],[-.3,-.25,.17,.5,angle],[.3,-.25,.17,.5,-angle]])this.skin.stamp({sequence:this.stamp,foot:a.id,position:[p[0]+dx,.15,p[2]+dz],yaw:y,time,depth:.28,ellipse:[rx,rz]});}}
   if(i===3||i===4){p=[o[0]+28+(i-3)*2,.15,o[2]+28];mode=t>14&&t<27?'build':'walk';yaw=Math.PI;}
   if(i===5){const u=smooth((t-24)/3);p=[o[0]+mix(35,29.8,u),.15,o[2]+29.5];mode='walk';yaw=Math.PI/2;}
   this.pose(a,p,yaw,time*5+i,mode);
  }
  const throwIndex=Math.floor(time/2);if(t<13&&throwIndex!==this.lastThrow){this.lastThrow=throwIndex;const from=this.actors[throwIndex%2].position,to=this.actors[1-throwIndex%2].position,flight=.65;const e=this.add({id:this.prefix+':ball'+throwIndex,position:[from[0],from[1]+1.3,from[2]],mesh:{kind:'sphere',radius:.10,segments:8},material:snow,body:{mass:1.1,velocity:[(to[0]-from[0])/flight,3.2,(to[2]-from[2])/flight],friction:.8,restitution:.015}});this.projectiles.push({id:e.id,at:time});}
  for(const p of this.projectiles)if(time-p.at>5){this.scene.remove(p.id);this.owned.delete(p.id);}this.projectiles=this.projectiles.filter(p=>time-p.at<=5);
  if(t>=15&&!this.liftRelease&&!this.built)this.liftRelease=this.scene.physics.drive(this.balls[1].body,this.liftDriver);
  if(t>=21&&!this.built){this.built=true;const top=this.balls[2].body;this.topDriver={maxStepSeconds:1/120,force:[0,0,0],torque:[0,0,0],evaluate:()=>{top.wake();const mid=this.balls[1].body.position,target=[mid[0],mid[1]+.72,mid[2]];for(let k=0;k<3;k++)this.topDriver.force[k]=top.mass*((target[k]-top.position[k])*65-top.velocity[k]*13+(k===1?9.81:0));}};this.topRelease=this.scene.physics.drive(top,this.topDriver);}
  if(t>=27&&this.topRelease){this.topRelease();this.topRelease=null;this.liftRelease?.();this.liftRelease=null;}
  if(t>=27&&!this.knocked){this.knocked=true;const b=this.balls[1].body;b.velocity[0]-=4;b.velocity[1]+=1; b.angularVelocity[2]+=3;b.wake();}
  const head=this.balls[2].body;for(const d of this.decor)this.scene.setVisualTransform(d.id,yawPoint(d.offset,head.position,head.rotation[1]),[Math.PI/2,head.rotation[1],0]);
 }
 focus(time){const t=time%32;return t<13?this.actors[0].position:t<17?[this.origin[0]+24,.6,this.origin[2]+30]:[this.origin[0]+29,1.3,this.origin[2]+29];}
 feet(){return this.actors.flatMap((a,i)=>[0,1].map(s=>({id:a.id+':foot'+s,position:[a.position[0]+(s?-.13:.13),.15,a.position[2]],grounded:a.presentation?.mode!=='angel'&&Math.sin(this.scene.time*5+i+s*Math.PI)<-.1,yaw:0})));}
 dispose(){this.pushRelease?.();this.liftRelease?.();this.topRelease?.();for(const id of this.owned)this.scene.remove(id);}
}
