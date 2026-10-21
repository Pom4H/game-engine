import {ENGINE_DEPTH} from '../core/depth.js';
import {ENGINE_DOMAINS} from '../core/domains.js';
import {AcousticWaveField,type BlastInjection} from '../physics/wave-field.js';
import {syncSceneAcousticBoundaries,type SceneAcousticBoundaryStats} from './acoustic-boundary.js';
import type {Scene} from './scene.js';
import type {Contact,RigidBody} from '../physics/world.js';
import type {Vec3} from '../math.js';
import type {WorldCoupling} from '../world-ir/couplings.js';

export interface AcousticListenerSpec {
  readonly entityId:string;
  /** Sensor is located at the authoritative entity origin (metres). */
}
export interface SceneAcousticCouplingOptions {
  readonly fieldId:string;
  readonly listeners?:readonly AcousticListenerSpec[];
  /**
   * Maximum CFL substeps allowed per Scene commit. Exceeding it is a hard
   * error, never a silent violation or time-dilation approximation.
   */
  readonly maxSubsteps?:number;
}
export interface AcousticSensorObservation {
  readonly listenerId:string;
  readonly positionM:Vec3;
  readonly rmsPressurePa:number;
  readonly peakAbsPressurePa:number;
  readonly samples:number;
  readonly timeSeconds:number;
}
export interface AcousticCouplingStats {
  readonly sourceContacts:number;
  readonly injectedSources:number;
  readonly sourceNoAirCells:number;
  /** Upper bound on dissipated normal-impulse energy eligible for radiation. */
  readonly contactDissipationBudgetJ:number;
  /** Actual increment in AcousticWaveField compressional energy at insertion. */
  readonly radiatedAcousticEnergyJ:number;
  readonly substeps:number;
  readonly audibleSensorSamples:number;
  readonly waveEnergyJ:number;
  readonly boundary?:SceneAcousticBoundaryStats;
}
const eps=1e-12;
function impedanceFraction(body:RigidBody,mediumImpedance:number):number{
  const material=body.material;
  // 1D plane-wave impedance matching is a physically motivated upper bound
  // for interface transmission, NOT a calibrated collision sound spectrum.
  const solidZ=Math.sqrt(material.density*material.mechanical.youngModulusPa);
  if(!Number.isFinite(solidZ)||solidZ<=0)return 0;
  return Math.min(1,4*mediumImpedance*solidZ/(mediumImpedance+solidZ)**2);
}
function dissipatedNormalEnergy(contact:Contact):number{
  if(contact.mode!=='resolve'||contact.normalSpeed<=0||contact.impulse<=0||
     contact.normalEnergy<=0)return 0;
  // For a resolved point impulse, delta normal kinetic energy is:
  // J*v_in - J²/(2*m_eff), with m_eff = 2*E_in/v_in².
  // Excludes penetration/fracture work and static surface manifolds, whose
  // reported impulses aggregate multiple contact points.
  const v=contact.normalSpeed,j=contact.impulse,e=contact.normalEnergy;
  const dissipated=j*v-j*j*v*v/(4*e);
  return Math.max(0,Math.min(e,dissipated));
}
function radius(body:RigidBody):number{
  return body.shape.kind==='sphere'?body.shape.radius:
    Math.min(...(body.collisionHalf??body.shape.half));
}

/**
 * Optional engine plugin connecting already-resolved rigid contact energy to
 * ONE existing acoustic medium and measuring physical RMS pressure at NPC ears.
 *
 * The plugin never changes PhysicsWorld bodies, materials, contact decisions,
 * event order, NPC intentions or rendering. It works with both TypeScript and
 * Rust/WASM contact backends and either acoustic numerical backend.
 *
 * The real wave field is the sole pressure authority: no parallel sound
 * attenuation/raycast or immediate "audible within radius" game trigger.
 */
