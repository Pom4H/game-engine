import type {MechanicalMaterial} from '../materials/catalog.js';
import type {MutableVec3,Vec3} from '../math.js';
import {V3} from '../math.js';

export interface StructuralNodeSpec {
  readonly position:Vec3;
  readonly mass:number;
}

export interface StructuralDistanceSpec {
  readonly kind:'distance';
  readonly a:number;
  readonly b:number;
  /** Effective load-bearing section. Used to derive EA/L compliance and yield force. */
  readonly areaM2:number;
  readonly material:MechanicalMaterial;
}

export interface StructuralVolumeSpec {
  readonly kind:'volume';
  readonly a:number;
  readonly b:number;
  readonly c:number;
  readonly d:number;
  /** XPBD compliance for the tetrahedral volume constraint. Zero is effectively incompressible. */
  readonly compliance:number;
  /** Relative volume change where permanent set begins. */
  readonly yieldRatio:number;
  /** Relative volume change where the element fails. */
  readonly breakRatio:number;
  /** Fraction of over-yield volume retained as permanent set. */
  readonly plasticity:number;
}

export type StructuralConstraintSpec=StructuralDistanceSpec|StructuralVolumeSpec;

export interface StructuralDefinition {
  readonly nodes:readonly StructuralNodeSpec[];
  readonly constraints:readonly StructuralConstraintSpec[];
  /** Optional closed/coarse collision surface over the same mass nodes. */
  readonly collisionTriangles?:readonly (readonly [number,number,number])[];
  readonly iterations?:number;
  /** Speed below which an active structure may be baked back into a sleeping reduced state. */
  readonly sleepSpeed?:number;
  /** Continuous quiet time required before automatic bake. */
  readonly sleepDelay?:number;
  /** Axial internal damping rate in 1/s. Pair impulses preserve rigid translation and angular momentum. */
  readonly internalDamping?:number;
}

/** Canonical reduced projection of a structure.
 * Rigid/reduced and nodal representations exchange exactly this state. */
export interface StructureProjection {
  readonly mass:number;
  readonly centerOfMass:Vec3;
  readonly linearVelocity:Vec3;
  readonly angularVelocity:Vec3;
}

export interface BakedStructuralState extends StructureProjection {
  readonly positions:Float64Array;
  readonly broken:Uint8Array;
  readonly plasticWorkJ:number;
  /** Mass centre used to hand the sleeping shape back to a reduced rigid body. */
  readonly centerOfMass:Vec3;
  readonly linearVelocity:Vec3;
  readonly angularVelocity:Vec3;
}

export interface StructuralImpulsePulse {
  readonly point:Vec3;
  readonly impulse:Vec3;
  readonly radius?:number;
  /** Contact/load duration. BeamNG-like crumple must evolve over physical time, not one tick. */
  readonly durationSeconds:number;
}

export interface StructuralStats {
  readonly mode:'active'|'dormant';
  readonly nodes:number;
  readonly constraints:number;
  readonly broken:number;
  readonly plasticWorkJ:number;
  readonly steps:number;
}

type ConstraintKind=0|1;
const DISTANCE:ConstraintKind=0;
const VOLUME:ConstraintKind=1;
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));

/**
 * SoA XPBD structural core.
 *
 * It deliberately owns the nodal mass while active. A caller can transfer a rigid
 * velocity field into the nodes with activateFromRigid(), solve structural motion,
 * then bake the permanent rest state and return to a reduced rigid representation.
 *
 * Plasticity is evaluated once per physical step from the unconstrained predicted
 * strain, never once per solver iteration. That keeps permanent set independent
 * from the chosen convergence iteration count.
 */
export class StructuralBody {
  readonly position:Float64Array;
  readonly previous:Float64Array;
  readonly velocity:Float64Array;
  readonly force:Float64Array;
  readonly mass:Float64Array;
  readonly inverseMass:Float64Array;
  readonly originalPosition:Float64Array;

  private readonly kind:Uint8Array;
  private readonly ia:Uint16Array;
  private readonly ib:Uint16Array;
  private readonly ic:Uint16Array;
  private readonly id:Uint16Array;
  private readonly originalRest:Float64Array;
  private readonly rest:Float64Array;
  private readonly compliance:Float64Array;
  private readonly yieldLimit:Float64Array;
  private readonly breakLimit:Float64Array;
  private readonly plasticity:Float64Array;
  private readonly yieldForce:Float64Array;
  private readonly lambda:Float64Array;
  private readonly predictedMeasure:Float64Array;
  private readonly impulseWeights:Float64Array;
  private readonly impulsePulses:{point:Vec3;remaining:MutableVec3;radius:number;remainingSeconds:number}[]=[];
  readonly broken:Uint8Array;

