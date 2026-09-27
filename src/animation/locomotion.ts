import {V3,finiteVec3,type MutableVec3,type Vec3} from '../math.js';
import type {FootContact} from '../environment/footprints.js';

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
}
export interface WalkerSpec {
 readonly id:string;readonly root:Vec3;readonly heading?:number;readonly speed:number;
 readonly period?:number;readonly heightScale?:number;readonly bindings?:readonly HumanoidBinding[];
}
export interface HumanoidPose {
 readonly position:Vec3;readonly heading:number;readonly heightScale:number;
 readonly joints:Readonly<Record<HumanoidJoint,Vec3>>;
 readonly feet:readonly FootContact[];readonly footPitch:Readonly<{left:number;right:number}>;
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
/** Validate authored locomotion without allocating runtime state. */
export function validateWalker(spec:WalkerSpec):void {
 if(!spec.id||spec.id.length>160)throw new TypeError('Walker requires a stable id');finiteVec3(spec.root,'Walker root');
 if(!Number.isFinite(spec.speed)||spec.speed<0||spec.speed>12||!Number.isFinite(spec.heading??0)||!Number.isFinite(spec.period??1.3)||(spec.period??1.3)<.25||(spec.period??1.3)>4||!Number.isFinite(spec.heightScale??1)||(spec.heightScale??1)<.25||(spec.heightScale??1)>3)throw new RangeError('Invalid locomotion dimensions or timing');
 for(const binding of spec.bindings??[]){if(!binding.entity)throw new TypeError('Rig binding requires an entity');for(const v of [binding.offset,binding.scale,binding.rotation])if(v)finiteVec3(v,'Rig transform');if(binding.scale?.some(v=>v<=0))throw new RangeError('Rig scale must be positive');}
}
/** A deterministic gait in metres and seconds, independent of render rate.
 * Stance anchors stay in world space; pelvis lowering keeps legs reachable.
 * Snow compression is shared with the contact system, rather than animation
 * pretending that a foot contact occurs above the actual surface. */
export function sampleWalker(spec:WalkerSpec,time:number,terrain?:GroundSampler,previousPose?:HumanoidPose):HumanoidPose {
 validateWalker(spec);if(!Number.isFinite(time)||time<0)throw new RangeError('Locomotion time must be finite and non-negative');
 const h=spec.heightScale??1,heading=spec.heading??0,period=Math.min(spec.period??1.3,1.16*h/Math.max(.001,spec.speed)),phase=spec.speed?time/period:0;
 const travel=spec.speed*time,base=world([travel,0,0],spec.root,heading),stance=.62,stride=spec.speed*period;
 const groundAt=(localX:number,side:number)=>{
  const p=world([localX,0,side*.13*h],spec.root,heading),sample=terrain?.(p);
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
  const foot=world([x,y-spec.root[1],side*.13*h],spec.root,heading),previous=previousPose?.feet.find(f=>f.id===spec.id+':'+name);
  // Accumulating snow falls around a planted boot, not beneath its sole.
  // An unchanged stance anchor retains its elevation until the foot lifts.
  if(grounded&&previous?.grounded&&Math.hypot(foot[0]-previous.position[0],foot[2]-previous.position[2])<1e-9){y=previous.position[1];foot[1]=y;}
  feet.push({id:spec.id+':'+name,position:foot,grounded,yaw:heading+side*.035});
  footLocal.push([x-travel,y,side*.13*h]);pitch[name]=-.14*Math.sin(swing*Math.PI);
 }
 const terrainRoot=groundAt(travel,0);let hipY=terrainRoot+.872*h+.008*h*Math.cos(phase*4*Math.PI);
 const upper=.425*h,lower=.42*h,reach=upper+lower-.005*h;
 for(const foot of footLocal){const horizontal=Math.hypot(foot[0],Math.abs(foot[2])-.125*h);hipY=Math.min(hipY,foot[1]+.105*h+Math.sqrt(Math.max(.01*h*h,reach*reach-horizontal*horizontal)));}
 const local:Record<HumanoidJoint,Vec3>={root:[0,terrainRoot,0],pelvis:[0,hipY,0],chest:[.009*h,hipY+.34*h,0],neck:[.022*h,hipY+.555*h,0],head:[.026*h,hipY+.69*h,0],leftHip:[0,0,0],rightHip:[0,0,0],leftKnee:[0,0,0],rightKnee:[0,0,0],leftAnkle:[0,0,0],rightAnkle:[0,0,0],leftFoot:[0,0,0],rightFoot:[0,0,0],leftShoulder:[0,0,0],rightShoulder:[0,0,0],leftElbow:[0,0,0],rightElbow:[0,0,0],leftHand:[0,0,0],rightHand:[0,0,0]};
 for(let i=0;i<2;i++){
  const side=i===0?-1:1,name=i===0?'left':'right',f=footLocal[i]!,hip:Vec3=[0,hipY,side*.125*h],ankle:Vec3=[f[0],f[1]+.105*h,f[2]],leg=solveTwoBone(hip,ankle,upper,lower,[1,0,0]);
  const shoulder:Vec3=[.01*h,hipY+.451*h,side*.22*h],hand:Vec3=[-.028*h-side*Math.sin(phase*2*Math.PI)*.125*h,hipY-.068*h,side*.287*h],arm=solveTwoBone(shoulder,hand,.295*h,.27*h,[-1,0,0]);
  local[`${name}Hip`]=hip;local[`${name}Knee`]=leg.joint;local[`${name}Ankle`]=leg.end;local[`${name}Foot`]=f;local[`${name}Shoulder`]=shoulder;local[`${name}Elbow`]=arm.joint;local[`${name}Hand`]=arm.end;
 }
 const joints={} as Record<HumanoidJoint,Vec3>;for(const key of Object.keys(local) as HumanoidJoint[]){const point=local[key];joints[key]=world([point[0],point[1]-base[1],point[2]],base,heading);}
 return{position:[base[0],terrainRoot,base[2]],heading,heightScale:h,joints,feet,footPitch:pitch};
}
export function bindHumanoid(pose:HumanoidPose,bindings:readonly HumanoidBinding[]):RigTransform[]{
 return bindings.map(binding=>{
  const anchor=pose.joints[binding.joint];if(!anchor)throw new TypeError(`Unknown humanoid joint ${binding.joint}`);
  const scale:MutableVec3=V3.scale(binding.scale??[1,1,1],pose.heightScale),rotation:MutableVec3=[...(binding.rotation??[0,0,0])];
  let position=world(V3.scale(binding.offset??[0,0,0],pose.heightScale),anchor,pose.heading);
  if(binding.boneTo){const end=pose.joints[binding.boneTo];if(!end)throw new TypeError(`Unknown humanoid joint ${binding.boneTo}`);const d=V3.sub(end,anchor),length=V3.length(d);position=V3.scale(V3.add(anchor,end),.5);scale[1]=(binding.scale?.[1]??1)*length;rotation[0]=Math.atan2(d[2],d[1]);rotation[1]=0;rotation[2]=Math.asin(clamp(-d[0]/length,-1,1));}
  else{rotation[1]+=pose.heading;if(binding.foot)rotation[2]+=pose.footPitch[binding.foot];}
  return{entity:binding.entity,position,rotation,scale};
 });
}
