import {CpuProfiler} from '../core/profiling.js';
import {AnimationSystem} from '../animation/system.js';
import {SurfaceContactSystem} from '../environment/surface-contacts.js';
import {freezePrimitive} from '../procedural/mesh.js';
import {hashString,mulberry32} from '../core/random.js';
import type {SimulationTier} from '../core/kernel.js';
import {environmentTimeScale,resolveEnvironmentAt,type EnvironmentState} from '../environment/types.js';
import {SurfaceEnvironmentSystem} from '../environment/surface-state.js';
import {material,type MaterialKind,type PhysicalMaterial} from '../materials/catalog.js';
import {deriveSurfaceState,effectiveFriction,type SurfaceState} from '../materials/surface.js';
import {evaluateFracture,type FractureDecision} from '../materials/fracture.js';
import {transferFragmentMotion} from '../materials/fragment-motion.js';
import {fracturePlate} from '../materials/glass-fracture.js';
import type {MutableVec3,Vec3} from '../math.js';
import {V3} from '../math.js';
import {PhysicsWorld,RigidBody,type CollisionShape,type Contact} from '../physics/world.js';
import {PlasticDeformationSystem} from '../physics/deformation.js';
import type {EngineEvent} from './events.js';
import type {AppearancePatch,BodySpec,CameraSpec,Color,SurfaceTextureSpec,EnvironmentalSpec,EntitySpec,LightSpec,Primitive,SceneSnapshot,SceneSpec} from './types.js';
import {sceneKernel,type InternalCommand,type SceneModule,type SceneModuleContext} from './modules.js';
import {validateEntity,validateScene} from './validate.js';
import {SceneSystemRuntime} from './system-runtime.js';

export interface RuntimeMaterial {
  readonly kind:MaterialKind;
  readonly label?:string;readonly roughness?:number;readonly metalness?:number;readonly clearcoat?:number;readonly clearcoatRoughness?:number;readonly emissive?:Vec3;readonly pattern?:'plain'|'brick'|'plaster'|'rubber'|'window'|'fabric';readonly finish?:import('../materials/surface.js').MaterialFinish;readonly ageYears?:number;readonly treatment?:import('../materials/surface.js').MaterialTreatment;
  readonly color:Color;
  readonly texture?:SurfaceTextureSpec;
  readonly profile:PhysicalMaterial;
  readonly surface:SurfaceState;
}
interface FracturePiece{mesh:Primitive;position:MutableVec3;rotation:MutableVec3;volume:number}

export interface RuntimeEntity {
  readonly id:string;
  /** Presentation-only visibility; hidden network/LOD objects retain their cached geometry. */
  presentationVisible?:boolean;
  position:MutableVec3;
  rotation:MutableVec3;
  scale:MutableVec3;
  /** Authoritative physical geometry; deformation may replace it. */
  mesh?:Primitive;
  /** Optional renderer-only high detail geometry, independent of mass/contact shape. */
  renderMesh?:Primitive;
  readonly material:RuntimeMaterial;
  readonly environmental?:EnvironmentalSpec;
  readonly light?:LightSpec;
  readonly body?:RigidBody;
  /** Engine-generated transient geometry is removed after this simulation time. */
  expiresAt?:number;
}
/** One final-state projection; never a second simulation or a kernel per entity. */
export interface SceneProjection {
  readonly ownerId:string;
  readonly visualIds:readonly string[];
  sync():void;
  dispose():void;
}
const DEFAULT_CAMERA:CameraSpec={position:[7,5,9],target:[0,1,0],fov:55};