  readonly totalMass:number;
  readonly iterations:number;
  readonly sleepSpeed:number;
  readonly sleepDelay:number;
  readonly internalDamping:number;

  mode:'active'|'dormant'='dormant';
  plasticWorkJ=0;
  steps=0;
  private quietTime=0;
  private dt=0;
  private thermalScaleValue=1;
  private pendingBake:BakedStructuralState|undefined;

  constructor(readonly definition:StructuralDefinition){
    const nodeCount=definition.nodes.length, constraintCount=definition.constraints.length;
    if(nodeCount<2||nodeCount>2048)throw new RangeError('Structural body requires 2..2048 nodes');
    if(constraintCount<1||constraintCount>16384)throw new RangeError('Structural body requires 1..16384 constraints');
    this.iterations=Math.max(1,Math.min(32,Math.floor(definition.iterations??8)));
    this.sleepSpeed=clamp(definition.sleepSpeed??.035,.001,2);
    this.sleepDelay=clamp(definition.sleepDelay??.22,.01,10);
    this.internalDamping=clamp(definition.internalDamping??8,0,200);

    this.position=new Float64Array(nodeCount*3);
    this.previous=new Float64Array(nodeCount*3);
    this.velocity=new Float64Array(nodeCount*3);
    this.force=new Float64Array(nodeCount*3);
    this.mass=new Float64Array(nodeCount);
    this.inverseMass=new Float64Array(nodeCount);
    this.originalPosition=new Float64Array(nodeCount*3);

    let total=0;
    for(let i=0;i<nodeCount;i++){
      const node=definition.nodes[i]!;
      if(!node.position.every(Number.isFinite)||!Number.isFinite(node.mass)||node.mass<=0)throw new RangeError('Invalid structural node');
      this.position.set(node.position,i*3);
      this.previous.set(node.position,i*3);
      this.originalPosition.set(node.position,i*3);
      this.mass[i]=node.mass;
      this.inverseMass[i]=1/node.mass;
      total+=node.mass;
    }
    this.totalMass=total;

    this.kind=new Uint8Array(constraintCount);
    this.ia=new Uint16Array(constraintCount);
    this.ib=new Uint16Array(constraintCount);
    this.ic=new Uint16Array(constraintCount);
    this.id=new Uint16Array(constraintCount);
    this.originalRest=new Float64Array(constraintCount);
    this.rest=new Float64Array(constraintCount);
    this.compliance=new Float64Array(constraintCount);
    this.yieldLimit=new Float64Array(constraintCount);
    this.breakLimit=new Float64Array(constraintCount);
    this.plasticity=new Float64Array(constraintCount);
    this.yieldForce=new Float64Array(constraintCount);
    this.lambda=new Float64Array(constraintCount);
    this.predictedMeasure=new Float64Array(constraintCount);
    this.impulseWeights=new Float64Array(nodeCount);
    this.broken=new Uint8Array(constraintCount);

    for(let i=0;i<constraintCount;i++){
      const constraint=definition.constraints[i]!;
      if(constraint.kind==='distance'){
        this.kind[i]=DISTANCE;
        this.validateIndex(constraint.a,nodeCount);this.validateIndex(constraint.b,nodeCount);
        if(constraint.a===constraint.b)throw new RangeError('Distance constraint endpoints must differ');
        if(!Number.isFinite(constraint.areaM2)||constraint.areaM2<=0)throw new RangeError('Distance constraint area must be positive');
        const a=constraint.a*3,b=constraint.b*3;
        const length=Math.hypot(
          this.position[b]!-this.position[a]!,
          this.position[b+1]!-this.position[a+1]!,
          this.position[b+2]!-this.position[a+2]!,
        );
        if(length<1e-6)throw new RangeError('Distance constraint cannot have zero rest length');
        const mechanical=constraint.material;
        if(!(mechanical.youngModulusPa>0)||!(mechanical.yieldStressPa>=0)||!(mechanical.failureStrain>0))throw new RangeError('Invalid mechanical material');
        this.ia[i]=constraint.a;this.ib[i]=constraint.b;
        this.originalRest[i]=this.rest[i]=length;
        const axialStiffness=mechanical.youngModulusPa*constraint.areaM2/length;
        this.compliance[i]=1/Math.max(1e-12,axialStiffness);
        this.yieldLimit[i]=mechanical.yieldStressPa/mechanical.youngModulusPa;
        this.breakLimit[i]=Math.max(this.yieldLimit[i]!,mechanical.failureStrain);
        this.plasticity[i]=clamp(mechanical.plasticity,0,1);
        this.yieldForce[i]=mechanical.yieldStressPa*constraint.areaM2;
      }else{
        this.kind[i]=VOLUME;
        const ids=[constraint.a,constraint.b,constraint.c,constraint.d];
        for(const index of ids)this.validateIndex(index,nodeCount);
        if(new Set(ids).size!==4)throw new RangeError('Volume constraint requires four distinct nodes');
        if(!Number.isFinite(constraint.compliance)||constraint.compliance<0)throw new RangeError('Invalid volume compliance');
        if(!Number.isFinite(constraint.yieldRatio)||constraint.yieldRatio<0)throw new RangeError('Invalid volume yield ratio');
        if(!Number.isFinite(constraint.breakRatio)||constraint.breakRatio<=constraint.yieldRatio)throw new RangeError('Invalid volume break ratio');
        this.ia[i]=constraint.a;this.ib[i]=constraint.b;this.ic[i]=constraint.c;this.id[i]=constraint.d;
        const volume=this.tetraVolume(constraint.a,constraint.b,constraint.c,constraint.d);
        if(Math.abs(volume)<1e-9)throw new RangeError('Volume constraint cannot start degenerate');
        this.originalRest[i]=this.rest[i]=volume;
        this.compliance[i]=constraint.compliance;
        this.yieldLimit[i]=constraint.yieldRatio;
        this.breakLimit[i]=constraint.breakRatio;
        this.plasticity[i]=clamp(constraint.plasticity,0,1);
        this.yieldForce[i]=0;
      }
    }
  }

