import {V3,type Vec3} from '../math.js';
import type {CameraSpec} from '../scene/types.js';
import {avoidCameraObstacles,type RenderMeshFilter,type RenderMeshQuery} from './mesh-ray.js';

export type SubjectCameraMode='third-person'|'first-person';
/** Resolve the same rendered meshes twice at most. A close boom uses the
 * presented model's head, never a simulated body or a position sent by input. */
export class SubjectCamera{
 private subject:string|null=null;
 private mode:SubjectCameraMode='third-person';
 resolve(query:RenderMeshQuery,desired:CameraSpec,options:{subjectId:string|null;head:Vec3|null;filter?:RenderMeshFilter;radius?:number;padding?:number}){
  const third=avoidCameraObstacles(query,desired,options),head=options.head;
  if(options.subjectId!==this.subject){this.subject=options.subjectId;this.mode='third-person';}
  if(!this.subject||!head||!head.every(Number.isFinite)||third.desiredDistance<1e-8)this.mode='third-person';
  else if(this.mode==='first-person'?third.distance>1.75:third.distance<1.35)this.mode=this.mode==='first-person'?'third-person':'first-person';
  if(this.mode!=='first-person'||!head)return{...third,mode:'third-person' as const,hiddenSubject:null};
  // Follow the original displayed head. Reserve the eye's near plane on the
  // route from the free-space body anchor, including low ceilings and doors.
  const eye:Vec3=[head[0],head[1]+.04,head[2]],safe=avoidCameraObstacles(query,{...desired,position:eye},{radius:.08,padding:.04,...(options.filter?{filter:options.filter}:{})}),forward=V3.normalize(V3.sub(desired.target,desired.position));
  return{...third,camera:{...desired,position:safe.camera.position,target:V3.add(safe.camera.position,V3.scale(forward,2)),fov:54},mode:'first-person' as const,hiddenSubject:this.subject};
 }
}
