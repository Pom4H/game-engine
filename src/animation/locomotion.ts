import {V3,finiteVec3,compose,multiply4,type MutableVec3,type Vec3} from '../math.js';
import type {FootContact} from '../environment/footprints.js';
import type {RuntimeEntity} from '../scene/scene.js';

export interface GroundSample {readonly height:number;readonly snowDepth?:number}
export type GroundSampler=(position:Vec3)=>GroundSample|undefined;
export type HumanoidJoint='root'|'pelvis'|'chest'|'neck'|'head'|'leftHip'|'rightHip'|'leftKnee'|'rightKnee'|'leftAnkle'|'rightAnkle'|'leftFoot'|'rightFoot'|'leftShoulder'|'rightShoulder'|'leftElbow'|'rightElbow'|'leftHand'|'rightHand';
/** Rig authoring data. Meshes are free to use any topology or materials; the
 * engine owns timing, planted contacts, IK and the resulting transforms.
 * Bound entities may be visual, static or kinematic. Dynamic bodies retain
 * physics authority and cannot be driven by an authored rig. */
export interface HumanoidBinding {
 readonly entity:string;readonly joint:HumanoidJoint;
 readonly offset?:Vec3;readonly scale?:Vec3;readonly rotation?:Vec3;
 readonly boneTo?:HumanoidJoint;readonly foot?:'left'|'right';
 /** Keep the joint anchor and authored size, pointing local +Y toward this
  * joint. The local offset follows the same frame; rotation is applied inside
  * it. Useful for a hand whose negative Y extends beyond the wrist. */
 readonly orientFrom?:HumanoidJoint;
}
/** Independent, dimensionless body proportions. One is the original rig;
 * every factor is in [0.7,1.3]. Height scales the complete character uniformly. */
export interface HumanoidProportions {
 readonly shoulders?:number;readonly hips?:number;readonly torso?:number;readonly arms?:number;readonly legs?:number;
}
/** Shared rest-rig dimensions in metres. Absolute heights describe the original
 * rest pose above the sole's ground plane; offsets are measured from the pelvis.
 * Authored stances derive pelvis height from limb lengths and ground contacts.
 * Head size is independent of torso/leg proportions. */
export interface HumanoidMeasurements {
 readonly upperArm:number;readonly forearm:number;readonly thigh:number;readonly shin:number;
 readonly hipHalfWidth:number;readonly shoulderHalfWidth:number;
 readonly pelvisRestHeight:number;readonly pelvisGaitBaseHeight:number;
 readonly chestOffset:number;readonly shoulderOffset:number;readonly neckOffset:number;readonly headOffset:number;
 readonly chestHeight:number;readonly shoulderHeight:number;readonly neckHeight:number;readonly headHeight:number;
 readonly footHalfSpacing:number;readonly footSpacing:number;readonly ankleHeight:number;
 readonly handRestOffset:number;readonly handHalfSpacing:number;readonly stepReachLimit:number;
}
/** Resolve one source of dimensions for generated geometry and locomotion.
 * Leg length moves the pelvis; torso length then moves shoulders, neck and head.
 * Original literals and zero deltas retain the original rig's default poses. */
