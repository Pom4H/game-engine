import {material,thermalLinearScale,type MaterialKind} from '../materials/catalog.js';
import type {Vec3} from '../math.js';
import {V3} from '../math.js';
import {applyStructuralSkin} from '../physics/structural-skin.js';
import {StructuralBody} from '../physics/structure.js';
import type {EngineEvent,ImpactEvent,MechanismEvent} from '../scene/events.js';
import type {Primitive} from '../scene/types.js';
import {M3_PARAMETRIC_PROFILE,m3DamagedRenderBody,m3SmoothRenderBody,m3StructuralBlueprint,type M3StructuralBlueprint} from './m3.js';

const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));

export interface PanelImpactInput {
  readonly point:Vec3;
  /** Outward panel normal. Positive impact energy deflects opposite this normal. */
  readonly normal:Vec3;
  readonly energyJ:number;
  readonly radiusM:number;
  readonly thicknessM:number;
  readonly material?:MaterialKind;
}

export interface PanelMode {
  point:Vec3;
  normal:Vec3;
  radius:number;
  elastic:number;
  velocity:number;
  plastic:number;
  omega:number;
  damping:number;
}

export interface PanelImpactResult {
  readonly elasticEnergyJ:number;
  readonly plasticEnergyJ:number;
  readonly yieldEnergyJ:number;
  readonly permanentDepthM:number;
}

/**
 * Thin-panel response layered over a sparse load-bearing cage.
 * Energy below yield excites a damped elastic mode and returns to zero.
 * Only work above the material yield-energy estimate changes the permanent rest shape.
 */
export class ElasticPlasticPanelResponse {
  private readonly modes:PanelMode[]=[];
  plasticWorkJ=0;

  impact(input:PanelImpactInput):PanelImpactResult{
    if(!input.point.every(Number.isFinite)||!input.normal.every(Number.isFinite)||!Number.isFinite(input.energyJ)||input.energyJ<0||!Number.isFinite(input.radiusM)||input.radiusM<=0||!Number.isFinite(input.thicknessM)||input.thicknessM<=0)throw new TypeError('Invalid panel impact');
    const kind=input.material??'steel',profile=material(kind),mechanical=profile.mechanical,normal=V3.normalize(input.normal);
    if(V3.length(normal)<.99)throw new TypeError('Panel impact normal must be non-zero');
    const radius=clamp(input.radiusM,.035,1.2),area=Math.PI*radius*radius,volume=area*input.thicknessM;
    const yieldEnergy=.5*mechanical.yieldStressPa*mechanical.yieldStressPa/Math.max(1,mechanical.youngModulusPa)*volume;
    const elasticEnergy=Math.min(input.energyJ,yieldEnergy);
    const plasticEnergy=mechanical.brittle?0:Math.max(0,input.energyJ-yieldEnergy)*mechanical.plasticity;
    // Curved automotive sheet is substantially stiffer than a flat unsupported plate.
    const stiffness=Math.max(2_000,mechanical.youngModulusPa*input.thicknessM**3/Math.max(.0025,radius*radius)*80);
    const modalMass=clamp(profile.density*volume*5,.65,18),omega=Math.sqrt(stiffness/modalMass),amplitude=Math.sqrt(2*elasticEnergy/stiffness);
    const workPerMetre=Math.max(250,mechanical.yieldStressPa*area*input.thicknessM/Math.max(.035,radius)*.05);
    const permanent=plasticEnergy/workPerMetre;
    let mode=this.modes.find(candidate=>V3.length(V3.sub(candidate.point,input.point))<Math.min(candidate.radius,radius)*.42&&V3.dot(candidate.normal,normal)>.82);
    if(!mode){
      mode={point:[...input.point],normal:[...normal],radius,elastic:0,velocity:0,plastic:0,omega,damping:kind==='glass'?.11:.24};
      this.modes.push(mode);if(this.modes.length>32)this.modes.shift();
    }
    mode.radius=Math.max(mode.radius,radius);mode.omega=(mode.omega+omega)*.5;
    mode.elastic-=amplitude;
    // Inject the same elastic energy as modal velocity as well, producing a short ring/flex transient.
    mode.velocity-=Math.sqrt(Math.max(0,2*elasticEnergy/modalMass))*.35;
    mode.plastic-=permanent;
    this.plasticWorkJ+=plasticEnergy;
    return{elasticEnergyJ:elasticEnergy,plasticEnergyJ:plasticEnergy,yieldEnergyJ:yieldEnergy,permanentDepthM:Math.abs(permanent)};
  }

