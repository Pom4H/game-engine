import {hashString,mulberry32} from '../core/random.js';
import {material,type MaterialKind,type PhysicalMaterial} from '../materials/catalog.js';
import {evaluateFracture,type FractureDecision} from '../materials/fracture.js';
import type {MutableVec3,Vec3} from '../math.js';
import {V3} from '../math.js';
import {PhysicsWorld,RigidBody,type CollisionShape,type Contact} from '../physics/world.js';
import type {EngineEvent} from './events.js';
import type {BodySpec,CameraSpec,Color,EntitySpec,Primitive,SceneSnapshot,SceneSpec} from './types.js';
import {validateScene} from './validate.js';

export interface RuntimeMaterial {
  readonly kind:MaterialKind;
  readonly color:Color;
  readonly profile:PhysicalMaterial;
}
export interface RuntimeEntity {
  readonly id:string;
  position:MutableVec3;
  rotation:MutableVec3;
  scale:MutableVec3;
  readonly mesh?:Primitive;
  readonly material:RuntimeMaterial;
  readonly body?:RigidBody;
  /** Engine-generated transient geometry is removed after this simulation time. */
  expiresAt?:number;
}
const DEFAULT_CAMERA:CameraSpec={position:[7,5,9],target:[0,1,0],fov:55};

export class Scene {
  readonly spec:SceneSpec;
  readonly entities=new Map<string,RuntimeEntity>();
  readonly physics:PhysicsWorld;
  time=0;
  tick=0;
  camera:CameraSpec;
  private eventSequence=0;
  private readonly eventQueue:EngineEvent[]=[];
  private readonly impactCooldown=new Map<string,number>();
  private generatedSequence=0;

  constructor(input:SceneSpec){
    this.spec=validateScene(input);
    this.physics=new PhysicsWorld(this.spec.gravity??[0,-9.81,0],this.spec.ground??0);
    this.camera=structuredClone(this.spec.camera??DEFAULT_CAMERA);
    for(const entity of this.spec.entities)this.add(entity);
  }

  add(spec:EntitySpec):RuntimeEntity{
    if(this.entities.has(spec.id))throw new TypeError(`Duplicate entity ${spec.id}`);
    const profile=material(spec.material?.kind??'default'),mesh=spec.mesh?structuredClone(spec.mesh):undefined;
    let position:MutableVec3=[...(spec.position??[0,0,0])],rotation:MutableVec3=[...(spec.rotation??[0,0,0])];
    const scale:MutableVec3=[...(spec.scale??[1,1,1])];
    const dynamicHint=spec.body!==undefined&&(spec.body.velocity!==undefined||spec.body.angularVelocity!==undefined);
    const shouldCollide=spec.body!==undefined||profile.brittle;
    const mass=spec.body?.mass??(dynamicHint?inferMass(profile,mesh,scale):0);
    const body=shouldCollide?this.physics.add(new RigidBody({
      id:spec.id,position,rotation,mass,material:profile,shape:bodyShape(mesh,spec.body??{},scale),
      ...(spec.body?.velocity?{velocity:spec.body.velocity}:{}),
      ...(spec.body?.angularVelocity?{angularVelocity:spec.body.angularVelocity}:{}),
      ...(spec.body?.restitution!==undefined?{restitution:spec.body.restitution}:{}),
      ...(spec.body?.friction!==undefined?{friction:spec.body.friction}:{}),
    })):undefined;
    if(body){position=body.position;rotation=body.rotation;}
    const runtime:RuntimeEntity={
      id:spec.id,position,rotation,scale,
      material:Object.freeze({kind:profile.kind,color:spec.material?.color??profile.color,profile}),
      ...(mesh?{mesh}:{}),...(body?{body}:{})
    };
    this.entities.set(spec.id,runtime);
    return runtime;
  }

  step(dt=1/60):void{
    const pending=new Map<string,FractureDecision>();
    this.physics.step(dt,contact=>{
      const result=evaluateFracture(contact);
      if(result.fracture){
        if(pending.has(result.fracture.body.id))return{mode:'penetrate',energyLoss:0};
        pending.set(result.fracture.body.id,result.fracture);
      }
      return result.decision;
    });
    const at=this.time+dt;
    this.emitContactEvents(at);
    for(const fracture of pending.values())this.fracture(fracture,at);
    this.cleanupGenerated(at);
    this.time=at;this.tick++;
  }

