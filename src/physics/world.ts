import {advanceRotation} from './rotation.js';
import {groundSupport,type WheelSupport} from './wheel-support.js';
import {SpatialHash} from '../core/spatial-hash.js';
import {material,type PhysicalMaterial} from '../materials/catalog.js';
import type {MutableVec3,Vec3} from '../math.js';
import {V3} from '../math.js';
import {PhysicsCauseTrace,physicsCause,type PhysicsBodyState,type PhysicsCauseManifestWriter,type PhysicsCauseRef,type PhysicsCauseWriter} from './cause-trace.js';
import {rigidBodyMechanicalEnergyJ} from './accounting.js';
import type {FluidSample} from './fluid.js';
import type {AirSample} from './wind.js';
import type {SoilContactInput,SoilContactResult} from './soil.js';
import {CollisionSolverFamily,type CollisionSolverPlugin,type CollisionSolverProgram} from './depth.js';
import type {SimulationProfileInput} from '../core/depth.js';

export type CollisionShape = {kind:'sphere';radius:number}|{kind:'box';half:Vec3};
export interface RigidBodyOptions {
  id:string;
  position:Vec3;
  rotation?:Vec3;
  velocity?:Vec3;
  angularVelocity?:Vec3;
  mass?:number;
  kinematic?:boolean;
  restitution?:number;
  friction?:number;
  material?:PhysicalMaterial;
  shape:CollisionShape;
  /** Optional internal hollow volume used only for flooding/sealing state. External buoyancy always follows collision volume. */
  fluid?:{readonly enclosedVolumeM3:number;readonly leakAreaM2?:number};
}
export class RigidBody {
  readonly id:string;
  position:MutableVec3;
  rotation:MutableVec3;
  velocity:MutableVec3;
  angularVelocity:MutableVec3;
  readonly mass:number;
  readonly invMass:number;
  readonly kinematic:boolean;
  readonly material:PhysicalMaterial;
  readonly invInertiaLocal:MutableVec3;
  sleeping=false;
  sleepTimer=0;
  supportedThisStep=false;
  /** Engine-generated micro debris does not recursively fracture or self-collide. */
  fracturable=true;
  collisionClass:'solid'|'debris'='solid';
  restitution:number;
  friction:number;
  readonly shape:CollisionShape;
  /** Directional permanent crush for box collision envelopes. */
  readonly crushPositive:MutableVec3=[0,0,0];
  readonly crushNegative:MutableVec3=[0,0,0];
  readonly collisionOffsetLocal:MutableVec3=[0,0,0];
  readonly collisionHalf:MutableVec3|undefined;
  readonly enclosedVolumeM3:number;
  leakAreaM2:number;
  floodedVolumeM3=0;
  x:number;z:number;w:number;l:number;

  constructor(options:RigidBodyOptions){
    if(!options.id)throw new TypeError('Rigid body id is required');
    const mass=options.mass??0;
    if(!Number.isFinite(mass)||mass<0)throw new RangeError('Body mass must be finite and non-negative');
    this.id=options.id;
    this.position=[...options.position];
    this.rotation=[...(options.rotation??[0,0,0])];
    this.velocity=[...(options.velocity??[0,0,0])];
    this.angularVelocity=[...(options.angularVelocity??[0,0,0])];
    this.mass=mass;
    this.kinematic=options.kinematic??false;
    this.invMass=mass>0&&!this.kinematic?1/mass:0;
    this.material=options.material??material();
    this.invInertiaLocal=inverseInertiaLocal(options.shape,mass);
    this.restitution=Math.max(0,Math.min(1,options.restitution??this.material.restitution));
    this.friction=Math.max(0,options.friction??this.material.friction);
    this.shape=options.shape;
    const enclosed=options.fluid?.enclosedVolumeM3??0,leak=options.fluid?.leakAreaM2??0;if(!Number.isFinite(enclosed)||enclosed<0||!Number.isFinite(leak)||leak<0)throw new RangeError('Invalid body fluid profile');
    this.enclosedVolumeM3=enclosed;this.leakAreaM2=leak;
    this.collisionHalf=options.shape.kind==='box'?[...options.shape.half]:undefined;
    const r=shapeRadius(options.shape);
    this.x=this.position[0];this.z=this.position[2];this.w=r*2;this.l=r*2;
  }
  syncSpatial():void{this.x=this.position[0];this.z=this.position[2];}
  wake():void{if(this.sleeping){this.sleeping=false;this.sleepTimer=0;}}
  setLeakArea(areaM2:number):void{if(!Number.isFinite(areaM2)||areaM2<0)throw new RangeError('Invalid leak area');this.leakAreaM2=areaM2;if(areaM2>0)this.wake();}
  applyLocalCrush(outwardNormal:Vec3,depth:number):void{
    if(this.shape.kind!=='box'||!this.collisionHalf||!Number.isFinite(depth)||depth<=0)return;
    const ax=Math.abs(outwardNormal[0]),ay=Math.abs(outwardNormal[1]),az=Math.abs(outwardNormal[2]),axis:0|1|2=ax>=ay&&ax>=az?0:ay>=az?1:2,sign=outwardNormal[axis]>=0?1:-1,base=this.shape.half[axis];
    const side=sign>0?this.crushPositive:this.crushNegative,current=side[axis],capacity=Math.max(0,base*1.45-current),applied=Math.min(depth,capacity);
    if(applied<=0)return;side[axis]+=applied;
    this.collisionHalf[axis]=Math.max(base*.22,base-(this.crushPositive[axis]+this.crushNegative[axis])*.5);
    this.collisionOffsetLocal[axis]=(this.crushNegative[axis]-this.crushPositive[axis])*.5;
  }
}

export interface ContactCandidate {
  readonly a:RigidBody;
  readonly b:RigidBody;
  /** Unit normal from A toward B. */
  readonly normal:Vec3;
  readonly point:Vec3;
  readonly penetration:number;
  readonly approachSpeed:number;
  readonly effectiveMass:number;
  readonly normalEnergy:number;
}
export interface ContactDecision {
  readonly mode:'resolve'|'penetrate';
  /** Energy consumed by material work; resolving contacts retain positional separation. */
  readonly energyLoss?:number;
}
export type ContactModel=((contact:ContactCandidate)=>ContactDecision)&{
  /** Explicit semantic proof supplied by the owning domain, not inferred by
   * the accelerator. True means this exact pair MUST resolve normally with no
   * material mutations or callback side effects. Default: no proof, so serial.
   * Called at the batch boundary before broadphase candidate states mutate. */
  canResolveWithoutCallback?:(a:RigidBody,b:RigidBody)=>boolean;
};

export interface Contact {
  readonly a:string;
  readonly b:string|'ground';
  readonly normal:Vec3;
  readonly point:Vec3;
  readonly penetration:number;
  readonly impulse:number;
  readonly normalSpeed:number;
  readonly normalEnergy:number;
  readonly mode:'resolve'|'penetrate';
}
/** One force owner per body. Wrenches are world-space and already summed over its parts.
 * evaluate() runs once per substep, before any dynamic body consumes the wrenches. */
