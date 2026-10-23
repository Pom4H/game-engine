/** Unified physical environment state for exposed surfaces and moving bodies.
 * Snow, water, ice and slush are phases of the same state, not separate engine
 * subsystems. Future mud, dust, moss and wear belong here as additional
 * consequences of material + environment + contact work.
 */
import type {EnvironmentState} from './types.js';
import type {RuntimeEntity} from '../scene/scene.js';
import type {SurfaceUse} from '../scene/types.js';
import {deriveSurfaceState,type SurfaceState} from '../materials/surface.js';
import {DeformableSurfaceField,surfaceFieldResolution} from './deformable-surface.js';

export type SnowDiagnosticClass='fresh-dry'|'wind-packed'|'settled'|'compacted'|'wet'|'slush'|'crust'|'granular'|'dirty-road';
export interface SnowLayerState {
  depthM:number;
  ageSeconds:number;
  densityKgM3:number;
  liquidFraction:number;
  iceFraction:number;
  grainSizeMm:number;
  windPacked:number;
}
export interface SnowpackState {
  readonly layers:SnowLayerState[];
  freshness:number;
  densityKgM3:number;
  liquidFraction:number;
  iceFraction:number;
  grainSizeMm:number;
  crust:number;
  windPacked:number;
  classification:SnowDiagnosticClass;
}

export interface SurfaceEnvironmentState {
  readonly id:string;
  readonly use:SurfaceUse;
  temperatureC:number;
  snowDepthM:number;
  waterDepthM:number;
  iceDepthM:number;
  slush:number;
  wetness:number;
  moss:number;
  dirt:number;
  wear:number;
  roughness:number;
  acousticDamping:number;
  darkening:number;
  trafficHeatC:number;
  trackMelt:number;
  puddle:number;
  frictionScale:number;
  /** Compact vertical history; diagnostic class never drives physics. */
  snowpack:SnowpackState;
}

export interface BodyEnvironmentState {
  readonly id:string;
  snowCoverage:number;
  rearSnow:number;
  wetness:number;
  roadDirt:number;
  directionX:number;
  directionZ:number;
}

export interface SurfaceEnvironmentField {readonly center:readonly[number,number];readonly size:readonly[number,number];readonly nx:number;readonly nz:number;readonly cells:SurfaceEnvironmentState[];readonly deformation:DeformableSurfaceField;revision:number}
export interface SurfaceContactWork {
  readonly sourceId:string;
  readonly surfaceId:string;
  readonly x:number;
  readonly z:number;
  readonly radiusM:number;
  readonly durationSeconds:number;
  readonly speedMps:number;
  readonly slipSpeedMps:number;
  readonly normalLoadN:number;
  readonly frictionCoefficient:number;
}
/** Physical work notification occurs only after a successful authoritative
 * field mutation. Listeners observe its committed result and never drive it. */
export type SurfaceWorkCommitObserver=(
  work:Readonly<SurfaceContactWork>,energyJ:number,touchedCells:number,actual:SurfaceEnvironmentState,
)=>void;
/** Per-material, per-weather-step coefficients. Every field cell observes the
 * same law inputs; only its mutable local state differs. Calculated once per
 * surface, not once per cell. Do not re-associate floating-point operations.
 */
interface SurfaceStepFactors {
  readonly snowfallDelta:number;
  readonly temperatureBase:number;
  readonly thermalBlend:number;
  readonly trafficHeatDecay:number;
  readonly trackMeltDecay:number;
  readonly drainageFraction:number;
}
function surfaceStepFactors(use:SurfaceUse,entity:RuntimeEntity,worldSeconds:number,environment:EnvironmentState):SurfaceStepFactors{
  const drift=use==='curb'?1.9:use==='sidewalk'?1.2:use==='road'?.78:1;
  const wind=Math.hypot(environment.wind[0],environment.wind[2]);
  const windDeposit=1+Math.min(.55,wind/12)*(use==='curb'?.8:use==='sidewalk'?.25:-.08);
  const coldSnow=environment.temperatureC<=1.2?1:Math.max(0,1-(environment.temperatureC-1.2)/2.5);
  const profile=entity.material.profile,thermal=profile.thermal;
  const volumetricCapacity=Math.max(1,profile.density*thermal.specificHeatJkgK);
  const referenceCapacity=2_000_000;
  const inertia=Math.sqrt(volumetricCapacity/referenceCapacity);
  const solarGain=10*thermal.solarAbsorptivity/Math.max(.45,inertia);
  const bulkCoupling=1+Math.sqrt(Math.max(.01,thermal.conductivityWmK))*.12;
  const thermalTau=Math.max(180,900*inertia*bulkCoupling);
  const drainageTau=use==='road'?2900:use==='sidewalk'?5200:use==='curb'?7600:4200;
  return{
    snowfallDelta:environment.snowfallRate*worldSeconds*drift*windDeposit*coldSnow,
    temperatureBase:environment.temperatureC+environment.sunlight*solarGain,
    thermalBlend:1-Math.exp(-worldSeconds/thermalTau),
    trafficHeatDecay:Math.exp(-worldSeconds/950),
    trackMeltDecay:Math.exp(-worldSeconds/5400),
    drainageFraction:1-Math.exp(-worldSeconds/drainageTau),
  };
}