export function humanoidMeasurements(proportions?:HumanoidProportions,heightScale=1):HumanoidMeasurements {
 if(!Number.isFinite(heightScale)||heightScale<.25||heightScale>3)throw new RangeError('Humanoid height scale must be in [0.25,3]');
 if(proportions!==undefined&&(proportions===null||typeof proportions!=='object'||Array.isArray(proportions)))throw new TypeError('Humanoid proportions must be an object');
 const factor=(name:keyof HumanoidProportions)=>{const authored=proportions?.[name],value=authored===undefined?1:authored;if(!Number.isFinite(value)||value<.7||value>1.3)throw new RangeError(`Humanoid ${name} proportion must be in [0.7,1.3]`);return value;};
 const shoulders=factor('shoulders'),hips=factor('hips'),torso=factor('torso'),arms=factor('arms'),legs=factor('legs'),h=heightScale;
 const legDelta=.845*(legs-1)*h,torsoDelta=(torso-1)*h,armDelta=(arms-1)*h;
 const pelvisRestHeight=.88*h+legDelta,chestOffset=.34*h+.34*torsoDelta,shoulderOffset=.451*h+.451*torsoDelta,neckOffset=.555*h+.555*torsoDelta,headOffset=.69*h+.555*torsoDelta;
 const footHalfSpacing=.13*h*hips;
 return{upperArm:.295*h*arms,forearm:.27*h*arms,thigh:.425*h*legs,shin:.42*h*legs,hipHalfWidth:.125*h*hips,shoulderHalfWidth:.22*h*shoulders,
  pelvisRestHeight,pelvisGaitBaseHeight:.872*h+legDelta,chestOffset,shoulderOffset,neckOffset,headOffset,
  chestHeight:pelvisRestHeight+chestOffset,shoulderHeight:pelvisRestHeight+shoulderOffset,neckHeight:pelvisRestHeight+neckOffset,headHeight:pelvisRestHeight+headOffset,
  footHalfSpacing,footSpacing:2*footHalfSpacing,ankleHeight:.105*h,handRestOffset:-.068*h+.451*torsoDelta-.519*armDelta,handHalfSpacing:.287*h+.22*(shoulders-1)*h,stepReachLimit:1.16*h*legs};
}
export interface WalkerSpec {
 readonly id:string;readonly root:Vec3;readonly heading?:number;readonly speed:number;
 readonly period?:number;readonly heightScale?:number;readonly proportions?:HumanoidProportions;readonly bindings?:readonly HumanoidBinding[];
 /** Opt-in relaxed standing pose at zero speed. The existing gait and callers
  * without a stance retain their original poses. */
 readonly stance?:'neutral';
}
export interface HumanoidPose {
 readonly position:Vec3;readonly heading:number;readonly heightScale:number;
 readonly joints:Readonly<Record<HumanoidJoint,Vec3>>;
 /** World-space head frame shared by every head-bound mesh and the face rig. */
 readonly headRotation?:Vec3;
 readonly feet:readonly FootContact[];readonly footPitch:Readonly<{left:number;right:number}>;
}
/** Optional upper-body targets. Feet/root are owned exclusively by locomotion. */
export interface UpperBodyTargets {readonly leftHand?:Vec3;readonly rightHand?:Vec3;readonly headRotation?:Vec3}
export type UpperBodyLayer=(pose:HumanoidPose,timeS:number)=>UpperBodyTargets|undefined;
function withUpperBody(pose:HumanoidPose,targets:UpperBodyTargets|undefined):HumanoidPose {
 if(!targets)return pose;
 const joints={...pose.joints};
 for(const side of ['left','right'] as const){
  const target=targets[`${side}Hand`];if(!target)continue;finiteVec3(target,'Upper-body hand target');
  const shoulder=pose.joints[`${side}Shoulder`],elbow=pose.joints[`${side}Elbow`],hand=pose.joints[`${side}Hand`];
  const pole=V3.sub(elbow,shoulder); // Preserve the previous bend plane at zero weight.
  const arm=solveTwoBone(shoulder,target,V3.length(V3.sub(elbow,shoulder)),V3.length(V3.sub(hand,elbow)),pole);
  joints[`${side}Elbow`]=arm.joint;joints[`${side}Hand`]=arm.end;
 }
 if(targets.headRotation)finiteVec3(targets.headRotation,'Upper-body head rotation');
 return {...pose,joints,...(targets.headRotation?{headRotation:[...targets.headRotation] as Vec3}:{})};
}
/** Same Rx*Ry*Rz convention as compose(); no additive Euler shortcut. */
function headBindingRotation(parent:Vec3,local:Vec3):MutableVec3 {
 const m=multiply4(compose([0,0,0],parent,[1,1,1]),compose([0,0,0],local,[1,1,1]));
 const y=Math.asin(Math.max(-1,Math.min(1,m[8]!)));
 return Math.abs(Math.cos(y))<1e-7?[Math.atan2(m[6]!,m[5]!),y,0]:[Math.atan2(-m[9]!,m[10]!),y,Math.atan2(-m[4]!,m[0]!)];
}
export interface RigTransform {readonly entity:string;readonly position:Vec3;readonly rotation:Vec3;readonly scale:Vec3}
/** Visual/static parts receive poses directly; kinematic parts receive target
 * velocities and reach the same pose through the subsequent physics step. */