export interface PhysicsForceDriver {
  readonly maxStepSeconds:number;
  readonly force:Vec3;
  readonly torque:Vec3;
  /** Optional proof-mode writer. A driver that changes its wrench without recording
   * matching contributions will fail closure in PhysicsCauseTrace. */
  evaluate(dt:number,causes?:PhysicsCauseWriter):void;
  /** Stable physical causes must be declared before this body first evaluates. */
  declareCauses?(manifest:PhysicsCauseManifestWriter):void;
}
export interface PhysicsStats {steps:number;substeps:number;contacts:number;bodies:number;sleeping:number;collisionSurfaceIterations:number}
/** Pre-contact contact data compiled by native rigid narrowphase.
 * a/b stay engine-owned RigidBody objects, never mirrored persistent worlds. */
export interface CollisionHit {
  readonly normal:Vec3;
  readonly point:Vec3;
  readonly penetration:number;
  readonly approachSpeed:number;
  readonly effectiveMass:number;
  readonly normalEnergy:number;
}
/** One contact from an ordered, policy-free batch. The caller owns every body. */
export interface BatchedRigidContact {
  readonly b:RigidBody;
  readonly hit:CollisionHit;
  readonly impulse:number;
}
/** Optional synchronous compiled narrowphase and sequential rigid impulse kernel. */
export interface RigidContactKernel {
  test(a:RigidBody,b:RigidBody):CollisionHit|null;
  resolve(contact:ContactCandidate):number;
  /** One A body against distinct B candidates, preserving their given order.
   * The accelerated path is NEVER used with contact-law callbacks or cause tracing.
   * Implementations must mutate original RigidBody arrays in-place before return. */
  readonly maxBatchSize?:number;
  batch?(a:RigidBody,others:readonly RigidBody[]):readonly BatchedRigidContact[];
  dispose():void;
}

/** Deterministic rigid-body contact core. Material failure may replace bounce with energy-consuming penetration. */
export class PhysicsWorld {
  wheelSupport:WheelSupport;
  private readonly rotationScratch=new Float64Array(4);
  surfaceFrictionAt?:(body:RigidBody,point:Vec3)=>number;
  /** Effective road/surface friction coefficient seen by tyre contact. */
  wheelFrictionAt?:(supportId:string,body:RigidBody|null,point:Vec3)=>number;
  /** Fluid field lookup is spatial; world owns the resulting forces. */
  fluidAt?:(body:RigidBody)=>FluidSample|undefined;
  /** Spatial air state sampled by aerodynamic force owners. */
  airAt?:(point:Vec3)=>AirSample;
  /** Deformable bearing response sampled by wheel contact owners. */
  soilContactAt?:(point:Vec3,input:SoilContactInput)=>SoilContactResult|undefined;
  readonly bodies=new Map<string,RigidBody>();
  readonly contacts:Contact[]=[];
  private readonly forceDrivers=new Map<RigidBody,PhysicsForceDriver>();
  private readonly collisionFamily=new CollisionSolverFamily();
  private collisionProgram:CollisionSolverProgram=this.collisionFamily.compile('detailed');
  private rigidContactKernel:RigidContactKernel|null=null;
  private readonly rigidBatchStats={
    calls:0,candidates:0,contacts:0,serialPairs:0,
    policyFallbacks:0,traceFallbacks:0,staticSurfaceFallbacks:0,capacityFallbacks:0,
  };
  private causeTrace:PhysicsCauseTrace|undefined;
  /** Proof-mode only: analytically predicted contact/solver energy transfer for the active substep. */
  private traceContactEnergy:Map<RigidBody,number>|undefined;
  private readonly gravityCauses=new Map<string,PhysicsCauseRef>();
  private readonly contactCauses=new Map<string,PhysicsCauseRef>();
  private readonly fluidCauses=new Map<string,PhysicsCauseRef>();
  readonly index:SpatialHash<RigidBody>;
  steps=0;substeps=0;time=0;
  constructor(
    readonly gravity:Vec3=[0,-9.81,0],
    readonly ground=0,
    cellSize=8,
    readonly groundMaterial:PhysicalMaterial=material('concrete'),
  ){this.index=new SpatialHash<RigidBody>(cellSize);this.wheelSupport=groundSupport(ground);}

  setSimulationProfile(profile:SimulationProfileInput):void{this.collisionProgram=this.collisionFamily.compile(profile);}
  useCollisionPlugin(plugin:CollisionSolverPlugin,profile:SimulationProfileInput='detailed'):this{this.collisionFamily.usePlugin(plugin);this.collisionProgram=this.collisionFamily.compile(profile);return this;}
  get collisionSolver():CollisionSolverProgram{return this.collisionProgram;}
  get rigidContactBackend():'typescript'|'wasm'{return this.rigidContactKernel?'wasm':'typescript';}
  /** Cumulative dispatch counters, independent of the physical solver's state. */
  get rigidContactDiagnostics():Readonly<{
    backend:'typescript'|'wasm';calls:number;candidates:number;contacts:number;serialPairs:number;
    policyFallbacks:number;traceFallbacks:number;staticSurfaceFallbacks:number;capacityFallbacks:number;
  }>{return Object.freeze({backend:this.rigidContactBackend,...this.rigidBatchStats});}
  /** Install at a simulation boundary; ownership of the kernel remains with caller.
   * Causal tracing bypasses the kernel to preserve full force/energy provenance. */
  setRigidContactKernel(kernel:RigidContactKernel|null):this{
    this.rigidContactKernel=kernel;
    return this;
  }

  add(body:RigidBody):RigidBody{if(this.bodies.has(body.id))throw new TypeError(`Duplicate body ${body.id}`);this.bodies.set(body.id,body);if(this.causeTrace)this.declareBodyCauses(body,this.causeTrace);return body;}
  /** Enable complete force provenance. Existing bodies/drivers are registered immediately;
   * every later driver wrench must close exactly against recorded contributions. */
  traceCauses(options:{readonly runId?:string;readonly maxRecords?:number}={}):PhysicsCauseTrace{
    if(this.causeTrace)throw new Error('Physics cause trace is already enabled');
    const trace=new PhysicsCauseTrace(options);this.causeTrace=trace;
    for(const body of this.bodies.values())this.declareBodyCauses(body,trace);
    for(const driver of this.forceDrivers.values())driver.declareCauses?.(trace);
    return trace;
  }
  stopCauseTrace(trace?:PhysicsCauseTrace):void{if(trace&&this.causeTrace!==trace)throw new TypeError('Physics cause trace does not belong to this world');this.causeTrace=undefined;}
  private declareBodyCauses(body:RigidBody,trace:PhysicsCauseTrace):void{
    trace.component({componentId:body.id,bodyId:body.id,kind:'body'});
    const cause=this.gravityCauses.get(body.id)??physicsCause(body.id,'gravity.v1','gravity',['force']);this.gravityCauses.set(body.id,cause);trace.law(body.id,cause);
    const contact=this.contactCauses.get(body.id)??physicsCause(body.id,'contact-solver.v1','collision',['impulse','position-correction','velocity-correction','angular-velocity-correction']);this.contactCauses.set(body.id,contact);trace.law(body.id,contact);
    const fluid=this.fluidCauses.get(body.id)??physicsCause(body.id,'fluid.v1','fluid',['force']);this.fluidCauses.set(body.id,fluid);trace.law(body.id,fluid);
  }
  drive(body:RigidBody,driver:PhysicsForceDriver):()=>void{
    if(this.bodies.get(body.id)!==body||!body.invMass||this.forceDrivers.has(body))throw new TypeError('Force driver requires one owned dynamic body');
    if(typeof driver.evaluate!=='function')throw new TypeError('Force driver requires evaluate');
    if(!Number.isFinite(driver.maxStepSeconds)||driver.maxStepSeconds<.001||driver.maxStepSeconds>.25)throw new RangeError('Force step must be within .001.. .25 s');
    this.forceDrivers.set(body,driver);if(this.causeTrace)driver.declareCauses?.(this.causeTrace);
    return()=>{if(this.forceDrivers.get(body)===driver)this.forceDrivers.delete(body);};
  }
  remove(id:string):boolean{const body=this.bodies.get(id);if(body)this.forceDrivers.delete(body);this.gravityCauses.delete(id);this.contactCauses.delete(id);this.fluidCauses.delete(id);return this.bodies.delete(id);}
  clear():void{this.forceDrivers.clear();this.bodies.clear();this.index.clear();this.contacts.length=0;this.gravityCauses.clear();this.contactCauses.clear();this.fluidCauses.clear();this.causeTrace=undefined;this.steps=0;this.substeps=0;this.time=0;for(const key of Object.keys(this.rigidBatchStats) as (keyof typeof this.rigidBatchStats)[])this.rigidBatchStats[key]=0;}