/** Preserve the public Map mutation API while publishing membership changes.
 * Replacing a value or editing its numbers cannot change render eligibility. */
class SurfaceStateMap<V> extends Map<string,V> {
  constructor(private readonly changed:(id:string)=>void){super();}
  override set(id:string,value:V):this{const changed=!!this.get(id)!==!!value;super.set(id,value);if(changed)this.changed(id);return this;}
  override delete(id:string):boolean{const removed=super.delete(id);if(removed)this.changed(id);return removed;}
  override clear():void{if(!this.size)return;const ids=[...this.keys()];super.clear();for(const id of ids)this.changed(id);}
}
export class SurfaceEnvironmentSystem {
  private readonly renderStateIds=new Set<string>();
  private readonly workObservers=new Set<SurfaceWorkCommitObserver>();
  observeContactWork(observer:SurfaceWorkCommitObserver):()=>void{
    this.workObservers.add(observer);
    return()=>{this.workObservers.delete(observer);};
  }
  readonly fields:Map<string,SurfaceEnvironmentField>=new SurfaceStateMap(id=>this.updateRenderMembership(id));
  private readonly claimedContactBodies=new Set<string>();
  remove(id:string):void{this.surfaces.delete(id);this.bodies.delete(id);this.fields.delete(id);this.claimedContactBodies.delete(id);}
  claimContactBody(id:string):void{this.claimedContactBodies.add(id);}
  releaseContactBody(id:string):void{this.claimedContactBodies.delete(id);}
  field(id:string):SurfaceEnvironmentField|undefined{return this.fields.get(id);}
  sample(id:string,x:number,z:number):SurfaceEnvironmentState|undefined{
    const field=this.fields.get(id);if(!field)return undefined;
    const u=(x-field.center[0])/field.size[0]+.5,v=(z-field.center[1])/field.size[1]+.5;
    if(u<0||u>1||v<0||v>1)return undefined;
    return field.cells[Math.min(field.nz-1,Math.floor(v*field.nz))*field.nx+Math.min(field.nx-1,Math.floor(u*field.nx))];
  }
  readonly surfaces:Map<string,SurfaceEnvironmentState>=new SurfaceStateMap(id=>this.updateRenderMembership(id));
  readonly bodies:Map<string,BodyEnvironmentState>=new SurfaceStateMap(id=>this.updateRenderMembership(id));
  /** Presence index only. Physical values and state objects stay in their maps. */
  hasRenderState(id:string):boolean{return this.renderStateIds.has(id);}
  private updateRenderMembership(id:string):void{
    if(this.fields.get(id)||this.surfaces.get(id)||this.bodies.get(id))this.renderStateIds.add(id);else this.renderStateIds.delete(id);
  }

  /** Reconcile authored entities into physical state without advancing time. */
  reconcile(environment:EnvironmentState,entities:ReadonlyMap<string,RuntimeEntity>):void{
    for(const id of [...this.surfaces.keys(),...this.bodies.keys()])if(!entities.has(id))this.remove(id);
    this.ensureStates(environment,entities);
  }

  /**
   * Integrate finite pre-t=0 weather history on one representative state per
   * surface, then fan it out to the spatial field. Historical weather is spatially
   * uniform until contacts begin, so this is O(surfaces × history), not O(cells).
   */
  prewarm(steps:readonly {durationSeconds:number;environment:EnvironmentState}[],entities:ReadonlyMap<string,RuntimeEntity>):void{
    if(!steps.length)return;
    for(const step of steps){
      for(const [id,state] of this.surfaces){
        const entity=entities.get(id);if(!entity)continue;
        this.stepSnowpack(state,step.durationSeconds,step.environment);
        const exposure=deriveSurfaceState(entity.material.profile,entity.material,step.environment);
        const factors=surfaceStepFactors(state.use,entity,step.durationSeconds,step.environment);
        this.stepSurface(state,entity,0,step.durationSeconds,step.environment,exposure,factors);
        this.reconcileSnowpack(state);
      }
    }
    for(const [id,state] of this.surfaces){
      const field=this.fields.get(id);if(!field)continue;
      for(const cell of field.cells)copySurfaceState(state,cell);
      field.revision++;
    }
  }