  step(dt:number):void{
    if(!Number.isFinite(dt)||dt<=0||dt>.05)throw new RangeError('Panel response dt must be in (0,.05]');
    for(const mode of this.modes){
      // Integrate the damped panel mode analytically. Automotive/glass local modes can be
      // several kHz; an explicit or semi-implicit Euler step at 120 Hz is unstable there
      // even though the physical response itself is perfectly bounded.
      const omega=mode.omega,zeta=clamp(mode.damping,0,.999999),wd=omega*Math.sqrt(Math.max(1e-12,1-zeta*zeta));
      const decay=Math.exp(-zeta*omega*dt),c=Math.cos(wd*dt),s=Math.sin(wd*dt);
      const x0=mode.elastic,v0=mode.velocity,b=(v0+zeta*omega*x0)/wd,osc=x0*c+b*s;
      const x=decay*osc,v=decay*(-zeta*omega*osc-x0*wd*s+b*wd*c);
      if(!Number.isFinite(x)||!Number.isFinite(v))throw new Error('Non-finite panel mode response');
      mode.elastic=x;mode.velocity=v;
      if(Math.abs(mode.elastic)<2e-6&&Math.abs(mode.velocity)<2e-5){mode.elastic=0;mode.velocity=0;}
    }
  }

  deform(positions:readonly number[]|Float32Array|Float64Array,output:Float32Array|Float64Array|number[]):void{
    if(output.length!==positions.length||positions.length%3)throw new RangeError('Panel deformation buffers must match xyz triples');
    for(let i=0;i<positions.length;i+=3){
      let x=positions[i]!,y=positions[i+1]!,z=positions[i+2]!;
      for(const mode of this.modes){
        const dx=x-mode.point[0],dy=y-mode.point[1],dz=z-mode.point[2],axial=dx*mode.normal[0]+dy*mode.normal[1]+dz*mode.normal[2];
        const rx=dx-axial*mode.normal[0],ry=dy-axial*mode.normal[1],rz=dz-axial*mode.normal[2],r=Math.hypot(rx,ry,rz);
        if(r>mode.radius*1.65||Math.abs(axial)>mode.radius*.9)continue;
        const weight=Math.exp(-3.1*(r/mode.radius)**2)*Math.exp(-4*Math.abs(axial)/mode.radius),depth=(mode.elastic+mode.plastic)*weight;
        x+=mode.normal[0]*depth;y+=mode.normal[1]*depth;z+=mode.normal[2]*depth;
      }
      output[i]=x;output[i+1]=y;output[i+2]=z;
    }
  }

  get maxPermanentDepthM():number{return this.modes.reduce((max,mode)=>Math.max(max,Math.abs(mode.plastic)),0);}
  get maxElasticDepthM():number{return this.modes.reduce((max,mode)=>Math.max(max,Math.abs(mode.elastic)),0);}
  presentationState():readonly PanelMode[]{return structuredClone(this.modes);}
  restorePresentation(modes:readonly PanelMode[]):void{
    if(modes.length>32||modes.some(m=>![...m.point,...m.normal,m.radius,m.elastic,m.velocity,m.plastic,m.omega,m.damping].every(Number.isFinite)||m.radius<=0||m.omega<=0))throw new TypeError('Invalid panel presentation state');
    this.modes.splice(0,this.modes.length,...structuredClone(modes));
  }
}

export interface SuspensionPose {readonly heave:number;readonly roll:number;readonly pitch:number;readonly compressions:readonly number[]}

/** Four independent spring-damper support points. Static vehicle weight is the zero state; loads are deviations around ride height. */
export class FourCornerSuspension {
  private readonly compression=new Float64Array(4);
  private readonly velocity=new Float64Array(4);
  private readonly load=new Float64Array(4);
  private lastAudible=-Infinity;
  private readonly events:MechanismEvent[]=[];
  private sequence=0;
  time=0;

  constructor(
    readonly massKg:number,
    readonly wheelbase:number,
    readonly track:number,
    readonly springNpm=31_000,
    readonly damperNsPm=3_200,
  ){
    if(!Number.isFinite(massKg)||massKg<=0||!Number.isFinite(wheelbase)||wheelbase<=0||!Number.isFinite(track)||track<=0)throw new RangeError('Invalid suspension dimensions');
  }

  applyLoad(point:Vec3,downwardForceN:number):void{
    if(!point.every(Number.isFinite)||!Number.isFinite(downwardForceN))throw new TypeError('Invalid suspension load');
    const front=clamp(.5+point[0]/this.wheelbase,0,1),right=clamp(.5+point[2]/this.track,0,1);
    const weights=[front*(1-right),front*right,(1-front)*(1-right),(1-front)*right];
    for(let i=0;i<4;i++)this.load[i]=this.load[i]!+downwardForceN*weights[i]!;
  }