  get nodeCount():number{return this.mass.length;}
  get constraintCount():number{return this.kind.length;}
  get thermalScale():number{return this.thermalScaleValue;}

  /**
   * Set uniform free thermal expansion/contraction relative to the material reference shape.
   * A dormant body is repositioned stress-free around its COM; an active body keeps its
   * instantaneous geometry and feels the changed rest lengths through the constraints.
   */
  setThermalScale(scale:number):void{
    if(!Number.isFinite(scale)||scale<.97||scale>1.03)throw new RangeError('Structural thermal scale must be within 0.97..1.03');
    const prior=this.thermalScaleValue;if(Math.abs(scale-prior)<1e-12)return;
    const wasDormant=this.mode==='dormant';
    if(wasDormant){
      const center=this.centerOfMass(),ratio=scale/prior;
      for(let i=0;i<this.nodeCount;i++){
        const j=i*3;
        for(let axis=0;axis<3;axis++){
          const k=j+axis;
          const centerAxis=center[axis]!;
          this.position[k]=centerAxis+(this.position[k]!-centerAxis)*ratio;
          this.previous[k]=centerAxis+(this.previous[k]!-centerAxis)*ratio;
        }
      }
    }
    this.thermalScaleValue=scale;
    if(!wasDormant)this.wake();
  }

  /** Reposition a dormant structural shape without introducing velocity. */
  translate(offset:Vec3):void{
    if(this.mode!=='dormant')throw new Error('Only a dormant structural body can be translated');
    if(!offset.every(Number.isFinite))throw new TypeError('Structural translation must be finite');
    for(let i=0;i<this.nodeCount;i++){
      const j=i*3;
      for(let axis=0;axis<3;axis++){
        const k=j+axis,value=offset[axis]!;
        this.position[k]=this.position[k]!+value;
        this.previous[k]=this.previous[k]!+value;
        this.originalPosition[k]=this.originalPosition[k]!+value;
      }
    }
  }

  centerOfMass():MutableVec3{
    const center:MutableVec3=[0,0,0];
    for(let i=0;i<this.nodeCount;i++){
      const j=i*3,m=this.mass[i]!;
      center[0]+=m*this.position[j]!;center[1]+=m*this.position[j+1]!;center[2]+=m*this.position[j+2]!;
    }
    center[0]/=this.totalMass;center[1]/=this.totalMass;center[2]/=this.totalMass;
    return center;
  }

  wake():void{this.mode='active';this.quietTime=0;this.pendingBake=undefined;}

  /**
   * Transfer a reduced rigid state into the nodal mass exactly once.
   * centerOfMass and linearVelocity must describe the same rigid COM state.
   * Every node receives vCOM + omega x r, so no second hidden rigid mass is created.
   */
  activateFromRigid(centerOfMass:Vec3,linearVelocity:Vec3,angularVelocity:Vec3):void{
    if(!centerOfMass.every(Number.isFinite)||!linearVelocity.every(Number.isFinite)||!angularVelocity.every(Number.isFinite))throw new TypeError('Rigid activation vectors must be finite');
    for(let i=0;i<this.nodeCount;i++){
      const j=i*3,r:Vec3=[this.position[j]!-centerOfMass[0],this.position[j+1]!-centerOfMass[1],this.position[j+2]!-centerOfMass[2]];
      const spin=V3.cross(angularVelocity,r);
      this.velocity[j]=linearVelocity[0]+spin[0];
      this.velocity[j+1]=linearVelocity[1]+spin[1];
      this.velocity[j+2]=linearVelocity[2]+spin[2];
    }
    this.wake();
  }