  step(dt:number,worldSeconds:number,environment:EnvironmentState,entities:ReadonlyMap<string,RuntimeEntity>):void{
    this.reconcile(environment,entities);
    this.applyTraffic(dt,entities);
    for(const [id,state] of this.surfaces){
      const entity=entities.get(id);if(!entity)continue;
      const field=this.fields.get(id)!;
      this.stepSnowpack(state,worldSeconds,environment);
      // Material/weather exposure is identical for every spatial cell of this
      // one surface during a step; calculate it once, never once per cell.
      const exposure=deriveSurfaceState(entity.material.profile,entity.material,environment);
      const factors=surfaceStepFactors(state.use,entity,worldSeconds,environment);
      const sums=new Float64Array(SURFACE_AVERAGE_KEYS.length);
      let maximumTrackMelt=-Infinity;
      for(const cell of field.cells){
        this.stepSurface(cell,entity,dt,worldSeconds,environment,exposure,factors);
        // Same per-key summation order as the original separate reduce() loops.
        for(let i=0;i<SURFACE_AVERAGE_KEYS.length;i++){
          const key=SURFACE_AVERAGE_KEYS[i]!;
          sums[i]=sums[i]!+cell[key];
        }
        maximumTrackMelt=Math.max(maximumTrackMelt,cell.trackMelt);
      }
      field.deformation.relax(dt,state.slush);
      for(let i=0;i<SURFACE_AVERAGE_KEYS.length;i++){
        state[SURFACE_AVERAGE_KEYS[i]!]=sums[i]!/field.cells.length;
      }
      state.trackMelt=maximumTrackMelt;
      this.reconcileSnowpack(state);
      field.revision++;
    }
    for(const [id,state] of this.bodies){
      const entity=entities.get(id);if(!entity?.body||( !entity.body.invMass&&!entity.body.kinematic)){this.bodies.delete(id);continue;}
      this.stepBody(state,entity,dt,worldSeconds,environment);
    }
  }

  surface(id:string):SurfaceEnvironmentState|undefined{return this.surfaces.get(id);}
  body(id:string):BodyEnvironmentState|undefined{return this.bodies.get(id);}

  /** Apply localized mechanical work from an authoritative contact patch. */
  applyContactWork(work:SurfaceContactWork):boolean{
    if(!work.sourceId||!work.surfaceId||![work.x,work.z,work.radiusM,work.durationSeconds,work.speedMps,work.slipSpeedMps,work.normalLoadN,work.frictionCoefficient].every(Number.isFinite)||work.radiusM<=0||work.durationSeconds<=0||work.normalLoadN<0||work.frictionCoefficient<0)return false;
    const field=this.fields.get(work.surfaceId);if(!field)return false;
    const cellX=field.size[0]/field.nx,cellZ=field.size[1]/field.nz,halfDiag=Math.hypot(cellX,cellZ)*.5;
    const localX=work.x-field.center[0]+field.size[0]/2,localZ=work.z-field.center[1]+field.size[1]/2;
    const minX=Math.max(0,Math.floor((localX-work.radiusM-halfDiag)/cellX)),maxX=Math.min(field.nx-1,Math.floor((localX+work.radiusM+halfDiag)/cellX));
    const minZ=Math.max(0,Math.floor((localZ-work.radiusM-halfDiag)/cellZ)),maxZ=Math.min(field.nz-1,Math.floor((localZ+work.radiusM+halfDiag)/cellZ));
    const touched:SurfaceEnvironmentState[]=[];
    for(let iz=minZ;iz<=maxZ;iz++)for(let ix=minX;ix<=maxX;ix++){
      const x=field.center[0]+((ix+.5)/field.nx-.5)*field.size[0],z=field.center[1]+((iz+.5)/field.nz-.5)*field.size[1];
      if(Math.hypot(x-work.x,z-work.z)<=work.radiusM+halfDiag)touched.push(field.cells[iz*field.nx+ix]!);
    }
    if(!touched.length)return false;
    const effectiveSlip=work.slipSpeedMps+work.speedMps*.018;
    const energy=Math.max(0,work.normalLoadN*work.frictionCoefficient*effectiveSlip*work.durationSeconds),energyPerCell=energy/touched.length;
    for(const surface of touched){
      surface.trafficHeatC=Math.min(12,surface.trafficHeatC+energyPerCell/1.8e6);
      surface.trackMelt=Math.min(1,surface.trackMelt+Math.min(1,energyPerCell/85_000)*.12);
      const wet=surface.waterDepthM>0||surface.snowDepthM>0||surface.slush>.02?1:.1;
      surface.dirt=Math.min(1,surface.dirt+work.speedMps*work.durationSeconds*.0008*wet);
    }
    const bodyState=this.bodies.get(work.sourceId),sample=this.sample(work.surfaceId,work.x,work.z);
    if(sample){
      const looseDepth=sample.snowDepthM+sample.waterDepthM*.35+sample.slush*.012;
      const loadScale=Math.min(1.35,work.normalLoadN/3600),depth=Math.min(work.radiusM*.18,looseDepth*.95)*Math.min(1,.28+.72*loadScale);
      if(depth>.00015)field.deformation.stamp({x:work.x,z:work.z,radiusM:Math.max(.06,work.radiusM),depthM:depth,compaction:Math.min(1,.25+loadScale*.55),shear:Math.min(1,(work.slipSpeedMps+work.speedMps*.035)/5),displacementRatio:.78});
    }
    if(bodyState&&sample){
      const spray=Math.min(1,(sample.slush+sample.puddle)*work.speedMps/8),mud=Math.min(1,sample.dirt*(.35+.65*sample.wetness)+sample.slush*.25);
      bodyState.rearSnow=Math.min(1,bodyState.rearSnow+spray*work.durationSeconds*.13);
      bodyState.roadDirt=Math.min(1,bodyState.roadDirt+spray*work.durationSeconds*(.09+.42*mud));
      bodyState.wetness=Math.min(1,bodyState.wetness+spray*work.durationSeconds*.15);
    }
    field.revision++;
    for(const observer of this.workObservers)observer(work,energy,touched.length,sample??touched[0]!);
    return true;
  }