export class Scene {
  readonly spec:SceneSpec;
  readonly entities=new Map<string,RuntimeEntity>();
  readonly physics:PhysicsWorld;
  readonly deformation=new PlasticDeformationSystem();
  readonly surfaces=new SurfaceEnvironmentSystem();
  readonly animation=new AnimationSystem();
  readonly contacts:SurfaceContactSystem;
  readonly kernel=sceneKernel();
  readonly systemRuntime:SceneSystemRuntime;
  readonly resources=new Map<string,unknown>();
  private readonly projections=new Map<SceneProjection,RuntimeEntity>();
  lastExecution:string[]=[];
  private pendingFractures=new Map<string,FractureDecision>();
  environment:EnvironmentState;
  time=0;
  tick=0;
  /** Changes only when renderer-owned structure/geometry membership changes, not on ordinary motion. */
  renderStructureRevision=0;
  /** Shader-only authoring changes; does not invalidate geometry, shadows, probes or culling. */
  appearanceRevision=0;
  camera:CameraSpec;
  private eventSequence=0;
  private readonly eventQueue:EngineEvent[]=[];
  private readonly impactCooldown=new Map<string,number>();
  private generatedSequence=0;
  private surfaceVisualSequence=0;
  private readonly surfaceVisuals=new Map<string,{source:string;entity:RuntimeEntity}>();
  private readonly presentationMovers=new Set<ReadonlySet<string>>();
  /** External read-only projections mark dynamic visuals without creating fake physical bodies. */
  trackPresentation(ids:readonly string[]):()=>void{
    if(ids.some(id=>!this.entities.has(id)))throw new TypeError('Unknown presentation entity');
    const set=new Set(ids);this.presentationMovers.add(set);this.renderStructureRevision++;
    return()=>{if(this.presentationMovers.delete(set))this.renderStructureRevision++;};
  }
  /** Explicit seek/epoch discontinuity; ordinary packets must never invalidate temporal history. */
  presentationRevision=0;
  cutPresentation():void{this.presentationRevision++;}
  private renderMoverRevision=-1;
  private renderMovers:ReadonlySet<string>=new Set<string>();

  constructor(input:SceneSpec,readonly profiler=new CpuProfiler()){
    this.systemRuntime=new SceneSystemRuntime(profiler);
    this.spec=validateScene(input);
    this.environment=resolveEnvironmentAt(this.spec.environment,0);
    this.physics=new PhysicsWorld(this.spec.gravity??[0,-9.81,0],this.spec.ground??0);
    this.physics.surfaceFrictionAt=(body,point)=>body.friction*(this.surfaces.sample(body.id,point[0],point[2])?.frictionScale??1);
    this.camera=structuredClone(this.spec.camera??DEFAULT_CAMERA);
    for(const entity of this.spec.entities)this.add(entity);
    for(const spec of this.spec.deformation?.bodies??[])this.deformation.attach(spec,this.entities);
    // Initial environmental facts exist before the first scheduled surface tick.
    // Cadence controls evolution, not whether authored physical state exists.
    this.surfaces.reconcile(this.environment,this.entities);
    this.contacts=new SurfaceContactSystem(this);
    this.syncSurfaceVisuals();
    for(const {surfaceId,...options} of this.spec.surfaceContacts?.snow??[])this.contacts.addSnowSurface(surfaceId,options);
    for(const {entityId,...options} of this.spec.surfaceContacts?.wheels??[])this.contacts.addWheelContact(entityId,options);
    for(const walker of this.spec.animation?.walkers??[])this.animation.addWalker(walker);
    for(const vehicle of this.spec.animation?.vehicles??[])this.animation.addVehicle(vehicle);
    this.installSystemRuntime();
  }