  addForce(node:number,force:Vec3):void{
    this.validateIndex(node,this.nodeCount);
    if(!force.every(Number.isFinite))throw new TypeError('Structural force must be finite');
    const j=node*3;this.force[j]=this.force[j]!+force[0];this.force[j+1]=this.force[j+1]!+force[1];this.force[j+2]=this.force[j+2]!+force[2];this.wake();
  }

  /**
   * Distribute an impulse over nearby nodes while preserving total linear impulse.
   * This is the bridge a contact manifold uses when an inactive region refines.
   */
  applyImpulse(point:Vec3,impulse:Vec3,radius=.45):void{
    this.applyImpulseNow(point,impulse,radius);
    this.wake();
  }

  /** Apply one contact impulse over finite physical time.
   * The total impulse is conserved exactly; only its temporal delivery changes. */
  scheduleImpulse(pulse:StructuralImpulsePulse):void{
    if(!pulse.point.every(Number.isFinite)||!pulse.impulse.every(Number.isFinite)||!Number.isFinite(pulse.durationSeconds)||pulse.durationSeconds<=0||pulse.durationSeconds>.5)throw new TypeError('Invalid structural impulse pulse');
    const radius=pulse.radius??.45;
    if(!Number.isFinite(radius)||radius<=0)throw new TypeError('Invalid structural impulse radius');
    this.impulsePulses.push({
      point:Object.freeze([...pulse.point]) as Vec3,
      remaining:[...pulse.impulse],
      radius,
      remainingSeconds:pulse.durationSeconds,
    });
    this.wake();
  }

  get pendingImpulsePulses():number{return this.impulsePulses.length;}

  private applyImpulseNow(point:Vec3,impulse:Vec3,radius:number):void{
    if(!point.every(Number.isFinite)||!impulse.every(Number.isFinite)||!Number.isFinite(radius)||radius<=0)throw new TypeError('Invalid structural impulse');
    const weights=this.impulseWeights;weights.fill(0);let sum=0,nearest=0,nearestD=Infinity;
    for(let i=0;i<this.nodeCount;i++){
      const j=i*3,d=Math.hypot(this.position[j]!-point[0],this.position[j+1]!-point[1],this.position[j+2]!-point[2]);
      if(d<nearestD){nearestD=d;nearest=i;}
      const q=d/radius,w=q<1?(1-q*q)**2:0;weights[i]=w;sum+=w;
    }
    if(sum<=1e-12){weights[nearest]=1;sum=1;}
    for(let i=0;i<this.nodeCount;i++){
      const w=weights[i]!/sum;if(w<=0)continue;
      const j=i*3,s=w*this.inverseMass[i]!;
      this.velocity[j]=this.velocity[j]!+impulse[0]*s;this.velocity[j+1]=this.velocity[j+1]!+impulse[1]*s;this.velocity[j+2]=this.velocity[j+2]!+impulse[2]*s;
    }
  }

  step(dt:number,gravity:Vec3=[0,-9.81,0],contactProjector?:(body:StructuralBody,iteration:number)=>void):void{
    if(this.mode==='dormant')return;
    if(!Number.isFinite(dt)||dt<=0||dt>1/30)throw new RangeError('Structural dt must be in (0, 1/30]');
    if(!gravity.every(Number.isFinite))throw new TypeError('Structural gravity must be finite');
    this.applyScheduledImpulses(dt);
    this.dt=dt;
    this.previous.set(this.position);

    for(let i=0;i<this.nodeCount;i++){
      const j=i*3,inv=this.inverseMass[i]!;
      this.velocity[j]=this.velocity[j]!+dt*(gravity[0]+this.force[j]!*inv);
      this.velocity[j+1]=this.velocity[j+1]!+dt*(gravity[1]+this.force[j+1]!*inv);
      this.velocity[j+2]=this.velocity[j+2]!+dt*(gravity[2]+this.force[j+2]!*inv);
      this.position[j]=this.position[j]!+dt*this.velocity[j]!;
      this.position[j+1]=this.position[j+1]!+dt*this.velocity[j+1]!;
      this.position[j+2]=this.position[j+2]!+dt*this.velocity[j+2]!;
      this.force[j]=this.force[j+1]=this.force[j+2]=0;
    }

    // Project hard contacts once before strain sampling. This exposes the actual
    // collision-induced trial strain to plastic return mapping exactly once per dt.
    contactProjector?.(this,-1);
    this.prepareConstraints();
    for(let iteration=0;iteration<this.iterations;iteration++){
      this.solveConstraints();
      contactProjector?.(this,iteration);
    }
    this.finishStep();
  }