  private ensureStates(environment:EnvironmentState,entities:ReadonlyMap<string,RuntimeEntity>):void{
    for(const entity of entities.values()){
      const use=entity.environmental?.surfaceUse;
      if(use&&!this.surfaces.has(entity.id)){
        const authored=entity.material.surface,snowDepthM=entity.environmental?.snowDepthM??0,waterDepthM=entity.environmental?.waterDepthM??0,iceDepthM=entity.environmental?.iceDepthM??0;
        const snowFactor=Math.min(1,snowDepthM/.025),iceFactor=Math.min(1,iceDepthM/.003),waterFactor=Math.min(1,waterDepthM/.003);
        const phaseFriction=Math.max(.16,1-snowFactor*.42-iceFactor*.72-waterFactor*.12);
        // A loaded scene is already a physical state. A snow+water mixture must
        // therefore read as slush even before the first simulation tick; paused
        // editors, deterministic frame renders and replay seeks all use this path.
        const initialWetRatio=waterDepthM/(waterDepthM+snowDepthM+.002);
        const initialSlush=Math.max(0,Math.min(1,snowDepthM>.0005?initialWetRatio*1.45:0));
        const snowpack=createSnowpack(snowDepthM,waterDepthM,iceDepthM,environment.temperatureC,use);
        this.surfaces.set(entity.id,{
          id:entity.id,use,temperatureC:environment.temperatureC,snowDepthM,waterDepthM,iceDepthM,
          slush:initialSlush,wetness:Math.max(authored.wetness,waterFactor,initialSlush*.72),moss:authored.moss,dirt:Math.max(authored.dirt,use==='road'?initialSlush*.12:0),wear:authored.wear,roughness:authored.roughness,acousticDamping:authored.acousticDamping,darkening:authored.darkening,
          trafficHeatC:0,trackMelt:0,puddle:Math.max(0,Math.min(1,waterDepthM/.006)),frictionScale:Math.max(.08,Math.min(1.18,authored.frictionScale*phaseFriction)),snowpack,
        });
      }
      if(use&&!this.fields.has(entity.id)){
        const half=horizontalHalf(entity),size=[half[0]*2,half[1]*2] as const,[nx,nz]=surfaceFieldResolution(size,entity.environmental?.fieldCellSizeM),center=[entity.position[0],entity.position[2]] as const;
        this.fields.set(entity.id,{center,size,nx,nz,revision:0,cells:Array.from({length:nx*nz},()=>({...this.surfaces.get(entity.id)!})),deformation:new DeformableSurfaceField(center,size,nx,nz)});
      }
      if((entity.body?.invMass||entity.body?.kinematic)&&!this.bodies.has(entity.id)){
        this.bodies.set(entity.id,{id:entity.id,snowCoverage:0,rearSnow:0,wetness:0,roadDirt:0,directionX:1,directionZ:0});
      }
    }
  }