  add(spec:EntitySpec):RuntimeEntity{
    spec=validateEntity(spec);
    if(this.entities.has(spec.id))throw new TypeError(`Duplicate entity ${spec.id}`);
    const profile=material(spec.material?.kind??'default'),mesh=spec.mesh?freezePrimitive(structuredClone(spec.mesh)):undefined,renderMesh=spec.renderMesh?freezePrimitive(structuredClone(spec.renderMesh)):undefined;
    const surface=deriveSurfaceState(profile,spec.material??{},this.environment);
    let position:MutableVec3=[...(spec.position??[0,0,0])],rotation:MutableVec3=[...(spec.rotation??[0,0,0])];
    const scale:MutableVec3=[...(spec.scale??[1,1,1])];
    const dynamicHint=spec.body!==undefined&&(spec.body.velocity!==undefined||spec.body.angularVelocity!==undefined);
    const shouldCollide=spec.collision!=='none'&&(spec.body!==undefined||spec.environmental?.surfaceUse!==undefined||profile.mechanical.brittle);
    const mass=spec.body?.mass??(dynamicHint?inferMass(profile,mesh,scale):0);
    const body=shouldCollide?this.physics.add(new RigidBody({
      id:spec.id,position,rotation,mass,material:profile,shape:bodyShape(mesh,spec.body??{},scale),kinematic:spec.body?.motion==='kinematic',
      ...(spec.body?.velocity?{velocity:spec.body.velocity}:{}),
      ...(spec.body?.angularVelocity?{angularVelocity:spec.body.angularVelocity}:{}),
      ...(spec.body?.restitution!==undefined?{restitution:spec.body.restitution}:{}),
      friction:spec.body?.friction??effectiveFriction(profile,surface),
    })):undefined;
    if(body){position=body.position;rotation=body.rotation;}
    const runtime:RuntimeEntity={
      id:spec.id,position,rotation,scale,
      material:Object.freeze({...spec.material,...(spec.material?.texture?{texture:Object.freeze({...spec.material.texture})}:{}),kind:profile.kind,color:spec.material?.color??profile.color,profile,surface}),
      ...(spec.environmental?{environmental:structuredClone(spec.environmental)}:{}),
      ...(spec.light?{light:structuredClone(spec.light)}:{}),
      ...(mesh?{mesh}:{}),...(renderMesh?{renderMesh}:{}),...(body?{body}:{})
    };
    this.entities.set(spec.id,runtime);this.renderStructureRevision++;
    return runtime;
  }

