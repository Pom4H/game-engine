import {Vehicle,vehicle,wheel} from '../../dist/vehicles/vehicle.js';
import {emptySnow,combineSnow,snowThermal} from '../../dist/environment/snow-matter.js';
import {compose} from '../../dist/math.js';
import {eulerFromBasis} from '../../dist/physics/rotation.js';
import {clamp,wrapAngle} from './math.mjs';
import {serviceVisuals,snowLoadMesh} from './service-visuals.mjs';
/** Native driven service vehicle. Payload is material removed by the blade;
 * carrying capacity and the remaining snow choose clearing/haul work. */
export class RoadService{
 constructor(world){this.world=world;this.scene=world.scene;this.id='roads:plow';this.load=emptySnow();this.exportedKg=0;this.goal=[96,0];this.capacityKg=600;this.routeIndex=0;this.parts=[];
  const parts=['fl','fr','rl','rr'].map((id,i)=>wheel(this.id+':'+id,{at:[i<2?2.05:-1.9,-.5,i%2?1:-1],massKg:65,radiusM:.52,widthM:.36,suspension:{restM:.26,travelM:.22,springNPerM:98000,damperNsPerM:8500},driveTorqueNm:i>1?2800:0,drivePowerW:i>1?100000:0,brakeTorqueNm:6000,steerRad:i<2?.65:0,grip:1.2}));
  const blueprint=vehicle(this.id,{chassis:{massKg:5200,sizeM:[6.8,1.1,2.4]},parts});this.root=this.scene.add({id:this.id,position:[-32,1.4,6],material:{kind:'steel'},body:{mass:blueprint.massKg,collisionSize:[6.8,1.1,2.4],friction:.6,restitution:.03}});this.rig=new Vehicle(this.scene.physics,blueprint,{}, {body:this.root.body});this.scene.assemblies.set(this.id,this.rig);
  for(const part of serviceVisuals()){const id=this.id+':'+part.id;this.scene.add({id,visualOnly:true,mesh:part.mesh,material:part.material});this.parts.push({...part,id});}
 }
 step(dt){
  const b=this.rig.body,basis=compose([0,0,0],b.rotation,[1,1,1]),heading=Math.atan2(-basis[2],basis[0]),speed=Math.hypot(b.velocity[0],b.velocity[2]);this.mode??='clear';this.from??=[-32,6];this.queue??=[];
  if(this.mode==='clear'&&this.load.massKg>=this.capacityKg){
   this.mode='haul';this.from=[b.position[0],b.position[2]];
   // Reach the next street junction in the current travel direction before
   // changing direction; a loaded truck cannot make an instantaneous U-turn.
   let x=Math.round(b.position[0]/96)*96,z=Math.round(b.position[2]/96)*96;
   if(Math.abs(basis[0])>Math.abs(basis[2]))x=(basis[0]>0?Math.floor(b.position[0]/96)+1:Math.ceil(b.position[0]/96)-1)*96;else z=(basis[2]>0?Math.floor(b.position[2]/96)+1:Math.ceil(b.position[2]/96)-1)*96;
   this.queue=[[x,z]];while(z!==0){z-=Math.sign(z)*96;this.queue.push([x,z]);}while(x!==384){x+=Math.sign(384-x)*96;this.queue.push([x,0]);}this.goal=this.queue.shift();
  }
  const range=Math.hypot(this.goal[0]-b.position[0],this.goal[1]-b.position[2]);
  if(range<5){this.from=[...this.goal];if(this.queue.length)this.goal=this.queue.shift();else if(this.mode==='haul'){
   this.world.snow.export(this.load);this.exportedKg+=this.load.massKg;this.load=emptySnow();this.mode='return';this.queue=[[480,96],[384,96],[288,96],[288,0],[192,0],[96,0]];this.goal=[480,0];
  }else if(this.mode==='return'){this.mode='clear';this.goal=[0,0];this.routeIndex=3;}else{this.routeIndex=(this.routeIndex+1)%4;this.goal=[[96,0],[96,96],[0,96],[0,0]][this.routeIndex];}}
  const dx=this.goal[0]-this.from[0],dz=this.goal[1]-this.from[1],length=Math.hypot(dx,dz)||1,progress=clamp(((b.position[0]-this.from[0])*dx+(b.position[2]-this.from[1])*dz)/length,0,length),along=Math.min(length,progress+6),tx=this.from[0]+dx/length*along,tz=this.from[1]+dz/length*along;
  const error=wrapAngle(Math.atan2(-(tz-b.position[2]),tx-b.position[0])-heading);this.steer=clamp(-error*1.3+b.angularVelocity[1]*.6,-1,1);
  const limit=Math.min(3.5,Math.sqrt(2.25+3*Math.max(0,length-progress-7)),Math.abs(error)>.35?1.5:3.5);this.rig.setControls({throttle:speed>limit?0:.55,steer:this.steer,brake:clamp((speed-limit)*.5,0,1)});
 }
 clear(dt){if(this.mode!=='clear')return;const b=this.rig.body,speed=Math.hypot(b.velocity[0],b.velocity[2]);if(speed<.2)return;const m=compose(b.position,b.rotation,[1,1,1]),p=[b.position[0]+m[0]*3.9,b.position[1]-.9,b.position[2]+m[2]*3.9];
  const packet=this.world.snow.cut({min:[p[0]-2,0,p[2]-2],max:[p[0]+2,.55,p[2]+2],distance:q=>Math.max(Math.abs((q[0]-p[0])*m[0]+(q[2]-p[2])*m[2])-.26,Math.abs((q[0]-p[0])*m[8]+(q[2]-p[2])*m[10])-1.65)},Math.min(this.capacityKg-this.load.massKg,speed*dt*12));
  this.load=combineSnow(this.load,packet);this.lastMovedKg=packet.massKg;
 }
 syncLoad(){
  if(this.loadVolume===this.load.volumeM3&&this.loadEnthalpy===this.load.enthalpyJ&&this.loadMass===this.load.massKg)return;const changedVolume=this.loadVolume!==this.load.volumeM3;this.loadVolume=this.load.volumeM3;this.loadEnthalpy=this.load.enthalpyJ;this.loadMass=this.load.massKg;const id=this.id+':snow-load',entity=this.scene.entities.get(id);
  if(this.load.volumeM3<=1e-9){if(entity)this.scene.remove(id);this.parts=this.parts.filter(p=>p.id!==id);return;}
  const mesh=changedVolume||!entity?snowLoadMesh(this.load.volumeM3):entity.mesh,liquid=snowThermal(this.load).liquidFraction,material={kind:'snow',color:[.96*(1-liquid*.16),.98*(1-liquid*.16),.995*(1-liquid*.16),1],roughness:.9};
  if(entity){if(entity.mesh!==mesh){entity.mesh=mesh;this.scene.renderStructureRevision++;}if(material.color.some((v,k)=>Math.abs(v-entity.material.color[k])>1e-6))this.scene.patchAppearance({materials:[{id,set:{color:material.color}}]});}else{this.scene.add({id,visualOnly:true,mesh,material});this.parts.push({id,p:[-1.3,.465,0]});}
 }
 publish(){this.syncLoad();const b=this.rig.body,m=compose(b.position,b.rotation,[1,1,1]);for(const part of this.parts){let p=[0,1,2].map(k=>b.position[k]+m[k]*part.p[0]+m[k+4]*part.p[1]+m[k+8]*part.p[2]),rotation=b.rotation;if(part.wheel!==undefined){const w=this.replayWheels?.[part.wheel]??this.rig.part(this.id+':'+['fl','fr','rl','rr'][part.wheel]);if(w.contact)p=w.point.map((v,k)=>v+w.contactNormal[k]*.52);const local=compose([0,0,0],[part.axisZ?0:Math.PI/2,part.wheel<2?-(this.steer??0)*.65:0,-w.spinRad],[1,1,1]),basis=[];for(let col=0;col<3;col++)for(let row=0;row<3;row++)basis[col*3+row]=m[row]*local[col*4]+m[row+4]*local[col*4+1]+m[row+8]*local[col*4+2];rotation=[0,0,0];eulerFromBasis(basis,rotation);}this.scene.setVisualTransform(part.id,p,rotation);}}
 snapshot(){const b=this.rig.body;return{body:[...b.position,...b.rotation,...b.velocity,...b.angularVelocity],wheels:['fl','fr','rl','rr'].map(id=>{const w=this.rig.part(this.id+':'+id);return{point:[...w.point],contactNormal:[...w.contactNormal],contact:w.contact,spinRad:w.spinRad};}),steer:this.steer??0,load:{...this.load},mode:this.mode,exportedKg:this.exportedKg};}
 restore(s){const b=this.rig.body;b.position.splice(0,3,...s.body.slice(0,3));b.rotation.splice(0,3,...s.body.slice(3,6));b.velocity.splice(0,3,...s.body.slice(6,9));this.replayWheels=s.wheels;this.steer=s.steer;this.load=s.load;this.mode=s.mode;this.exportedKg=s.exportedKg;}
 dispose(){this.scene.remove(this.id);for(const p of this.parts)this.scene.remove(p.id);}
}