  private applyTraffic(dt:number,entities:ReadonlyMap<string,RuntimeEntity>):void{
    for(const [bodyId,bodyState] of this.bodies){
      if(this.claimedContactBodies.has(bodyId))continue;
      const bodyEntity=entities.get(bodyId),body=bodyEntity?.body;if(!bodyEntity||!body)continue;
      const vx=body.velocity[0],vz=body.velocity[2],speed=Math.hypot(vx,vz);
      if(speed>.1){bodyState.directionX=vx/speed;bodyState.directionZ=vz/speed;}
      if(speed<.45)continue;
      for(const [surfaceId,summary] of this.surfaces){
        const surfaceEntity=entities.get(surfaceId);if(!surfaceEntity||summary.use!=='road'||!containsXZ(surfaceEntity,bodyEntity.position[0],bodyEntity.position[2]))continue;
        const top=surfaceTop(surfaceEntity),bottom=bodyEntity.position[1]-verticalHalf(bodyEntity);
        // A supported contact is required; an airborne body deposits no work.
        if(Math.abs(bottom-top)>.025||Math.abs(body.velocity[1])>.2)continue;
        const surface=this.sample(surfaceId,bodyEntity.position[0],bodyEntity.position[2]);if(!surface)continue;
        // Sliding work estimate at the supported footprint (kinematic motor load uses m*g).
        const load=Math.max(1,body.mass)*9.81,contactWork=load*Math.sqrt(Math.max(0,body.friction*surfaceEntity.body!.friction))*speed*dt;
        const field=this.fields.get(surfaceId)!,half=horizontalHalf(bodyEntity),touched:SurfaceEnvironmentState[]=[];
        for(let iz=0;iz<field.nz;iz++)for(let ix=0;ix<field.nx;ix++){
          const x=field.center[0]+((ix+.5)/field.nx-.5)*field.size[0],z=field.center[1]+((iz+.5)/field.nz-.5)*field.size[1];
          if(Math.abs(x-body.position[0])<=half[0]+field.size[0]/field.nx/2&&Math.abs(z-body.position[2])<=half[1]+field.size[1]/field.nz/2)touched.push(field.cells[iz*field.nx+ix]!);
        }
        const workPerCell=contactWork/Math.max(1,touched.length);
        for(const surface of touched){
        surface.trafficHeatC=Math.min(12,surface.trafficHeatC+workPerCell/1.8e6);
        surface.trackMelt=Math.min(1,surface.trackMelt+Math.min(1,workPerCell/85_000)*.12);
        surface.dirt=Math.min(1,surface.dirt+dt*speed*.0008*(surface.waterDepthM>0||surface.snowDepthM>0?1:.1));
        }
        const looseDepth=surface.snowDepthM+surface.waterDepthM*.35+surface.slush*.012;
        const depth=Math.min(Math.max(half[0],half[1])*.12,looseDepth*.8);
        if(depth>.00015)field.deformation.stamp({x:bodyEntity.position[0],z:bodyEntity.position[2],radiusM:Math.max(.12,Math.min(half[0],half[1])*.7),depthM:depth,compaction:.55,shear:Math.min(1,speed/10),displacementRatio:.74});
        const spray=Math.min(1,(surface.slush+surface.puddle)*speed/8),mud=Math.min(1,surface.dirt*(.35+.65*surface.wetness)+surface.slush*.25);
        bodyState.rearSnow=Math.min(1,bodyState.rearSnow+spray*dt*.13);
        bodyState.roadDirt=Math.min(1,bodyState.roadDirt+spray*dt*(.09+.42*mud));
        bodyState.wetness=Math.min(1,bodyState.wetness+spray*dt*.15);
      }
    }
  }

  private stepSnowpack(state:SurfaceEnvironmentState,worldSeconds:number,environment:EnvironmentState):void{
    const pack=state.snowpack,use=state.use,wind=Math.hypot(environment.wind[0],environment.wind[2]);
    for(const layer of pack.layers){
      layer.ageSeconds+=worldSeconds;
      const warm=Math.max(0,environment.temperatureC+1.5),hours=worldSeconds/3600;
      layer.grainSizeMm=Math.min(4.5,layer.grainSizeMm+hours*(.004+.010*warm)*(1+layer.liquidFraction*.8));
      layer.densityKgM3=Math.min(560,layer.densityKgM3+hours*(.35+.45*warm+Math.min(10,wind)*.09));
      layer.windPacked=Math.min(1,Math.max(layer.windPacked,wind/14)*(Math.exp(-worldSeconds/432000)));
      if(environment.temperatureC>.15){
        const wet=Math.min(.72-layer.liquidFraction,hours*environment.temperatureC*.012);if(wet>0)layer.liquidFraction+=wet;
        const thaw=Math.min(layer.iceFraction,hours*environment.temperatureC*.018);layer.iceFraction-=thaw;layer.liquidFraction=Math.min(.8,layer.liquidFraction+thaw*.65);
      }else if(environment.temperatureC<-.35&&layer.liquidFraction>0){
        const freeze=Math.min(layer.liquidFraction,hours*Math.abs(environment.temperatureC)*.018);layer.liquidFraction-=freeze;layer.iceFraction=Math.min(1,layer.iceFraction+freeze*.9);
      }
    }
    const drift=use==='curb'?1.9:use==='sidewalk'?1.2:use==='road'?.78:1;
    const windDeposit=1+Math.min(.55,wind/12)*(use==='curb'?.8:use==='sidewalk'?.25:-.08);
    const coldSnow=environment.temperatureC<=1.2?1:Math.max(0,1-(environment.temperatureC-1.2)/2.5);
    const deposited=environment.snowfallRate*worldSeconds*drift*windDeposit*coldSnow;
    if(deposited>.00005){
      const warmFresh=Math.max(0,Math.min(1,(environment.temperatureC+12)/13)),density=70+warmFresh*75+Math.min(10,wind)*5;
      const fresh:SnowLayerState={depthM:deposited,ageSeconds:0,densityKgM3:density,liquidFraction:Math.max(0,environment.temperatureC)*.04,iceFraction:0,grainSizeMm:.18+warmFresh*.18,windPacked:Math.min(1,wind/12)};
      const top=pack.layers[0];
      if(top&&top.ageSeconds<1800&&Math.abs(top.densityKgM3-density)<45)mergeLayerInto(top,fresh);
      else pack.layers.unshift(fresh);
      while(pack.layers.length>4){const older=pack.layers.pop()!,target=pack.layers.at(-1)!;mergeLayerInto(target,older);}
    }
  }