  step(dt:number):void{
    const cornerMass=this.massKg/4;this.time+=dt;
    for(let i=0;i<4;i++){
      const v=this.velocity[i]!,x=this.compression[i]!,a=(this.load[i]!-this.springNpm*x-this.damperNsPm*v)/cornerMass;
      const nv=v+a*dt,nx=clamp(x+nv*dt,-.075,.145);
      this.velocity[i]=nx===-.075||nx===.145?nv*.18:nv;this.compression[i]=nx;
      const dissipated=this.damperNsPm*nv*nv*dt;
      if(dissipated>.35&&Math.abs(nv)>.04&&this.time-this.lastAudible>.16){
        this.lastAudible=this.time;
        this.events.push({type:'mechanism',id:++this.sequence,time:this.time,point:this.cornerPoint(i),mechanism:'suspension',energy:dissipated,speed:Math.abs(nv),size:.55});
      }
      this.load[i]=0;
    }
  }

  drainEvents():MechanismEvent[]{return this.events.splice(0);}
  get pose():SuspensionPose{
    const [fl,fr,rl,rr]=[...this.compression],front=(fl!+fr!)/2,rear=(rl!+rr!)/2,left=(fl!+rl!)/2,right=(fr!+rr!)/2;
    return{heave:-(front+rear)/2,roll:(left-right)/this.track,pitch:(rear-front)/this.wheelbase,compressions:Object.freeze([fl!,fr!,rl!,rr!])};
  }
  private cornerPoint(index:number):Vec3{
    const front=index<2,right=index%2===1;return[front?this.wheelbase/2:-this.wheelbase/2,-.25,right?this.track/2:-this.track/2];
  }
}

export class DoorHinge {
  angle=0;
  angularVelocity=0;
  private torque=0;
  private readonly events:MechanismEvent[]=[];
  private sequence=0;
  time=0;
  constructor(readonly inertiaKgM2=5.2,readonly maxAngle=1.22,readonly dampingNms=2.7){}

  drive(targetAngle:number,torqueLimit=42):void{
    const target=clamp(targetAngle,0,this.maxAngle),error=target-this.angle,torque=error*48-this.angularVelocity*5.5;
    this.torque+=clamp(torque,-Math.abs(torqueLimit),Math.abs(torqueLimit));
  }
  addTorque(value:number):void{if(!Number.isFinite(value))throw new TypeError('Door torque must be finite');this.torque+=value;}
  addAngularImpulse(value:number):void{if(!Number.isFinite(value))throw new TypeError('Door angular impulse must be finite');this.angularVelocity+=value/this.inertiaKgM2;}

  step(dt:number):void{
    this.time+=dt;
    const acceleration=(this.torque-this.dampingNms*this.angularVelocity)/this.inertiaKgM2;
    this.angularVelocity+=acceleration*dt;this.angle+=this.angularVelocity*dt;this.torque=0;
    if(this.angle<0){
      const speed=Math.abs(this.angularVelocity),energy=.5*this.inertiaKgM2*speed*speed;
      this.angle=0;this.angularVelocity=speed<.18?0:Math.abs(this.angularVelocity)*.025;
      if(energy>.015)this.events.push({type:'mechanism',id:++this.sequence,time:this.time,point:[0,0,0],mechanism:'door-latch',energy,speed,size:1.1});
    }else if(this.angle>this.maxAngle){
      const speed=Math.abs(this.angularVelocity),energy=.5*this.inertiaKgM2*speed*speed;
      this.angle=this.maxAngle;this.angularVelocity=-Math.abs(this.angularVelocity)*.08;
      if(energy>.02)this.events.push({type:'mechanism',id:++this.sequence,time:this.time,point:[0,0,0],mechanism:'door-stop',energy,speed,size:1.1});
    }
  }
  drainEvents():MechanismEvent[]{return this.events.splice(0);}
}

export interface VehicleInteractionImpact extends PanelImpactInput {
  /** Explicit cage budget; zero lets a contact owner allocate panel work separately. */
  readonly structuralEnergyJ?:number;
  readonly time:number;
  readonly contactMaterial?:MaterialKind;
  readonly effectiveMassKg?:number;
}

export interface VehicleInteractionState {
  readonly thermalScale:number;
  readonly suspension:SuspensionPose;
  readonly doorAngle:number;
  readonly panelElasticDepthM:number;
  readonly panelPermanentDepthM:number;
  readonly structuralPlasticWorkJ:number;
}

