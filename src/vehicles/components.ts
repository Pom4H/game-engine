import type {Vec3} from '../math.js';
import {finiteVec3} from '../math.js';
import {validateCondition,type ConditionSpec} from './condition.js';

interface PartSpec {readonly id:string;readonly at:Vec3;readonly massKg:number;readonly condition?:ConditionSpec;/** Optional chassis-local structural mount; defaults to at. */readonly mountAt?:Vec3;}
export interface ShaftSpec {readonly id:string;readonly maxPowerW:number;readonly efficiency?:number;}
export interface WheelSpec extends PartSpec {
  readonly kind:'wheel';readonly radiusM:number;readonly widthM:number;
  readonly suspension:{readonly restM:number;readonly travelM:number;readonly springNPerM:number;readonly damperNsPerM:number;readonly yieldForceN?:number};
  readonly driveTorqueNm?:number;readonly drivePowerW?:number;readonly brakeTorqueNm?:number;readonly steerRad?:number;
  readonly grip?:number;readonly wornGripFraction?:number;readonly treadDepthM?:number;
}
export interface WingSpec extends PartSpec {
  readonly kind:'wing';readonly spanM:number;readonly chordM:number;
  readonly chord?:Vec3;readonly normal?:Vec3;readonly incidenceRad?:number;readonly zeroLiftRad?:number;
  readonly dragCoefficient?:number;readonly efficiency?:number;readonly stallRad?:number;readonly stallWidthRad?:number;
  readonly control?:'pitch'|'roll'|'flap';readonly controlGainRad?:number;
}
export interface RotorSpec extends PartSpec {
  readonly kind:'rotor';readonly radiusM:number;readonly bladeChordM:number;readonly blades:number;
  readonly axis?:Vec3;readonly forward?:Vec3;readonly direction?:-1|1;
  readonly governorRpm:number;readonly maxPowerW:number;readonly spoolSeconds?:number;
  readonly collectiveControl?:'collective'|'yaw';readonly collectiveTrimRad?:number;readonly collectiveGainRad?:number;
  readonly cyclicPitchGainRad?:number;readonly cyclicRollGainRad?:number;
  readonly liftSlope?:number;readonly profileDragCoefficient?:number;
  /** Shared engine/gearbox budget. Multiple rotors may consume the same shaft. */readonly shaft?:string;
  readonly flapTimeSeconds?:number;readonly leadLagTimeSeconds?:number;
}
export type VehicleComponent=WheelSpec|WingSpec|RotorSpec;
export interface VehicleSpec {
  readonly id:string;
  readonly chassis:{readonly massKg:number;readonly sizeM:Vec3;readonly dragAreaM2?:number};
  readonly shafts?:readonly ShaftSpec[];
  readonly parts:readonly VehicleComponent[];
}
export interface CompiledComponent {
  readonly source:VehicleComponent;readonly arm:Vec3;readonly inertia:number;
  readonly area:number;readonly slope:number;readonly induced:number;readonly chord:Vec3;readonly normal:Vec3;
}
export interface VehicleBlueprint {
  readonly source:VehicleSpec;readonly massKg:number;readonly centerOfMass:Vec3;readonly inertia:Vec3;
  readonly parts:readonly CompiledComponent[];
}
const check=(value:number,label:string,min=0,max=1e12)=>{if(!Number.isFinite(value)||value<min||value>max)throw new RangeError(label);return value;};
const unit=(value:Vec3):Vec3=>{finiteVec3(value,'Direction');const length=Math.hypot(...value);if(length<1e-9)throw new RangeError('Zero direction');return[value[0]/length,value[1]/length,value[2]/length];};
const freeze=<T>(value:T):T=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
/** RU: Деталь колеса, не исполняемый модуль. EN: An authored wheel, not a tick handler. */
export const wheel=(id:string,spec:Omit<WheelSpec,'id'|'kind'>):WheelSpec=>({kind:'wheel',id,...spec});
/** RU: Несущая поверхность; не флаг полёта. EN: Lifting surface, not a flight-mode flag. */
export const wing=(id:string,spec:Omit<WingSpec,'id'|'kind'>):WingSpec=>({kind:'wing',id,...spec});
/** RU: Вращающийся несущий диск. EN: Rotating actuator disk, not a helicopter mode. */
export const rotor=(id:string,spec:Omit<RotorSpec,'id'|'kind'>):RotorSpec=>({kind:'rotor',id,...spec});