  step(dt:number,contactModel?:ContactModel):void{
    if(!Number.isFinite(dt)||dt<=0||dt>.25)throw new RangeError('Physics dt must be in (0, 0.25]');
    this.contacts.length=0;
    const substeps=this.adaptiveSubsteps(dt),subDt=dt/substeps;
    for(let substep=0;substep<substeps;substep++)this.stepSubstep(subDt,contactModel,substep,this.time+substep*subDt);
    this.steps++;this.substeps+=substeps;this.time+=dt;
  }

  private adaptiveSubsteps(dt:number):number{
    let required=1;
    for(const body of this.bodies.values()){
      if(!body.invMass&&!body.kinematic)continue;
      const speed=Math.hypot(body.velocity[0],body.velocity[1],body.velocity[2]),travel=speed*dt;
      const feature=body.shape.kind==='sphere'?body.shape.radius*1.5:Math.max(.025,Math.min(...boxHalf(body))*1.5);
      required=Math.max(required,Math.ceil(travel/Math.max(.015,feature)));
    }
    let forceSteps=1;
    for(const driver of this.forceDrivers.values())forceSteps=Math.max(forceSteps,Math.ceil(dt/driver.maxStepSeconds));
    return Math.max(forceSteps,Math.max(1,Math.min(12,required)));
  }

