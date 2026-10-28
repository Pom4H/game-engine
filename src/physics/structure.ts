import type {MechanicalMaterial} from '../materials/catalog.js';
import type {MutableVec3,Vec3} from '../math.js';
import {V3} from '../math.js';
import {dihedralGeometry} from './dihedral.js';
import {ProjectiveDistanceSystem} from './projective-distance.js';

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
  /** Weak-axis section moment. Enables Euler compression buckling (pinned span). */
  readonly secondMomentM4?:number;
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

export interface StructuralBendingSpec {
 readonly kind:'bending';readonly a:number;readonly b:number;readonly c:number;readonly d:number;
 /** Angular stiffness dM/dtheta in N m / rad, derived from shell D or beam EI. */
 readonly stiffnessNm:number;readonly yieldMomentNm:number;readonly plasticity:number;
 /** Material edges which must survive for this hinge to transmit a moment. */
 readonly supportEdges?:readonly number[];
}
export type StructuralConstraintSpec=StructuralDistanceSpec|StructuralVolumeSpec|StructuralBendingSpec;

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
  /** Return-map trial strain before elastic projection; prevents plastic rest changes from adding a rebound. */
  readonly plasticityMode?:'trial'|'stress'|'post-projection';
  /** Small material shells may solve their distance network with one cached
   * local/global SPD factor instead of uncoupled edge Gauss-Seidel updates. */
  readonly projectiveDistances?:boolean;
}

export interface BakedStructuralState {
  readonly positions:Float64Array;
  readonly broken:Uint8Array;
  readonly plasticWorkJ:number;
  /** Mass centre used to hand the sleeping shape back to a reduced rigid body. */
  readonly centerOfMass:Vec3;
  readonly linearVelocity:Vec3;
  readonly angularVelocity:Vec3;
}

export interface StructuralStats {
  readonly mode:'active'|'dormant';
  readonly nodes:number;
  readonly constraints:number;
  readonly broken:number;
  readonly plasticWorkJ:number;
  readonly steps:number;
  readonly linearBackend?:'wasm'|'javascript';
  readonly linearFallbackReason?:string;
  readonly linearFactorization?:'cholesky'|'square-root';
  readonly normalMatrixFallbacks?:number;
}
/** Mechanical work released by this step; geometry changes alone are not a source. */
export interface StructuralDissipation {
  workJ:number;point:MutableVec3;areaM2:number;seconds:number;broken:number;
  /** Released fracture share of workJ after the same mechanical energy budget. */
  fractureWorkJ?:number;
}

type ConstraintKind=0|1|2;
const DISTANCE:ConstraintKind=0;
const VOLUME:ConstraintKind=1;
const BENDING:ConstraintKind=2;
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
// Ordinary SI displacements do not need hypot's scaling path; retain it for extreme exponents.
function finiteNorm3(x:number,y:number,z:number):number{const squared=x*x+y*y+z*z;return squared>1e-280&&squared<1e280?Math.sqrt(squared):Math.hypot(x,y,z);}

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
/** Internal solver ABI. The body retains ownership of activation, contacts,
 * force/impulse inputs, deformation, fracture and rigid bake. A numerical kernel
 * can replace only the contiguous active step without changing these semantics. */