/**
 * Deterministic interaction rig for a passenger car.
 * Structural cage, thin-panel flex/plasticity, suspension and door mechanics are separate
 * physical layers but consume the same authored M3 dimensions/materials.
 */
export class M3InteractionRig {
  readonly blueprint:M3StructuralBlueprint;
  readonly structure:StructuralBody;
  readonly panels=new ElasticPlasticPanelResponse();
  readonly suspension:FourCornerSuspension;
  readonly door=new DoorHinge();
  readonly nodeRest:Float64Array;
  readonly shellRest:Float64Array;
  private readonly structuralSkin:Float64Array;
  private readonly deformedShell:Float64Array;
  private readonly events:EngineEvent[]=[];
  private eventSequence=10_000;
  private readonly referenceCenter:Vec3;
  temperatureC=20;
  time=0;

  constructor(readonly massKg=1700){
    const steel=material('steel'),profile=M3_PARAMETRIC_PROFILE;
    this.blueprint=m3StructuralBlueprint(massKg,steel.mechanical);
    this.structure=new StructuralBody({...this.blueprint.definition,sleepDelay:3});
    this.nodeRest=new Float64Array(this.blueprint.definition.nodes.length*3);
    for(let i=0;i<this.blueprint.definition.nodes.length;i++)this.nodeRest.set(this.blueprint.definition.nodes[i]!.position,i*3);
    this.shellRest=new Float64Array(this.blueprint.skin.rest);
    this.structuralSkin=new Float64Array(this.shellRest.length);this.deformedShell=new Float64Array(this.shellRest.length);
    this.suspension=new FourCornerSuspension(massKg,profile.dimensions.wheelbase,profile.dimensions.track);
    this.referenceCenter=[...this.structure.centerOfMass()];
  }

  setTemperatureC(value:number):void{
    if(!Number.isFinite(value)||value<-80||value>120)throw new RangeError('Vehicle temperature out of supported range');
    this.temperatureC=value;this.structure.setThermalScale(thermalLinearScale('steel',value,20));
  }

  impact(input:VehicleInteractionImpact):PanelImpactResult{
    const result=this.panels.impact(input),effectiveMass=input.effectiveMassKg??3,impulse=Math.sqrt(Math.max(0,2*effectiveMass*input.energyJ));
    // Human-scale contacts belong to the thin skin. Activating the sparse crash cage for
    // taps, kicks or bodyweight incorrectly turns local sheet-metal work into chassis
    // plasticity. Reserve the expensive structural LOD for genuinely severe contacts.
    const structuralActivationEnergyJ=Math.max(350,this.massKg*.20);
    if(input.structuralEnergyJ!==undefined&&(!Number.isFinite(input.structuralEnergyJ)||input.structuralEnergyJ<0))throw new RangeError('Invalid structural impact energy');
    if(input.material!=='glass'&&(input.structuralEnergyJ===undefined?input.energyJ>=structuralActivationEnergyJ:input.structuralEnergyJ>0)){const cageImpulse=input.structuralEnergyJ===undefined?impulse:Math.sqrt(2*effectiveMass*input.structuralEnergyJ);this.structure.applyImpulse(input.point,V3.scale(V3.normalize(input.normal),-cageImpulse),Math.max(.16,input.radiusM*1.25));}
    const event:ImpactEvent={type:'impact',id:++this.eventSequence,time:input.time,point:input.point,normal:input.normal,a:'m3-panel',b:'human',materialA:input.material??'steel',materialB:input.contactMaterial??'default',energy:input.energyJ,impulse,speed:effectiveMass>0?impulse/effectiveMass:0,size:input.radiusM*2};
    this.events.push(event);
    if(result.elasticEnergyJ>4&&input.energyJ>80)this.events.push({type:'mechanism',id:++this.eventSequence,time:input.time,point:input.point,mechanism:'panel-flex',energy:result.elasticEnergyJ,speed:Math.sqrt(Math.max(0,2*result.elasticEnergyJ/effectiveMass)),size:input.radiusM*2});
    return result;
  }

  applyBodyLoad(point:Vec3,downwardForceN:number):void{
    // Standing/jumping bodyweight changes the sprung-body pose. Local hood/roof flex is
    // represented by the panel impact modes at each landing; it must not plastically work
    // the crash cage continuously while a person is merely standing on the car.
    this.suspension.applyLoad(point,downwardForceN);
  }