  private stepSubstep(dt:number,contactModel:ContactModel|undefined,substep:number,simTime:number):void{
    const trace=this.causeTrace,before=trace?new Map<RigidBody,PhysicsBodyState>():undefined,wrenchIds=trace?new Map<RigidBody,string>():undefined,energyInitial=trace?new Map<RigidBody,number>():undefined;
    trace?.beginSubstep(this.steps,substep,simTime);this.traceContactEnergy=trace?new Map():undefined;
    if(trace)for(const body of this.bodies.values())if(body.invMass){
      before!.set(body,this.traceState(body));energyInitial!.set(body,rigidBodyMechanicalEnergyJ(body,this.gravity));
    }
    for(const [body,driver] of this.forceDrivers)driver.evaluate(dt,trace?.writer(body.id));
    for(const [body,driver] of this.forceDrivers){
      const f=driver.force,t=driver.torque;
      if(!Number.isFinite(f[0]+f[1]+f[2]+t[0]+t[1]+t[2]))throw new RangeError('Non-finite force-driver wrench');
      if(body.sleeping)continue;
      const driverWork=trace?this.forceKickEnergyJ(body,f,t,dt):0;
      body.velocity[0]+=f[0]*body.invMass*dt;body.velocity[1]+=f[1]*body.invMass*dt;body.velocity[2]+=f[2]*body.invMass*dt;
      if(t[0]!==0||t[1]!==0||t[2]!==0){const dw=applyInvInertiaWorld(body,t);body.angularVelocity[0]+=dw[0]*dt;body.angularVelocity[1]+=dw[1]*dt;body.angularVelocity[2]+=dw[2]*dt;}
      trace?.energy(body.id,'force-driver',driverWork);
    }
    for(const body of this.bodies.values())if(body.kinematic){
      body.position[0]+=body.velocity[0]*dt;body.position[1]+=body.velocity[1]*dt;body.position[2]+=body.velocity[2]*dt;
      advanceRotation(body.rotation,body.angularVelocity,dt,this.rotationScratch);
    }
    for(const body of this.bodies.values())if(body.invMass&&!body.sleeping){
      body.supportedThisStep=false;
      let wrenchId='';
      const fluid=this.fluidAt?.(body),fluidForce=this.fluidForce(body,fluid,dt);
      if(trace){
        const gravity:Vec3=[body.mass*this.gravity[0],body.mass*this.gravity[1],body.mass*this.gravity[2]],writer=trace.writer(body.id),cause=this.gravityCauses.get(body.id)!;
        writer.contribute(cause,{kind:'gravity-field',id:'world.gravity'},{forceN:gravity});
        if(fluid&&(fluidForce[0]!==0||fluidForce[1]!==0||fluidForce[2]!==0))writer.contribute(this.fluidCauses.get(body.id)!,{kind:'fluid',id:fluid.id},{forceN:fluidForce});
        const driver=this.forceDrivers.get(body),force:Vec3=driver?[driver.force[0]+gravity[0]+fluidForce[0],driver.force[1]+gravity[1]+fluidForce[1],driver.force[2]+gravity[2]+fluidForce[2]]:[gravity[0]+fluidForce[0],gravity[1]+fluidForce[1],gravity[2]+fluidForce[2]],torque:Vec3=driver?driver.torque:[0,0,0];
        wrenchId=trace.wrench(body.id,force,torque);wrenchIds!.set(body,wrenchId);
        trace.energy(body.id,'fluid',this.forceKickEnergyJ(body,fluidForce,[0,0,0],dt));
      }
      body.velocity[0]+=fluidForce[0]*body.invMass*dt;body.velocity[1]+=fluidForce[1]*body.invMass*dt;body.velocity[2]+=fluidForce[2]*body.invMass*dt;
      body.velocity[0]+=this.gravity[0]*dt;body.velocity[1]+=this.gravity[1]*dt;body.velocity[2]+=this.gravity[2]*dt;
      body.position[0]+=body.velocity[0]*dt;body.position[1]+=body.velocity[1]*dt;body.position[2]+=body.velocity[2]*dt;
      // No global angular damping: aerodynamic damping must come from authored physical surfaces.
      advanceRotation(body.rotation,body.angularVelocity,dt,this.rotationScratch);
      if(trace)trace.energy(body.id,'gravity-integrate',-.5*body.mass*V3.dot(this.gravity,this.gravity)*dt*dt);
      this.resolveGround(body,dt);
    }
    this.rebuildIndex();
    const seen=new Set<string>(),scratch:RigidBody[]=[];
    for(const a of this.bodies.values()){
      if(!a.invMass||a.sleeping)continue;
      const radius=shapeRadius(a.shape),candidates=this.index.near(a.position[0],a.position[2],radius*2+2,scratch);
      const native=this.rigidContactKernel;
      // Batch is confined to ONE current A body. Processing A in Rust before
      // asking SpatialHash for the next body preserves dynamic query positions,
      // wakeups, the Seen order and the exact sequential impulse dependency.
      // The domain may explicitly prove particular pairs cannot cause material
      // side effects. Without that proof cross-domain callbacks must remain
      // synchronous and ordered before the next collision can be evaluated.
      if(native?.batch){
        const policy=!!contactModel&&(
          !contactModel.canResolveWithoutCallback ||
          candidates.some(b=>
            b!==a&&!(a.collisionClass==='debris'&&b.collisionClass==='debris')&&
            !contactModel.canResolveWithoutCallback!(a,b))
        ),traceEnabled=!!trace;
        const capacity=candidates.length>(native.maxBatchSize??0)+1;
        // Finite horizontal surfaces own their manifolds, friction and sleep
        // policy in JS; a single such candidate opts this A out of batching.
        const special=!policy&&!traceEnabled&&!capacity&&candidates.some(b=>
          b!==a&&!b.invMass&&isHorizontalStaticSurface(b));
        if(policy)this.rigidBatchStats.policyFallbacks++;
        else if(traceEnabled)this.rigidBatchStats.traceFallbacks++;
        else if(capacity)this.rigidBatchStats.capacityFallbacks++;
        else if(special)this.rigidBatchStats.staticSurfaceFallbacks++;
        else{
          const accepted:RigidBody[]=[];
          for(const b of candidates){
            if(a===b||a.collisionClass==='debris'&&b.collisionClass==='debris')continue;
            const key=a.id<b.id?`${a.id}\u0000${b.id}`:`${b.id}\u0000${a.id}`;
            if(seen.has(key))continue;seen.add(key);
            if(!a.invMass&&!b.invMass)continue;
            accepted.push(b);
          }
          if(accepted.length){
            const hits=native.batch(a,accepted);
            this.rigidBatchStats.calls++;
            this.rigidBatchStats.candidates+=accepted.length;
            this.rigidBatchStats.contacts+=hits.length;
            for(const {b,hit,impulse} of hits)this.contacts.push({
              a:a.id,b:b.id,normal:hit.normal,point:hit.point,
              penetration:hit.penetration,impulse,normalSpeed:hit.approachSpeed,
              normalEnergy:hit.normalEnergy,mode:'resolve',
            });
          }
          continue;
        }
      }
      for(const b of candidates){
        if(a===b||a.collisionClass==='debris'&&b.collisionClass==='debris')continue;
        const key=a.id<b.id?`${a.id}\u0000${b.id}`:`${b.id}\u0000${a.id}`;
        if(seen.has(key))continue;seen.add(key);
        if(!a.invMass&&!b.invMass)continue;
        if(!b.invMass&&isHorizontalStaticSurface(b)&&this.resolveStaticHorizontalSurface(a,b,dt,contactModel))continue;
        // The Rust kernel observes the current pair in the original broadphase
        // order. Material callbacks still decide penetration/fracture in JS.
        // Trace mode uses exactly the original engine collision path.
        const serial=this.rigidContactKernel&&!trace?this.rigidContactKernel:null;
        if(serial){
          this.rigidBatchStats.serialPairs++;
          const hit=serial.test(a,b);
          if(!hit)continue;
          const candidate:ContactCandidate={a,b,...hit};
          const decision=contactModel?.(candidate)??{mode:'resolve' as const};
          if(decision.mode==='penetrate')this.resolvePenetration(candidate,Math.max(0,decision.energyLoss??0));
          else{
            const impulse=serial.resolve(candidate);
            this.pushContact(candidate,impulse,'resolve');
          }
          continue;
        }
        const hit=intersect(a,b);
        if(!hit)continue;
        const candidate=this.contactCandidate(a,b,hit),decision=contactModel?.(candidate)??{mode:'resolve' as const};
        if(decision.mode==='penetrate')this.resolvePenetration(candidate,Math.max(0,decision.energyLoss??0));
        else this.resolvePair(candidate,Math.max(0,decision.energyLoss??0));
      }
    }
    for(const body of this.bodies.values())if(body.invMass&&!body.sleeping&&!body.supportedThisStep)body.sleepTimer=Math.max(0,body.sleepTimer-dt*.35);
    if(trace)for(const [body,state] of before!){
      trace.energy(body.id,'contacts-solver',this.traceContactEnergy?.get(body)??0);
      trace.energyClosure(body.id,energyInitial!.get(body)!,rigidBodyMechanicalEnergyJ(body,this.gravity));
      trace.stateMutation(body.id,wrenchIds!.get(body)??'',state,this.traceState(body),dt);
    }
    this.traceContactEnergy=undefined;trace?.endSubstep();
  }
  private fluidForce(body:RigidBody,fluid:FluidSample|undefined,dt:number):Vec3{
    if(!fluid)return [0,0,0];
    const info=submergedBody(body,fluid.bottomY,fluid.surfaceY);if(info.fraction<=0)return [0,0,0];
    const rho=fluid.densityKgM3,g=Math.hypot(this.gravity[0],this.gravity[1],this.gravity[2]),buoyancyScale=rho*info.volume;
    if(body.enclosedVolumeM3>0&&body.leakAreaM2>0&&body.floodedVolumeM3<body.enclosedVolumeM3&&g>0){
      const head=Math.max(0,fluid.surfaceY-body.position[1]),flow=.62*body.leakAreaM2*Math.sqrt(2*g*head);
      body.floodedVolumeM3=Math.min(body.enclosedVolumeM3,body.floodedVolumeM3+flow*dt*info.fraction);
    }
    const relative:Vec3=[body.velocity[0]-fluid.velocity[0],body.velocity[1]-fluid.velocity[1],body.velocity[2]-fluid.velocity[2]],speed=Math.hypot(...relative),area=projectedFluidArea(body,relative)*info.fraction,dragScale=speed>1e-9?.5*rho*fluid.dragCoefficient*area*speed:0,floodMass=rho*body.floodedVolumeM3;
    return[-this.gravity[0]*buoyancyScale+this.gravity[0]*floodMass-relative[0]*dragScale,-this.gravity[1]*buoyancyScale+this.gravity[1]*floodMass-relative[1]*dragScale,-this.gravity[2]*buoyancyScale+this.gravity[2]*floodMass-relative[2]*dragScale];
  }
  private traceState(body:RigidBody):PhysicsBodyState{return{positionM:[...body.position],rotationRad:[...body.rotation],velocityMps:[...body.velocity],angularVelocityRadps:[...body.angularVelocity]};}

  get stats():PhysicsStats{return{steps:this.steps,substeps:this.substeps,contacts:this.contacts.length,bodies:this.bodies.size,sleeping:[...this.bodies.values()].filter(body=>body.sleeping).length,collisionSurfaceIterations:this.collisionProgram.surfaceIterations};}

  private contactCandidate(a:RigidBody,b:RigidBody,hit:Hit):ContactCandidate{
    const ra=V3.sub(hit.point,a.position),rb=V3.sub(hit.point,b.position);
    const va=V3.add(a.velocity,V3.cross(a.angularVelocity,ra)),vb=V3.add(b.velocity,V3.cross(b.angularVelocity,rb));
    const rv=V3.sub(vb,va),approachSpeed=Math.max(0,-V3.dot(rv,hit.normal));
    const denominator=this.contactDenominator(a,b,ra,rb,hit.normal),effectiveMass=denominator>1e-12?1/denominator:0;
    return{a,b,normal:hit.normal,point:hit.point,penetration:hit.penetration,approachSpeed,effectiveMass,normalEnergy:.5*effectiveMass*approachSpeed*approachSpeed};
  }