export class SceneAcousticCoupling {
  readonly field:AcousticWaveField;
  readonly fieldId:string;
  readonly sourceCouplings:readonly WorldCoupling[];
  readonly hearingCouplings:readonly WorldCoupling[];
  private readonly scene:Scene;
  private readonly listenerIds:readonly string[];
  private readonly maxSubsteps:number;
  private readonly readings=new Map<string,AcousticSensorObservation>();
  private disposed=false;
  private cumulativeSources=0;
  private cumulativeRadiatedJ=0;
  private latest:AcousticCouplingStats=Object.freeze({
    sourceContacts:0,injectedSources:0,sourceNoAirCells:0,
    contactDissipationBudgetJ:0,radiatedAcousticEnergyJ:0,
    substeps:0,audibleSensorSamples:0,waveEnergyJ:0,
  });

  constructor(scene:Scene,field:AcousticWaveField,options:SceneAcousticCouplingOptions){
    if(!options.fieldId||options.fieldId.length>180)
      throw new TypeError('Scene acoustic field requires stable identity');
    const max=options.maxSubsteps??512;
    if(!Number.isSafeInteger(max)||max<1||max>8192)
      throw new RangeError('CFL substep cap must be 1..8192');
    const source=(scene.spec.couplings??[]).filter(c=>
      c.from==='physics.contact.energy'&&c.to==='acoustic.source.energy');
    const hearing=(scene.spec.couplings??[]).filter(c=>
      c.from==='acoustic.pressure'&&c.to==='npc.hearing.pressure');
    if(!source.length&&!hearing.length)
      throw new TypeError('World scene needs an acoustic source/hearing coupling');
    const listeners=options.listeners??[];
    if(listeners.length>256)throw new RangeError('Acoustic listeners exceed 256');
    const ids=new Set<string>();
    for(const listener of listeners){
      if(!listener.entityId||ids.has(listener.entityId)||!scene.entities.has(listener.entityId))
        throw new TypeError('Acoustic listener must reference one distinct existing entity');
      ids.add(listener.entityId);
    }
    this.scene=scene;
    this.field=field;
    this.fieldId=options.fieldId;
    this.maxSubsteps=max;
    this.sourceCouplings=Object.freeze([...source]);
    this.hearingCouplings=Object.freeze([...hearing]);
    this.listenerIds=Object.freeze([...ids]);
    scene.usePlugin({
      id:'engine.acoustic.'+this.fieldId,
      modules:[{
        id:'engine:acoustic:'+this.fieldId,
        phase:'commit',rateHz:60,reads:['contacts','entities','events','environment'],
        writes:['acoustic-field:'+this.fieldId,'npc-hearing'],
        // Cleanup mutates entity membership; the acoustic reader must run
        // after that explicit commit, not as an ambiguous sibling.
        after:['engine:cleanup'],
        depth:{axis:ENGINE_DOMAINS.audio,min:ENGINE_DEPTH.active},
        context:'none',
        run:(_context,frame)=>[{
          type:'system',action:'acoustic:'+this.fieldId,deltaSeconds:frame.deltaSeconds,
        }],
      }],
      systems:[{id:'acoustic:'+this.fieldId,run:(_scene,frame)=>this.step(frame.dt,frame.at)}],
    });
  }

  get diagnostics():AcousticCouplingStats{return this.latest;}
  get sourcesEverInjected():number{return this.cumulativeSources;}
  get totalRadiatedEnergyJ():number{return this.cumulativeRadiatedJ;}
  sensor(id:string):AcousticSensorObservation|undefined{return this.readings.get(id);}
  /** Disables plugin processing while preserving the WaveField's ownership. */
  close():void{this.disposed=true;this.readings.clear();}