  snapshot():SceneSnapshot{
    return{version:1,time:this.time,tick:this.tick,entities:[...this.entities.values()].map(entity=>({
      id:entity.id,position:[...entity.position],rotation:[...entity.rotation],
      velocity:entity.body?[...entity.body.velocity]:[0,0,0],material:entity.material.kind,
    }))};
  }
  drainEvents():EngineEvent[]{return this.eventQueue.splice(0);}
  setCamera(camera:CameraSpec):void{this.camera=structuredClone(camera);}

  private emitContactEvents(at:number):void{
    for(const contact of this.physics.contacts){
      if(contact.normalEnergy<.005)continue;
      const key=contact.b==='ground'?`${contact.a}|ground`:contact.a<contact.b?`${contact.a}|${contact.b}`:`${contact.b}|${contact.a}`;
      const previous=this.impactCooldown.get(key)??-Infinity;
      if(at-previous<.035)continue;
      this.impactCooldown.set(key,at);
      const a=this.physics.bodies.get(contact.a),b=contact.b==='ground'?undefined:this.physics.bodies.get(contact.b);
      if(!a)continue;
      this.pushEvent({
        type:'impact',id:++this.eventSequence,time:at,point:contact.point,normal:contact.normal,a:contact.a,b:contact.b,
        materialA:a.material.kind,materialB:b?.material.kind??this.physics.groundMaterial.kind,
        energy:contact.normalEnergy,impulse:contact.impulse,speed:contact.normalSpeed,size:Math.max(.02,Math.min(characteristicSize(a),b?characteristicSize(b):characteristicSize(a))),
      });
    }
  }

  private fracture(fracture:FractureDecision,at:number):void{
    const entity=this.entities.get(fracture.body.id);
    if(!entity||!entity.mesh)return;
    const contact=this.physics.contacts.find(c=>c.mode==='penetrate'&&(c.a===entity.id||c.b===entity.id));
    const dimensions=meshDimensions(entity.mesh,entity.scale),axis=dominantAxis(fracture.normal),planar=axis===0?[dimensions[1],dimensions[2]]:axis===1?[dimensions[0],dimensions[2]]:[dimensions[0],dimensions[1]];
    const area=Math.max(.002,planar[0]!*planar[1]!),ratio=Math.max(1,fracture.availableEnergy/fracture.requiredEnergy);
    const count=Math.max(10,Math.min(36,Math.round(10+Math.sqrt(area)*5+Math.min(18,(ratio-1)*7))));
    const totalMass=entity.material.profile.density*Math.max(.000001,dimensions[0]*dimensions[1]*dimensions[2]);
    const rng=mulberry32((this.spec.seed??1)^hashString(entity.id)^this.tick),pieces:{size:MutableVec3;position:MutableVec3;skew:number;volume:number;rotation:MutableVec3}[]=[];
    const halfU=planar[0]!/2,halfV=planar[1]!/2,baseU=planar[0]!/Math.sqrt(count),baseV=planar[1]!/Math.sqrt(count);
    for(let i=0;i<count;i++){
      const u=(rng()*2-1)*halfU,v=(rng()*2-1)*halfV,du=Math.max(.035,baseU*(.55+rng()*1.15)),dv=Math.max(.035,baseV*(.55+rng()*1.15)),thickness=Math.max(.001,fracture.thickness*(.62+rng()*.3));
      const size:MutableVec3=axis===0?[thickness,du,dv]:axis===1?[du,thickness,dv]:[du,dv,thickness];
      const position:[number,number,number]=[...entity.position];const axes=planeAxes(axis);position[axes[0]]+=u;position[axes[1]]+=v;position[axis]+=(rng()-.5)*fracture.thickness*.4;
      pieces.push({size,position,skew:rng()*.8-.4,volume:size[0]*size[1]*size[2]*.5,rotation:[...entity.rotation]});
    }
    const pieceVolume=pieces.reduce((sum,p)=>sum+p.volume,0)||1,kick:Vec3=[-fracture.normal[0],-fracture.normal[1],-fracture.normal[2]],impulse=contact?.impulse??0;
    const centerSpeed=totalMass>0?impulse/totalMass:0,excess=Math.max(0,fracture.availableEnergy-fracture.requiredEnergy),scatterSpeed=Math.sqrt(2*Math.min(excess,fracture.requiredEnergy*.35)/Math.max(totalMass,.001));
    this.physics.remove(entity.id);this.entities.delete(entity.id);
    for(const piece of pieces){
      const mass=Math.max(.002,totalMass*piece.volume/pieceVolume),lateral:Vec3=[rng()*2-1,rng()*1.3,rng()*2-1],lateralUnit=V3.normalize(lateral),velocity:Vec3=[
        kick[0]*centerSpeed+fracture.sourceVelocity[0]*.025+lateralUnit[0]*scatterSpeed*(.3+rng()*.7),
        kick[1]*centerSpeed+fracture.sourceVelocity[1]*.025+Math.abs(lateralUnit[1])*scatterSpeed*(.45+rng()*.8),
        kick[2]*centerSpeed+fracture.sourceVelocity[2]*.025+lateralUnit[2]*scatterSpeed*(.3+rng()*.7),
      ];
      const id=`${entity.id}:shard:${this.generatedSequence++}`,shard=this.add({
        id,position:piece.position,rotation:piece.rotation,mesh:{kind:'shard',size:piece.size,axis,skew:piece.skew},
        material:{kind:entity.material.kind,color:entity.material.color},
        body:{mass,velocity,angularVelocity:[(rng()*2-1)*13,(rng()*2-1)*13,(rng()*2-1)*13],restitution:.12,friction:.42,shape:'box'},
      });
      if(shard.body){shard.body.fracturable=false;shard.body.collisionClass='debris';}\n      shard.expiresAt=at+4.5+rng()*1.5;
    }
    this.pushEvent({
      type:'fracture',id:++this.eventSequence,time:at,entity:entity.id,material:entity.material.kind,point:fracture.point,normal:fracture.normal,
      energy:fracture.availableEnergy,requiredEnergy:fracture.requiredEnergy,thickness:fracture.thickness,shardCount:count,size:Math.max(planar[0]!,planar[1]!),
    });
  }