  /**
   * Freeze the current permanent shape as the new reduced rest state.
   * Elastic energy is intentionally discarded only at this explicit LOD boundary.
   */
  bake():BakedStructuralState{
    const rigid=this.projectReduced();
    for(let i=0;i<this.constraintCount;i++){
      if(this.broken[i])continue;
      const thermalPower=this.kind[i]===DISTANCE?this.thermalScaleValue:this.thermalScaleValue**3;
      this.rest[i]=this.measure(i)/thermalPower;
      this.originalRest[i]=this.rest[i]!;
      this.lambda[i]=0;
    }
    this.previous.set(this.position);
    this.velocity.fill(0);this.force.fill(0);this.quietTime=0;this.mode='dormant';
    const baked=Object.freeze({
      positions:new Float64Array(this.position),
      broken:new Uint8Array(this.broken),
      plasticWorkJ:this.plasticWorkJ,
      mass:rigid.mass,
      centerOfMass:Object.freeze([...rigid.centerOfMass]) as Vec3,
      linearVelocity:Object.freeze([...rigid.linearVelocity]) as Vec3,
      angularVelocity:Object.freeze([...rigid.angularVelocity]) as Vec3,
    });
    this.pendingBake=baked;
    return baked;
  }

  /** Auto-bake stores the rigid handoff until the owning LOD manager consumes it. */
  takeBakedState():BakedStructuralState|undefined{
    const value=this.pendingBake;this.pendingBake=undefined;return value;
  }

  deformationOffsets():Float64Array{
    const out=new Float64Array(this.position.length);
    for(let i=0;i<out.length;i++)out[i]=this.position[i]!-this.originalPosition[i]!;
    return out;
  }

  /** Project the current nodal representation onto the conserved rigid state.
   * This is the only structural -> reduced kinematic handoff contract. */
  projectReduced():StructureProjection{
    const rigid=this.rigidState();
    return Object.freeze({
      mass:this.totalMass,
      centerOfMass:Object.freeze([...rigid.centerOfMass]) as Vec3,
      linearVelocity:Object.freeze([...rigid.linearVelocity]) as Vec3,
      angularVelocity:Object.freeze([...rigid.angularVelocity]) as Vec3,
    });
  }

  linearMomentum():MutableVec3{
    const out:MutableVec3=[0,0,0];
    for(let i=0;i<this.nodeCount;i++){
      const j=i*3,m=this.mass[i]!;
      out[0]+=m*this.velocity[j]!;out[1]+=m*this.velocity[j+1]!;out[2]+=m*this.velocity[j+2]!;
    }
    return out;
  }

  kineticEnergy():number{
    let value=0;
    for(let i=0;i<this.nodeCount;i++){
      const j=i*3,m=this.mass[i]!;
      value+=.5*m*(this.velocity[j]!**2+this.velocity[j+1]!**2+this.velocity[j+2]!**2);
    }
    return value;
  }

  get stats():StructuralStats{
    let broken=0;for(const value of this.broken)broken+=value?1:0;
    return{mode:this.mode,nodes:this.nodeCount,constraints:this.constraintCount,broken,plasticWorkJ:this.plasticWorkJ,steps:this.steps};
  }

  private applyScheduledImpulses(dt:number):void{
    for(let i=this.impulsePulses.length-1;i>=0;i--){
      const pulse=this.impulsePulses[i]!;
      const fraction=Math.min(1,dt/pulse.remainingSeconds);
      const delivered:Vec3=[
        pulse.remaining[0]*fraction,
        pulse.remaining[1]*fraction,
        pulse.remaining[2]*fraction,
      ];
      this.applyImpulseNow(pulse.point,delivered,pulse.radius);
      pulse.remaining[0]-=delivered[0];pulse.remaining[1]-=delivered[1];pulse.remaining[2]-=delivered[2];
      pulse.remainingSeconds-=dt;
      if(pulse.remainingSeconds<=1e-9||V3.length(pulse.remaining)<1e-12)this.impulsePulses.splice(i,1);
    }
  }

  private validateIndex(index:number,count:number):void{
    if(!Number.isInteger(index)||index<0||index>=count)throw new RangeError('Structural node index out of range');
  }

  private prepareConstraints():void{
    this.lambda.fill(0);
    for(let i=0;i<this.constraintCount;i++)if(!this.broken[i])this.predictedMeasure[i]=this.measure(i);
  }

  private solveConstraints():void{
    for(let i=0;i<this.constraintCount;i++){
      if(this.broken[i])continue;
      if(this.kind[i]===DISTANCE)this.solveDistance(i);else this.solveVolume(i);
    }
  }