  private contactDenominator(a:RigidBody,b:RigidBody,ra:Vec3,rb:Vec3,direction:Vec3):number{
    let value=a.invMass+b.invMass;
    if(a.invMass){const rn=V3.cross(ra,direction);value+=V3.dot(direction,V3.cross(applyInvInertiaWorld(a,rn),ra));}
    if(b.invMass){const rn=V3.cross(rb,direction);value+=V3.dot(direction,V3.cross(applyInvInertiaWorld(b,rn),rb));}
    return value;
  }

  private rebuildIndex():void{
    this.index.clear();this.index.beginBatch();
    for(const body of this.bodies.values()){body.syncSpatial();this.index.add(body,shapeRadius(body.shape));}
    this.index.endBatch();
  }

  private resolveGround(body:RigidBody,dt:number):void{
    // Cheap conservative swept bound: do not build eight rotated corners for
    // objects provably unable to touch this infinite ground plane this substep.
    // Use all three box half-extents (the broadphase XZ shapeRadius is NOT
    // conservative vertically), plus plastic-crush offset and angular motion.
    const radius=body.shape.kind==='sphere'?body.shape.radius:
      Math.hypot(body.shape.half[0],body.shape.half[1],body.shape.half[2])+
        Math.hypot(body.collisionOffsetLocal[0],body.collisionOffsetLocal[1],body.collisionOffsetLocal[2]);
    const w=body.angularVelocity;
    const maxDownward=Math.max(0,-body.velocity[1])+
      (Math.abs(w[0])+Math.abs(w[1])+Math.abs(w[2]))*radius;
    if(body.position[1]-radius-maxDownward*dt>this.ground+.0015)return;
    this.resolveHorizontalSurface(body,this.ground,this.groundMaterial,'ground',dt);
  }

  private resolveStaticHorizontalSurface(body:RigidBody,surface:RigidBody,dt:number,contactModel?:ContactModel):boolean{
    if(surface.shape.kind!=='box')return false;
    const r=groundSupportVector(body),pointX=body.position[0]+r[0],pointZ=body.position[2]+r[2],h=boxHalf(surface),surfaceCenter=boxCenter(surface),margin=.003;
    if(pointX<surfaceCenter[0]-h[0]-margin||pointX>surfaceCenter[0]+h[0]+margin||pointZ<surfaceCenter[2]-h[2]-margin||pointZ>surfaceCenter[2]+h[2]+margin)return false;
    const surfaceY=surfaceCenter[1]+h[1],bottom=body.position[1]+r[1];
    // A finite slab is not an infinite column: approach from below uses narrow phase.
    if(body.position[1]<surface.position[1]-h[1])return false;
    const pointVelocity=V3.add(body.velocity,V3.cross(body.angularVelocity,r));
    if(bottom>surfaceY+.0015&&bottom+Math.min(0,pointVelocity[1])*dt>surfaceY+.0015)return false;
    const contact=this.contactCandidate(body,surface,{normal:[0,-1,0],point:[pointX,surfaceY,pointZ],penetration:Math.max(0,surfaceY-bottom)});
    const decision=contactModel?.(contact)??{mode:'resolve' as const};
    if(decision.mode==='penetrate'){
      this.resolvePenetration(contact,Math.max(0,decision.energyLoss??0));
      return true;
    }
    return this.resolveHorizontalSurface(body,surfaceY,surface.material,surface.id,dt,this.surfaceFrictionAt?.(surface,[pointX,surfaceY,pointZ])??surface.friction,surface.restitution);
  }

  private resolveHorizontalSurface(body:RigidBody,surfaceY:number,surfaceMaterial:PhysicalMaterial,surfaceId:string|'ground',dt:number,surfaceFriction=surfaceMaterial.friction,surfaceRestitution=surfaceMaterial.restitution):boolean{
    const manifold=groundContactManifold(body),lowest=manifold.lowest,slop=.0015,bottom=body.position[1]+lowest;
    let minPointVelocityY=Infinity;
    for(const r of manifold.points){const velocity=V3.add(body.velocity,V3.cross(body.angularVelocity,r));minPointVelocityY=Math.min(minPointVelocityY,velocity[1]);}
    const predictedBottom=bottom+Math.min(0,minPointVelocityY)*dt;
    if(bottom>surfaceY+slop&&predictedBottom>surfaceY+slop)return false;
    body.supportedThisStep=true;
    const penetration=Math.max(0,surfaceY-bottom);if(penetration>0){this.tracePositionCorrection(body,[0,penetration,0],[body.position[0],surfaceY,body.position[2]],'surface',surfaceId);body.position[1]+=penetration;}
    const normal:Vec3=[0,1,0],mu=Math.sqrt(body.friction*surfaceFriction);
    let totalImpulse=0,maxApproach=0,totalEnergy=0;

    // Sequential impulses over the whole edge/face manifold prevent a thin shard
    // from alternating forever between single-corner supports.
    for(let iteration=0;iteration<this.collisionProgram.surfaceIterations;iteration++){
      for(const r of manifold.points){
        const contactVelocity=V3.add(body.velocity,V3.cross(body.angularVelocity,r)),approach=Math.max(0,-contactVelocity[1]);
        maxApproach=Math.max(maxApproach,approach);if(iteration===0)totalEnergy+=.5*body.mass*approach*approach/manifold.points.length;
        if(contactVelocity[1]<0){
          const restitution=iteration===0&&approach>.55?Math.min(body.restitution,surfaceRestitution):0;
          const rn=V3.cross(r,normal),angular=V3.dot(normal,V3.cross(applyInvInertiaWorld(body,rn),r)),denom=body.invMass+angular;
          if(denom>1e-10){const j=-(1+restitution)*contactVelocity[1]/denom;this.applyImpulseAtPoint(body,normal,j,r,'surface',surfaceId);totalImpulse+=Math.max(0,j);}
        }
        const post=V3.add(body.velocity,V3.cross(body.angularVelocity,r)),tangentRaw:Vec3=[post[0],0,post[2]],tangentSpeed=V3.length(tangentRaw);
        if(tangentSpeed>1e-6){
          const tangent=V3.scale(tangentRaw,1/tangentSpeed),rt=V3.cross(r,tangent),angular=V3.dot(tangent,V3.cross(applyInvInertiaWorld(body,rt),r)),denom=body.invMass+angular;
          if(denom>1e-10){
            const share=body.mass*Math.abs(this.gravity[1])*dt/manifold.points.length,supportImpulse=Math.max(share,totalImpulse/Math.max(1,manifold.points.length)),wanted=-tangentSpeed/denom,jt=Math.max(-mu*supportImpulse,Math.min(mu*supportImpulse,wanted));
            this.applyImpulseAtPoint(body,tangent,jt,r,'surface',surfaceId);
          }
        }
      }
    }

    // Contact-patch rolling resistance dissipates the tiny residual tumbling
    // that a finite rigid solver otherwise preserves indefinitely.
    const contactScale=Math.min(1,(body.mass*Math.abs(this.gravity[1])*dt+totalImpulse)/Math.max(.001,body.mass*.1));
    const angularDecay=Math.exp(-(2.4+7.5*mu)*dt*contactScale*Math.sqrt(manifold.points.length)),angularDelta:Vec3=[
      body.angularVelocity[0]*(angularDecay-1),body.angularVelocity[1]*(angularDecay-1),body.angularVelocity[2]*(angularDecay-1),
    ];
    this.traceStateCorrection(body,[0,0,0],angularDelta,'solver.rolling-rest');
    body.angularVelocity[0]+=angularDelta[0];body.angularVelocity[1]+=angularDelta[1];body.angularVelocity[2]+=angularDelta[2];

    const linear=V3.length(body.velocity),angularSpeed=V3.length(body.angularVelocity);
    let residualNormal=0;
    for(const r of manifold.points){const velocity=V3.add(body.velocity,V3.cross(body.angularVelocity,r));residualNormal=Math.max(residualNormal,Math.abs(velocity[1]));}
    if(linear<.075&&angularSpeed<.16&&residualNormal<.055){
      body.sleepTimer+=dt;
      if(body.sleepTimer>.24){
        const dv:Vec3=[-body.velocity[0],-body.velocity[1],-body.velocity[2]],dw:Vec3=[-body.angularVelocity[0],-body.angularVelocity[1],-body.angularVelocity[2]];
        this.traceStateCorrection(body,dv,dw,'solver.sleep-rest');body.velocity=[0,0,0];body.angularVelocity=[0,0,0];body.sleeping=true;
      }
    }else if(!body.sleeping){
      const restingJitter=linear<.22&&angularSpeed<.7&&residualNormal<.22;
      body.sleepTimer=restingJitter?Math.max(0,body.sleepTimer-dt*.2):0;
    }

    const representative=manifold.points[0]??[0,lowest,0];
    this.contacts.push({a:body.id,b:surfaceId,normal,point:[body.position[0]+representative[0],surfaceY,body.position[2]+representative[2]],penetration,impulse:totalImpulse,normalSpeed:maxApproach,normalEnergy:totalEnergy,mode:'resolve'});
    return true;
  }