  private reconcileSnowpack(state:SurfaceEnvironmentState):void{
    const pack=state.snowpack,target=Math.max(0,state.snowDepthM);
    let total=pack.layers.reduce((sum,layer)=>sum+layer.depthM,0);
    if(target<total-.000001){
      let remove=total-target;
      for(let i=0;i<pack.layers.length&&remove>0;){
        const layer=pack.layers[i]!,take=Math.min(layer.depthM,remove);layer.depthM-=take;remove-=take;
        if(layer.depthM<1e-6)pack.layers.splice(i,1);else i++;
      }
    }else if(target>total+.000001){
      const delta=target-total,top=pack.layers[0];
      if(top)top.depthM+=delta;else pack.layers.push({depthM:delta,ageSeconds:0,densityKgM3:120,liquidFraction:0,iceFraction:0,grainSizeMm:.28,windPacked:0});
    }
    total=pack.layers.reduce((sum,layer)=>sum+layer.depthM,0);
    const weighted=(selector:(layer:SnowLayerState)=>number,fallback=0)=>total>1e-9?pack.layers.reduce((sum,layer)=>sum+selector(layer)*layer.depthM,0)/total:fallback;
    const top=pack.layers[0];
    pack.freshness=top?Math.exp(-top.ageSeconds/21600)*Math.max(0,1-top.liquidFraction*.7-top.iceFraction*.55):0;
    pack.densityKgM3=weighted(layer=>layer.densityKgM3,0);
    pack.liquidFraction=weighted(layer=>layer.liquidFraction,0);
    pack.iceFraction=weighted(layer=>layer.iceFraction,0);
    pack.grainSizeMm=weighted(layer=>layer.grainSizeMm,.25);
    pack.windPacked=weighted(layer=>layer.windPacked,0);
    pack.crust=Math.max(0,...pack.layers.map(layer=>layer.iceFraction*Math.min(1,.35+layer.densityKgM3/420)));
    pack.classification=classifySnowpack(pack,state);
  }

  private stepSurface(state:SurfaceEnvironmentState,entity:RuntimeEntity,dt:number,worldSeconds:number,environment:EnvironmentState,exposure:SurfaceState,factors:SurfaceStepFactors):void{
    const use=state.use,profile=entity.material.profile;
    state.snowDepthM+=factors.snowfallDelta;
    // Authoritative material thermal/solar laws were evaluated once for this
    // surface. Applying the same coefficients to every cell preserves the
    // original state transition and the exact order of floating arithmetic.
    const target=factors.temperatureBase+state.trafficHeatC;
    state.temperatureC+=(target-state.temperatureC)*factors.thermalBlend;
    state.trafficHeatC*=factors.trafficHeatDecay;
    state.trackMelt*=factors.trackMeltDecay;

    // Integrate phase change independently in each contacted grid cell.
    const positive=Math.max(0,state.temperatureC),trafficMelt=use==='road'?state.trackMelt*1.7e-5*worldSeconds:0;
    const thermalMelt=Math.min(state.snowDepthM,positive*1.3e-6*worldSeconds+trafficMelt);
    state.snowDepthM-=thermalMelt;state.waterDepthM+=thermalMelt;

    if(state.temperatureC<-.25&&state.waterDepthM>0){
      const freeze=Math.min(state.waterDepthM,Math.abs(state.temperatureC)*5e-7*worldSeconds);
      state.waterDepthM-=freeze;state.iceDepthM+=freeze;
    }else if(state.temperatureC>.2&&state.iceDepthM>0){
      const thaw=Math.min(state.iceDepthM,state.temperatureC*7e-7*worldSeconds);
      state.iceDepthM-=thaw;state.waterDepthM+=thaw;
    }

    const snowWetRatio=state.waterDepthM/(state.waterDepthM+state.snowDepthM+.002);
    state.slush=Math.max(0,Math.min(1,(state.snowDepthM>.0005?snowWetRatio*1.45:0)+(use==='road'?state.trackMelt*.5:0)));
    state.dirt=Math.min(1,state.dirt+state.slush*(use==='road'?.00012:.00003)*worldSeconds);

    // Drainage leaves water in low procedural depressions; roads drain faster but
    // tyre ruts retain local puddles.
    const drained=state.waterDepthM*factors.drainageFraction;
    state.waterDepthM=Math.max(0,state.waterDepthM-drained);
    const retention=use==='road'?.55+state.trackMelt*.55:use==='curb'?.85:.66;
    state.puddle=Math.max(0,Math.min(1,state.waterDepthM/.006*retention));

    const waterFactor=Math.min(1,state.waterDepthM/.003),snowFactor=Math.min(1,state.snowDepthM/.025),iceFactor=Math.min(1,state.iceDepthM/.003);
    state.wetness=Math.max(exposure.wetness,waterFactor,state.slush*.72);
    state.moss=exposure.moss;
    state.wear=exposure.wear;
    // Traffic/slush dirt is persistent state; authored aging supplies its floor.
    state.dirt=Math.max(exposure.dirt,state.dirt);
    state.roughness=Math.max(.02,Math.min(1,exposure.roughness+state.dirt*.045-state.wetness*.07+state.slush*.05));
    state.acousticDamping=Math.max(0,Math.min(1,profile.acoustic.damping+state.wetness*.22+state.moss*.34+state.slush*.12));
    state.darkening=Math.max(0,Math.min(1,exposure.darkening+state.wetness*.18+state.dirt*.08));
    const phaseFriction=Math.max(.16,1-snowFactor*.42-iceFactor*.72-state.slush*.5-waterFactor*.12);
    state.frictionScale=Math.max(.08,Math.min(1.18,exposure.frictionScale*phaseFriction));

  }