export interface VehiclePart {readonly id:string;readonly origin:Vec3;readonly wheel?:boolean;readonly radius?:number;readonly rotation?:Vec3;readonly wheelAxis?:0|1|2}
export interface VehicleMotionSpec {readonly id:string;readonly velocity:Vec3;readonly parts:readonly VehiclePart[];readonly startTime?:number}

const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
function world(local:Vec3,root:Vec3,heading:number):MutableVec3 {const c=Math.cos(heading),s=Math.sin(heading);return[root[0]+c*local[0]+s*local[2],root[1]+local[1],root[2]-s*local[0]+c*local[2]];}
/** Analytic IK with an explicit reachable endpoint. Both bone lengths remain
 * constant, including unreachable targets and a pole parallel to the chain. */
export function solveTwoBone(root:Vec3,target:Vec3,upper:number,lower:number,pole:Vec3):{joint:Vec3;end:Vec3}{
 for(const [v,name] of [[root,'root'],[target,'target'],[pole,'pole']] as const)finiteVec3(v,name);
 if(!Number.isFinite(upper)||upper<=0||!Number.isFinite(lower)||lower<=0)throw new RangeError('Bone lengths must be positive');
 const delta=V3.sub(target,root),raw=V3.length(delta),direction=raw>1e-10?V3.scale(delta,1/raw):[0,-1,0] as Vec3;
 const distance=clamp(raw,Math.abs(upper-lower)+1e-7,upper+lower-1e-7),end=V3.add(root,V3.scale(direction,distance));
 let bend=V3.sub(pole,V3.scale(direction,V3.dot(pole,direction)));
 if(V3.length(bend)<1e-8){const axis:Vec3=Math.abs(direction[1])<.9?[0,1,0]:[1,0,0];bend=V3.sub(axis,V3.scale(direction,V3.dot(axis,direction)));}
 bend=V3.normalize(bend);
 const along=(upper*upper-lower*lower+distance*distance)/(2*distance),across=Math.sqrt(Math.max(0,upper*upper-along*along));
 return{joint:V3.add(root,V3.add(V3.scale(direction,along),V3.scale(bend,across))),end};
}
function checkedWalker(spec:WalkerSpec):HumanoidMeasurements {
 if(!spec.id||spec.id.length>160)throw new TypeError('Walker requires a stable id');finiteVec3(spec.root,'Walker root');
 if(!Number.isFinite(spec.speed)||spec.speed<0||spec.speed>12||!Number.isFinite(spec.heading??0)||!Number.isFinite(spec.period??1.3)||(spec.period??1.3)<.25||(spec.period??1.3)>4||!Number.isFinite(spec.heightScale??1)||(spec.heightScale??1)<.25||(spec.heightScale??1)>3)throw new RangeError('Invalid locomotion dimensions or timing');
 if(spec.stance!==undefined&&spec.stance!=='neutral')throw new TypeError('Unknown walker stance');
 for(const binding of spec.bindings??[]){if(!binding.entity)throw new TypeError('Rig binding requires an entity');if(binding.boneTo!==undefined&&binding.orientFrom!==undefined)throw new TypeError('Rig binding cannot combine boneTo and orientFrom');for(const v of [binding.offset,binding.scale,binding.rotation])if(v)finiteVec3(v,'Rig transform');if(binding.scale?.some(v=>v<=0))throw new RangeError('Rig scale must be positive');}
 return humanoidMeasurements(spec.proportions,spec.heightScale??1);
}
/** A deterministic gait in metres and seconds, independent of render rate.
 * Stance anchors stay in world space; pelvis lowering keeps legs reachable.
 * Snow compression is shared with the contact system, rather than animation
 * pretending that a foot contact occurs above the actual surface. */