  private resolvePenetration(contact:ContactCandidate,energyLoss:number):void{
    const {a,b,normal,point,approachSpeed,effectiveMass,normalEnergy}=contact;
    if(approachSpeed<=0||effectiveMass<=0){this.pushContact(contact,0,'penetrate');return;}
    const remaining=Math.max(0,normalEnergy-energyLoss),after=Math.sqrt(2*remaining/effectiveMass);
    const impulse=Math.max(0,(approachSpeed-after)*effectiveMass);
    this.applyPairImpulseAtPoint(a,b,normal,impulse,point);
    this.pushContact(contact,impulse,'penetrate');
  }

  private resolvePair(contact:ContactCandidate,energyLoss=0):void{
    const {a,b,normal,point,penetration,approachSpeed,effectiveMass}=contact,inv=a.invMass+b.invMass;if(inv<=0)return;
    const slop=.0005,correction=Math.max(0,penetration-slop)*.8/inv;
    if(a.invMass){const d:Vec3=[-normal[0]*correction*a.invMass,-normal[1]*correction*a.invMass,-normal[2]*correction*a.invMass];this.tracePositionCorrection(a,d,point,'body',b.id);a.position[0]+=d[0];a.position[1]+=d[1];a.position[2]+=d[2];}
    if(b.invMass){const d:Vec3=[normal[0]*correction*b.invMass,normal[1]*correction*b.invMass,normal[2]*correction*b.invMass];this.tracePositionCorrection(b,d,point,'body',a.id);b.position[0]+=d[0];b.position[1]+=d[1];b.position[2]+=d[2];}
    let impulse=0;
    if(approachSpeed>0&&effectiveMass>0){
      const restitution=Math.min(a.restitution,b.restitution),bounceSpeed=energyLoss>0?Math.sqrt(2*Math.max(0,contact.normalEnergy-energyLoss)/effectiveMass):approachSpeed,j=(approachSpeed+restitution*bounceSpeed)*effectiveMass;impulse=j;
      this.applyPairImpulseAtPoint(a,b,normal,j,point);
      const ra=V3.sub(point,a.position),rb=V3.sub(point,b.position);
      const va=V3.add(a.velocity,V3.cross(a.angularVelocity,ra)),vb=V3.add(b.velocity,V3.cross(b.angularVelocity,rb)),post=V3.sub(vb,va),normalSpeed=V3.dot(post,normal);
      const tangentRaw:Vec3=[post[0]-normal[0]*normalSpeed,post[1]-normal[1]*normalSpeed,post[2]-normal[2]*normalSpeed],length=V3.length(tangentRaw);
      if(length>1e-8){
        const tangent=V3.scale(tangentRaw,1/length),denom=this.contactDenominator(a,b,ra,rb,tangent),limit=j*Math.sqrt(a.friction*b.friction);
        if(denom>1e-12){const wanted=-V3.dot(post,tangent)/denom,jt=Math.max(-limit,Math.min(limit,wanted));this.applyPairImpulseAtPoint(a,b,tangent,jt,point);}
      }
    }
    this.pushContact(contact,impulse,'resolve');
  }

  private addTraceContactEnergy(body:RigidBody,deltaJ:number):void{
    if(!this.traceContactEnergy||!Number.isFinite(deltaJ)||!body.invMass)return;
    this.traceContactEnergy.set(body,(this.traceContactEnergy.get(body)??0)+deltaJ);
  }
  /** Exact kinetic work of a constant force/torque velocity kick at fixed orientation. */
  private forceKickEnergyJ(body:RigidBody,force:Vec3,torque:Vec3,dt:number):number{
    if(!body.invMass)return 0;
    const invTorque=applyInvInertiaWorld(body,torque);
    return V3.dot(force,body.velocity)*dt+.5*V3.dot(force,force)*body.invMass*dt*dt
      +V3.dot(torque,body.angularVelocity)*dt+.5*V3.dot(torque,invTorque)*dt*dt;
  }
  /** Exact kinetic-energy change implied by explicit Δv/Δω at fixed orientation. */
  private stateCorrectionEnergyJ(body:RigidBody,velocityDelta:Vec3,angularDelta:Vec3):number{
    const linear=body.mass*V3.dot(body.velocity,velocityDelta)+.5*body.mass*V3.dot(velocityDelta,velocityDelta);
    const angularMomentum=applyInertiaWorld(body,body.angularVelocity),deltaMomentum=applyInertiaWorld(body,angularDelta);
    return linear+V3.dot(angularMomentum,angularDelta)+.5*V3.dot(deltaMomentum,angularDelta);
  }
  private traceStateCorrection(body:RigidBody,velocityDelta:Vec3,angularDelta:Vec3,sourceId:string):void{
    const trace=this.causeTrace;if(!trace||!body.invMass)return;
    if(Math.hypot(...velocityDelta)+Math.hypot(...angularDelta)<=1e-15)return;
    this.addTraceContactEnergy(body,this.stateCorrectionEnergyJ(body,velocityDelta,angularDelta));
    trace.writer(body.id).contribute(this.contactCauses.get(body.id)!,{kind:'constraint',id:sourceId},{...(Math.hypot(...velocityDelta)>0?{velocityCorrectionMps:velocityDelta}:{}),...(Math.hypot(...angularDelta)>0?{angularVelocityCorrectionRadps:angularDelta}:{})});
  }
  private tracePositionCorrection(body:RigidBody,delta:Vec3,point:Vec3,sourceKind:'surface'|'body',sourceId:string):void{
    const trace=this.causeTrace;if(!trace||!body.invMass)return;
    this.addTraceContactEnergy(body,-body.mass*V3.dot(this.gravity,delta));
    trace.writer(body.id).contribute(this.contactCauses.get(body.id)!,{kind:sourceKind,id:sourceId},{positionCorrectionM:delta,pointWorldM:point});
  }
  private applyImpulseAtPoint(body:RigidBody,direction:Vec3,j:number,r:Vec3,sourceKind:'surface'|'body',sourceId:string):void{
    if(!body.invMass||j===0)return;body.wake();
    const impulse:Vec3=[direction[0]*j,direction[1]*j,direction[2]*j],angularImpulse=V3.cross(r,impulse),dw=applyInvInertiaWorld(body,angularImpulse),point:Vec3=[body.position[0]+r[0],body.position[1]+r[1],body.position[2]+r[2]];
    const trace=this.causeTrace;if(trace){
      const deltaK=V3.dot(impulse,body.velocity)+.5*V3.dot(impulse,impulse)*body.invMass+V3.dot(angularImpulse,body.angularVelocity)+.5*V3.dot(angularImpulse,dw);
      this.addTraceContactEnergy(body,deltaK);
      trace.writer(body.id).contribute(this.contactCauses.get(body.id)!,{kind:sourceKind,id:sourceId},{impulseNs:impulse,pointWorldM:point});
    }
    body.velocity[0]+=impulse[0]*body.invMass;body.velocity[1]+=impulse[1]*body.invMass;body.velocity[2]+=impulse[2]*body.invMass;
    body.angularVelocity[0]+=dw[0];body.angularVelocity[1]+=dw[1];body.angularVelocity[2]+=dw[2];
  }
  private applyPairImpulseAtPoint(a:RigidBody,b:RigidBody,direction:Vec3,j:number,point:Vec3):void{
    if(j===0)return;
    if(a.invMass)this.applyImpulseAtPoint(a,direction,-j,V3.sub(point,a.position),'body',b.id);
    if(b.invMass)this.applyImpulseAtPoint(b,direction,j,V3.sub(point,b.position),'body',a.id);
  }
  private pushContact(contact:ContactCandidate,impulse:number,mode:'resolve'|'penetrate'):void{
    this.contacts.push({a:contact.a.id,b:contact.b.id,normal:contact.normal,point:contact.point,penetration:contact.penetration,impulse,normalSpeed:contact.approachSpeed,normalEnergy:contact.normalEnergy,mode});
  }
}