  private stepBody(state:BodyEnvironmentState,entity:RuntimeEntity,dt:number,worldSeconds:number,environment:EnvironmentState):void{
    const body=entity.body;if(!body)return;
    const speed=Math.hypot(body.velocity[0],body.velocity[2]),cold=environment.temperatureC<1.5?1:Math.max(0,1-(environment.temperatureC-1.5)/3);
    const deposition=environment.snowfallRate*worldSeconds*42*cold;
    const shedding=Math.min(.9,speed/24);
    state.snowCoverage=Math.min(1,Math.max(0,state.snowCoverage+deposition*(1-shedding*.72)-speed*dt*.00045));
    // Wake/recirculation makes the rear retain more snow than forward-facing areas.
    state.rearSnow=Math.min(1,Math.max(0,state.rearSnow+deposition*(.25+shedding*.95)-speed*dt*.00012));
    if(environment.temperatureC>0||environment.sunlight>.2){
      const melt=(Math.max(0,environment.temperatureC)*.0018+environment.sunlight*.0045)*worldSeconds/60;
      state.snowCoverage=Math.max(0,state.snowCoverage-melt);
      state.rearSnow=Math.max(0,state.rearSnow-melt*.62);
      state.wetness=Math.min(1,state.wetness+melt*.8);
    }
    state.wetness*=Math.exp(-worldSeconds/2600);
  }
}

const SURFACE_AVERAGE_KEYS=['temperatureC','snowDepthM','waterDepthM','iceDepthM','slush','wetness','moss','dirt','wear','roughness','acousticDamping','darkening','trafficHeatC','puddle','frictionScale'] as const;

function createSnowpack(snowDepthM:number,waterDepthM:number,iceDepthM:number,temperatureC:number,use:SurfaceUse):SnowpackState{
  const liquid=waterDepthM/(waterDepthM+snowDepthM+.002),ice=Math.min(1,iceDepthM/.004),layers:SnowLayerState[]=snowDepthM>.00001?[{depthM:snowDepthM,ageSeconds:43200,densityKgM3:use==='road'?260:210,liquidFraction:Math.min(.7,liquid),iceFraction:ice,grainSizeMm:temperatureC>-1?1.05:.72,windPacked:0}]:[];
  const pack:SnowpackState={layers,freshness:0,densityKgM3:0,liquidFraction:0,iceFraction:0,grainSizeMm:.25,crust:0,windPacked:0,classification:'settled'};
  const dummy={use,snowDepthM,waterDepthM,iceDepthM,slush:Math.min(1,liquid),dirt:0} as Pick<SurfaceEnvironmentState,'use'|'snowDepthM'|'waterDepthM'|'iceDepthM'|'slush'|'dirt'>;
  updateSnowpackSummary(pack,dummy);return pack;
}
function mergeLayerInto(target:SnowLayerState,source:SnowLayerState):void{
  const total=target.depthM+source.depthM;if(total<=0)return;
  const mix=(a:number,b:number)=>(a*target.depthM+b*source.depthM)/total;
  target.ageSeconds=mix(target.ageSeconds,source.ageSeconds);target.densityKgM3=mix(target.densityKgM3,source.densityKgM3);target.liquidFraction=mix(target.liquidFraction,source.liquidFraction);target.iceFraction=mix(target.iceFraction,source.iceFraction);target.grainSizeMm=mix(target.grainSizeMm,source.grainSizeMm);target.windPacked=mix(target.windPacked,source.windPacked);target.depthM=total;
}
function updateSnowpackSummary(pack:SnowpackState,state:Pick<SurfaceEnvironmentState,'use'|'snowDepthM'|'waterDepthM'|'iceDepthM'|'slush'|'dirt'>):void{
  const total=pack.layers.reduce((sum,layer)=>sum+layer.depthM,0),weighted=(selector:(layer:SnowLayerState)=>number,fallback=0)=>total>1e-9?pack.layers.reduce((sum,layer)=>sum+selector(layer)*layer.depthM,0)/total:fallback,top=pack.layers[0];
  pack.freshness=top?Math.exp(-top.ageSeconds/21600)*Math.max(0,1-top.liquidFraction*.7-top.iceFraction*.55):0;pack.densityKgM3=weighted(layer=>layer.densityKgM3);pack.liquidFraction=weighted(layer=>layer.liquidFraction);pack.iceFraction=weighted(layer=>layer.iceFraction);pack.grainSizeMm=weighted(layer=>layer.grainSizeMm,.25);pack.windPacked=weighted(layer=>layer.windPacked);pack.crust=Math.max(0,...pack.layers.map(layer=>layer.iceFraction*Math.min(1,.35+layer.densityKgM3/420)));pack.classification=classifySnowpack(pack,state);
}
function classifySnowpack(pack:SnowpackState,state:Pick<SurfaceEnvironmentState,'use'|'snowDepthM'|'waterDepthM'|'iceDepthM'|'slush'|'dirt'>):SnowDiagnosticClass{
  if(state.use==='road'&&state.dirt>.18&&(state.slush>.12||pack.liquidFraction>.15))return'dirty-road';
  if(state.slush>.35)return'slush';
  if(pack.crust>.34||pack.iceFraction>.28)return'crust';
  if(pack.liquidFraction>.20)return'wet';
  if(pack.freshness>.58&&pack.densityKgM3<180)return'fresh-dry';
  if(pack.windPacked>.48)return'wind-packed';
  if(pack.densityKgM3>390)return'compacted';
  if(pack.grainSizeMm>1.35)return'granular';
  return'settled';
}
function copySurfaceState(source:SurfaceEnvironmentState,target:SurfaceEnvironmentState):void{
  for(const key of SURFACE_AVERAGE_KEYS)target[key]=source[key];target.trackMelt=source.trackMelt;target.snowpack=source.snowpack;
}