  /** Register once; sync after the existing world/contacts/deformation pipeline. */
  project(projection:SceneProjection):()=>void {
    const owner=this.entities.get(projection.ownerId);
    if(!owner||this.projections.has(projection)||projection.visualIds.some(id=>!this.entities.has(id)))throw new TypeError('Projection requires existing owned scene entities');
    this.projections.set(projection,owner);this.renderStructureRevision++;
    return()=>{if(this.projections.delete(projection))this.renderStructureRevision++;};
  }
  use(module:SceneModule):this{this.kernel.use(module);return this;}
  renderMoverIds():ReadonlySet<string>{
    if(this.renderMoverRevision===this.renderStructureRevision)return this.renderMovers;
    const ids=new Set<string>();
    for(const set of this.presentationMovers)for(const id of set)if(this.entities.has(id))ids.add(id);
    for(const entity of this.entities.values())if(entity.body&&(entity.body.invMass>0||entity.body.kinematic))ids.add(entity.id);
    for(const projection of this.projections.keys())for(const id of projection.visualIds)ids.add(id);
    for(const id of this.animation.controlledEntityIds())ids.add(id);
    for(const id of this.deformation.visualEntityIds())ids.add(id);
    for(const id of this.contacts?.controlledEntityIds()??[])ids.add(id);
    this.renderMoverRevision=this.renderStructureRevision;this.renderMovers=ids;return ids;
  }
  remove(id:string):void{
    const removing=this.entities.get(id);
    for(const [projection,owner] of this.projections)if(owner===removing){this.projections.delete(projection);projection.dispose();}
    if(this.entities.get(id)!==removing)return;

    // Only exact owned objects are removed; an authored replacement under a
    // formerly generated ID must survive source deletion and weather cleanup.
    for(const [key,visual] of this.surfaceVisuals){
      if(visual.source===id){this.surfaceVisuals.delete(key);if(this.entities.get(visual.entity.id)===visual.entity)this.remove(visual.entity.id);}
      else if(visual.entity.id===id)this.surfaceVisuals.delete(key);
    }
    this.animation.detachEntity(id);this.contacts?.onEntityRemoved(id);this.deformation.remove(id);this.physics.remove(id);const removed=this.entities.delete(id);this.surfaces.remove(id);if(removed)this.renderStructureRevision++;
  }
  dispose():void{this.presentationMovers.clear();for(const id of [...this.entities.keys()])this.remove(id);this.physics.clear();}
  private context():SceneModuleContext{return{...this.snapshot(),environment:this.environment,resources:this.resources};}
  step(dt=1/60,tier:SimulationTier='detailed'):void{
    if(!Number.isFinite(dt)||dt<=0||dt>.25)throw new RangeError('Scene step must be within (0, .25] seconds');
    if(this.profiler.enabled)this.profiler.measure('scene:step',()=>this.advance(dt,tier));else this.advance(dt,tier);
  }
  private advance(dt:number,tier:SimulationTier):void{
    const at=this.time+dt;this.lastExecution=[];
    this.kernel.run(this.tick+1,{} as SceneModuleContext,tier,{profiler:this.profiler,read:()=>this.context(),deltaSeconds:dt,onModule:m=>this.lastExecution.push(m.id),commit:commands=>{
      for(const command of commands)this.commit(command,at);
      return {} as SceneModuleContext;
    }});
    if(this.profiler.enabled)this.profiler.measure('scene:projections',()=>this.syncProjections());else this.syncProjections();
  }
  private syncProjections():void{
    for(const [projection,owner] of this.projections)if(this.entities.get(owner.id)===owner)projection.sync();
  }
  private commit(command:InternalCommand,at:number):void{
    if(command.type==='spawn'){this.add(command.entity);return;}
    if(command.type==='remove'){this.remove(command.id);return;}
    if(command.type==='resource'){this.resources.set(command.key,structuredClone(command.value));return;}
    if(command.type==='velocity'){
      if(command.value.length!==3||!command.value.every(Number.isFinite))throw new TypeError('velocity command requires a finite vec3');
      const body=this.entities.get(command.id)?.body;if(!body)throw new TypeError(`No body: ${command.id}`);body.velocity.splice(0,3,...command.value);return;
    }
    this.systemRuntime.run(command.action,command.deltaSeconds,at);
  }

  private installSystemRuntime():void{
    this.systemRuntime
      .use('weather',({at})=>{this.environment=resolveEnvironmentAt(this.spec.environment,at);})
      .use('surfaces',({dt})=>{
        this.surfaces.step(dt,dt*environmentTimeScale(this.spec.environment),this.environment,this.entities);
        this.syncSurfaceVisuals();
      })
      .use('animation',({at})=>{this.animation.step(at,this.entities,p=>this.contacts.sample(p));})
      .use('physics',({dt})=>{
        this.pendingFractures.clear();
        this.physics.step(dt,contact=>{
          const result=evaluateFracture(contact);
          if(result.fracture){
            if(this.pendingFractures.has(result.fracture.body.id))return{mode:'penetrate',energyLoss:0};
            this.pendingFractures.set(result.fracture.body.id,result.fracture);
            return result.decision;
          }
          const plasticWork=this.deformation.absorbContact(contact,this.entities);
          return plasticWork>0?{mode:'penetrate',energyLoss:plasticWork}:result.decision;
        });
      })
      .use('deformation',()=>{if(this.deformation.step(this.entities))this.renderStructureRevision++;})
      .use('surface-contacts',({dt,at})=>{this.contacts.step(dt,at,this.animation.feet);})
      .use('events',({at})=>{this.emitContactEvents(at);})
      .use('fracture',({at})=>{for(const fracture of this.pendingFractures.values())this.fracture(fracture,at);})
      .use('cleanup',({at})=>{this.cleanupGenerated(at);})
      .use('clock',({at})=>{this.time=at;this.tick++;});
  }