function isHorizontalStaticSurface(body:RigidBody):boolean{
  if(body.invMass||body.shape.kind!=='box')return false;
  const h=boxHalf(body);
  return Math.abs(body.rotation[0])<1e-5&&Math.abs(body.rotation[2])<1e-5&&h[1]<=Math.max(.25,Math.min(h[0],h[2])*.2);
}
export function shapeRadius(shape:CollisionShape):number{return shape.kind==='sphere'?shape.radius:Math.hypot(shape.half[0],shape.half[2]);}
interface Hit{normal:Vec3;penetration:number;point:Vec3}
function intersect(a:RigidBody,b:RigidBody):Hit|null{
  if(a.shape.kind==='sphere'&&b.shape.kind==='sphere')return sphereSphere(a,b);
  if(a.shape.kind==='box'&&b.shape.kind==='box')return boxBox(a,b);
  return a.shape.kind==='sphere'?sphereBox(a,b,false):sphereBox(b,a,true);
}
function sphereSphere(a:RigidBody,b:RigidBody):Hit|null{
  const d:Vec3=[b.position[0]-a.position[0],b.position[1]-a.position[1],b.position[2]-a.position[2]],distance=V3.length(d),ar=(a.shape as {radius:number}).radius,br=(b.shape as {radius:number}).radius,radius=ar+br;
  if(distance>=radius)return null;const normal:Vec3=distance>1e-8?V3.scale(d,1/distance):[1,0,0];
  return{normal,penetration:radius-distance,point:[a.position[0]+normal[0]*ar,a.position[1]+normal[1]*ar,a.position[2]+normal[2]*ar]};
}
function boxBox(a:RigidBody,b:RigidBody):Hit|null{
  const ah=boxHalf(a),bh=boxHalf(b),ab=rotationBasis(a.rotation),bb=rotationBasis(b.rotation),center=V3.sub(boxCenter(b),boxCenter(a));
  const axes:Vec3[]=[...ab,...bb];
  for(const aa of ab)for(const ba of bb){const cross=V3.cross(aa,ba);if(V3.length(cross)>1e-8)axes.push(V3.normalize(cross));}
  let penetration=Infinity,normal:Vec3=[1,0,0];
  for(const raw of axes){
    const axis=V3.normalize(raw);if(V3.length(axis)<1e-8)continue;
    const ra=projectedRadius(ah,ab,axis),rb=projectedRadius(bh,bb,axis),signed=V3.dot(center,axis),overlap=ra+rb-Math.abs(signed);
    if(overlap<=0)return null;
    if(overlap<penetration){penetration=overlap;normal=signed>=0?axis:V3.scale(axis,-1);}
  }
  const pa=supportPoint(a,normal),pb=supportPoint(b,V3.scale(normal,-1)),point=V3.scale(V3.add(pa,pb),.5);
  return{normal,penetration,point};
}
function sphereBox(sphere:RigidBody,box:RigidBody,invert:boolean):Hit|null{
  const radius=(sphere.shape as {radius:number}).radius,half=boxHalf(box),center=boxCenter(box);
  const local=rotateWorldToLocal(box.rotation,V3.sub(sphere.position,center));
  const closest:MutableVec3=[
    Math.max(-half[0],Math.min(local[0],half[0])),
    Math.max(-half[1],Math.min(local[1],half[1])),
    Math.max(-half[2],Math.min(local[2],half[2])),
  ];
  const worldClosest=V3.add(center,rotateLocal(box.rotation,closest));
  let delta=V3.sub(worldClosest,sphere.position),distance=V3.length(delta),normalSphereToBox:Vec3,penetration:number,point:Vec3=worldClosest;
  if(distance>=radius)return null;
  if(distance<1e-8){
    const gaps=[half[0]-Math.abs(local[0]),half[1]-Math.abs(local[1]),half[2]-Math.abs(local[2])];
    const i=gaps[0]!<=gaps[1]!&&gaps[0]!<=gaps[2]!?0:gaps[1]!<=gaps[2]!?1:2;
    // At the exact mid-plane a thin box has two equally near faces. Use the
    // incoming relative velocity to retain the entry side instead of choosing
    // an arbitrary face that can turn approachSpeed into zero.
    const relativeLocal=rotateWorldToLocal(box.rotation,V3.sub(sphere.velocity,box.velocity));
    const sign=Math.abs(local[i]!)>1e-7?(Math.sign(local[i]!)||1):(-Math.sign(relativeLocal[i]!)||1);
    const outwardLocal:MutableVec3=[0,0,0];outwardLocal[i]=sign;
    const outward=rotateLocal(box.rotation,outwardLocal);normalSphereToBox=V3.scale(outward,-1);penetration=radius+gaps[i]!;
    const faceLocal:MutableVec3=[...local];faceLocal[i]=sign*half[i]!;point=V3.add(center,rotateLocal(box.rotation,faceLocal));
  }else{
    normalSphereToBox=V3.scale(delta,1/distance);penetration=radius-distance;
  }
  return{normal:invert?V3.scale(normalSphereToBox,-1):normalSphereToBox,penetration,point};
}