function containsXZ(entity:RuntimeEntity,x:number,z:number):boolean{
  const mesh=entity.mesh,dx=x-entity.position[0],dz=z-entity.position[2];
  if(mesh?.kind==='polygon-prism'&&(mesh.axis??2)===1){
    const c=Math.cos(entity.rotation[1]),s=Math.sin(entity.rotation[1]),u=(c*dx-s*dz)/entity.scale[0],v=(s*dx+c*dz)/entity.scale[2];let inside=false;
    for(let i=0,j=mesh.points.length-1;i<mesh.points.length;j=i++){
      const a=mesh.points[i]!,b=mesh.points[j]!;if((a[1]>v)!==(b[1]>v)&&u<(b[0]-a[0])*(v-a[1])/(b[1]-a[1])+a[0])inside=!inside;
    }return inside;
  }
  const half=horizontalHalf(entity);return Math.abs(dx)<=half[0]&&Math.abs(dz)<=half[1];
}
function horizontalHalf(entity:RuntimeEntity):readonly[number,number]{
  const mesh=entity.mesh;
  if(mesh?.kind==='box'||mesh?.kind==='shard')return[(mesh.size?.[0]??1)*entity.scale[0]/2,(mesh.size?.[2]??1)*entity.scale[2]/2];
  if(mesh?.kind==='plane')return[(mesh.size?.[0]??1)*entity.scale[0]/2,(mesh.size?.[1]??1)*entity.scale[2]/2];
  if(mesh?.kind==='polygon-prism'&&(mesh.axis??2)===1){const c=Math.cos(entity.rotation[1]),s=Math.sin(entity.rotation[1]);let x=0,z=0;for(const p of mesh.points){const u=p[0]*entity.scale[0],v=p[1]*entity.scale[2];x=Math.max(x,Math.abs(c*u+s*v));z=Math.max(z,Math.abs(-s*u+c*v));}return[x,z];}
  if(mesh?.kind==='sphere'){const r=(mesh.radius??1)*Math.max(entity.scale[0],entity.scale[2]);return[r,r];}
  return[.5,.5];
}
function surfaceTop(entity:RuntimeEntity):number{
  const mesh=entity.mesh;if(mesh?.kind==='box'||mesh?.kind==='shard')return entity.position[1]+(mesh.size?.[1]??1)*entity.scale[1]/2;
  if(mesh?.kind==='polygon-prism'&&(mesh.axis??2)===1)return entity.position[1]+mesh.thickness*entity.scale[1]/2;
  return entity.position[1];
}
function verticalHalf(entity:RuntimeEntity):number{
  const mesh=entity.mesh;if(mesh?.kind==='box'||mesh?.kind==='shard')return(mesh.size?.[1]??1)*entity.scale[1]/2;
  if(mesh?.kind==='sphere')return(mesh.radius??1)*entity.scale[1];
  return.5;
}