  snapshot():SceneSnapshot{
    return{version:1,time:this.time,tick:this.tick,entities:[...this.entities.values()].map(entity=>({
      id:entity.id,position:[...entity.position],rotation:[...entity.rotation],
      velocity:entity.body?[...entity.body.velocity]:[0,0,0],material:entity.material.kind,
    }))};
  }
  drainEvents():EngineEvent[]{return this.eventQueue.splice(0);}
  setCamera(camera:CameraSpec):void{this.camera=structuredClone(camera);}
  patchAppearance(patch:AppearancePatch):void{
    let appearanceChanged=false,structureChanged=false;
    if(patch.rendering){
      const keys=Object.keys(patch.rendering);
      this.spec.rendering={...(this.spec.rendering??{}),...structuredClone(patch.rendering)};
      // Exposure/fog are frame uniforms. Lighting/probe/shadow authoring may
      // change scene-derived caches and therefore takes the structural path.
      if(keys.some(key=>key!=='exposure'&&key!=='fogDensity'))structureChanged=true;
      else appearanceChanged=true;
    }
    for(const rule of patch.materials??[]){
      for(const entity of this.entities.values()){
        if(rule.id!==undefined&&entity.id!==rule.id)continue;
        if(rule.idPrefix!==undefined&&!entity.id.startsWith(rule.idPrefix))continue;
        if(rule.treatment!==undefined&&entity.material.treatment!==rule.treatment)continue;
        if(rule.set.color&&rule.set.color[3]!==entity.material.color[3])throw new TypeError('appearance patch cannot change material alpha/classification');
        (entity as {material:RuntimeMaterial}).material=Object.freeze({...entity.material,...structuredClone(rule.set)});
        appearanceChanged=true;
      }
    }
    if(structureChanged)this.renderStructureRevision++;
    if(appearanceChanged)this.appearanceRevision++;
  }

  private syncSurfaceVisuals():void{
    const keep=new Set<string>();
    for(const [surfaceId,state] of this.surfaces.surfaces){
      if(state.use!=='curb'&&state.use!=='sidewalk')continue;
      const source=this.entities.get(surfaceId);if(!source?.mesh)continue;
      const dimensions=meshDimensions(source.mesh,source.scale),longAxis:0|2=dimensions[0]>=dimensions[2]?0:2,crossAxis:0|2=longAxis===0?2:0;
      const longSize=dimensions[longAxis],crossSize=dimensions[crossAxis],count=Math.max(1,Math.min(256,Math.ceil(longSize/6)));
      const top=source.position[1]+dimensions[1]/2;
      for(let i=0;i<count;i++){
        const key=`${surfaceId}:${i}`,height=Math.round(Math.min(1.45,state.snowDepthM*(state.use==='curb'?4.2:1.25))*50)/50;
        if(height<.02)continue;keep.add(key);
        const longitudinal=longSize/count,cross=state.use==='curb'?Math.max(.7,crossSize*4.8):crossSize;
        const position:MutableVec3=[...source.position];position[longAxis]+=-longSize/2+(i+.5)*longSize/count;position[1]=state.use==='curb'?source.position[1]-dimensions[1]/2+.003:top-.015;
        const size:MutableVec3=[longitudinal,height,cross],seed=(this.spec.seed??1)^hashString(surfaceId),owned=this.surfaceVisuals.get(key);
        const previous=owned&&this.entities.get(owned.entity.id)===owned.entity?owned.entity:undefined;
        if(previous?.mesh?.kind==='snowdrift'&&previous.mesh.size[1]===height&&previous.mesh.size[0]===size[0]&&previous.mesh.size[2]===size[2]&&previous.mesh.offset===position[longAxis]&&previous.position.every((v,i)=>v===position[i]))continue;
        let id=previous?.id;
        if(previous)this.remove(previous.id);
        else{
          const preferred=`__surface:snowdrift:${surfaceId}:${i}`,base=preferred.length<=140?preferred:`__surface:snowdrift:${hashString(surfaceId).toString(36)}:${i}`;
          id=base;while(this.entities.has(id))id=`${base}:${this.surfaceVisualSequence++}`;
        }
        const entity=this.add({id:id!,position,rotation:longAxis===0?[0,0,0]:[0,-Math.PI/2,0],mesh:{kind:'snowdrift',size,seed,continuous:true,offset:position[longAxis]},material:{roughness:.88,...source.environmental?.snowMaterial,kind:'snow'}});
        this.surfaceVisuals.set(key,{source:surfaceId,entity});
      }
    }
    for(const [key,visual] of this.surfaceVisuals)if(!keep.has(key)){
      this.surfaceVisuals.delete(key);if(this.entities.get(visual.entity.id)===visual.entity)this.remove(visual.entity.id);
    }
  }