  private solveDistance(index:number):void{
    const a=this.ia[index]!,b=this.ib[index]!,A=a*3,B=b*3;
    const dx=this.position[B]!-this.position[A]!,dy=this.position[B+1]!-this.position[A+1]!,dz=this.position[B+2]!-this.position[A+2]!;
    const length=Math.hypot(dx,dy,dz);if(length<1e-10)return;
    const nx=dx/length,ny=dy/length,nz=dz/length,C=length-this.rest[index]!*this.thermalScaleValue;
    const alpha=this.compliance[index]!/(this.dt*this.dt),denom=this.inverseMass[a]!+this.inverseMass[b]!+alpha;
    if(denom<=1e-14)return;
    const dl=(-C-alpha*this.lambda[index]!)/denom;this.lambda[index]=this.lambda[index]!+dl;
    const wa=this.inverseMass[a]!*dl,wb=this.inverseMass[b]!*dl;
    this.position[A]=this.position[A]!-nx*wa;this.position[A+1]=this.position[A+1]!-ny*wa;this.position[A+2]=this.position[A+2]!-nz*wa;
    this.position[B]=this.position[B]!+nx*wb;this.position[B+1]=this.position[B+1]!+ny*wb;this.position[B+2]=this.position[B+2]!+nz*wb;
  }

  private solveVolume(index:number):void{
    const a=this.ia[index]!,b=this.ib[index]!,c=this.ic[index]!,d=this.id[index]!;
    const A=this.point(a),B=this.point(b),C=this.point(c),D=this.point(d);
    const gb=V3.scale(V3.cross(V3.sub(C,A),V3.sub(D,A)),1/6);
    const gc=V3.scale(V3.cross(V3.sub(D,A),V3.sub(B,A)),1/6);
    const gd=V3.scale(V3.cross(V3.sub(B,A),V3.sub(C,A)),1/6);
    const ga:MutableVec3=[-gb[0]-gc[0]-gd[0],-gb[1]-gc[1]-gd[1],-gb[2]-gc[2]-gd[2]];
    const current=V3.dot(V3.sub(B,A),V3.cross(V3.sub(C,A),V3.sub(D,A)))/6,Cv=current-this.rest[index]!*this.thermalScaleValue**3;
    const alpha=this.compliance[index]!/(this.dt*this.dt);
    const denom=this.inverseMass[a]!*V3.dot(ga,ga)+this.inverseMass[b]!*V3.dot(gb,gb)+this.inverseMass[c]!*V3.dot(gc,gc)+this.inverseMass[d]!*V3.dot(gd,gd)+alpha;
    if(denom<=1e-14)return;
    const dl=(-Cv-alpha*this.lambda[index]!)/denom;this.lambda[index]=this.lambda[index]!+dl;
    this.applyGradient(a,ga,dl);this.applyGradient(b,gb,dl);this.applyGradient(c,gc,dl);this.applyGradient(d,gd,dl);
  }

  private applyGradient(node:number,gradient:Vec3,lambda:number):void{
    const j=node*3,s=this.inverseMass[node]!*lambda;
    this.position[j]=this.position[j]!+gradient[0]*s;this.position[j+1]=this.position[j+1]!+gradient[1]*s;this.position[j+2]=this.position[j+2]!+gradient[2]*s;
  }