/** Compile construction once. Frames: +X forward, +Y up, +Z right; metres and SI forces.
 * Attached part masses are included ONCE. Inertia uses a diagonal lumped-body approximation. */
export function vehicle(id:string,spec:Omit<VehicleSpec,'id'>):VehicleBlueprint {
  const source:VehicleSpec=structuredClone({...spec,id});
  if(!id||id.length>180||!Array.isArray(source.parts)||source.parts.length>64)throw new RangeError('Invalid vehicle identity/part budget');
  const size=source.chassis.sizeM;finiteVec3(size,'Chassis size');for(const n of size)check(n,'Chassis size',.001,1000);
  const chassisMass=check(source.chassis.massKg,'Chassis mass',1e-6,1e8);
  check(source.chassis.dragAreaM2??0,'Drag area');
  const shafts=new Set<string>();
  for(const shaft of source.shafts??[]){if(!shaft.id||shaft.id.length>180||shafts.has(shaft.id))throw new RangeError('Shafts require unique stable IDs');shafts.add(shaft.id);check(shaft.maxPowerW,'Shaft power',1,1e9);check(shaft.efficiency??1,'Shaft efficiency',.01,1);}
  const ids=new Set<string>(),parts:CompiledComponent[]=[],centers:Vec3[]=[],diagonals:Vec3[]=[];
  let mass=chassisMass,cx=0,cy=0,cz=0;
  for(const p of source.parts){
    if(!p.id||p.id.length>180||ids.has(p.id))throw new RangeError('Parts require unique stable IDs');ids.add(p.id);
    finiteVec3(p.at,'Part position');if(p.mountAt)finiteVec3(p.mountAt,'Part mount');check(p.massKg,'Part mass',1e-6,1e7);validateCondition(p.condition??{});
    let center=p.at,inertia=0,area=0,slope=0,induced=0,chord:Vec3=[1,0,0],normal:Vec3=[0,1,0],diag:Vec3;
    if(p.kind==='wheel'){
      check(p.radiusM,'Wheel radius',.0001,100);check(p.widthM,'Wheel width',.0001,100);
      const s=p.suspension;check(s.restM,'Suspension rest',.0001,100);check(s.travelM,'Suspension travel',.0001,s.restM);
      check(s.springNPerM,'Spring stiffness',1e-6,1e9);check(s.damperNsPerM,'Damper',0,1e8);
      if(s.yieldForceN!==undefined)check(s.yieldForceN,'Yield force',1e-6);
      for(const n of [p.driveTorqueNm??0,p.brakeTorqueNm??0,p.drivePowerW??0])check(n,'Power/torque');
      check(p.steerRad??0,'Steering lock',0,1.4);check(p.grip??1.1,'Grip',0,5);check(p.wornGripFraction??.65,'Worn grip',0,1);
      const depth=p.treadDepthM??Math.min(.008,p.radiusM*.03);check(depth,'Tread depth',0,p.radiusM);if(depth>=p.radiusM)throw new RangeError('Tread cannot consume the entire radius');
      center=[p.at[0],p.at[1]-s.restM,p.at[2]];inertia=.5*p.massKg*p.radiusM*p.radiusM;
      const transverse=p.massKg*(3*p.radiusM*p.radiusM+p.widthM*p.widthM)/12;diag=[transverse,transverse,inertia];
    }else if(p.kind==='wing'){
      check(p.spanM,'Wing span',.001,1000);check(p.chordM,'Wing chord',.001,1000);
      chord=unit(p.chord??chord);normal=unit(p.normal??normal);
      if(Math.abs(chord[0]*normal[0]+chord[1]*normal[1]+chord[2]*normal[2])>1e-8)throw new RangeError('Wing chord and normal must be perpendicular');
      check(p.incidenceRad??0,'Incidence',-Math.PI,Math.PI);check(p.zeroLiftRad??-.035,'Zero-lift angle',-Math.PI,Math.PI);
      check(p.dragCoefficient??.025,'Wing drag',0,10);check(p.efficiency??.8,'Efficiency',.01,1);
      check(p.stallRad??.26,'Stall angle',.001,Math.PI);check(p.stallWidthRad??.2,'Stall width',.001,Math.PI);
      check(p.controlGainRad??0,'Control gain',-1.4,1.4);
      if(p.control!==undefined&&!['pitch','roll','flap'].includes(p.control))throw new RangeError('Unknown wing control');
      area=p.spanM*p.chordM;const aspect=p.spanM*p.spanM/area;slope=2*Math.PI*aspect/(aspect+2);induced=1/(Math.PI*aspect*(p.efficiency??.8));
      const span:Vec3=[chord[1]*normal[2]-chord[2]*normal[1],chord[2]*normal[0]-chord[0]*normal[2],chord[0]*normal[1]-chord[1]*normal[0]];
      const variance=[0,1,2].map(k=>(p.chordM*p.chordM*chord[k]!**2+p.spanM*p.spanM*span[k]!**2)/12);
      diag=[p.massKg*(variance[1]!+variance[2]!),p.massKg*(variance[0]!+variance[2]!),p.massKg*(variance[0]!+variance[1]!)];
    }else if(p.kind==='rotor'){
      check(p.radiusM,'Rotor radius',.05,100);check(p.bladeChordM,'Rotor blade chord',.005,p.radiusM);
      if(!Number.isSafeInteger(p.blades)||p.blades<1||p.blades>16)throw new RangeError('Rotor blade count');
      check(p.governorRpm,'Rotor governor RPM',10,10000);check(p.maxPowerW,'Rotor power',1,1e8);check(p.spoolSeconds??1.5,'Rotor spool time',.05,120);
      check(p.collectiveTrimRad??0,'Rotor collective trim',-.7,.7);check(p.collectiveGainRad??.12,'Rotor collective gain',-.7,.7);
      check(p.cyclicPitchGainRad??0,'Rotor cyclic pitch',0,.7);check(p.cyclicRollGainRad??0,'Rotor cyclic roll',0,.7);
      check(p.flapTimeSeconds??.08,'Rotor flap response',.005,5);check(p.leadLagTimeSeconds??.12,'Rotor lead-lag response',.005,5);
      if(p.shaft!==undefined&&!shafts.has(p.shaft))throw new RangeError(`Unknown rotor shaft ${p.shaft}`);
      check(p.liftSlope??5.7,'Rotor lift slope',.1,10);check(p.profileDragCoefficient??.011,'Rotor profile drag',0,1);
      if((p.direction??1)!==1&&(p.direction??1)!==-1)throw new RangeError('Rotor direction');
      if(p.collectiveControl!==undefined&&!['collective','yaw'].includes(p.collectiveControl))throw new RangeError('Unknown rotor collective control');
      normal=unit(p.axis??normal);chord=unit(p.forward??chord);
      if(Math.abs(chord[0]*normal[0]+chord[1]*normal[1]+chord[2]*normal[2])>1e-8)throw new RangeError('Rotor forward and axis must be perpendicular');
      area=Math.PI*p.radiusM*p.radiusM;slope=p.liftSlope??5.7;induced=p.blades*p.bladeChordM/(Math.PI*p.radiusM);
      inertia=.5*p.massKg*p.radiusM*p.radiusM;
      const transverse=.25*p.massKg*p.radiusM*p.radiusM,delta=inertia-transverse;
      diag=[transverse+delta*normal[0]**2,transverse+delta*normal[1]**2,transverse+delta*normal[2]**2];
    }else throw new RangeError('Unsupported vehicle part');
    mass+=p.massKg;cx+=p.massKg*center[0];cy+=p.massKg*center[1];cz+=p.massKg*center[2];
    centers.push(center);diagonals.push(diag);parts.push({source:p,arm:p.at,inertia,area,slope,induced,chord,normal});
  }
  const com:Vec3=[cx/mass,cy/mass,cz/mass];
  const I=[chassisMass*(size[1]**2+size[2]**2)/12+chassisMass*(com[1]**2+com[2]**2),chassisMass*(size[0]**2+size[2]**2)/12+chassisMass*(com[0]**2+com[2]**2),chassisMass*(size[0]**2+size[1]**2)/12+chassisMass*(com[0]**2+com[1]**2)];
  const shifted=parts.map((part,i)=>{
    const c=centers[i]!,d=diagonals[i]!,m=part.source.massKg,x=c[0]-com[0],y=c[1]-com[1],z=c[2]-com[2];
    I[0]!+=d[0]+m*(y*y+z*z);I[1]!+=d[1]+m*(x*x+z*z);I[2]!+=d[2]+m*(x*x+y*y);
    return{...part,arm:[part.arm[0]-com[0],part.arm[1]-com[1],part.arm[2]-com[2]] as Vec3};
  });
  return freeze({source,massKg:mass,centerOfMass:com,inertia:I as unknown as Vec3,parts:shifted});
}
