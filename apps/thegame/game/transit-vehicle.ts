/** Recovered from game-engine 9c564556275b1a50b366e92034910ade90b68986; current Engine adapter. */
import {projection,scalar,vector3,type Frame,type Stamp} from '../../../src/network/projection.js';
import {PhysicsWorld} from '../../../src/physics/world.js';
import {physicsCause,type PhysicsCauseWriter,type PhysicsCauseManifestWriter} from '../../../src/physics/cause-trace.js';
import {Vehicle,vehicle,wheel} from '../../../src/vehicles/vehicle.js';
import type {CharacterState} from '../../../src/runtime/character-motor.js';
import {WORLD_LIMIT} from './world.js';
import {THEGAME_TRANSIT_ROUTES,type TransitAuthority,type TransitMode,type TransitServiceState} from './transit.js';

const modeCode:Record<TransitMode,number>={bus:0,tram:1,metro:2};
const PROMOTE_RADIUS=420,RETAIN_RADIUS=650,MAX_PHYSICAL_BUSES=4;
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const angle=(v:number)=>Math.atan2(Math.sin(v),Math.cos(v));
const distance=(a:Readonly<{x:number;z:number}>,p:readonly[number,number,number])=>Math.hypot(a.x-p[0],a.z-p[2]);
const routeById=new Map(THEGAME_TRANSIT_ROUTES.map(route=>[route.id,route]));

export const transitVehicleProjection=projection('thegame/transit-vehicles/1',{
 position:vector3('linear',-WORLD_LIMIT,WORLD_LIMIT),
 yaw:scalar('angle',-Math.PI*2,Math.PI*2),
 speed:scalar('linear',0,80),
 doors:scalar('linear',0,1),
 mode:scalar('step',0,2),
 passengers:scalar('step',0,200),
 physical:scalar('step',0,1),
},{maxEntities:16,maxBytes:24_576});

function busBlueprint(id:string){
 const wheels=[] as ReturnType<typeof wheel>[];
 for(const [axle,x] of [['front',4.1],['rear',-3.7]] as const)for(const [side,z] of [['left',-1.02],['right',1.02]] as const)wheels.push(wheel(`${axle}.${side}`,{
  at:[x,0,z],massKg:150,radiusM:.52,widthM:.31,
  suspension:{restM:.58,travelM:.28,springNPerM:150_000,damperNsPerM:18_000,yieldForceN:190_000},
  driveTorqueNm:axle==='rear'?9_000:0,drivePowerW:240_000,brakeTorqueNm:8_000,steerRad:axle==='front'?.42:0,
  grip:1.05,condition:{wearEnergyJ:8e7,heatCapacityJPerK:80_000},
 }));
 return vehicle(id,{chassis:{massKg:11_800,sizeM:[11.5,2.7,2.5],dragAreaM2:4.2},parts:wheels});
}

class ScheduledBus extends Vehicle{
 private target:TransitServiceState;
 private targetSpeed=0;
 private readonly dispatchForce:[number,number,number]=[0,0,0];
 private readonly dispatchCause=physicsCause(this.body.id+'/dispatch','timetable-path.v1','constraint',['force']);
 constructor(world:PhysicsWorld,service:TransitServiceState){
  const yaw=service.yaw,route=routeById.get(service.routeId)!;
  super(world,busBlueprint('transit:'+service.id),{
   position:[service.position[0],service.position[1]+.82,service.position[2]],
   rotation:[0,yaw-Math.PI/2,0],
   velocity:service.phase==='run'?[Math.sin(yaw)*route.cruiseMps,0,Math.cos(yaw)*route.cruiseMps]:[0,0,0],
  });
  this.target=service;this.targetSpeed=service.phase==='run'?route.cruiseMps:0;
 }
 schedule(service:TransitServiceState):void{
  this.target=service;this.targetSpeed=service.phase==='run'?(routeById.get(service.routeId)?.cruiseMps??0):0;
 }
 override declareCauses(manifest:PhysicsCauseManifestWriter):void{
  super.declareCauses(manifest);
  // Vehicle can bind to an already traced world inside super(), before this
  // subclass's field initializers have run. Compile the same stable descriptor.
  const cause=physicsCause(this.body.id+'/dispatch','timetable-path.v1','constraint',['force']);
  manifest.component({componentId:cause.componentId,bodyId:this.body.id,kind:'other',parentComponentId:this.body.id});
  manifest.law(this.body.id,cause);
 }
 override evaluate(dt:number,causes?:PhysicsCauseWriter):void{
  const b=this.body,target=this.target,bodyYaw=angle(b.rotation[1]+Math.PI/2);
  const dx=target.position[0]-b.position[0],dz=target.position[2]-b.position[2],distanceM=Math.hypot(dx,dz);
  const desiredYaw=distanceM>.6?Math.atan2(dx,dz):target.yaw,yawError=angle(desiredYaw-bodyYaw);
  const forwardX=Math.sin(bodyYaw),forwardZ=Math.cos(bodyYaw),speed=b.velocity[0]*forwardX+b.velocity[2]*forwardZ;
  const speedError=this.targetSpeed-speed;
  this.setControls({
   throttle:target.phase==='run'?clamp(speedError*.10,0,.55):0,
   brake:target.phase==='dwell'?1:speedError<-.5?clamp(-speedError*.14,0,1):0,
   steer:clamp(yawError*1.35,-1,1),
  });
  super.evaluate(dt,causes);
  // Schedule is a desired path, not a pose teleport. A bounded dispatch force keeps
  // local physical authority near its coarse service without overriding impacts.
  const desiredVx=Math.sin(target.yaw)*this.targetSpeed,desiredVz=Math.cos(target.yaw)*this.targetSpeed;
  const ax=clamp(dx*.28+(desiredVx-b.velocity[0])*.42,-1.6,1.6);
  const az=clamp(dz*.28+(desiredVz-b.velocity[2])*.42,-1.6,1.6);
  this.dispatchForce[0]=ax*b.mass;this.dispatchForce[2]=az*b.mass;
  this.force[0]+=this.dispatchForce[0];this.force[2]+=this.dispatchForce[2];
  if(causes&&(ax!==0||az!==0))causes.contribute(this.dispatchCause,{kind:'constraint',id:this.target.id},{forceN:this.dispatchForce,pointWorldM:b.position});
 }
}