  private cleanupGenerated(at:number):void{
    for(const entity of [...this.entities.values()])if(entity.expiresAt!==undefined&&entity.expiresAt<=at){this.physics.remove(entity.id);this.entities.delete(entity.id);}
    for(const [key,time] of this.impactCooldown)if(at-time>2)this.impactCooldown.delete(key);
  }
  private pushEvent(event:EngineEvent):void{this.eventQueue.push(event);if(this.eventQueue.length>4096)this.eventQueue.splice(0,this.eventQueue.length-4096);}
}

function dominantAxis(normal:Vec3):0|1|2{return Math.abs(normal[0])>=Math.abs(normal[1])&&Math.abs(normal[0])>=Math.abs(normal[2])?0:Math.abs(normal[1])>=Math.abs(normal[2])?1:2;}
function planeAxes(axis:0|1|2):[0|1|2,0|1|2]{return axis===0?[1,2]:axis===1?[0,2]:[0,1];}
function characteristicSize(body:RigidBody):number{return body.shape.kind==='sphere'?body.shape.radius*2:Math.max(body.shape.half[0],body.shape.half[1],body.shape.half[2])*2;}
function inferMass(profile:PhysicalMaterial,mesh:Primitive|undefined,scale:Vec3):number{return Math.max(.001,profile.density*meshVolume(mesh,scale));}
function meshVolume(mesh:Primitive|undefined,scale:Vec3):number{
  if(!mesh)return scale[0]*scale[1]*scale[2];
  if(mesh.kind==='sphere'){const r=(mesh.radius??1)*Math.max(scale[0],scale[1],scale[2]);return 4/3*Math.PI*r*r*r;}
  const d=meshDimensions(mesh,scale);return d[0]*d[1]*d[2]*(mesh.kind==='shard'?.5:1);
}
function meshDimensions(mesh:Primitive,scale:Vec3):MutableVec3{
  if(mesh.kind==='box'||mesh.kind==='shard'){const size=mesh.size??[1,1,1];return[size[0]*scale[0],size[1]*scale[1],size[2]*scale[2]];}
  if(mesh.kind==='sphere'){const d=2*(mesh.radius??1);return[d*scale[0],d*scale[1],d*scale[2]];}
  return[(mesh.size?.[0]??1)*scale[0],.02*scale[1],(mesh.size?.[1]??1)*scale[2]];
}
function bodyShape(mesh:Primitive|undefined,body:BodySpec,scale:Vec3):CollisionShape{
  const shape=body.shape??'auto';
  if(shape==='sphere'||shape==='auto'&&mesh?.kind==='sphere')return{kind:'sphere',radius:(mesh?.kind==='sphere'?mesh.radius??1:1)*Math.max(scale[0],scale[1],scale[2])};
  const size:Vec3=mesh?.kind==='box'||mesh?.kind==='shard'?mesh.size??[1,1,1]:mesh?.kind==='plane'?[mesh.size?.[0]??1,.02,mesh.size?.[1]??1]:[1,1,1];
  return{kind:'box',half:[size[0]*scale[0]/2,size[1]*scale[1]/2,size[2]*scale[2]/2]};
}
