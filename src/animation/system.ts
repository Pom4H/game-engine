import {V3,finiteVec3,type MutableVec3,type Vec3} from '../math.js';
import type {FootContact} from '../environment/footprints.js';
import {sampleWalker,bindHumanoid,validateWalker,type WalkerSpec,type VehicleMotionSpec,type HumanoidPose,type RigTransform,type GroundSampler} from './locomotion.js';

/** Borrow only the pose and body fields this domain consumes. Scene entities
 * satisfy this contract structurally; there is no wrapper, copy or Scene import. */
export interface AnimationTarget {
 readonly id:string;
 position:MutableVec3;rotation:MutableVec3;scale:MutableVec3;
 readonly body?:{
  readonly invMass:number;readonly kinematic:boolean;
  readonly position:MutableVec3;readonly rotation:MutableVec3;
  readonly velocity:MutableVec3;readonly angularVelocity:MutableVec3;
 };
}
/** Engine-owned actor poses. Scene invokes this once at its authoritative
 * simulation time; cinematics only author rigs/routes and read these results. */
export class AnimationSystem {
 private readonly walkers=new Map<string,WalkerSpec>();private readonly vehicles=new Map<string,VehicleMotionSpec>();
 private readonly poses=new Map<string,HumanoidPose>();private time=0;
 private readonly driven=new Map<string,{position:Vec3;heading:number;speed:number;time:number}>();
 private publishedFeet:readonly FootContact[]=Object.freeze([]);
 get feet():readonly FootContact[]{return this.publishedFeet;}
 controlledEntityIds():ReadonlySet<string>{
  const ids=new Set<string>();
  for(const spec of this.walkers.values())for(const binding of spec.bindings??[])ids.add(binding.entity);
  for(const spec of this.vehicles.values())for(const part of spec.parts)ids.add(part.id);
  return ids;
 }
 addWalker(input:WalkerSpec):void {validateWalker(input);if(this.walkers.has(input.id)||this.vehicles.has(input.id))throw new TypeError(`Duplicate animated actor ${input.id}`);this.walkers.set(input.id,structuredClone(input));}
 addVehicle(input:VehicleMotionSpec):void {
  if(!input.id||input.id.length>160||this.walkers.has(input.id)||this.vehicles.has(input.id))throw new TypeError('Vehicle requires a distinct stable id');finiteVec3(input.velocity,'Vehicle velocity');
  if(!Number.isFinite(input.startTime??0)||(input.startTime??0)<0)throw new RangeError('Vehicle start time must be nonnegative');
  const ids=new Set<string>();for(const part of input.parts){if(!part.id||ids.has(part.id))throw new TypeError('Vehicle parts require distinct ids');ids.add(part.id);finiteVec3(part.origin,'Part origin');if(part.rotation)finiteVec3(part.rotation,'Part rotation');if(part.wheel&&(!Number.isFinite(part.radius)||part.radius!<=0))throw new RangeError('Wheel radius must be positive');if(part.wheelAxis!==undefined&&![0,1,2].includes(part.wheelAxis))throw new TypeError('Invalid wheel axis');}
  this.vehicles.set(input.id,structuredClone(input));
 }
 /** Take control of an existing rig. Integration remains in the simulation tick. */
 driveWalker(id:string,speed:number,heading:number):void {
  const spec=this.walkers.get(id);if(!spec)throw new TypeError(`Unknown walker ${id}`);
  if(!Number.isFinite(speed)||speed<0||speed>12||!Number.isFinite(heading))throw new RangeError('Invalid walker input');
  let state=this.driven.get(id);if(!state){const pose=this.poses.get(id);state={position:pose?.position??spec.root,heading:pose?.heading??spec.heading??0,speed:0,time:0};this.driven.set(id,state);}
  if(state.speed!==speed)state.time=0;state.speed=speed;state.heading=heading;
 }
 remove(id:string):void {
  this.driven.delete(id);
  this.walkers.delete(id);this.vehicles.delete(id);this.poses.delete(id);
  // IDs may themselves contain colons. Rebuild from exact actor ownership,
  // rather than treating an actor ID as a namespace prefix for other actors.
  this.publishedFeet=Object.freeze([...this.poses.values()].flatMap(pose=>pose.feet));
 }
 /** Detach a removed scene entity from every authored rig that references it.
  * A partially removed actor continues driving its remaining parts; removing
  * its last bound part releases the actor and its published foot contacts.
  * Missing entities that were never explicitly detached still fail at step. */
 detachEntity(entityId:string):void {
  for(const [id,spec] of this.walkers){
   if(!spec.bindings?.some(binding=>binding.entity===entityId))continue;
   const bindings=spec.bindings.filter(binding=>binding.entity!==entityId);
   if(bindings.length)this.walkers.set(id,{...spec,bindings});else this.remove(id);
  }
  for(const [id,spec] of this.vehicles){
   if(!spec.parts.some(part=>part.id===entityId))continue;
   const parts=spec.parts.filter(part=>part.id!==entityId);
   if(parts.length)this.vehicles.set(id,{...spec,parts});else this.remove(id);
  }
 }
 pose(id:string):HumanoidPose|undefined{return this.poses.get(id);}
 step(time:number,entities:ReadonlyMap<string,AnimationTarget>,terrain?:GroundSampler):void {
  if(!Number.isFinite(time)||time<this.time)throw new RangeError('Animation time must be monotonic');
  const dt=time-this.time,updates:RigTransform[]=[],poses=new Map<string,HumanoidPose>();
  for(const [id,spec] of this.walkers){const driven=this.driven.get(id);let pose:HumanoidPose;
   if(driven){driven.time+=dt;driven.position=V3.add(driven.position,[Math.cos(driven.heading)*driven.speed*dt,0,-Math.sin(driven.heading)*driven.speed*dt]);
    const distance=driven.speed*driven.time,root:Vec3=[driven.position[0]-Math.cos(driven.heading)*distance,driven.position[1],driven.position[2]+Math.sin(driven.heading)*distance];
    pose=sampleWalker({...spec,root,speed:driven.speed,heading:driven.heading},driven.time,terrain,this.poses.get(id));driven.position=pose.position;
   }else pose=sampleWalker(spec,time,terrain,this.poses.get(id));poses.set(id,pose);updates.push(...bindHumanoid(pose,spec.bindings??[]));}
  for(const spec of this.vehicles.values())for(const part of spec.parts){const t=Math.max(0,time-(spec.startTime??0)),rotation:MutableVec3=[...(part.rotation??[0,0,0])];if(part.wheel)rotation[part.wheelAxis??2]-=V3.length(spec.velocity)*t/part.radius!;updates.push({entity:part.id,position:V3.add(part.origin,V3.scale(spec.velocity,t)),rotation,scale:entities.get(part.id)?.scale??[1,1,1]});}
  // Complete validation before changing transforms or velocities: a malformed
  // rig cannot leave half of an actor at a different simulation instant.
  const prepared:{entity:AnimationTarget;transform:RigTransform;velocity?:Vec3;angularVelocity?:Vec3}[]=[];
  for(const transform of updates){
   const entity=entities.get(transform.entity);if(!entity)throw new TypeError(`Missing animated entity ${transform.entity}`);
   if(entity.body?.invMass)throw new TypeError(`Dynamic body ${entity.id} owns its pose; animated bodies must be kinematic or static`);
   finiteVec3(transform.position,'Animated position');finiteVec3(transform.rotation,'Animated rotation');finiteVec3(transform.scale,'Animated scale');
   if(entity.body?.kinematic&&dt>0){
    const velocity=V3.scale(V3.sub(transform.position,entity.body.position),1/dt),angularVelocity=V3.scale(V3.sub(transform.rotation,entity.body.rotation),1/dt);
    finiteVec3(velocity,'Animated linear velocity');finiteVec3(angularVelocity,'Animated angular velocity');prepared.push({entity,transform,velocity,angularVelocity});
   }else prepared.push({entity,transform});
  }
  for(const {entity,transform,velocity,angularVelocity} of prepared){
   if(velocity&&angularVelocity){
    // Physics is the sole integrator of kinematic bodies. Supplying the
    // velocity needed to reach the authored target also gives contact and
    // surface systems the actual motion, without advancing a second time.
    entity.body!.velocity.splice(0,3,...velocity);entity.body!.angularVelocity.splice(0,3,...angularVelocity);
   }else{
    entity.position.splice(0,3,...transform.position);entity.rotation.splice(0,3,...transform.rotation);
    // A zero-duration publication initializes a pose; it has no motion.
    if(entity.body?.kinematic){entity.body.velocity.splice(0,3,0,0,0);entity.body.angularVelocity.splice(0,3,0,0,0);}
   }
   entity.scale.splice(0,3,...transform.scale);
  }
  this.poses.clear();for(const [id,pose] of poses){
   Object.freeze(pose.position);Object.freeze(pose.footPitch);for(const point of Object.values(pose.joints))Object.freeze(point);Object.freeze(pose.joints);
   for(const foot of pose.feet){Object.freeze(foot.position);Object.freeze(foot);}Object.freeze(pose.feet);Object.freeze(pose);this.poses.set(id,pose);
  }this.publishedFeet=Object.freeze([...poses.values()].flatMap(pose=>pose.feet));this.time=time;
 }
}