  step(dt:number):void{
    this.time+=dt;this.panels.step(dt);this.door.step(dt);this.suspension.step(dt);
    this.structure.step(dt,[0,0,0]);
    // Suspension owns rigid-body translation; the cage represents internal motion only.
    const center=this.structure.centerOfMass(),dx=center[0]-this.referenceCenter[0],dy=center[1]-this.referenceCenter[1],dz=center[2]-this.referenceCenter[2];
    let vx=0,vy=0,vz=0;
    for(let i=0;i<this.structure.nodeCount;i++){const j=i*3,m=this.structure.mass[i]!;vx+=m*this.structure.velocity[j]!;vy+=m*this.structure.velocity[j+1]!;vz+=m*this.structure.velocity[j+2]!;}
    vx/=this.structure.totalMass;vy/=this.structure.totalMass;vz/=this.structure.totalMass;
    for(let i=0;i<this.structure.nodeCount;i++){
      const j=i*3;
      this.structure.position[j]=this.structure.position[j]!-dx;this.structure.position[j+1]=this.structure.position[j+1]!-dy;this.structure.position[j+2]=this.structure.position[j+2]!-dz;
      this.structure.previous[j]=this.structure.previous[j]!-dx;this.structure.previous[j+1]=this.structure.previous[j+1]!-dy;this.structure.previous[j+2]=this.structure.previous[j+2]!-dz;
      this.structure.velocity[j]=this.structure.velocity[j]!-vx;this.structure.velocity[j+1]=this.structure.velocity[j+1]!-vy;this.structure.velocity[j+2]=this.structure.velocity[j+2]!-vz;
    }
    for(const event of this.door.drainEvents())this.events.push({...event,id:++this.eventSequence,time:this.time,point:[.1,.8,-M3_PARAMETRIC_PROFILE.dimensions.width/2]});
    for(const event of this.suspension.drainEvents())this.events.push({...event,id:++this.eventSequence,time:this.time});
  }

  shellPositions():Float64Array{
    applyStructuralSkin(this.blueprint.skin,this.nodeRest,this.structure.position,this.structuralSkin);
    this.panels.deform(this.structuralSkin,this.deformedShell);
    return this.deformedShell;
  }

  shellMesh(base:Extract<Primitive,{kind:'triangle-mesh'}>,detail:'full'|'damaged'|'damaged-coarse'='full'):Extract<Primitive,{kind:'triangle-mesh'}>{
    const positions=[...this.shellPositions()],normals=recomputeNormals(positions,base.indices);
    const mesh:Extract<Primitive,{kind:'triangle-mesh'}>={kind:'triangle-mesh',positions,normals,indices:base.indices};
    return detail==='full'?m3SmoothRenderBody(mesh):m3DamagedRenderBody(mesh,detail==='damaged'?2:1);
  }

  drainEvents():EngineEvent[]{return this.events.splice(0);}
  get state():VehicleInteractionState{return{thermalScale:this.structure.thermalScale,suspension:this.suspension.pose,doorAngle:this.door.angle,panelElasticDepthM:this.panels.maxElasticDepthM,panelPermanentDepthM:this.panels.maxPermanentDepthM,structuralPlasticWorkJ:this.structure.plasticWorkJ};}

  private nearestNode(point:Vec3):number{
    let best=0,distance=Infinity;
    for(let i=0;i<this.structure.nodeCount;i++){const j=i*3,d=Math.hypot(this.structure.position[j]!-point[0],this.structure.position[j+1]!-point[1],this.structure.position[j+2]!-point[2]);if(d<distance){distance=d;best=i;}}
    return best;
  }
}

function recomputeNormals(positions:readonly number[],indices:readonly number[]):number[]{
  const normals=Array<number>(positions.length).fill(0);
  for(let i=0;i<indices.length;i+=3){
    const ia=indices[i]!*3,ib=indices[i+1]!*3,ic=indices[i+2]!*3;
    const ax=positions[ia]!,ay=positions[ia+1]!,az=positions[ia+2]!,bx=positions[ib]!,by=positions[ib+1]!,bz=positions[ib+2]!,cx=positions[ic]!,cy=positions[ic+1]!,cz=positions[ic+2]!;
    const ux=bx-ax,uy=by-ay,uz=bz-az,vx=cx-ax,vy=cy-ay,vz=cz-az,nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
    for(const base of [ia,ib,ic]){normals[base]=normals[base]!+nx;normals[base+1]=normals[base+1]!+ny;normals[base+2]=normals[base+2]!+nz;}
  }
  for(let i=0;i<normals.length;i++){if(i%3)continue;const n=Math.hypot(normals[i]!,normals[i+1]!,normals[i+2]!)||1;normals[i]=normals[i]!/n;normals[i+1]=normals[i+1]!/n;normals[i+2]=normals[i+2]!/n;}
  return normals;
}
