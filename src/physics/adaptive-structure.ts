import type {Vec3} from '../math.js';
import {V3} from '../math.js';
import {StructuralBody,type BakedStructuralState} from './structure.js';

export interface ReducedRigidState {
  readonly mass:number;
  readonly centerOfMass:Vec3;
  readonly linearVelocity:Vec3;
  readonly angularVelocity:Vec3;
}

export interface StructuralActivationPolicy {
  /** Normal impact energy per vehicle kilogram required to leave the cheap rigid/reduced tier. */
  readonly specificEnergyJkg?:number;
  /** Absolute floor prevents tiny lightweight props from refining on harmless taps. */
  readonly minimumEnergyJ?:number;
  /** Local structural impulse footprint. */
  readonly impulseRadiusM?:number;
}

export interface StructuralActivation {
  readonly point:Vec3;
  /** World-space impulse applied to the structural nodes after rigid-state transfer. */
  readonly impulse:Vec3;
  readonly normalEnergyJ:number;
}

export interface AdaptiveStructuralStats {
  readonly mode:'reduced'|'structural';
  readonly activations:number;
  readonly rejectedContacts:number;
  readonly thresholdJ:number;
  readonly structuralSteps:number;
  readonly plasticWorkJ:number;
}

/**
 * LOD state machine for adaptive structural physics.
 *
 * It does not run a second hidden vehicle mass. The owning physics world must
 * suspend its reduced rigid integrator while mode === 'structural'; StructuralBody
 * then owns the same mass until step() returns a baked rigid handoff.
 *
 * Keeping orchestration separate from collision generation is deliberate:
 * a CPU manifold today and a WebGPU/local-FEM contact patch later can feed the
 * same activation contract without changing material or LOD semantics.
 */
export class AdaptiveStructuralController {
  readonly thresholdJ:number;
  readonly impulseRadiusM:number;
  private modeValue:'reduced'|'structural'='reduced';
  private activations=0;
  private rejectedContacts=0;

  constructor(
    readonly structure:StructuralBody,
    readonly reducedMass:number,
    policy:StructuralActivationPolicy={},
  ){
    if(!Number.isFinite(reducedMass)||reducedMass<=0)throw new RangeError('Adaptive structural mass must be positive');
    const massError=Math.abs(structure.totalMass-reducedMass)/reducedMass;
    if(massError>1e-6)throw new RangeError('Structural nodes must own exactly the reduced rigid mass');
    const specific=policy.specificEnergyJkg??28;
    const floor=policy.minimumEnergyJ??2500;
    if(!Number.isFinite(specific)||specific<0||!Number.isFinite(floor)||floor<0)throw new RangeError('Invalid structural activation energy');
    this.thresholdJ=Math.max(floor,reducedMass*specific);
    this.impulseRadiusM=Math.max(.03,Math.min(4,policy.impulseRadiusM??.55));
  }

  get mode():'reduced'|'structural'{return this.modeValue;}

  shouldActivate(normalEnergyJ:number):boolean{
    return Number.isFinite(normalEnergyJ)&&normalEnergyJ>=this.thresholdJ;
  }

  /**
   * Promote a reduced rigid body to high-detail structure.
   * Call only after the reduced owner has stopped integrating the same mass.
   */
  activate(rigid:ReducedRigidState,cause:StructuralActivation):boolean{
    if(this.modeValue==='structural')return false;
    if(!this.shouldActivate(cause.normalEnergyJ)){this.rejectedContacts++;return false;}
    if(!Number.isFinite(rigid.mass)||Math.abs(rigid.mass-this.reducedMass)>this.reducedMass*1e-6)throw new RangeError('Rigid handoff mass changed');
    if(!rigid.centerOfMass.every(Number.isFinite)||!rigid.linearVelocity.every(Number.isFinite)||!rigid.angularVelocity.every(Number.isFinite))throw new TypeError('Rigid handoff must be finite');
    if(!cause.point.every(Number.isFinite)||!cause.impulse.every(Number.isFinite))throw new TypeError('Structural activation cause must be finite');

    this.structure.activateFromRigid(rigid.centerOfMass,rigid.linearVelocity,rigid.angularVelocity);
    this.structure.applyImpulse(cause.point,cause.impulse,this.impulseRadiusM);
    this.modeValue='structural';
    this.activations++;
    return true;
  }

  /**
   * Advance only the detailed tier. A returned state is the exact moment when
   * ownership can move back to the reduced rigid body.
   */
  step(dt:number,gravity:Vec3=[0,-9.81,0]):BakedStructuralState|undefined{
    if(this.modeValue==='reduced')return;
    this.structure.step(dt,gravity);
    const baked=this.structure.takeBakedState();
    if(baked)this.modeValue='reduced';
    return baked;
  }

  /** Explicit LOD demotion for distance/streaming pressure after a safe boundary. */
  bakeNow():BakedStructuralState|undefined{
    if(this.modeValue==='reduced')return;
    const baked=this.structure.bake();
    // bake() also queues the automatic handoff; consume that duplicate here.
    this.structure.takeBakedState();
    this.modeValue='reduced';
    return baked;
  }

  /**
   * Convenience for a normal contact when the contact solver has already
   * determined the impulse magnitude assigned to this vehicle.
   */
  activateFromNormalImpulse(
    rigid:ReducedRigidState,
    point:Vec3,
    normal:Vec3,
    impulseNs:number,
    normalEnergyJ:number,
  ):boolean{
    if(!Number.isFinite(impulseNs)||impulseNs<0)throw new RangeError('Contact impulse must be non-negative');
    const n=V3.normalize(normal);
    if(V3.length(n)<.999)throw new TypeError('Contact normal must be non-zero');
    return this.activate(rigid,{point,impulse:V3.scale(n,impulseNs),normalEnergyJ});
  }

  get stats():AdaptiveStructuralStats{
    const structural=this.structure.stats;
    return{
      mode:this.modeValue,
      activations:this.activations,
      rejectedContacts:this.rejectedContacts,
      thresholdJ:this.thresholdJ,
      structuralSteps:structural.steps,
      plasticWorkJ:structural.plasticWorkJ,
    };
  }
}