  private finishStep():void{
    const invDt=1/this.dt;
    for(let i=0;i<this.nodeCount;i++){
      const j=i*3;
      this.velocity[j]=(this.position[j]!-this.previous[j]!)*invDt;
      this.velocity[j+1]=(this.position[j+1]!-this.previous[j+1]!)*invDt;
      this.velocity[j+2]=(this.position[j+2]!-this.previous[j+2]!)*invDt;
    }

    for(let i=0;i<this.constraintCount;i++){
      if(this.broken[i])continue;
      const original=this.originalRest[i]!,trial=this.predictedMeasure[i]!,rest=this.rest[i]!;
      const thermalPower=this.kind[i]===DISTANCE?this.thermalScaleValue:this.thermalScaleValue**3;
      const effectiveOriginal=original*thermalPower,effectiveRest=rest*thermalPower;
      if(this.kind[i]===DISTANCE){
        const trialStrain=(trial-effectiveRest)/Math.max(1e-9,Math.abs(effectiveOriginal));
        const originalStrain=(trial-effectiveOriginal)/Math.max(1e-9,Math.abs(effectiveOriginal));
        if(Math.abs(originalStrain)>this.breakLimit[i]!){this.broken[i]=1;continue;}
        const yieldStrain=this.yieldLimit[i]!;
        if(Math.abs(trialStrain)>yieldStrain&&this.plasticity[i]!>0){
          const elastic=Math.sign(trialStrain)*yieldStrain*Math.abs(effectiveOriginal);
          const targetEffective=trial-elastic,targetBase=targetEffective/thermalPower,delta=(targetBase-rest)*this.plasticity[i]!;
          if(Math.abs(delta)>1e-12){
            this.rest[i]=Math.max(Math.abs(original)*.04,rest+delta);
            this.plasticWorkJ+=Math.abs(delta*thermalPower)*this.yieldForce[i]!;
          }
        }
      }else{
        const ratio=(trial-effectiveRest)/Math.max(1e-12,Math.abs(effectiveOriginal));
        const originalRatio=(trial-effectiveOriginal)/Math.max(1e-12,Math.abs(effectiveOriginal));
        if(Math.abs(originalRatio)>this.breakLimit[i]!){this.broken[i]=1;continue;}
        const yieldRatio=this.yieldLimit[i]!;
        if(Math.abs(ratio)>yieldRatio&&this.plasticity[i]!>0){
          const elastic=Math.sign(ratio)*yieldRatio*Math.abs(effectiveOriginal);
          const targetEffective=trial-elastic,targetBase=targetEffective/thermalPower,delta=(targetBase-rest)*this.plasticity[i]!;
          if(Math.abs(delta)>1e-15)this.rest[i]=rest+delta;
        }
      }
    }

    this.dampInternalVelocities();
    const internalSpeed=this.internalSpeed();
    this.steps++;
    if(internalSpeed<this.sleepSpeed)this.quietTime+=this.dt;else this.quietTime=0;
    if(this.quietTime>=this.sleepDelay)this.bake();
  }

  private dampInternalVelocities():void{
    if(this.internalDamping<=0)return;
    const gain=1-Math.exp(-this.internalDamping*this.dt);
    for(let i=0;i<this.constraintCount;i++){
      if(this.broken[i]||this.kind[i]!==DISTANCE)continue;
      const a=this.ia[i]!,b=this.ib[i]!,A=a*3,B=b*3;
      const dx=this.position[B]!-this.position[A]!,dy=this.position[B+1]!-this.position[A+1]!,dz=this.position[B+2]!-this.position[A+2]!;
      const length=Math.hypot(dx,dy,dz);if(length<1e-10)continue;
      const nx=dx/length,ny=dy/length,nz=dz/length;
      const relative=(this.velocity[B]!-this.velocity[A]!)*nx+(this.velocity[B+1]!-this.velocity[A+1]!)*ny+(this.velocity[B+2]!-this.velocity[A+2]!)*nz;
      const denom=this.inverseMass[a]!+this.inverseMass[b]!;if(denom<=1e-14)continue;
      const impulse=-relative*gain/denom,ia=this.inverseMass[a]!*impulse,ib=this.inverseMass[b]!*impulse;
      this.velocity[A]=this.velocity[A]!-nx*ia;this.velocity[A+1]=this.velocity[A+1]!-ny*ia;this.velocity[A+2]=this.velocity[A+2]!-nz*ia;
      this.velocity[B]=this.velocity[B]!+nx*ib;this.velocity[B+1]=this.velocity[B+1]!+ny*ib;this.velocity[B+2]=this.velocity[B+2]!+nz*ib;
    }
  }

  /** Internal strain-rate proxy invariant to whole-body translation and rigid rotation. */
  private internalSpeed():number{
    let peak=0;
    for(let i=0;i<this.constraintCount;i++){
      if(this.broken[i])continue;
      if(this.kind[i]===DISTANCE){
        const a=this.ia[i]!,b=this.ib[i]!,A=a*3,B=b*3;
        const dx=this.position[B]!-this.position[A]!,dy=this.position[B+1]!-this.position[A+1]!,dz=this.position[B+2]!-this.position[A+2]!;
        const length=Math.hypot(dx,dy,dz);if(length<1e-10)continue;
        const relative=((this.velocity[B]!-this.velocity[A]!)*dx+(this.velocity[B+1]!-this.velocity[A+1]!)*dy+(this.velocity[B+2]!-this.velocity[A+2]!)*dz)/length;
        peak=Math.max(peak,Math.abs(relative));
      }else{
        const a=this.ia[i]!,b=this.ib[i]!,c=this.ic[i]!,d=this.id[i]!,A=this.point(a),B=this.point(b),C=this.point(c),D=this.point(d);
        const gb=V3.scale(V3.cross(V3.sub(C,A),V3.sub(D,A)),1/6);
        const gc=V3.scale(V3.cross(V3.sub(D,A),V3.sub(B,A)),1/6);
        const gd=V3.scale(V3.cross(V3.sub(B,A),V3.sub(C,A)),1/6);
        const ga:MutableVec3=[-gb[0]-gc[0]-gd[0],-gb[1]-gc[1]-gd[1],-gb[2]-gc[2]-gd[2]];
        const rate=V3.dot(ga,this.velocityPoint(a))+V3.dot(gb,this.velocityPoint(b))+V3.dot(gc,this.velocityPoint(c))+V3.dot(gd,this.velocityPoint(d));
        const area=Math.max(1e-9,Math.abs(this.rest[i]!)**(2/3));
        peak=Math.max(peak,Math.abs(rate)/area);
      }
    }
    return peak;
  }