export function sampleWalker(spec:WalkerSpec,time:number,terrain?:GroundSampler,previousPose?:HumanoidPose):HumanoidPose {
 const dimensions=checkedWalker(spec);if(!Number.isFinite(time)||time<0)throw new RangeError('Locomotion time must be finite and non-negative');
 const h=spec.heightScale??1,heading=spec.heading??0,period=Math.min(spec.period??1.3,dimensions.stepReachLimit/Math.max(.001,spec.speed)),phase=spec.speed?time/period:0;
 const travel=spec.speed*time,base=world([travel,0,0],spec.root,heading),stance=.62,stride=spec.speed*period;
 const groundAt=(localX:number,side:number)=>{
  const p=world([localX,0,side*dimensions.footHalfSpacing],spec.root,heading),sample=terrain?.(p);
  if(!sample)return spec.root[1];
  if(!Number.isFinite(sample.height)||!Number.isFinite(sample.snowDepth??0)||(sample.snowDepth??0)<0)throw new TypeError('Ground sampler returned invalid height or snow depth');
  return sample.height-Math.min(.020*h,(sample.snowDepth??0)*.4);
 };
 const feet:FootContact[]=[],footLocal:Vec3[]=[],pitch:{left:number;right:number}={left:0,right:0};
 for(const side of [-1,1] as const){
  const name=side<0?'left':'right',offset=side===1?0:.5,cycle=phase+offset,k=Math.floor(cycle),u=cycle-k;
  const swing=spec.speed?Math.max(0,(u-stance)/(1-stance)):0,smooth=swing*swing*(3-2*swing),anchor=(k-offset+stance*.5)*stride;
  const x=anchor+smooth*stride,y0=groundAt(anchor,side),y1=groundAt(anchor+stride,side),grounded=!spec.speed||u<stance;
  let y=y0+(y1-y0)*smooth+Math.sin(swing*Math.PI)*.125*h;
  const foot=world([x,y-spec.root[1],side*dimensions.footHalfSpacing],spec.root,heading),previous=previousPose?.feet.find(f=>f.id===spec.id+':'+name);
  // Accumulating snow falls around a planted boot, not beneath its sole.
  // An unchanged stance anchor retains its elevation until the foot lifts.
  if(grounded&&previous?.grounded&&Math.hypot(foot[0]-previous.position[0],foot[2]-previous.position[2])<1e-9){y=previous.position[1];foot[1]=y;}
  feet.push({id:spec.id+':'+name,position:foot,grounded,yaw:heading+side*.035});
  footLocal.push([x-travel,y,side*dimensions.footHalfSpacing]);pitch[name]=-.14*Math.sin(swing*Math.PI);
 }
 const terrainRoot=groundAt(travel,0),neutral=spec.stance==='neutral'&&spec.speed===0;
 // Authored relaxed standing uses an 8-degree knee bend. The law of cosines
 // gives the reachable hip-to-ankle distance from the actual segment lengths;
 // ground contacts then determine pelvis height, including lateral stance.
 const upper=dimensions.thigh,lower=dimensions.shin,reach=neutral?Math.sqrt(upper*upper+lower*lower+2*upper*lower*Math.cos(8*Math.PI/180)):upper+lower-.005*h;
 let hipY=neutral?footLocal[0]![1]+dimensions.ankleHeight+reach:terrainRoot+dimensions.pelvisGaitBaseHeight+.008*h*Math.cos(phase*4*Math.PI);
 for(const foot of footLocal){const horizontal=Math.hypot(foot[0],Math.abs(foot[2])-dimensions.hipHalfWidth);hipY=Math.min(hipY,foot[1]+dimensions.ankleHeight+Math.sqrt(Math.max(.01*h*h,reach*reach-horizontal*horizontal)));}
 const local:Record<HumanoidJoint,Vec3>={root:[0,terrainRoot,0],pelvis:[0,hipY,0],chest:[.009*h,hipY+dimensions.chestOffset,0],neck:[.022*h,hipY+dimensions.neckOffset,0],head:[.026*h,hipY+dimensions.headOffset,0],leftHip:[0,0,0],rightHip:[0,0,0],leftKnee:[0,0,0],rightKnee:[0,0,0],leftAnkle:[0,0,0],rightAnkle:[0,0,0],leftFoot:[0,0,0],rightFoot:[0,0,0],leftShoulder:[0,0,0],rightShoulder:[0,0,0],leftElbow:[0,0,0],rightElbow:[0,0,0],leftHand:[0,0,0],rightHand:[0,0,0]};
 // Hands hang slightly forward and outside the shoulders. Their vertical
 // position follows a 12-degree elbow bend rather than shortening the arm.
 const handForward=.018*h,handLateral=.05*h,handDrop=neutral?Math.sqrt(dimensions.upperArm**2+dimensions.forearm**2+2*dimensions.upperArm*dimensions.forearm*Math.cos(12*Math.PI/180)-handForward**2-handLateral**2):0;
 for(let i=0;i<2;i++){
  const side=i===0?-1:1,name=i===0?'left':'right',f=footLocal[i]!,hip:Vec3=[0,hipY,side*dimensions.hipHalfWidth],ankle:Vec3=[f[0],f[1]+dimensions.ankleHeight,f[2]],leg=solveTwoBone(hip,ankle,upper,lower,[1,0,0]);
  const shoulder:Vec3=[.01*h,hipY+dimensions.shoulderOffset,side*dimensions.shoulderHalfWidth];
  const hand:Vec3=neutral?[shoulder[0]+handForward,shoulder[1]-handDrop,shoulder[2]+side*handLateral]:[-.028*h-side*Math.sin(phase*2*Math.PI)*.125*h*(spec.proportions?.arms??1),hipY+dimensions.handRestOffset,side*dimensions.handHalfSpacing],arm=solveTwoBone(shoulder,hand,dimensions.upperArm,dimensions.forearm,[-1,0,0]);
  local[`${name}Hip`]=hip;local[`${name}Knee`]=leg.joint;local[`${name}Ankle`]=leg.end;local[`${name}Foot`]=f;local[`${name}Shoulder`]=shoulder;local[`${name}Elbow`]=arm.joint;local[`${name}Hand`]=arm.end;
 }
 const joints={} as Record<HumanoidJoint,Vec3>;for(const key of Object.keys(local) as HumanoidJoint[]){const point=local[key];joints[key]=world([point[0],point[1]-base[1],point[2]],base,heading);}
 return{position:[base[0],terrainRoot,base[2]],heading,heightScale:h,joints,feet,footPitch:pitch};
}
type RigAxes={readonly x:Vec3;readonly y:Vec3;readonly z:Vec3};
function frameVector(v:Vec3,frame:RigAxes):MutableVec3{return V3.add(V3.scale(frame.x,v[0]),V3.add(V3.scale(frame.y,v[1]),V3.scale(frame.z,v[2])));}
/** A joint direction fixes Y. Projected character-forward fixes twist, so the
 * attachment rotates coherently when an otherwise identical actor turns. */
