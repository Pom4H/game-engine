import type {MutableVec3,Vec3} from '../math.js';
import {PhysicsWorld,RigidBody,type CollisionShape} from '../physics/world.js';
import type {BodySpec,CameraSpec,EntitySpec,Primitive,SceneSnapshot,SceneSpec} from './types.js';
import {validateScene} from './validate.js';

export interface RuntimeEntity {readonly id:string;position:MutableVec3;rotation:MutableVec3;scale:MutableVec3;readonly mesh?:Primitive;readonly material:Readonly<{color:readonly[number,number,number,number]}>;readonly body?:RigidBody}
const DEFAULT_CAMERA:CameraSpec={position:[7,5,9],target:[0,1,0],fov:55};
export class Scene {
  readonly spec:SceneSpec;readonly entities=new Map<string,RuntimeEntity>();readonly physics:PhysicsWorld;time=0;tick=0;camera:CameraSpec;
  constructor(input:SceneSpec){this.spec=validateScene(input);this.physics=new PhysicsWorld(this.spec.gravity??[0,-9.81,0],this.spec.ground??0);this.camera=structuredClone(this.spec.camera??DEFAULT_CAMERA);for(const entity of this.spec.entities)this.add(entity);}
  add(spec:EntitySpec):RuntimeEntity{if(this.entities.has(spec.id))throw new TypeError(`Duplicate entity ${spec.id}`);let position:MutableVec3=[...(spec.position??[0,0,0])];const rotation:MutableVec3=[...(spec.rotation??[0,0,0])],scale:MutableVec3=[...(spec.scale??[1,1,1])];const body=spec.body?this.physics.add(new RigidBody({id:spec.id,position,mass:spec.body.mass??0,shape:bodyShape(spec.mesh,spec.body,scale),...(spec.body.velocity?{velocity:spec.body.velocity}:{}),...(spec.body.restitution!==undefined?{restitution:spec.body.restitution}:{}),...(spec.body.friction!==undefined?{friction:spec.body.friction}:{})})):undefined;if(body)position=body.position;const runtime:RuntimeEntity={id:spec.id,position,rotation,scale,material:Object.freeze({color:spec.material?.color??[.72,.76,.82,1]}),...(spec.mesh?{mesh:structuredClone(spec.mesh)}:{}),...(body?{body}:{})};this.entities.set(spec.id,runtime);return runtime;}
  step(dt=1/60):void{this.physics.step(dt);this.time+=dt;this.tick++;}
  snapshot():SceneSnapshot{return{version:1,time:this.time,tick:this.tick,entities:[...this.entities.values()].map(entity=>({id:entity.id,position:[...entity.position],rotation:[...entity.rotation],velocity:entity.body?[...entity.body.velocity]:[0,0,0]}))};}
  setCamera(camera:CameraSpec):void{this.camera=structuredClone(camera);}
}
function bodyShape(mesh:Primitive|undefined,body:BodySpec,scale:Vec3):CollisionShape{const shape=body.shape??'auto';if(shape==='sphere'||shape==='auto'&&mesh?.kind==='sphere')return{kind:'sphere',radius:(mesh?.kind==='sphere'?mesh.radius??1:1)*Math.max(scale[0],scale[1],scale[2])};const size:Vec3=mesh?.kind==='box'?mesh.size??[1,1,1]:mesh?.kind==='plane'?[mesh.size?.[0]??1,.02,mesh.size?.[1]??1]:[1,1,1];return{kind:'box',half:[size[0]*scale[0]/2,size[1]*scale[1]/2,size[2]*scale[2]/2]};}