  private rigidState():{centerOfMass:MutableVec3;linearVelocity:MutableVec3;angularVelocity:MutableVec3}{
    const center:MutableVec3=[0,0,0],linear:MutableVec3=[0,0,0];
    for(let i=0;i<this.nodeCount;i++){
      const j=i*3,m=this.mass[i]!;
      center[0]+=m*this.position[j]!;center[1]+=m*this.position[j+1]!;center[2]+=m*this.position[j+2]!;
      linear[0]+=m*this.velocity[j]!;linear[1]+=m*this.velocity[j+1]!;linear[2]+=m*this.velocity[j+2]!;
    }
    center[0]/=this.totalMass;center[1]/=this.totalMass;center[2]/=this.totalMass;
    linear[0]/=this.totalMass;linear[1]/=this.totalMass;linear[2]/=this.totalMass;
    let ixx=0,iyy=0,izz=0,ixy=0,ixz=0,iyz=0;const angular:MutableVec3=[0,0,0];
    for(let i=0;i<this.nodeCount;i++){
      const j=i*3,m=this.mass[i]!,x=this.position[j]!-center[0],y=this.position[j+1]!-center[1],z=this.position[j+2]!-center[2];
      const vx=this.velocity[j]!-linear[0],vy=this.velocity[j+1]!-linear[1],vz=this.velocity[j+2]!-linear[2];
      angular[0]+=m*(y*vz-z*vy);angular[1]+=m*(z*vx-x*vz);angular[2]+=m*(x*vy-y*vx);
      ixx+=m*(y*y+z*z);iyy+=m*(x*x+z*z);izz+=m*(x*x+y*y);
      ixy-=m*x*y;ixz-=m*x*z;iyz-=m*y*z;
    }
    return{centerOfMass:center,linearVelocity:linear,angularVelocity:solveSymmetric3(ixx,ixy,ixz,iyy,iyz,izz,angular)};
  }

  private velocityPoint(node:number):MutableVec3{
    const j=node*3;return[this.velocity[j]!,this.velocity[j+1]!,this.velocity[j+2]!];
  }

  private measure(index:number):number{
    if(this.kind[index]===DISTANCE){
      const a=this.ia[index]!*3,b=this.ib[index]!*3;
      return Math.hypot(this.position[b]!-this.position[a]!,this.position[b+1]!-this.position[a+1]!,this.position[b+2]!-this.position[a+2]!);
    }
    return this.tetraVolume(this.ia[index]!,this.ib[index]!,this.ic[index]!,this.id[index]!);
  }

  private tetraVolume(a:number,b:number,c:number,d:number):number{
    const A=this.point(a),B=this.point(b),C=this.point(c),D=this.point(d);
    return V3.dot(V3.sub(B,A),V3.cross(V3.sub(C,A),V3.sub(D,A)))/6;
  }

  private point(node:number):MutableVec3{
    const j=node*3;return[this.position[j]!,this.position[j+1]!,this.position[j+2]!];
  }
}

function solveSymmetric3(a:number,b:number,c:number,d:number,e:number,f:number,rhs:Vec3):MutableVec3{
  let aa=a,dd=d,ff=f;
  let det=aa*(dd*ff-e*e)-b*(b*ff-c*e)+c*(b*e-c*dd);
  const scale=Math.max(1,Math.abs(aa)+Math.abs(dd)+Math.abs(ff));
  if(Math.abs(det)<1e-12*scale*scale*scale){
    const regularization=scale*1e-9;aa+=regularization;dd+=regularization;ff+=regularization;
    det=aa*(dd*ff-e*e)-b*(b*ff-c*e)+c*(b*e-c*dd);
  }
  if(Math.abs(det)<1e-30)return[0,0,0];
  const [x,y,z]=rhs;
  return[
    ((dd*ff-e*e)*x+(c*e-b*ff)*y+(b*e-c*dd)*z)/det,
    ((c*e-b*ff)*x+(aa*ff-c*c)*y+(b*c-aa*e)*z)/det,
    ((b*e-c*dd)*x+(b*c-aa*e)*y+(aa*dd-b*b)*z)/det,
  ];
}