  private emitContactEvents(at:number):void{
    for(const contact of this.physics.contacts){
      if(contact.normalEnergy<.005)continue;
      const key=contact.b==='ground'?`${contact.a}|ground`:contact.a<contact.b?`${contact.a}|${contact.b}`:`${contact.b}|${contact.a}`;
      const previous=this.impactCooldown.get(key)??-Infinity;
      if(at-previous<.035)continue;
      this.impactCooldown.set(key,at);
      const a=this.physics.bodies.get(contact.a),b=contact.b==='ground'?undefined:this.physics.bodies.get(contact.b);
      if(!a)continue;
      const entityA=this.entities.get(contact.a),entityB=contact.b==='ground'?undefined:this.entities.get(contact.b);
      this.pushEvent({
        type:'impact',id:++this.eventSequence,time:at,point:contact.point,normal:contact.normal,a:contact.a,b:contact.b,
        materialA:a.material.kind,materialB:b?.material.kind??this.physics.groundMaterial.kind,
        ...(entityA?{surfaceA:surfaceAcoustics(this.surfaces.sample(entityA.id,contact.point[0],contact.point[2])??this.surfaces.surface(entityA.id)??entityA.material.surface)}:{}),
        ...(entityB?{surfaceB:surfaceAcoustics(this.surfaces.sample(entityB.id,contact.point[0],contact.point[2])??this.surfaces.surface(entityB.id)??entityB.material.surface)}:{}),
        energy:contact.normalEnergy,impulse:contact.impulse,speed:contact.normalSpeed,size:Math.max(.02,Math.min(characteristicSize(a),b?characteristicSize(b):characteristicSize(a))),
      });
    }
  }