function attachmentFrame(direction:Vec3,heading:number):RigAxes{
 const length=V3.length(direction);if(!Number.isFinite(length)||length<1e-10)throw new RangeError('Rig orientation requires distinct finite joints');
 const y=V3.scale(direction,1/length),forward:Vec3=[Math.cos(heading),0,-Math.sin(heading)],lateral:Vec3=[Math.sin(heading),0,Math.cos(heading)];
 const projected=V3.sub(forward,V3.scale(y,V3.dot(forward,y))),x=V3.normalize(V3.length(projected)>1e-8?projected:V3.cross(y,lateral));
 return{x,y,z:V3.normalize(V3.cross(x,y))};
}
/** compose() uses Rx * Ry * Rz. Recover that same Euler convention from the
 * frame, including its gimbal limit, after an optional local mesh rotation. */
function frameRotation(frame:RigAxes,local?:Vec3):MutableVec3{
 let{x,y,z}=frame;
 if(local){
  finiteVec3(local,'Rig rotation');const [rx,ry,rz]=local,sx=Math.sin(rx),cx=Math.cos(rx),sy=Math.sin(ry),cy=Math.cos(ry),sz=Math.sin(rz),cz=Math.cos(rz);
  x=frameVector([cy*cz,sx*sy*cz+cx*sz,-cx*sy*cz+sx*sz],frame);
  y=frameVector([-cy*sz,-sx*sy*sz+cx*cz,cx*sy*sz+sx*cz],frame);
  z=frameVector([sy,-sx*cy,cx*cy],frame);
 }
 const horizontal=Math.hypot(x[0],y[0]),ry=Math.atan2(z[0],horizontal);
 return horizontal<1e-10?[Math.atan2(y[2],y[1]),ry,0]:[Math.atan2(-z[1],z[2]),ry,Math.atan2(-y[0],x[0])];
}
export function bindHumanoid(pose:HumanoidPose,bindings:readonly HumanoidBinding[]):RigTransform[]{
 return bindings.map(binding=>{
  if(binding.boneTo!==undefined&&binding.orientFrom!==undefined)throw new TypeError('Rig binding cannot combine boneTo and orientFrom');
  const anchor=pose.joints[binding.joint];if(!anchor)throw new TypeError(`Unknown humanoid joint ${binding.joint}`);
  const scale:MutableVec3=V3.scale(binding.scale??[1,1,1],pose.heightScale);let rotation:MutableVec3=[...(binding.rotation??[0,0,0])];
  let position=world(V3.scale(binding.offset??[0,0,0],pose.heightScale),anchor,pose.heading);
  if(binding.boneTo){const end=pose.joints[binding.boneTo];if(!end)throw new TypeError(`Unknown humanoid joint ${binding.boneTo}`);const d=V3.sub(end,anchor),length=V3.length(d);position=V3.scale(V3.add(anchor,end),.5);scale[1]=(binding.scale?.[1]??1)*length;rotation[0]=Math.atan2(d[2],d[1]);rotation[1]=0;rotation[2]=Math.asin(clamp(-d[0]/length,-1,1));}
  else if(binding.orientFrom){
   const source=pose.joints[binding.orientFrom];if(!source)throw new TypeError(`Unknown humanoid joint ${binding.orientFrom}`);
   const frame=attachmentFrame(V3.sub(source,anchor),pose.heading);
   position=V3.add(anchor,frameVector(V3.scale(binding.offset??[0,0,0],pose.heightScale),frame));rotation=frameRotation(frame,binding.rotation);
  }
  else if(binding.joint==='head'&&pose.headRotation){
   const m=compose(anchor,pose.headRotation,[1,1,1]),o=V3.scale(binding.offset??[0,0,0],pose.heightScale);
   position=[m[0]!*o[0]+m[4]!*o[1]+m[8]!*o[2]+m[12]!,m[1]!*o[0]+m[5]!*o[1]+m[9]!*o[2]+m[13]!,m[2]!*o[0]+m[6]!*o[1]+m[10]!*o[2]+m[14]!];
   rotation.splice(0,3,...headBindingRotation(pose.headRotation,binding.rotation??[0,0,0]));
  }else{rotation[1]+=pose.heading;if(binding.foot)rotation[2]+=pose.footPitch[binding.foot];}
  finiteVec3(position,'Rig position');finiteVec3(rotation,'Rig rotation');finiteVec3(scale,'Rig scale');if(scale.some(value=>value<=0))throw new RangeError('Rig scale must be positive');
  return{entity:binding.entity,position,rotation,scale};
 });
}
/** Engine-owned actor poses. Scene invokes this once at its authoritative
 * simulation time; cinematics only author rigs/routes and read these results. */
