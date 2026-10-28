import {Vehicle,vehicle,wheel} from '../../dist/vehicles/vehicle.js';
import {generateM3Vehicle,m3PartMaterial} from '../../dist/vehicles/m3.js';
import {freezePrimitive} from '../../dist/procedural/mesh.js';
import {compose} from '../../dist/math.js';
import {M3InteractionRig} from '../../dist/vehicles/interaction-physics.js';
import {eulerFromBasis} from '../../dist/physics/rotation.js';
import {yawPoint,clamp,wrapAngle,hash} from './math.mjs';
const geometry=generateM3Vehicle();
for(const part of geometry.parts){freezePrimitive(part.mesh);if(part.renderMesh)freezePrimitive(part.renderMesh);}
const ROUTE=[[0,0],[96,0],[96,-96],[192,-96],[192,0],[192,96],[96,96],[0,96],[-96,96],[-96,0],[-96,-96],[0,-96]];
export function createCar(scene,id,origin,index){
 const personality=0;
 const wheelIds=['fl','fr','rl','rr'].map(s=>id+':'+s),parts=wheelIds.map((wid,k)=>wheel(wid,{at:[k<2?1.535:-1.30,-.13,k%2? .787:-.787],massKg:22,radiusM:.346,widthM:.27,suspension:{restM:.22,travelM:.20,springNPerM:44000,damperNsPerM:4500},driveTorqueNm:k>1?600:0,drivePowerW:k>1?135000:0,brakeTorqueNm:2300,steerRad:k<2?.58:0,grip:k<2?1.7:1.05,treadDepthM:.009}));
 const blueprint=vehicle(id,{chassis:{massKg:1432,sizeM:[4.7,.64,1.91],dragAreaM2:.72},parts,drivetrain:{engine:{idleRpm:1000,stallRpm:250,redlineRpm:7200,inertiaKgM2:.38,dragTorqueNm:8,torqueCurve:[{rpm:0,torqueNm:180},{rpm:1800,torqueNm:470},{rpm:3500,torqueNm:550},{rpm:5800,torqueNm:510},{rpm:7200,torqueNm:350}]},clutch:{maxTorqueNm:650,stiffnessNmPerRadS:12},gearbox:{forwardRatios:[4.1,2.5,1.67,1.25],reverseRatio:3.8,finalDrive:3.45},differential:{outputs:wheelIds.slice(2),lockFraction:.75,preloadNm:80,couplingNmPerRadS:16}}});
 const yaw=index===2?Math.PI/2:0,initial=index===0?[-17,.67,-2.7]:index===1?[-29,.67,3]:[3,.67,22];initial[0]+=(personality%5)*.7;initial[2]+=(personality%3)*.45;
 const root=scene.add({id,position:[origin[0]+initial[0],initial[1],origin[2]+initial[2]],rotation:[0,yaw,0],material:{kind:'steel'},body:{mass:blueprint.massKg,collisionSize:[4.7,.64,1.91],velocity:index===2?[0,0,-10]:[11-index*2,0,index===0?2:0],friction:.4,restitution:.08}});
 const rig=new Vehicle(scene.physics,blueprint,{}, {body:root.body});scene.assemblies.set(id,rig);
 const paint=[[.03,.28,.48,1],[.7,.16,.045,1],[.48,.55,.12,1]][index],visuals=[];
 for(const part of geometry.parts){const vid=id+':visual:'+part.id;scene.add({id:vid,visualOnly:true,mesh:part.renderMesh??part.mesh,position:[0,-100,0],material:m3PartMaterial(part,paint,true)});visuals.push({id:vid,part});}
 const soft=new M3InteractionRig(blueprint.massKg);
 const car={id,rig,soft,wheelIds,visuals,index,steer:0,maxSlip:0,origin,personality,routeIndex:0,distanceM:0,fullThrottleTicks:0,driftTicks:0,lastPosition:[...root.body.position],lastShift:-1,turnUntil:-1,recoveryAt:null,softUntil:-1,softRevision:0,meshRevision:-1};
 const field={get revision(){return car.softRevision;},sample(rest,out){const point=[rest[0],rest[1]+.59,rest[2]],distances=[];for(let n=0;n<soft.structure.nodeCount;n++){const j=n*3,d=(point[0]-soft.nodeRest[j])**2+(point[1]-soft.nodeRest[j+1])**2+(point[2]-soft.nodeRest[j+2])**2;distances.push([d,j]);}distances.sort((a,b)=>a[0]-b[0]);out.splice(0,3,...rest);let sum=0;for(const [d]of distances.slice(0,4))sum+=1/Math.max(1e-8,d);for(const [d,j]of distances.slice(0,4)){const weight=1/Math.max(1e-8,d)/sum;for(let k=0;k<3;k++)out[k]+=(soft.structure.position[j+k]-soft.nodeRest[j+k])*weight;}}};rig.bindDeformation(field);
 car.impact=(contact,available,isA)=>{if(contact.approachSpeed<1||available<120)return 0;const body=rig.body,frame=compose([0,0,0],body.rotation,[1,1,1]),relative=contact.point.map((v,k)=>v-body.position[k]),normal=contact.normal.map(v=>v*(isA?1:-1)),point=[0,1,2].map(k=>frame[k*4]*relative[0]+frame[k*4+1]*relative[1]+frame[k*4+2]*relative[2]+(k===1?.59:0)),localNormal=[0,1,2].map(k=>frame[k*4]*normal[0]+frame[k*4+1]*normal[1]+frame[k*4+2]*normal[2]),budget=Math.min(8000,available*.35),cage=Math.min(3,budget*.005),result=soft.impact({time:scene.time,point,normal:localNormal,energyJ:budget-cage,structuralEnergyJ:cage,radiusM:.55,thicknessM:.0008,effectiveMassKg:5});car.softUntil=scene.time+2;car.softRevision++;return Math.min(available,result.elasticEnergyJ+result.plasticEnergyJ+cage);};
 car.observe=()=>{car.maxSlip=Math.max(car.maxSlip,...wheelIds.map(w=>rig.part(w).slipPowerW));if(scene.time<car.softUntil){soft.step(1/120);soft.step(1/120);soft.drainEvents();car.softRevision++;}};
 rig.setGear(2);scene.surfaces.claimContactBody(id);
 car.drive=time=>{const b=rig.body,speed=Math.hypot(b.velocity[0],b.velocity[2]),bodyFrame=compose([0,0,0],b.rotation,[1,1,1]),heading=Math.atan2(-bodyFrame[2],bodyFrame[0]);
  // Drivers traverse connected streets. Only wheel forces move the body.
  const route=car.route?.length?car.route:ROUTE;
  let waypoint=route[car.routeIndex],target=[origin[0]+waypoint[0],origin[2]+waypoint[1]];
  if(Math.hypot(target[0]-b.position[0],target[1]-b.position[2])<Math.max(9,speed*.65)){car.routeIndex=(car.routeIndex+1)%route.length;waypoint=route[car.routeIndex];target=[origin[0]+waypoint[0],origin[2]+waypoint[1]];car.turnUntil=time+.22;}
  const desired=Math.atan2(-(target[1]-b.position[2]),target[0]-b.position[0]),error=wrapAngle(desired-heading),velocityYaw=Math.atan2(-b.velocity[2],b.velocity[0]),slip=wrapAngle(velocityYaw-heading);
  car.steer=clamp(-error*1.25+b.angularVelocity[1]*.45-(speed>5?slip*.55:0),-1,1);
  // Lift briefly, then kick the rear loose with full power through the corner.
  const remaining=Math.hypot(target[0]-b.position[0],target[1]-b.position[2]),turnSpeed=Math.abs(error)>.40||remaining<38?11:18;
  let throttle=car.intent?.throttle??((time+index*.47)%2.3<1.95?1:.20),brake=speed>turnSpeed+2?.65:0,handbrake=speed>8&&time<car.turnUntil?.55:0;
  const forward=b.velocity[0]*Math.cos(heading)-b.velocity[2]*Math.sin(heading);
  if(speed<1.4&&time>2){car.recoveryAt??=time;if(time-car.recoveryAt>1.1){rig.setGear(-1);throttle=.65;car.steer=-car.steer;if(time-car.recoveryAt>3.3){car.recoveryAt=null;rig.setGear(1);}}}else if(car.recoveryAt!==null||rig.drivetrainState.gear<0&&forward< -3){car.recoveryAt=null;rig.setGear(1);}
  const state=rig.drivetrainState,rpm=state.engineRpm;
  if(state.gear>0&&time-car.lastShift>.7){const gear=state.gear;if(rpm>6500&&speed>gear*9&&gear<4){rig.setGear(gear+1);car.lastShift=time;}else if(gear>1&&speed<(gear-1)*8){rig.setGear(gear-1);car.lastShift=time;}}
  const clutch=rpm<1300?.16:rpm<2300?.45:1;
  if(state.gear<0&&forward>2)brake=.25;
  rig.setControls({throttle,clutch,steer:car.steer,brake,handbrake});
  car.throttle=throttle;
  if(throttle===1)car.fullThrottleTicks++;if(speed>6&&Math.abs(slip)>.20)car.driftTicks++;
  car.distanceM+=Math.hypot(b.position[0]-car.lastPosition[0],b.position[2]-car.lastPosition[2]);car.lastPosition=[...b.position];
 };
 car.publish=()=>{const b=rig.body,groundOrigin=[b.position[0],b.position[1]-.59,b.position[2]];
  const frame=compose(groundOrigin,b.rotation,[1,1,1]);
  for(const v of visuals){const p=v.part,rotation=p.rotation??[0,0,0],wheelMatch=/^(?:rim|tire)-(front|rear)-(left|right)$/.exec(p.id),wi=wheelMatch?(wheelMatch[1]==='front'?0:2)+(wheelMatch[2]==='right'?1:0):-1,part=wi>=0?(car.replayParts?.[wi]??rig.part(wheelIds[wi])):null,local=p.position??[0,0,0];let position=[0,1,2].map(k=>frame[k]*local[0]+frame[k+4]*local[1]+frame[k+8]*local[2]+frame[k+12]);if(part?.contact)position=part.point.map((x,k)=>x+part.contactNormal[k]*part.effectiveRadiusM);const localFrame=compose([0,0,0],[rotation[0],rotation[1]-(wi>=0&&wi<2?car.steer*.58:0),rotation[2]-(part?part.spinRad:0)],[1,1,1]),basis=[];for(let col=0;col<3;col++)for(let row=0;row<3;row++)basis[col*3+row]=frame[row]*localFrame[col*4]+frame[row+4]*localFrame[col*4+1]+frame[row+8]*localFrame[col*4+2];const composed=[0,0,0];eulerFromBasis(basis,composed);scene.setVisualTransform(v.id,position,composed);}
  const detail=car.renderDetail??2;
  if((car.softRevision!==car.meshRevision||detail!==car.meshDetail)&&car.softUntil>=0){const bodyPart=geometry.parts.find(p=>p.id==='body'),entity=scene.entities.get(id+':visual:body');entity.mesh=freezePrimitive(soft.shellMesh(bodyPart.mesh,detail===2?'damaged':'damaged-coarse'),true);scene.renderStructureRevision++;car.meshRevision=car.softRevision;car.meshDetail=detail;}
  car.maxSlip=Math.max(car.maxSlip,...wheelIds.map(w=>rig.part(w).slipPowerW));
 };
 car.contacts=()=>wheelIds.map(w=>{const p=rig.part(w),b=rig.body;return{id:w,sourceBodyId:id,normalLoadN:Math.max(0,p.loadN),position:[p.point[0],p.point[1],p.point[2]],velocity:[b.velocity[0],0,b.velocity[2]],grounded:p.contact,radius:p.effectiveRadiusM,angularSpeed:Math.abs(p.angularSpeed),lateral:[Math.sin(b.rotation[1]),0,Math.cos(b.rotation[1])]};});
 car.dispose=()=>{scene.surfaces.releaseContactBody(id);scene.remove(id);for(const v of visuals)scene.remove(v.id);};car.publish();
 car.clearSoftPresentation=()=>{soft.structure.position.set(soft.nodeRest);soft.panels.restorePresentation([]);car.softUntil=-1;car.softRevision=0;car.tapeSoft=-1;car.meshRevision=-1;scene.entities.get(id+':visual:body').mesh=geometry.parts.find(p=>p.id==='body').renderMesh??geometry.parts.find(p=>p.id==='body').mesh;scene.renderStructureRevision++;};
 return car;
}