  private fracture(fracture:FractureDecision,at:number):void{
    const entity=this.entities.get(fracture.body.id);
    if(!entity||!entity.mesh)return;
    const contact=this.physics.contacts.find(c=>c.mode==='penetrate'&&(c.a===entity.id||c.b===entity.id));
    const dimensions=meshDimensions(entity.mesh,entity.scale),axis=dominantAxis(fracture.normal),axes=planeAxes(axis);
    const planar:[number,number]=axis===0?[dimensions[1],dimensions[2]]:axis===1?[dimensions[0],dimensions[2]]:[dimensions[0],dimensions[1]];
    const ratio=Math.max(1,fracture.availableEnergy/fracture.requiredEnergy),seed=(this.spec.seed??1)^hashString(entity.id)^this.tick;
    const pieces:FracturePiece[]=[];

    if(entity.material.kind==='glass'&&entity.mesh.kind==='box'){
      const impact:[number,number]=[
        fracture.point[axes[0]]-entity.position[axes[0]],
        fracture.point[axes[1]]-entity.position[axes[1]],
      ];
      const pattern=fracturePlate({width:planar[0],height:planar[1],thickness:fracture.thickness,impact,energyRatio:ratio,seed});
      for(const fragment of pattern.fragments){
        const points=fragment.points.map(point=>[point[0]-fragment.centroid[0],point[1]-fragment.centroid[1]] as const);
        const position:MutableVec3=[...entity.position];
        position[axes[0]]+=fragment.centroid[0];position[axes[1]]+=fragment.centroid[1];
        pieces.push({
          mesh:{kind:'polygon-prism',points,thickness:fracture.thickness,axis},
          position,rotation:[...entity.rotation],
          volume:fragment.area*fracture.thickness,
        });
      }
    }else{
      const area=Math.max(.002,planar[0]*planar[1]),count=Math.max(10,Math.min(36,Math.round(10+Math.sqrt(area)*5+Math.min(18,(ratio-1)*7)))),rng=mulberry32(seed);
      const halfU=planar[0]/2,halfV=planar[1]/2,baseU=planar[0]/Math.sqrt(count),baseV=planar[1]/Math.sqrt(count);
      for(let i=0;i<count;i++){
        const u=(rng()*2-1)*halfU,v=(rng()*2-1)*halfV,du=Math.max(.035,baseU*(.55+rng()*1.15)),dv=Math.max(.035,baseV*(.55+rng()*1.15)),thickness=Math.max(.001,fracture.thickness*(.62+rng()*.3));
        const size:MutableVec3=axis===0?[thickness,du,dv]:axis===1?[du,thickness,dv]:[du,dv,thickness],position:MutableVec3=[...entity.position];
        position[axes[0]]+=u;position[axes[1]]+=v;position[axis]+=(rng()-.5)*fracture.thickness*.4;
        pieces.push({mesh:{kind:'shard',size,axis,skew:rng()*.8-.4},position,rotation:[...entity.rotation],volume:size[0]*size[1]*size[2]*.5});
      }
    }

    if(!pieces.length)return;
    const density=entity.material.profile.density,totalVolume=pieces.reduce((sum,p)=>sum+p.volume,0);
    const source=fracture.body,sourceMass=source.invMass?source.mass:density*totalVolume;
    const kick:Vec3=[-fracture.normal[0],-fracture.normal[1],-fracture.normal[2]],impulse=contact?.impulse??0;
    const fragments:RigidBody[]=[],rng=mulberry32(seed^0x91e10da5);
    this.remove(entity.id);

    for(const piece of pieces){
      const mass=sourceMass*piece.volume/totalVolume;
      const id=`${entity.id}:shard:${this.generatedSequence++}`,shard=this.add({
        id,position:piece.position,rotation:piece.rotation,mesh:piece.mesh,
        material:{kind:entity.material.kind,color:entity.material.color,...(entity.material.roughness!==undefined?{roughness:entity.material.roughness}:{}),...(entity.material.metalness!==undefined?{metalness:entity.material.metalness}:{}),...(entity.material.emissive?{emissive:entity.material.emissive}:{})},
        body:{mass,restitution:.12,friction:.42,shape:'box'},
      });
      if(shard.body){shard.body.fracturable=false;shard.body.collisionClass='debris';fragments.push(shard.body);}
      shard.expiresAt=at+4.5+rng()*1.5;
    }
    transferFragmentMotion(source,fragments,V3.scale(kick,impulse),fracture.requiredEnergy,seed^0x91e10da5);
    this.pushEvent({
      type:'fracture',id:++this.eventSequence,time:at,entity:entity.id,material:entity.material.kind,point:fracture.point,normal:fracture.normal,
      energy:fracture.availableEnergy,requiredEnergy:fracture.requiredEnergy,thickness:fracture.thickness,shardCount:pieces.length,size:Math.max(planar[0],planar[1]),
    });
  }