function boxHalf(body:RigidBody):Vec3{
  if(body.shape.kind!=='box')throw new TypeError('boxHalf requires box body');
  return body.collisionHalf??body.shape.half;
}
function boxCenter(body:RigidBody):MutableVec3{
  return V3.add(body.position,rotateLocal(body.rotation,body.collisionOffsetLocal));
}
function projectedRadius(half:Vec3,basis:readonly[Vec3,Vec3,Vec3],axis:Vec3):number{
  return half[0]*Math.abs(V3.dot(basis[0],axis))+half[1]*Math.abs(V3.dot(basis[1],axis))+half[2]*Math.abs(V3.dot(basis[2],axis));
}
function supportPoint(body:RigidBody,direction:Vec3):MutableVec3{
  if(body.shape.kind==='sphere')return V3.add(body.position,V3.scale(V3.normalize(direction),body.shape.radius));
  const basis=rotationBasis(body.rotation),half=boxHalf(body),point:MutableVec3=[...boxCenter(body)];
  for(let i=0;i<3;i++){const projection=V3.dot(direction,basis[i]!);if(Math.abs(projection)>1e-8){const sign=projection>0?1:-1;point[0]+=basis[i]![0]*half[i]!*sign;point[1]+=basis[i]![1]*half[i]!*sign;point[2]+=basis[i]![2]*half[i]!*sign;}}
  return point;
}

function submergedBody(body:RigidBody,bottomY:number,surfaceY:number):{fraction:number;volume:number}{
  if(surfaceY<=bottomY)return{fraction:0,volume:0};
  if(body.shape.kind==='sphere'){
    const r=body.shape.radius,low=body.position[1]-r,high=body.position[1]+r,from=Math.max(low,bottomY),to=Math.min(high,surfaceY);if(to<=from)return{fraction:0,volume:0};
    // Integrate spherical slices between clamped heights.
    const primitive=(y:number)=>Math.PI*(r*r*y-y*y*y/3),a=from-body.position[1],b=to-body.position[1],volume=primitive(b)-primitive(a),total=4*Math.PI*r*r*r/3;
    return{fraction:Math.max(0,Math.min(1,volume/total)),volume};
  }
  const h=boxHalf(body),basis=rotationBasis(body.rotation),vertical=Math.abs(basis[0][1])*h[0]+Math.abs(basis[1][1])*h[1]+Math.abs(basis[2][1])*h[2],low=body.position[1]-vertical,high=body.position[1]+vertical,overlap=Math.max(0,Math.min(high,surfaceY)-Math.max(low,bottomY)),fraction=vertical>1e-9?Math.min(1,overlap/(2*vertical)):0,total=8*h[0]*h[1]*h[2];
  return{fraction,volume:total*fraction};
}
function projectedFluidArea(body:RigidBody,velocity:Vec3):number{
  const speed=Math.hypot(...velocity);if(speed<1e-9)return 0;if(body.shape.kind==='sphere')return Math.PI*body.shape.radius*body.shape.radius;
  const n:Vec3=[velocity[0]/speed,velocity[1]/speed,velocity[2]/speed],h=boxHalf(body),b=rotationBasis(body.rotation);
  return Math.abs(V3.dot(n,b[0]))*4*h[1]*h[2]+Math.abs(V3.dot(n,b[1]))*4*h[0]*h[2]+Math.abs(V3.dot(n,b[2]))*4*h[0]*h[1];
}
function inverseInertiaLocal(shape:CollisionShape,mass:number):MutableVec3{
  if(!(mass>0))return[0,0,0];
  if(shape.kind==='sphere'){const i=.4*mass*shape.radius*shape.radius,inv=i>1e-12?1/i:0;return[inv,inv,inv];}
  const h=shape.half,ix=mass/3*(h[1]*h[1]+h[2]*h[2]),iy=mass/3*(h[0]*h[0]+h[2]*h[2]),iz=mass/3*(h[0]*h[0]+h[1]*h[1]);
  return[ix>1e-12?1/ix:0,iy>1e-12?1/iy:0,iz>1e-12?1/iz:0];
}
function rotationBasis(rotation:Vec3):readonly[Vec3,Vec3,Vec3]{
  const [rx,ry,rz]=rotation,sx=Math.sin(rx),cx=Math.cos(rx),sy=Math.sin(ry),cy=Math.cos(ry),sz=Math.sin(rz),cz=Math.cos(rz);
  return[
    [cy*cz,sx*sy*cz+cx*sz,-cx*sy*cz+sx*sz],
    [-cy*sz,-sx*sy*sz+cx*cz,cx*sy*sz+sx*cz],
    [sy,-sx*cy,cx*cy],
  ];
}
function rotateLocal(rotation:Vec3,v:Vec3):MutableVec3{const b=rotationBasis(rotation);return[b[0][0]*v[0]+b[1][0]*v[1]+b[2][0]*v[2],b[0][1]*v[0]+b[1][1]*v[1]+b[2][1]*v[2],b[0][2]*v[0]+b[1][2]*v[1]+b[2][2]*v[2]];}
function rotateWorldToLocal(rotation:Vec3,v:Vec3):MutableVec3{const b=rotationBasis(rotation);return[V3.dot(v,b[0]),V3.dot(v,b[1]),V3.dot(v,b[2])];}
export function applyInvInertiaWorld(body:RigidBody,v:Vec3):MutableVec3{const local=rotateWorldToLocal(body.rotation,v),scaled:Vec3=[local[0]*body.invInertiaLocal[0],local[1]*body.invInertiaLocal[1],local[2]*body.invInertiaLocal[2]];return rotateLocal(body.rotation,scaled);}
function applyInertiaWorld(body:RigidBody,v:Vec3):MutableVec3{
  const local=rotateWorldToLocal(body.rotation,v),scaled:Vec3=[
    body.invInertiaLocal[0]>0?local[0]/body.invInertiaLocal[0]:0,
    body.invInertiaLocal[1]>0?local[1]/body.invInertiaLocal[1]:0,
    body.invInertiaLocal[2]>0?local[2]/body.invInertiaLocal[2]:0,
  ];return rotateLocal(body.rotation,scaled);
}
function groundSupportVector(body:RigidBody):MutableVec3{return groundContactManifold(body).points[0]??[0,groundContactManifold(body).lowest,0];}
function groundContactManifold(body:RigidBody):{lowest:number;points:MutableVec3[]}{
  if(body.shape.kind==='sphere')return{lowest:-body.shape.radius,points:[[0,-body.shape.radius,0]]};
  const h=boxHalf(body),basis=rotationBasis(body.rotation);
  // A rigid body's orientation is constant for the contact manifold. The old
  // loop rebuilt this trigonometric basis nine times per ground contact.
  // Preserve the exact scalar arithmetic/order used by rotateLocal.
  const rotate=(v:Vec3):MutableVec3=>[
    basis[0][0]*v[0]+basis[1][0]*v[1]+basis[2][0]*v[2],
    basis[0][1]*v[0]+basis[1][1]*v[1]+basis[2][1]*v[2],
    basis[0][2]*v[0]+basis[1][2]*v[1]+basis[2][2]*v[2],
  ];
  const offset=rotate(body.collisionOffsetLocal),corners:MutableVec3[]=[];
  for(const x of [-h[0],h[0]])for(const y of [-h[1],h[1]])for(const z of [-h[2],h[2]])corners.push(V3.add(offset,rotate([x,y,z])));
  let lowest=Infinity;for(const corner of corners)lowest=Math.min(lowest,corner[1]);
  const minHalf=Math.min(h[0],h[1],h[2]),band=Math.max(.0018,minHalf*.42);
  const points=corners.filter(corner=>corner[1]<=lowest+band).sort((a,b)=>a[1]-b[1]||a[0]-b[0]||a[2]-b[2]);
  return{lowest,points};
}
