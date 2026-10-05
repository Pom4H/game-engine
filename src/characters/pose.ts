import {V3,type Vec3} from '../math.js';
import {sampleWalker,solveTwoBone,humanoidMeasurements,type WalkerSpec,type HumanoidPose,type HumanoidJoint} from '../animation/locomotion.js';

export type CharacterPoseName='idle'|'walk'|'reach'|'t-pose';

/** Authoring preview in metres. The chosen pose and time are its only causes;
 * render bindings read these same joints. This does not integrate rigid bodies.
 * Walking is sampled on a treadmill, keeping the editable actor at its root. */
export function sampleCharacterPose(walker:WalkerSpec,mode:CharacterPoseName='idle',time=0):HumanoidPose {
  if(!['idle','walk','reach','t-pose'].includes(mode))throw new TypeError('Unknown character pose');
  if(!Number.isFinite(time)||time<0)throw new RangeError('Pose time must be finite and non-negative');
  const h=walker.heightScale??1,heading=walker.heading??0,speed=mode==='walk'?.62*h:0;
  const root:Vec3=[walker.root[0]-Math.cos(heading)*speed*time,walker.root[1],walker.root[2]+Math.sin(heading)*speed*time];
  const pose=sampleWalker({...walker,root,speed},time);
  if(mode==='idle'||mode==='walk')return pose;
  const m=humanoidMeasurements(walker.proportions,h),joints={...pose.joints};
  const rotate=(v:Vec3):Vec3=>[Math.cos(heading)*v[0]+Math.sin(heading)*v[2],v[1],-Math.sin(heading)*v[0]+Math.cos(heading)*v[2]];
  for(const side of [-1,1] as const){
    const prefix=side<0?'left':'right',shoulder=joints[`${prefix}Shoulder`];
    if(mode==='reach'&&side<0)continue;
    const target=mode==='t-pose'
      ?V3.add(shoulder,rotate([0,0,side*(m.upperArm+m.forearm)]))
      :V3.add(shoulder,rotate([.84*(m.upperArm+m.forearm),-.16*h,side*.025*h]));
    const arm=solveTwoBone(shoulder,target,m.upperArm,m.forearm,rotate(mode==='t-pose'?[0,-1,0]:[0,-1,side*.2]));
    joints[`${prefix}Elbow` as HumanoidJoint]=arm.joint;
    joints[`${prefix}Hand` as HumanoidJoint]=arm.end;
  }
  return {...pose,joints};
}