interface PhysicalBus {readonly serviceId:string;readonly bus:ScheduledBus;lastWanted:number}

export interface TransitSeatPose{
 readonly serviceId:string;
 readonly mode:TransitMode;
 readonly position:readonly[number,number,number];
 readonly yaw:number;
 readonly speed:number;
 readonly physical:boolean;
}

/** Promotion layer: timetable/passenger service is the durable cause; near players a
 * bus receives the engine's real Vehicle/PhysicsWorld authority. Tram/metro stay on
 * their route authority until rail contact is implemented instead of faking tyres. */
export class TransitVehicleAuthority{
 readonly physics=new PhysicsWorld([0,-9.81,0],0,16);
 private readonly physical=new Map<string,PhysicalBus>();
 private update=0;
 readonly stats={promotions:0,demotions:0,physicsSteps:0};

 constructor(readonly transit:TransitAuthority){}

 step(timeSeconds:number,observers:Iterable<Readonly<{state:CharacterState}>>,dt=1/60):void{
  if(!Number.isFinite(timeSeconds)||timeSeconds<0||!Number.isFinite(dt)||dt<=0||dt>.05)throw new RangeError('Invalid transit vehicle clock');
  this.update++;
  const players=[...observers].map(peer=>peer.state),services=this.transit.services(timeSeconds),byId=new Map(services.map(service=>[service.id,service]));
  const buses=services.filter(service=>service.mode==='bus').sort((a,b)=>a.id.localeCompare(b.id));
  for(const service of buses){
   const near=players.some(player=>distance(player,service.position)<=PROMOTE_RADIUS);
   const existing=this.physical.get(service.id);
   if(existing){existing.bus.schedule(service);if(near)existing.lastWanted=this.update;continue;}
   if(!near||this.physical.size>=MAX_PHYSICAL_BUSES)continue;
   const bus=new ScheduledBus(this.physics,service);
   this.physical.set(service.id,{serviceId:service.id,bus,lastWanted:this.update});this.stats.promotions++;
  }
  for(const [id,item] of [...this.physical]){
   const service=byId.get(id);
   if(!service){item.bus.dispose();this.physical.delete(id);this.stats.demotions++;continue;}
   const retained=players.some(player=>distance(player,[item.bus.body.position[0],0,item.bus.body.position[2]])<=RETAIN_RADIUS);
   if(!retained&&this.update-item.lastWanted>30){item.bus.dispose();this.physical.delete(id);this.stats.demotions++;}
  }
  if(this.physical.size){this.physics.step(dt);this.stats.physicsSteps++;}
 }

 private state(service:TransitServiceState):{position:readonly[number,number,number];yaw:number;speed:number;physical:boolean}{
  const item=this.physical.get(service.id);
  if(!item)return{position:service.position,yaw:service.yaw,speed:service.phase==='run'?(routeById.get(service.routeId)?.cruiseMps??0):0,physical:false};
  const b=item.bus.body,yaw=angle(b.rotation[1]+Math.PI/2);
  return{position:[b.position[0],b.position[1],b.position[2]],yaw,speed:Math.hypot(b.velocity[0],b.velocity[2]),physical:true};
 }

 servicePose(serviceId:string,timeSeconds:number){
  const service=this.transit.services(timeSeconds).find(value=>value.id===serviceId);if(!service)return;
  return this.state(service);
 }
 seatPose(serviceId:string,timeSeconds:number):TransitSeatPose|undefined{
  const service=this.transit.services(timeSeconds).find(value=>value.id===serviceId);if(!service)return;
  const state=this.state(service);
  return{serviceId,mode:service.mode,position:[state.position[0],state.position[1]+(service.mode==='metro'?1.15:1.35),state.position[2]],yaw:state.yaw,speed:state.speed,physical:state.physical};
 }

 frame(stamp:Stamp,self:Readonly<{x:number;z:number}>,timeSeconds:number):Frame{
  const rows=this.transit.services(timeSeconds)
   .filter(service=>distance(self,service.position)<=900)
   .map(service=>{const state=this.state(service);return{id:service.id,data:{
    position:state.position,yaw:state.yaw,speed:state.speed,doors:service.doors,mode:modeCode[service.mode],passengers:service.passengers,physical:state.physical?1:0,
   }};});
  return transitVehicleProjection.capture(stamp,rows);
 }

 hasPhysical(serviceId:string):boolean{return this.physical.has(serviceId);}
 inspect(){return{physical:this.physical.size,bodies:this.physics.bodies.size,...this.stats,physics:this.physics.stats};}
 dispose():void{for(const item of this.physical.values())item.bus.dispose();this.physical.clear();this.physics.clear();}
}