export const STRUCTURAL_KERNEL_FIELDS=[
  'position','previous','velocity','force','mass','inverseMass','originalPosition',
  'kind','ia','ib','ic','id','originalRest','rest','compliance','yieldLimit',
  'breakLimit','plasticity','yieldForce','lambda','predictedMeasure','impulseWeights','broken',
] as const;
export type StructuralKernelField=typeof STRUCTURAL_KERNEL_FIELDS[number];
export type StructuralKernelBuffer=Float64Array|Uint16Array|Uint8Array;
export interface StructuralKernelContactStats {
  readonly contacts:number;
  readonly projectedSamples:number;
  readonly maxPenetration:number;
  readonly deepestBoxId?:string;
  readonly deepestPoint?:Vec3;
}
export interface StructuralNumericalKernel {
  readonly buffers:Readonly<Record<StructuralKernelField,StructuralKernelBuffer>>;
  solve(input:Readonly<{
    dt:number;gravity:Vec3;iterations:number;damping:number;thermalScale:number;
    sleepSpeed:number;sleepDelay:number;plasticWorkJ:number;quietTime:number;steps:number;
  }>):Readonly<{plasticWorkJ:number;quietTime:number;steps:number;shouldBake:boolean}>;
  contactStats?():StructuralKernelContactStats;
  dispose():void;
}
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
  private readonly compressionYieldForce:Float64Array;
  private readonly lambda:Float64Array;
  private readonly predictedMeasure:Float64Array;
  private readonly impulseWeights:Float64Array;
  readonly broken:Uint8Array;

  totalMass:number;
  readonly iterations:number;
  readonly sleepSpeed:number;
  readonly sleepDelay:number;
  readonly internalDamping:number;

  mode:'active'|'dormant'='dormant';
  plasticWorkJ=0;
  readonly dissipation:StructuralDissipation={workJ:0,point:[0,0,0],areaM2:0,seconds:0,broken:0};
  private rawYieldWork=0;private rawFractureWork=0;
  private readonly storedElasticEnergy:Float64Array;
  private readonly bendingConstraintIds:number[]=[];private readonly bendingGradient=new Float64Array(12);private readonly bendingIds=new Uint16Array(4);private readonly bendingArea:Float64Array;private readonly bendingMeasure:Float64Array;
  steps=0;
  private quietTime=0;
  private dt=0;
  private thermalScaleValue=1;
  private pendingBake:BakedStructuralState|undefined;
  private numericalKernel:StructuralNumericalKernel|null=null;
  private readonly projective:ProjectiveDistanceSystem|undefined;

  constructor(readonly definition:StructuralDefinition){
    const nodeCount=definition.nodes.length, constraintCount=definition.constraints.length;
    if(nodeCount<2||nodeCount>2048)throw new RangeError('Structural body requires 2..2048 nodes');
    if(constraintCount<1||constraintCount>16384)throw new RangeError('Structural body requires 1..16384 constraints');
    this.iterations=Math.max(1,Math.min(32,Math.floor(definition.iterations??8)));
    this.storedElasticEnergy=new Float64Array(constraintCount);
    this.bendingArea=new Float64Array(constraintCount);
    this.bendingMeasure=new Float64Array(constraintCount);
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
    this.compressionYieldForce=new Float64Array(constraintCount);
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
        if(constraint.secondMomentM4!==undefined&&!(Number.isFinite(constraint.secondMomentM4)&&constraint.secondMomentM4>0))throw new RangeError('Invalid beam second moment');
        this.compressionYieldForce[i]=constraint.secondMomentM4===undefined?this.yieldForce[i]!:Math.min(this.yieldForce[i]!,Math.PI**2*mechanical.youngModulusPa*constraint.secondMomentM4/(length*length));
      }else if(constraint.kind==='volume'){
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
      }else{
        const ids=[constraint.a,constraint.b,constraint.c,constraint.d];for(const node of ids)this.validateIndex(node,nodeCount);if(new Set(ids).size!==4)throw new RangeError('Bending hinge requires four distinct nodes');
        if(!(Number.isFinite(constraint.stiffnessNm)&&constraint.stiffnessNm>0&&Number.isFinite(constraint.yieldMomentNm)&&constraint.yieldMomentNm>=0&&Number.isFinite(constraint.plasticity)))throw new RangeError('Invalid bending section');
        for(const edge of constraint.supportEdges??[]){this.validateIndex(edge,constraintCount);if(definition.constraints[edge]!.kind!=='distance')throw new RangeError('Bending support must be a material edge');}
        this.kind[i]=BENDING;this.ia[i]=constraint.a;this.ib[i]=constraint.b;this.ic[i]=constraint.c;this.id[i]=constraint.d;
        const angle=dihedralGeometry(this.position,...ids as [number,number,number,number],this.bendingGradient);if(angle===undefined)throw new RangeError('Bending hinge cannot start degenerate');
        this.bendingConstraintIds.push(i);this.originalRest[i]=this.rest[i]=this.bendingMeasure[i]=angle;this.compliance[i]=1/constraint.stiffnessNm;this.yieldForce[i]=constraint.yieldMomentNm;this.yieldLimit[i]=constraint.yieldMomentNm/constraint.stiffnessNm;this.breakLimit[i]=Infinity;this.plasticity[i]=clamp(constraint.plasticity,0,1);
        const a=this.point(constraint.a),b=this.point(constraint.b),c=this.point(constraint.c),d=this.point(constraint.d),e=V3.sub(b,a);this.bendingArea[i]=(V3.length(V3.cross(e,V3.sub(c,a)))+V3.length(V3.cross(V3.sub(d,a),e)))/6;
      }
    }
    if(definition.projectiveDistances){const edges=definition.constraints.flatMap((c,index)=>{if(c.kind!=='distance')return[];const a=definition.nodes[c.a]!.position,b=definition.nodes[c.b]!.position,length=Math.hypot(...b.map((n,k)=>n-a[k]!));return[{index,a:c.a,b:c.b,stiffness:1/this.compliance[index]!,rest:()=>this.rest[index]!*this.thermalScaleValue,direction:b.map((n,k)=>(n-a[k]!)/length),yieldForce:this.yieldForce[index]!,plasticity:this.plasticity[index]!}];}),volumes=definition.constraints.flatMap((c,index)=>c.kind==='volume'?[{index,a:c.a,b:c.b,c:c.c,d:c.d,stiffness:1/this.compliance[index]!,rest:()=>this.rest[index]!*this.thermalScaleValue**3,yieldForce:this.yieldLimit[index]!*Math.abs(this.originalRest[index]!)/this.compliance[index]!,plasticity:this.plasticity[index]!}]:[]);const bends=definition.constraints.flatMap((c,index)=>c.kind==='bending'?[{index,a:c.a,b:c.b,c:c.c,d:c.d,stiffness:1/this.compliance[index]!,rest:()=>this.rest[index]!,reference:()=>this.bendingMeasure[index]!}]:[]);this.projective=new ProjectiveDistanceSystem(this.position,this.previous,this.mass,this.broken,edges,()=>this.projectiveBendingEnergy(),volumes,definition.constraints,bends);}
  }

  /** Backend selection is per structural body, never a global physics override. */
  get backend(): 'typescript'|'wasm' {return this.numericalKernel?'wasm':'typescript';}
  /** Stats for optional Rust-owned static structural contacts. */
  get nativeContactStats():StructuralKernelContactStats|undefined{
    return this.numericalKernel?.contactStats?.();
  }

  /** Attach exactly once while dormant and before other systems cache array views. */
  installKernel(kernel:StructuralNumericalKernel):void{
    if(this.projective||this.definition.constraints.some(c=>c.kind==='bending'||c.kind==='distance'&&c.secondMomentM4!==undefined))throw new Error('This structural kernel ABI does not support projective shells, bending or beam buckling');
    if(this.numericalKernel||this.mode!=='dormant'||this.steps!==0)
      throw new Error('Structural numerical kernel must be installed on a new dormant body');
    const target=this as unknown as Record<string,StructuralKernelBuffer>;
    for(const key of STRUCTURAL_KERNEL_FIELDS){
      const from=target[key],to=kernel.buffers[key];
      if(!from||from.constructor!==to.constructor||from.length!==to.length)
        throw new TypeError('Structural numerical ABI mismatch for '+key);
      if(to.byteLength>0&&to.buffer.byteLength===0)throw new TypeError('Structural kernel memory is detached');
    }
    for(const key of STRUCTURAL_KERNEL_FIELDS){
      const copied=target[key]!,to=kernel.buffers[key];
      to.set(copied as never);
      Object.defineProperty(this,key,{value:to,writable:true,enumerable:true,configurable:true});
    }
    this.numericalKernel=kernel;
  }

  /** Copy out once at an explicit lifecycle boundary and release Wasm memory. */
  detachKernel():void{
    const kernel=this.numericalKernel;if(!kernel)return;
    const state=this as unknown as Record<string,StructuralKernelBuffer>;
    for(const key of STRUCTURAL_KERNEL_FIELDS){
      const old=state[key]!;
      const detached=new (old.constructor as {new(array:StructuralKernelBuffer):StructuralKernelBuffer})(old);
      Object.defineProperty(this,key,{value:detached,writable:true,enumerable:true,configurable:true});
    }
    this.numericalKernel=null;
    kernel.dispose();
  }

  get nodeCount():number{return this.mass.length;}
  get constraintCount():number{return this.kind.length;}
  get thermalScale():number{return this.thermalScaleValue;}
  get linearSolverBackend(){return this.projective?.linearBackend;}
  get linearSolverFallbackReason(){return this.projective?.linearFailure||undefined;}
  get linearSolverFactorization(){return this.projective?.linearFactorization;}
  get normalMatrixFallbacks(){return this.projective?.normalMatrixFallbacks??0;}

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

  /**
   * Actuate one distance element by changing its stress-free length relative
   * to the original structural definition. This is the generic muscle /
   * tendon / pneumatic-actuator primitive; the solver still owns motion,
   * inertia, contacts and energy dissipation.
   */
  setDistanceRestScale(index:number,scale:number):void{
    this.validateIndex(index,this.constraintCount);
    if(this.kind[index]!==DISTANCE)throw new TypeError('Only distance constraints can be actively contracted');
    if(!Number.isFinite(scale)||scale<.25||scale>4)throw new RangeError('Active distance rest scale must be within 0.25..4');
    const next=this.originalRest[index]!*scale;
    if(Math.abs(next-this.rest[index]!)<1e-12)return;
    this.rest[index]=next;
    this.lambda[index]=0;
    this.wake();
  }

  distanceRestScale(index:number):number{
    this.validateIndex(index,this.constraintCount);
    if(this.kind[index]!==DISTANCE)throw new TypeError('Only distance constraints expose an active rest scale');
    return this.rest[index]!/Math.max(1e-12,this.originalRest[index]!);
  }
  /** Cold inspection of the actual angular constitutive state, in radians/J/Nm. */
  bendingState(index:number){this.validateIndex(index,this.constraintCount);if(this.kind[index]!==BENDING)throw new TypeError('Not a bending hinge');const angle=this.bendAngle(index)??this.rest[index]!,elastic=angle-this.rest[index]!;return{angle,restAngle:this.rest[index]!,momentNm:elastic/this.compliance[index]!,elasticEnergyJ:.5*elastic*elastic/this.compliance[index]!};}
  /** Position-only Schur response. This never replaces physical velocity mass. */
  /** A fixed sparse scalar row with caller-owned mutable Vec3 gradients. Each
   * row owns its response so querying a peer cannot overwrite a pending solve. */
  positionGradientConstraint(ids:readonly number[],gradients:Float64Array){
    const system=this.projective;if(!system)return;if(gradients.length!==ids.length*3)throw new RangeError('Invalid material gradient row');for(const id of ids)this.validateIndex(id,this.nodeCount);
    const nodes=ids.slice(),response=new Float64Array(this.nodeCount*3),previous=new Float64Array(gradients.length);let version=-1,inverse=0;
    const refresh=()=>{const generation=system.responseVersion;let changed=generation!==version;for(let i=0;i<gradients.length;i++){if(!Number.isFinite(gradients[i]))throw new RangeError('Nonfinite material gradient');if(gradients[i]!==previous[i])changed=true;}if(changed){inverse=system.responseGradient(nodes,gradients,response);version=system.responseVersion;previous.set(gradients);}};
    let contactResponse:Float64Array|undefined,contactPrevious:Float64Array|undefined,contactVersion=-1,contactInverse=0;
    const refreshContact=()=>{if(!contactResponse){contactResponse=new Float64Array(this.nodeCount*3);contactPrevious=new Float64Array(gradients.length);}const generation=system.contactResponseVersion;let changed=contactVersion!==generation;for(let i=0;i<gradients.length;i++){if(!Number.isFinite(gradients[i]))throw new RangeError('Nonfinite material contact gradient');if(gradients[i]!==contactPrevious![i])changed=true;}if(changed){contactInverse=system.responseContactGradient(nodes,gradients,contactResponse);contactVersion=generation;contactPrevious!.set(gradients);}};
    return{inverseMass:()=>{refresh();return inverse;},displace:(lambda:number)=>{if(!Number.isFinite(lambda))throw new RangeError('Invalid material projection impulse');refresh();system.applyPositionGradient(nodes,gradients,response,lambda);},inverseContactMass:()=>{refreshContact();return contactInverse;},displaceContact:(lambda:number,target?:number,minScale=-Infinity)=>{if(!Number.isFinite(lambda))throw new RangeError('Invalid material contact impulse');refreshContact();return system.applyContactGradient(nodes,gradients,contactResponse!,lambda,target,minScale);}};
  }
  /** Re-linearise an existing material reaction without applying it a second
   * time to the primal position. Its next GN step sees the updated Jacobian. */
  adjustPositionReaction(ids:readonly number[],gradient:Float64Array,lambda:number){if(gradient.length!==ids.length*3||!Number.isFinite(lambda))throw new RangeError('Invalid material reaction');this.projective?.adjustExternalGradient(ids,gradient,lambda);}
  private contactPositionConstraint(ids:readonly number[],weights:readonly number[]){
    let row:ReturnType<StructuralBody['positionGradientConstraint']>,gradient:Float64Array|undefined;
    const refresh=(n:readonly number[])=>{if(!gradient){gradient=new Float64Array(ids.length*3);row=this.positionGradientConstraint(ids,gradient);}for(let a=0;a<ids.length;a++)for(let k=0;k<3;k++)gradient[a*3+k]=weights[a]!*n[k]!;return row!;};
    return{inverseContactMass:(n:readonly number[])=>refresh(n).inverseContactMass(),displaceContact:(n:readonly number[],lambda:number)=>{refresh(n).displaceContact(lambda);}};
  }
  positionConstraint(ids:readonly number[],weights:readonly number[]){const system=this.projective;if(!system)return;
    const contact=this.contactPositionConstraint(ids,weights);
    if(this.nodeCount>64){const entries:{direction:number[];response:Float64Array;version:number;inverse:number}[]=[];let cursor=0;const refresh=(n:readonly number[])=>{let entry=entries.find(e=>e.direction[0]===n[0]&&e.direction[1]===n[1]&&e.direction[2]===n[2]);if(!entry){if(entries.length<4){entry={direction:[...n],response:new Float64Array(this.nodeCount*3),version:-1,inverse:0};entries.push(entry);}else{entry=entries[cursor++%4]!;for(let k=0;k<3;k++)entry.direction[k]=n[k]!;entry.version=-1;}}if(entry.version!==system.responseVersion){entry.inverse=system.response(ids,weights,n,entry.response);entry.version=system.responseVersion;}return entry;};return{...contact,inverseMass:(n:readonly number[])=>refresh(n).inverse,displace:(n:readonly number[],lambda:number)=>system.apply(ids,weights,refresh(n).response,n,lambda)};}
    const response=new Float64Array(this.nodeCount*3),direction=[NaN,NaN,NaN];let version=-1,inverse=0;const refresh=(n:readonly number[])=>{if(version!==system.responseVersion||n.some((v,k)=>v!==direction[k])){inverse=system.response(ids,weights,n,response);version=system.responseVersion;for(let k=0;k<3;k++)direction[k]=n[k]!;}};return{...contact,inverseMass:(n:readonly number[])=>{refresh(n);return inverse;},displace:(n:readonly number[],lambda:number)=>{refresh(n);system.apply(ids,weights,response,n,lambda);}};}

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

  /** Restore compact permanent geometry without healing original failure strain. */
  restorePermanentShape(positions:Float64Array):void{
    if(positions.length!==this.position.length||!positions.every(Number.isFinite))throw new TypeError('Invalid permanent structural shape');
    if(this.mode==='active')throw new Error('Restore structural shape before activation');
    this.position.set(positions);this.previous.set(positions);this.velocity.fill(0);this.force.fill(0);
    this.commitBendingAngles();for(let i=0;i<this.constraintCount;i++){const scale=this.kind[i]===VOLUME?this.thermalScaleValue**3:this.kind[i]===BENDING?1:this.thermalScaleValue;this.rest[i]=this.measure(i)/scale;this.lambda[i]=this.storedElasticEnergy[i]=0;}
  }
  /** Transfer a disconnected point mass to an independently colliding debris owner. */
  detachNode(node:number):{mass:number;position:MutableVec3;velocity:MutableVec3}{
    if(this.numericalKernel)throw new Error('Detach the structural kernel before splitting masses');
    this.validateIndex(node,this.nodeCount);const j=node*3,mass=this.mass[node]!;
    const result={mass,position:this.point(node),velocity:this.velocityPoint(node)};
    if(mass<=0)return result;
    this.totalMass-=mass;this.mass[node]=0;this.inverseMass[node]=0;this.projective?.invalidate();
    this.velocity.fill(0,j,j+3);this.force.fill(0,j,j+3);
    for(let i=0;i<this.constraintCount;i++)if(this.ia[i]===node||this.ib[i]===node||(this.kind[i]!==DISTANCE&&(this.ic[i]===node||this.id[i]===node)))this.broken[i]=1;
    return result;
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
    this.wake();
  }

  step(dt:number,gravity:Vec3=[0,-9.81,0],contactProjector?:(body:StructuralBody,iteration:number)=>void):void{
    this.dissipation.workJ=this.dissipation.areaM2=this.dissipation.broken=0;this.dissipation.fractureWorkJ=0;
    this.dissipation.point.fill(0);this.dissipation.seconds=0;
    if(this.mode==='dormant')return;
    if(!Number.isFinite(dt)||dt<=0||dt>1/30)throw new RangeError('Structural dt must be in (0, 1/30]');
    if(!gravity.every(Number.isFinite))throw new TypeError('Structural gravity must be finite');
    this.dt=dt;
    this.dissipation.workJ=this.dissipation.areaM2=this.dissipation.broken=this.rawYieldWork=this.rawFractureWork=0;this.dissipation.fractureWorkJ=0;
    this.dissipation.point.fill(0);this.dissipation.seconds=dt;
    // Rust owns the complete arithmetic transition if there is no external
    // per-iteration contact callback. A callback uses the original production
    // solver on the very same memory, never a copied/mirrored physical state.
    if(this.numericalKernel&&!contactProjector&&(!this.definition.plasticityMode||this.definition.plasticityMode==='post-projection')){
      const result=this.numericalKernel.solve({
        dt,gravity,iterations:this.iterations,damping:this.internalDamping,
        thermalScale:this.thermalScaleValue,sleepSpeed:this.sleepSpeed,
        sleepDelay:this.sleepDelay,plasticWorkJ:this.plasticWorkJ,
        quietTime:this.quietTime,steps:this.steps,
      });
      this.plasticWorkJ=result.plasticWorkJ;
      this.quietTime=result.quietTime;
      this.steps=result.steps;
      if(result.shouldBake)this.bake();
      return;
    }
    this.predictStep(dt,gravity,contactProjector);
    for(let iteration=0;iteration<this.iterations;iteration++)this.projectStep(contactProjector,iteration);
    this.completeStep();
  }

  private stepWorkBefore=0;private stepTrialEnergy=0;private stepExternalWork=0;
  private energyGroup:{budgetJ:number;members:Set<StructuralBody>}={budgetJ:0,members:new Set([this])};
  private accountedKineticJ=0;private stepDampingWorkJ=0;private predicting=false;
  /** A contact inside this group transfers energy, it does not create an external source. */
  shareMechanicalEnergy(other:StructuralBody|undefined):void{
    if(!other||other.energyGroup===this.energyGroup)return;
    const group=this.energyGroup,old=other.energyGroup;group.budgetJ+=old.budgetJ;
    for(const member of old.members){group.members.add(member);member.energyGroup=group;}
  }
  leaveMechanicalEnergyGroup():void{
    const group=this.energyGroup;if(group.members.size<2)return;
    let total=0;for(const member of group.members)total+=member.reservedMechanicalEnergy();
    const share=total>1e-9?this.reservedMechanicalEnergy()/total:1/group.members.size,budget=group.budgetJ*share;
    group.budgetJ-=budget;group.members.delete(this);this.energyGroup={budgetJ:budget,members:new Set([this])};
  }
  /** Release optional direct-solver storage when the physical owner leaves its
   * world. Its reference positions/masses remain available for inspection. */
  disposeDirectSolver():void{this.projective?.dispose();}
  disposeNumericalResources():void{this.projective?.dispose();this.detachKernel();this.leaveMechanicalEnergyGroup();}
  private reservedMechanicalEnergy():number{
    let kinetic=0,elastic=0;
    for(let i=0;i<this.nodeCount;i++){const j=i*3,h=this.dt;for(let a=0;a<3;a++){const v=this.predicting?(this.position[j+a]!-this.previous[j+a]!)/h:this.velocity[j+a]!;kinetic+=.5*this.mass[i]!*v*v;}}
    // A newly admitted/coupled member has no previous dt or elastic impulse.
    // Its stored energy is zero, not (0 / 0)². One unpredicted neighbour must
    // never poison the entire contact group's plastic work with NaN.
    for(let i=0;i<this.constraintCount;i++)if(!this.broken[i])elastic+=this.predicting?this.constraintEnergy(i):this.storedElasticEnergy[i]!;
    return kinetic+elastic;
  }
  private constraintEnergy(index:number){if(this.kind[index]===BENDING){const C=(this.bendAngle(index)??this.rest[index]!)-this.rest[index]!;return .5*C*C/this.compliance[index]!;}if(this.projective){const C=this.measure(index)-this.rest[index]!*(this.kind[index]===VOLUME?this.thermalScaleValue**3:this.thermalScaleValue);return .5*C*C/this.compliance[index]!;}return .5*(this.lambda[index]!/(this.dt*this.dt))**2*this.compliance[index]!;}
  private projectiveBendingEnergy(){let total=0;for(let entry=0;entry<this.bendingConstraintIds.length;entry++){const i=this.bendingConstraintIds[entry]!;if(this.broken[i])continue;const raw=dihedralGeometry(this.position,this.ia[i]!,this.ib[i]!,this.ic[i]!,this.id[i]!);if(raw===undefined)continue;const C=Math.abs(raw+Math.PI*2*Math.round((this.bendingMeasure[i]!-raw)/(Math.PI*2))-this.rest[i]!),limit=this.yieldForce[i]!,yieldAngle=limit*this.compliance[i]!;total+=this.plasticity[i]!>0&&C>yieldAngle?limit*C-.5*limit*yieldAngle:.5*C*C/this.compliance[i]!;}return total;}
  /** Mechanical work already delivered by a coupled position constraint. */
  addExternalConstraintWork(workJ:number):void{if(!Number.isFinite(workJ))throw new RangeError('Invalid constraint work');this.stepExternalWork+=workJ;}
  /** Phased interface for a coupled graph/contact solve on the same node memory. */
  predictStep(dt:number,gravity:Vec3=[0,-9.81,0],contactProjector?:(body:StructuralBody,iteration:number)=>void):void{
    if(!Number.isFinite(dt)||dt<=0||dt>1/30||!gravity.every(Number.isFinite))throw new RangeError('Invalid structural prediction step');
    this.dt=dt;
    this.stepExternalWork=0;
    this.dissipation.workJ=this.dissipation.areaM2=this.dissipation.broken=this.rawYieldWork=this.rawFractureWork=0;this.dissipation.fractureWorkJ=0;
    this.dissipation.point.fill(0);this.dissipation.seconds=dt;
    this.previous.set(this.position);
    this.stepWorkBefore=this.plasticWorkJ;

    for(let i=0;i<this.nodeCount;i++){
      const j=i*3,inv=this.inverseMass[i]!;if(this.mass[i]!<=0)continue;
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
    if(this.projective){this.projective.begin(dt);this.updateProjectiveDistances();this.updateProjectiveVolumes();this.updateProjectiveBends();this.projective.project();}this.projectContact(contactProjector,-1);
    this.commitBendingAngles();this.stepTrialEnergy=this.kineticEnergy();
    this.energyGroup.budgetJ+=this.stepTrialEnergy-this.accountedKineticJ;
    this.predicting=true;
    this.prepareConstraints();
    if(this.definition.plasticityMode==='trial'||this.definition.plasticityMode==='stress')this.returnPlasticity();
  }
  projectStep(contactProjector?:(body:StructuralBody,iteration:number)=>void,iteration=0):void{
    this.solveConstraints();this.projectContact(contactProjector,iteration);this.commitBendingAngles();
  }
  private projectContact(projector:((body:StructuralBody,iteration:number)=>void)|undefined,iteration:number){if(!projector)return;this.projective?.beginExternalProjection();projector(this,iteration);this.projective?.endExternalProjection();}
  completeStep():void{
    this.commitBendingAngles();this.finishStep();
    this.projective?.end();
    this.predicting=false;
    for(let i=0;i<this.constraintCount;i++){
      const energy=this.broken[i]?0:this.constraintEnergy(i);
      this.storedElasticEnergy[i]=energy;
    }
    let dissipated=Math.max(0,this.plasticWorkJ-this.stepWorkBefore)+this.rawFractureWork;
    if(this.definition.plasticityMode==='trial'||this.definition.plasticityMode==='stress'){
      // Carry the energy balance across substeps. A per-step cap can repeatedly
      // spend elastic ringing, and count work transferred between two graphs twice.
      // Prediction includes force/gravity and queued external velocity impulses;
      // shared constraints report their exact incremental kinetic work separately.
      const kinetic=this.kineticEnergy();
      this.energyGroup.budgetJ+=this.stepExternalWork-this.stepDampingWorkJ;
      let reserved=0;for(const member of this.energyGroup.members)reserved+=member.reservedMechanicalEnergy();
      let requested=dissipated;for(const member of this.energyGroup.members)if(member!==this&&member.predicting)requested+=Math.max(0,member.plasticWorkJ-member.stepWorkBefore)+member.rawFractureWork;
      const available=Math.max(0,this.energyGroup.budgetJ-reserved);
      dissipated=Math.min(dissipated,requested>0?available*dissipated/requested:0);
      const fracture=Math.min(this.rawFractureWork,dissipated);
      this.plasticWorkJ=this.stepWorkBefore+dissipated-fracture;
      this.energyGroup.budgetJ-=dissipated;this.accountedKineticJ=kinetic;
    }
    const raw=this.rawYieldWork+this.rawFractureWork;
    if(raw>0){for(let k=0;k<3;k++)this.dissipation.point[k]!/=raw;this.dissipation.areaM2/=raw;this.dissipation.workJ=dissipated;this.dissipation.fractureWorkJ=Math.min(this.rawFractureWork,dissipated);}
  }

  /**
   * Freeze the current permanent shape as the new reduced rest state.
   * Elastic energy is intentionally discarded only at this explicit LOD boundary.
   */
  bake():BakedStructuralState{
    this.commitBendingAngles();
    const rigid=this.rigidState();
    for(let i=0;i<this.constraintCount;i++){
      if(this.broken[i])continue;
      const thermalPower=this.kind[i]===VOLUME?this.thermalScaleValue**3:this.kind[i]===BENDING?1:this.thermalScaleValue;
      this.rest[i]=this.measure(i)/thermalPower;
      this.originalRest[i]=this.rest[i]!;
      this.lambda[i]=this.storedElasticEnergy[i]=0;
    }
    this.previous.set(this.position);
    this.velocity.fill(0);this.force.fill(0);this.quietTime=0;this.mode='dormant';
    const baked=Object.freeze({
      positions:new Float64Array(this.position),
      broken:new Uint8Array(this.broken),
      plasticWorkJ:this.plasticWorkJ,
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
    return{mode:this.mode,nodes:this.nodeCount,constraints:this.constraintCount,broken,plasticWorkJ:this.plasticWorkJ,steps:this.steps,...(this.projective?{linearBackend:this.projective.linearBackend,linearFactorization:this.projective.linearFactorization,normalMatrixFallbacks:this.projective.normalMatrixFallbacks,...(this.projective.linearFailure?{linearFallbackReason:this.projective.linearFailure}:{})}:{})};
  }

  private validateIndex(index:number,count:number):void{
    if(!Number.isInteger(index)||index<0||index>=count)throw new RangeError('Structural node index out of range');
  }

  private prepareConstraints():void{
    this.lambda.fill(0);
    for(let i=0;i<this.constraintCount;i++)if(!this.broken[i])this.predictedMeasure[i]=this.measure(i);
  }

  private solveConstraints():void{
    if(this.projective){this.updateProjectiveDistances();this.updateProjectiveVolumes();this.updateProjectiveBends();this.projective.project();return;
    }
    for(let i=0;i<this.constraintCount;i++){
      if(this.broken[i])continue;
      if(this.kind[i]===DISTANCE)this.solveDistance(i);else if(this.kind[i]===VOLUME)this.solveVolume(i);else this.solveBending(i);
    }
  }

  private solveDistance(index:number):void{
    const a=this.ia[index]!,b=this.ib[index]!,A=a*3,B=b*3;
    const dx=this.position[B]!-this.position[A]!,dy=this.position[B+1]!-this.position[A+1]!,dz=this.position[B+2]!-this.position[A+2]!;
    const length=this.definition.plasticityMode==='stress'?finiteNorm3(dx,dy,dz):Math.hypot(dx,dy,dz);if(length<1e-10)return;
    const nx=dx/length,ny=dy/length,nz=dz/length,C=length-this.rest[index]!*this.thermalScaleValue;
    const alpha=this.compliance[index]!/(this.dt*this.dt),denom=this.inverseMass[a]!+this.inverseMass[b]!+alpha;
    if(denom<=1e-14)return;
    let dl=(-C-alpha*this.lambda[index]!)/denom;
    if(this.definition.plasticityMode==='stress'&&this.plasticity[index]!>0){
      // XPBD lambda / dt² is the member force. Cap its trial stress at yield,
      // then return only the unsupported deformation to the permanent rest length.
      // Free predictor travel alone cannot plastically crush a stiff unloaded member.
      const previous=this.lambda[index]!,trial=previous+dl,yieldForce=trial>0?this.compressionYieldForce[index]!:this.yieldForce[index]!,yieldLambda=yieldForce*this.dt*this.dt;
      if(Math.abs(trial)>yieldLambda){
        const limited=clamp(trial,-yieldLambda,yieldLambda),flow=(C+(denom-alpha)*(limited-previous)+alpha*limited)*this.plasticity[index]!;
        const rest=this.rest[index]!,next=Math.max(Math.abs(this.originalRest[index]!)*.04,rest+flow/this.thermalScaleValue);
        const work=Math.abs((next-rest)*this.thermalScaleValue)*yieldForce;
        this.rest[index]=next;this.plasticWorkJ+=work;this.recordDissipation(index,work,false);
        dl=(-(length-next*this.thermalScaleValue)-alpha*previous)/denom;
      }
    }
    this.lambda[index]=this.lambda[index]!+dl;
    const wa=this.inverseMass[a]!*dl,wb=this.inverseMass[b]!*dl;
    this.position[A]=this.position[A]!-nx*wa;this.position[A+1]=this.position[A+1]!-ny*wa;this.position[A+2]=this.position[A+2]!-nz*wa;
    this.position[B]=this.position[B]!+nx*wb;this.position[B+1]=this.position[B+1]!+ny*wb;this.position[B+2]=this.position[B+2]!+nz*wb;
  }
  private updateProjectiveDistances(){for(let i=0;i<this.constraintCount;i++)if(!this.broken[i]&&this.kind[i]===DISTANCE){const length=this.measure(i),effective=this.rest[i]!*this.thermalScaleValue,C=length-effective,k=1/this.compliance[i]!,limit=C<0?this.compressionYieldForce[i]!:this.yieldForce[i]!,original=this.originalRest[i]!*this.thermalScaleValue;if(Math.abs((length-original)/original)>this.breakLimit[i]!){this.broken[i]=1;this.recordDissipation(i,this.storedElasticEnergy[i]!,true);continue;}if(Math.abs(k*C)>limit&&this.plasticity[i]!>0){const flow=(C-Math.sign(C)*limit/k)*this.plasticity[i]!;this.rest[i]=Math.max(this.originalRest[i]!*.04,this.rest[i]!+flow/this.thermalScaleValue);const work=Math.abs(flow)*limit;this.plasticWorkJ+=work;this.recordDissipation(i,work,false);}this.lambda[i]=-k*(length-this.rest[i]!*this.thermalScaleValue)*this.dt*this.dt;}}
  private updateProjectiveVolumes(){for(let i=0;i<this.constraintCount;i++)if(!this.broken[i]&&this.kind[i]===VOLUME){const scale=this.thermalScaleValue**3,volume=this.measure(i),original=this.originalRest[i]!*scale,C=volume-this.rest[i]!*scale,k=1/this.compliance[i]!,yieldVolume=this.yieldLimit[i]!*Math.abs(original),limit=k*yieldVolume;if(Math.abs((volume-original)/original)>this.breakLimit[i]!){this.broken[i]=1;this.recordDissipation(i,this.storedElasticEnergy[i]!,true);continue;}if(Math.abs(C)>yieldVolume&&this.plasticity[i]!>0){const flow=(C-Math.sign(C)*yieldVolume)*this.plasticity[i]!;this.rest[i]!+=flow/scale;const work=Math.abs(flow)*limit;this.plasticWorkJ+=work;this.recordDissipation(i,work,false);}this.lambda[i]=-k*(volume-this.rest[i]!*scale)*this.dt*this.dt;}}

  private updateProjectiveBends(){for(let entry=0;entry<this.bendingConstraintIds.length;entry++){const i=this.bendingConstraintIds[entry]!;if(this.broken[i]||!this.bendingSupported(i))continue;const angle=this.bendAngle(i);if(angle===undefined)continue;const k=1/this.compliance[i]!,C=angle-this.rest[i]!,limit=this.yieldForce[i]!;if(Math.abs(k*C)>limit&&this.plasticity[i]!>0){const flow=(C-Math.sign(C)*limit/k)*this.plasticity[i]!;this.rest[i]!+=flow;const work=Math.abs(flow)*limit;this.plasticWorkJ+=work;this.recordDissipation(i,work,false);}this.lambda[i]=-k*(angle-this.rest[i]!)*this.dt*this.dt;}}
  private readonly volumeGradient=new Float64Array(12);
  private bendAngle(index:number,gradient=false):number|undefined{
    const raw=dihedralGeometry(this.position,this.ia[index]!,this.ib[index]!,this.ic[index]!,this.id[index]!,gradient?this.bendingGradient:undefined);if(raw===undefined)return;
    return raw+Math.PI*2*Math.round((this.bendingMeasure[index]!-raw)/(Math.PI*2));
  }
  private commitBendingAngles(){for(let entry=0;entry<this.bendingConstraintIds.length;entry++){const i=this.bendingConstraintIds[entry]!;if(this.broken[i])continue;const angle=this.bendAngle(i);if(angle!==undefined)this.bendingMeasure[i]=angle;}}
  private bendNodes(index:number){const ids=this.bendingIds;ids[0]=this.ia[index]!;ids[1]=this.ib[index]!;ids[2]=this.ic[index]!;ids[3]=this.id[index]!;return ids;}
  private bendingSupported(index:number){
    const spec=this.definition.constraints[index]!;if(spec.kind!=='bending')return false;
    for(const edge of spec.supportEdges??[])if(this.broken[edge]){this.broken[index]=1;this.recordDissipation(index,this.storedElasticEnergy[index]!,true);return false;}return true;
  }
  private solveBending(index:number){
    if(!this.bendingSupported(index))return;const angle=this.bendAngle(index,true);if(angle===undefined)return;const g=this.bendingGradient,ids=this.bendNodes(index);let inverse=0;
    if(this.projective)inverse=this.projective.gradientMass(ids,g);else for(let n=0;n<4;n++)inverse+=this.inverseMass[ids[n]!]!*(g[n*3]!**2+g[n*3+1]!**2+g[n*3+2]!**2);
    const alpha=this.compliance[index]!/(this.dt*this.dt),denom=inverse+alpha,C=angle-this.rest[index]!;if(denom<=1e-18)return;const previous=this.lambda[index]!;let delta=(-C-alpha*previous)/denom;
    if(this.plasticity[index]!>0){const trial=previous+delta,limit=this.yieldForce[index]!*this.dt*this.dt;if(Math.abs(trial)>limit){const limited=clamp(trial,-limit,limit),flow=(C+inverse*(limited-previous)+alpha*limited)*this.plasticity[index]!;this.rest[index]!+=flow;const work=Math.abs(flow)*this.yieldForce[index]!;this.plasticWorkJ+=work;this.recordDissipation(index,work,false);delta=(-(angle-this.rest[index]!)-alpha*previous)/denom;}}
    this.lambda[index]!+=delta;if(this.projective)this.projective.applyGradient(ids,g,delta);else for(let n=0;n<4;n++){const j=ids[n]!*3,scale=this.inverseMass[ids[n]!]!*delta;for(let k=0;k<3;k++)this.position[j+k]!+=g[n*3+k]!*scale;}
  }
  /** Scratch belongs to this body; volume projection never allocates per iteration. */
  private volumeGeometry(a:number,b:number,c:number,d:number):number{
    const p=this.position,A=a*3,B=b*3,C=c*3,D=d*3;
    const bx=p[B]!-p[A]!,by=p[B+1]!-p[A+1]!,bz=p[B+2]!-p[A+2]!;
    const cx=p[C]!-p[A]!,cy=p[C+1]!-p[A+1]!,cz=p[C+2]!-p[A+2]!;
    const dx=p[D]!-p[A]!,dy=p[D+1]!-p[A+1]!,dz=p[D+2]!-p[A+2]!;
    const g=this.volumeGradient;
    g[3]=(cy*dz-cz*dy)*(1/6);g[4]=(cz*dx-cx*dz)*(1/6);g[5]=(cx*dy-cy*dx)*(1/6);
    g[6]=(dy*bz-dz*by)*(1/6);g[7]=(dz*bx-dx*bz)*(1/6);g[8]=(dx*by-dy*bx)*(1/6);
    g[9]=(by*cz-bz*cy)*(1/6);g[10]=(bz*cx-bx*cz)*(1/6);g[11]=(bx*cy-by*cx)*(1/6);
    g[0]=-g[3]!-g[6]!-g[9]!;g[1]=-g[4]!-g[7]!-g[10]!;g[2]=-g[5]!-g[8]!-g[11]!;
    return (bx*(cy*dz-cz*dy)+by*(cz*dx-cx*dz)+bz*(cx*dy-cy*dx))/6;
  }

  private solveVolume(index:number):void{
    const a=this.ia[index]!,b=this.ib[index]!,c=this.ic[index]!,d=this.id[index]!;
    const current=this.volumeGeometry(a,b,c,d),g=this.volumeGradient,Cv=current-this.rest[index]!*this.thermalScaleValue**3;
    const alpha=this.compliance[index]!/(this.dt*this.dt);
    const ga=g[0]!**2+g[1]!**2+g[2]!**2,gb=g[3]!**2+g[4]!**2+g[5]!**2,gc=g[6]!**2+g[7]!**2+g[8]!**2,gd=g[9]!**2+g[10]!**2+g[11]!**2;
    const denom=this.inverseMass[a]!*ga+this.inverseMass[b]!*gb+this.inverseMass[c]!*gc+this.inverseMass[d]!*gd+alpha;
    if(denom<=1e-14)return;
    let dl=(-Cv-alpha*this.lambda[index]!)/denom;
    if(this.definition.plasticityMode==='trial'||this.definition.plasticityMode==='stress'){
      const p=this.position,A=a*3,B=b*3,C=c*3,D=d*3;
      const bx=p[B]!-p[A]!,by=p[B+1]!-p[A+1]!,bz=p[B+2]!-p[A+2]!,cx=p[C]!-p[A]!,cy=p[C+1]!-p[A+1]!,cz=p[C+2]!-p[A+2]!,dx=p[D]!-p[A]!,dy=p[D+1]!-p[A+1]!,dz=p[D+2]!-p[A+2]!;
      const spanSquared=Math.max(1e-8,Math.min(bx*bx+by*by+bz*bz,cx*cx+cy*cy+cz*cz,dx*dx+dy*dy+dz*dz));
      const largestSquared=Math.max(this.inverseMass[a]!**2*ga,this.inverseMass[b]!**2*gb,this.inverseMass[c]!**2*gc,this.inverseMass[d]!**2*gd),displacementSquared=dl*dl*largestSquared;
      // Most resting projections are far below the limiter. A conservative squared
      // bound avoids seven scaled norms while preserving the original clamp near its boundary.
      if(!Number.isFinite(displacementSquared)||!Number.isFinite(spanSquared)||displacementSquared>=spanSquared*.00999999){
        const span=Math.max(1e-4,Math.min(Math.hypot(bx,by,bz),Math.hypot(cx,cy,cz),Math.hypot(dx,dy,dz)));
        const largest=Math.max(this.inverseMass[a]!*Math.hypot(g[0]!,g[1]!,g[2]!),this.inverseMass[b]!*Math.hypot(g[3]!,g[4]!,g[5]!),this.inverseMass[c]!*Math.hypot(g[6]!,g[7]!,g[8]!),this.inverseMass[d]!*Math.hypot(g[9]!,g[10]!,g[11]!));
        if(largest>1e-14)dl=clamp(dl,-span*.1/largest,span*.1/largest);
      }
    }
    this.lambda[index]=this.lambda[index]!+dl;
    this.applyVolumeGradient(a,0,dl);this.applyVolumeGradient(b,3,dl);this.applyVolumeGradient(c,6,dl);this.applyVolumeGradient(d,9,dl);
  }

  private applyVolumeGradient(node:number,offset:number,lambda:number):void{
    const j=node*3,s=this.inverseMass[node]!*lambda,g=this.volumeGradient;
    this.position[j]=this.position[j]!+g[offset]!*s;this.position[j+1]=this.position[j+1]!+g[offset+1]!*s;this.position[j+2]=this.position[j+2]!+g[offset+2]!*s;
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

    if(!this.definition.plasticityMode||this.definition.plasticityMode==='post-projection')this.returnPlasticity();

    const beforeDamping=this.kineticEnergy();
    this.dampInternalVelocities();
    this.stepDampingWorkJ=Math.max(0,beforeDamping-this.kineticEnergy());
    const internalSpeed=this.internalSpeed();
    this.steps++;
    if(internalSpeed<this.sleepSpeed)this.quietTime+=this.dt;else this.quietTime=0;
    if(this.quietTime>=this.sleepDelay)this.bake();
  }

  private returnPlasticity():void{
    for(let i=0;i<this.constraintCount;i++){
      if(this.broken[i])continue;
      if(this.kind[i]===BENDING){this.bendingSupported(i);continue;}
      const original=this.originalRest[i]!,trial=this.predictedMeasure[i]!,rest=this.rest[i]!;
      const thermalPower=this.kind[i]===DISTANCE?this.thermalScaleValue:this.thermalScaleValue**3;
      const effectiveOriginal=original*thermalPower,effectiveRest=rest*thermalPower;
      if(this.kind[i]===DISTANCE){
        if(this.projective)continue;
        const trialStrain=(trial-effectiveRest)/Math.max(1e-9,Math.abs(effectiveOriginal));
        const originalStrain=(trial-effectiveOriginal)/Math.max(1e-9,Math.abs(effectiveOriginal));
        const section=this.definition.constraints[i]!,buckles=section.kind==='distance'&&section.secondMomentM4!==undefined;
        // A thin member folds under compression. Its shortening alone is not a
        // tensile tear; retain its mass/load path until actual tensile failure.
        if(originalStrain>this.breakLimit[i]!||!buckles&&originalStrain< -this.breakLimit[i]!){this.broken[i]=1;this.recordDissipation(i,this.storedElasticEnergy[i]!,true);continue;}
        if(this.definition.plasticityMode==='stress')continue;
        const yieldStrain=this.yieldLimit[i]!;
        if(Math.abs(trialStrain)>yieldStrain&&this.plasticity[i]!>0){
          const elastic=Math.sign(trialStrain)*yieldStrain*Math.abs(effectiveOriginal);
          const targetEffective=trial-elastic,targetBase=targetEffective/thermalPower,delta=(targetBase-rest)*this.plasticity[i]!;
          if(Math.abs(delta)>1e-12){
            this.rest[i]=Math.max(Math.abs(original)*.04,rest+delta);
            const work=Math.abs(delta*thermalPower)*this.yieldForce[i]!;this.plasticWorkJ+=work;this.recordDissipation(i,work,false);
          }
        }
      }else{
        if(this.projective)continue;
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

  }

  private recordDissipation(index:number,work:number,fracture:boolean):void{
    if(fracture)this.dissipation.broken++;
    if(!(work>0&&Number.isFinite(work)))return;
    if(fracture)this.rawFractureWork+=work;else this.rawYieldWork+=work;
    const spec=this.definition.constraints[index]!;if(spec.kind==='distance'){const A=spec.a*3,B=spec.b*3;for(let k=0;k<3;k++)this.dissipation.point[k]!+=(this.position[A+k]!+this.position[B+k]!)*.5*work;this.dissipation.areaM2+=this.originalRest[index]!*Math.sqrt(spec.areaM2)*work;}
    else if(spec.kind==='bending'){for(const node of this.bendNodes(index))for(let k=0;k<3;k++)this.dissipation.point[k]!+=this.position[node*3+k]!*.25*work;this.dissipation.areaM2+=this.bendingArea[index]!*work;}
  }

  private dampInternalVelocities():void{
    if(this.internalDamping<=0)return;
    const gain=1-Math.exp(-this.internalDamping*this.dt);
    for(let i=0;i<this.constraintCount;i++){
      if(this.broken[i])continue;
      if(this.kind[i]===BENDING){if(this.bendAngle(i,true)===undefined)continue;const g=this.bendingGradient,ids=this.bendNodes(i);let inverse=0,rate=0;for(let n=0;n<4;n++)for(let k=0;k<3;k++){const value=g[n*3+k]!;inverse+=this.inverseMass[ids[n]!]!*value*value;rate+=value*this.velocity[ids[n]!*3+k]!;}if(inverse>1e-18){const impulse=-rate*gain/inverse;for(let n=0;n<4;n++)for(let k=0;k<3;k++)this.velocity[ids[n]!*3+k]!+=impulse*g[n*3+k]!*this.inverseMass[ids[n]!]!;}continue;}
      if(this.kind[i]!==DISTANCE)continue;
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
      }else if(this.kind[i]===BENDING){if(this.bendAngle(i,true)===undefined)continue;const g=this.bendingGradient,ids=this.bendNodes(i);let rate=0;for(let n=0;n<4;n++)for(let k=0;k<3;k++)rate+=g[n*3+k]!*this.velocity[ids[n]!*3+k]!;peak=Math.max(peak,Math.abs(rate)*Math.sqrt(this.bendingArea[i]!));
      }else{
        const a=this.ia[i]!,b=this.ib[i]!,c=this.ic[i]!,d=this.id[i]!;
        this.volumeGeometry(a,b,c,d);
        const g=this.volumeGradient,v=this.velocity,A=a*3,B=b*3,C=c*3,D=d*3;
        const rate=(g[0]!*v[A]!+g[1]!*v[A+1]!+g[2]!*v[A+2]!)+(g[3]!*v[B]!+g[4]!*v[B+1]!+g[5]!*v[B+2]!)+(g[6]!*v[C]!+g[7]!*v[C+1]!+g[8]!*v[C+2]!)+(g[9]!*v[D]!+g[10]!*v[D+1]!+g[11]!*v[D+2]!);
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

  private point(node:number):MutableVec3{const j=node*3;return[this.position[j]!,this.position[j+1]!,this.position[j+2]!];}
  private velocityPoint(node:number):MutableVec3{const j=node*3;return[this.velocity[j]!,this.velocity[j+1]!,this.velocity[j+2]!];}

  private measure(index:number):number{
    if(this.kind[index]===DISTANCE){
      const a=this.ia[index]!*3,b=this.ib[index]!*3;
      if(this.projective)return finiteNorm3(this.position[b]!-this.position[a]!,this.position[b+1]!-this.position[a+1]!,this.position[b+2]!-this.position[a+2]!);
      return Math.hypot(this.position[b]!-this.position[a]!,this.position[b+1]!-this.position[a+1]!,this.position[b+2]!-this.position[a+2]!);
    }
    if(this.kind[index]===BENDING)return this.bendAngle(index)??this.rest[index]!;
    return this.tetraVolume(this.ia[index]!,this.ib[index]!,this.ic[index]!,this.id[index]!);
  }

  private tetraVolume(a:number,b:number,c:number,d:number):number{
    const p=this.position,A=a*3,B=b*3,C=c*3,D=d*3;
    const bx=p[B]!-p[A]!,by=p[B+1]!-p[A+1]!,bz=p[B+2]!-p[A+2]!;
    const cx=p[C]!-p[A]!,cy=p[C+1]!-p[A+1]!,cz=p[C+2]!-p[A+2]!;
    const dx=p[D]!-p[A]!,dy=p[D+1]!-p[A+1]!,dz=p[D+2]!-p[A+2]!;
    // Preserve the former dot(cross()) operation order without its vector arrays.
    return (bx*(cy*dz-cz*dy)+by*(cz*dx-cx*dz)+bz*(cx*dy-cy*dx))/6;
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