export class AnimationSystem {
 private readonly walkers=new Map<string,WalkerSpec>();private readonly vehicles=new Map<string,VehicleMotionSpec>();
 private readonly poses=new Map<string,HumanoidPose>();private time=0;
 private readonly driven=new Map<string,{position:Vec3;heading:number;speed:number;time:number}>();
 private readonly upperBodyLayers=new Map<string,UpperBodyLayer>();
 get timeSeconds():number{return this.time;}
 private publishedFeet:readonly FootContact[]=Object.freeze([]);
 get feet():readonly FootContact[]{return this.publishedFeet;}
 controlledEntityIds():ReadonlySet<string>{
  const ids=new Set<string>();
  for(const spec of this.walkers.values())for(const binding of spec.bindings??[])ids.add(binding.entity);
  for(const spec of this.vehicles.values())for(const part of spec.parts)ids.add(part.id);
  return ids;
 }
 addWalker(input:WalkerSpec):void {checkedWalker(input);if(this.walkers.has(input.id)||this.vehicles.has(input.id))throw new TypeError(`Duplicate animated actor ${input.id}`);this.walkers.set(input.id,structuredClone(input));}
 /** A layer has one owner; a stale disposer cannot remove its replacement. */
 setUpperBodyLayer(id:string,layer:UpperBodyLayer):void {
  if(!this.walkers.has(id)||typeof layer!=='function')throw new TypeError('Upper-body layer requires an existing walker');
  if(this.upperBodyLayers.has(id))throw new Error('Walker already has an upper-body owner');this.upperBodyLayers.set(id,layer);
 }
 hasUpperBodyLayer(id:string,layer:UpperBodyLayer):boolean{return this.upperBodyLayers.get(id)===layer;}
 clearUpperBodyLayer(id:string,layer:UpperBodyLayer):void{if(this.hasUpperBodyLayer(id,layer))this.upperBodyLayers.delete(id);}
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
  this.driven.delete(id);this.upperBodyLayers.delete(id);
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
 step(time:number,entities:ReadonlyMap<string,RuntimeEntity>,terrain?:GroundSampler):void {
  if(!Number.isFinite(time)||time<this.time)throw new RangeError('Animation time must be monotonic');
  const dt=time-this.time,updates:RigTransform[]=[],poses=new Map<string,HumanoidPose>(),drivenUpdates=new Map<string,{position:Vec3;heading:number;speed:number;time:number}>();
  for(const [id,spec] of this.walkers){const currentDriven=this.driven.get(id),driven=currentDriven?{...currentDriven}:undefined;let pose:HumanoidPose;
   if(driven){driven.time+=dt;driven.position=V3.add(driven.position,[Math.cos(driven.heading)*driven.speed*dt,0,-Math.sin(driven.heading)*driven.speed*dt]);
    const distance=driven.speed*driven.time,root:Vec3=[driven.position[0]-Math.cos(driven.heading)*distance,driven.position[1],driven.position[2]+Math.sin(driven.heading)*distance];
    pose=sampleWalker({...spec,root,speed:driven.speed,heading:driven.heading},driven.time,terrain,this.poses.get(id));driven.position=pose.position;drivenUpdates.set(id,driven);
   }else pose=sampleWalker(spec,time,terrain,this.poses.get(id));
   pose=withUpperBody(pose,this.upperBodyLayers.get(id)?.(pose,time));poses.set(id,pose);updates.push(...bindHumanoid(pose,spec.bindings??[]));}
  for(const spec of this.vehicles.values())for(const part of spec.parts){const t=Math.max(0,time-(spec.startTime??0)),rotation:MutableVec3=[...(part.rotation??[0,0,0])];if(part.wheel)rotation[part.wheelAxis??2]-=V3.length(spec.velocity)*t/part.radius!;updates.push({entity:part.id,position:V3.add(part.origin,V3.scale(spec.velocity,t)),rotation,scale:entities.get(part.id)?.scale??[1,1,1]});}
  // Complete validation before changing transforms or velocities: a malformed
  // rig cannot leave half of an actor at a different simulation instant.
  const prepared:{entity:RuntimeEntity;transform:RigTransform;velocity?:Vec3;angularVelocity?:Vec3}[]=[];
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
  for(const [id,value] of drivenUpdates)this.driven.set(id,value);
  this.poses.clear();for(const [id,pose] of poses){
   Object.freeze(pose.position);if(pose.headRotation)Object.freeze(pose.headRotation);Object.freeze(pose.footPitch);for(const point of Object.values(pose.joints))Object.freeze(point);Object.freeze(pose.joints);
   for(const foot of pose.feet){Object.freeze(foot.position);Object.freeze(foot);}Object.freeze(pose.feet);Object.freeze(pose);this.poses.set(id,pose);
  }this.publishedFeet=Object.freeze([...poses.values()].flatMap(pose=>pose.feet));this.time=time;
 }
}