  private step(dt:number,at:number):void{
    if(this.disposed)return;
    const substeps=Math.ceil(dt/this.field.maxStableDt);
    if(substeps>this.maxSubsteps)
      throw new RangeError('Acoustic CFL resolution exceeds configured substep cap');
    const boundary=syncSceneAcousticBoundaries(this.field,this.scene.entities.values());
    let sourceContacts=0,injectedSources=0,sourceNoAirCells=0,
      contactDissipationBudgetJ=0,radiatedAcousticEnergyJ=0;
    if(this.sourceCouplings.length)for(const contact of this.scene.physics.contacts){
      if(contact.b==='ground'||contact.mode!=='resolve')continue;
      const a=this.scene.physics.bodies.get(contact.a);
      const b=this.scene.physics.bodies.get(contact.b);
      if(!a||!b)continue;
      if(!this.sourceCouplings.some(link=>contact.normalEnergy>=(link.min??0)))continue;
      const energy=dissipatedNormalEnergy(contact);
      if(energy<=eps)continue;
      sourceContacts++;contactDissipationBudgetJ+=energy;
      const mediumZ=this.field.densityKgM3*this.field.waveSpeedMps;
      const tA=impedanceFraction(a,mediumZ),tB=impedanceFraction(b,mediumZ);
      const radiated=energy*(1-(1-tA)*(1-tB));
      if(radiated<=eps)continue;
      // A rigid contact is generally *inside* the two touching solid
      // occupancy masks. Radiate from the exposed air around the smaller
      // body's outer surface, accounting for the 3D cell diagonal of the
      // finite-volume raster. Never write pressure inside solid voxels.
      const sourceRadiusM=Math.min(radius(a),radius(b))+
        Math.sqrt(3)*this.field.cellSizeM;
      const result=this.field.injectEnergyPacket({
        position:contact.point,acousticEnergyJ:radiated,radiusM:sourceRadiusM,
      });
      if(!result){sourceNoAirCells++;continue;}
      injectedSources++;radiatedAcousticEnergyJ+=result.acousticEnergyJ;
      this.cumulativeSources++;this.cumulativeRadiatedJ+=result.acousticEnergyJ;
      this.scene.observeAcousticRadiation({
        contact,fieldId:this.fieldId,sourceRadiusM,dissipatedNormalEnergyJ:energy,
        acousticEnergyJ:result.acousticEnergyJ,
        transmissionFraction:radiated/energy,result,
      },at);
    }
    // RMS is sampled at the CFL substep rate, NOT at the 60 Hz Scene tick:
    // a high-frequency wave cannot disappear by undersampling sensor phase.
    const total=new Float64Array(this.listenerIds.length);
    const peak=new Float64Array(this.listenerIds.length);
    const positions:(Vec3|undefined)[]=this.listenerIds.map(id=>{
      const entity=this.scene.entities.get(id);
      return entity?[...entity.position]:undefined;
    });
    for(let sample=0;sample<substeps;sample++){
      this.field.step(dt/substeps);
      for(let i=0;i<positions.length;i++){
        const position=positions[i];if(!position)continue;
        const pressure=this.field.pressureAt(position),magnitude=Math.abs(pressure);
        total[i]=total[i]!+pressure*pressure;peak[i]=Math.max(peak[i]!,magnitude);
      }
    }
    let audibleSensorSamples=0;
    if(this.hearingCouplings.length)for(let i=0;i<this.listenerIds.length;i++){
      const position=positions[i];if(!position)continue;
      const rms=Math.sqrt(total[i]!/substeps);
      const hearing:AcousticSensorObservation=Object.freeze({
        listenerId:this.listenerIds[i]!,positionM:position,
        rmsPressurePa:rms,peakAbsPressurePa:peak[i]!,samples:substeps,timeSeconds:at,
      });
      this.readings.set(hearing.listenerId,hearing);
      if(rms<=0||!this.hearingCouplings.some(link=>rms>=(link.min??0)))continue;
      audibleSensorSamples++;
      this.scene.observeAcousticHearing({
        fieldId:this.fieldId,listenerId:hearing.listenerId,
        positionM:hearing.positionM,rmsPressurePa:rms,
        peakAbsPressurePa:hearing.peakAbsPressurePa,samples:substeps,
      },at);
    }
    this.latest=Object.freeze({
      sourceContacts,injectedSources,sourceNoAirCells,
      contactDissipationBudgetJ,radiatedAcousticEnergyJ,substeps,
      audibleSensorSamples,waveEnergyJ:this.field.compressionEnergyJ(),boundary,
    });
  }
}

export function attachSceneAcoustics(
  scene:Scene,field:AcousticWaveField,options:SceneAcousticCouplingOptions,
):SceneAcousticCoupling{
  return new SceneAcousticCoupling(scene,field,options);
}