  private cleanupGenerated(at:number):void{
    for(const entity of [...this.entities.values()])if(entity.expiresAt!==undefined&&entity.expiresAt<=at)this.remove(entity.id);
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
  if(mesh.kind==='polygon-prism'){
    const area=Math.abs(polygonArea2(mesh.points)),axes=planeAxes(mesh.axis??2);
    return area*scale[axes[0]]*scale[axes[1]]*mesh.thickness*scale[mesh.axis??2];
  }
  const d=meshDimensions(mesh,scale);return d[0]*d[1]*d[2]*(mesh.kind==='shard'?.5:1);
}
function meshDimensions(mesh:Primitive,scale:Vec3):MutableVec3{
  if(mesh.kind==='triangle-mesh'){const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];mesh.positions.forEach((v,i)=>{const a=i%3;lo[a]=Math.min(lo[a]!,v);hi[a]=Math.max(hi[a]!,v);});return[(hi[0]!-lo[0]!)*scale[0],(hi[1]!-lo[1]!)*scale[1],(hi[2]!-lo[2]!)*scale[2]];}
  if(mesh.kind==='torus')return[(mesh.radius+mesh.tube)*2*scale[0],mesh.tube*2*scale[1],(mesh.radius+mesh.tube)*2*scale[2]];
  if(mesh.kind==='cylinder'){const r=Math.max(mesh.radius,mesh.topRadius??mesh.radius);return[r*2*scale[0],mesh.height*scale[1],r*2*scale[2]];};
  if(mesh.kind==='box'||mesh.kind==='shard'||mesh.kind==='snowdrift'){const size=mesh.size??[1,1,1];return[size[0]*scale[0],size[1]*scale[1],size[2]*scale[2]];}
  if(mesh.kind==='sphere'){const d=2*(mesh.radius??1);return[d*scale[0],d*scale[1],d*scale[2]];}
  if(mesh.kind==='polygon-prism'){
    const bounds=polygonBounds(mesh.points),axis=mesh.axis??2,axes=planeAxes(axis),d:MutableVec3=[1,1,1];
    d[axis]=mesh.thickness*scale[axis];d[axes[0]]=(bounds.maxX-bounds.minX)*scale[axes[0]];d[axes[1]]=(bounds.maxY-bounds.minY)*scale[axes[1]];return d;
  }
  return[(mesh.size?.[0]??1)*scale[0],.02*scale[1],(mesh.size?.[1]??1)*scale[2]];
}
function bodyShape(mesh:Primitive|undefined,body:BodySpec,scale:Vec3):CollisionShape{
  if(body.collisionSize)return{kind:'box',half:[body.collisionSize[0]/2,body.collisionSize[1]/2,body.collisionSize[2]/2]};
  const shape=body.shape??'auto';
  if(shape==='sphere'||shape==='auto'&&mesh?.kind==='sphere')return{kind:'sphere',radius:(mesh?.kind==='sphere'?mesh.radius??1:1)*Math.max(scale[0],scale[1],scale[2])};
  if(mesh?.kind==='polygon-prism'||mesh?.kind==='cylinder'||mesh?.kind==='snowdrift'||mesh?.kind==='torus'||mesh?.kind==='triangle-mesh'){const d=meshDimensions(mesh,scale);return{kind:'box',half:[d[0]/2,d[1]/2,d[2]/2]};}
  const size:Vec3=mesh?.kind==='box'||mesh?.kind==='shard'?mesh.size??[1,1,1]:mesh?.kind==='plane'?[mesh.size?.[0]??1,.02,mesh.size?.[1]??1]:[1,1,1];
  return{kind:'box',half:[size[0]*scale[0]/2,size[1]*scale[1]/2,size[2]*scale[2]/2]};
}

function polygonArea2(points:readonly (readonly[number,number])[]):number{let area=0;for(let i=0;i<points.length;i++){const a=points[i]!,b=points[(i+1)%points.length]!;area+=a[0]*b[1]-b[0]*a[1];}return area*.5;}
function polygonBounds(points:readonly (readonly[number,number])[]){let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;for(const p of points){minX=Math.min(minX,p[0]);maxX=Math.max(maxX,p[0]);minY=Math.min(minY,p[1]);maxY=Math.max(maxY,p[1]);}return{minX,maxX,minY,maxY};}

function surfaceAcoustics(surface:Pick<SurfaceState,'wetness'|'moss'|'acousticDamping'>){return{wetness:surface.wetness,moss:surface.moss,damping:surface.acousticDamping};}
