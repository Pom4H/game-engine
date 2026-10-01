import {ThermalMass,validateThermalSpec,type ThermalSpec} from '../physics/thermal.js';
const clamp=(x:number,a:number,b:number)=>Math.max(a,Math.min(b,x));
const RPM_PER_RAD_S=60/(2*Math.PI);

export interface TorqueCurvePoint {readonly rpm:number;readonly torqueNm:number}
export interface CombustionEngineSpec {
 readonly idleRpm:number;
 readonly stallRpm?:number;
 readonly redlineRpm:number;
 readonly inertiaKgM2:number;
 readonly dragTorqueNm?:number;
 readonly torqueCurve:readonly TorqueCurvePoint[];
}
export interface ClutchSpec {
 readonly maxTorqueNm:number;
 /** Linear torsional coupling before the friction limit, N m per rad/s of slip. */
 readonly stiffnessNmPerRadS:number;
 readonly thermal?:ThermalSpec;
}
export interface GearboxSpec {
 readonly forwardRatios:readonly number[];
 readonly reverseRatio:number;
 readonly finalDrive:number;
 readonly efficiency?:number;
}
export interface DifferentialSpec {
 readonly outputs:readonly string[];
 /** Clutch-type speed coupling. Zero is an open differential. */
 readonly lockFraction?:number;
 readonly preloadNm?:number;
 readonly couplingNmPerRadS?:number;
}
export interface DrivetrainSpec {
 readonly engine:CombustionEngineSpec;
 readonly clutch:ClutchSpec;
 readonly gearbox:GearboxSpec;
 readonly differential:DifferentialSpec;
}
export interface DrivetrainInput {
 readonly throttle:number;
 /** 0 = open, 1 = fully engaged. This is a physical clutch command, not an automatic gearbox policy. */
 readonly clutch:number;
 readonly wheelOmega:(id:string)=>number;
 readonly wheelInertia:(id:string)=>number;
 readonly ambientTemperatureC?:number;
 readonly airSpeedMps?:number;
}
export interface DrivetrainState {
 readonly engineRpm:number;
 readonly gear:number;
 readonly clutchSlipRadS:number;
 readonly clutchTorqueNm:number;
 readonly outputTorqueNm:number;
 readonly clutchDissipatedJ:number;
 readonly clutchTemperatureC:number;
 readonly clutchPerformance:number;
 readonly stalled:boolean;
}

const positive=(x:number,label:string,min=0)=>{if(!Number.isFinite(x)||x<=min)throw new RangeError(label);return x;};

export function validateDrivetrainSpec(spec:DrivetrainSpec):void{
 const e=spec.engine,g=spec.gearbox,c=spec.clutch,d=spec.differential;
 positive(e.idleRpm,'engine.idleRpm');positive(e.redlineRpm,'engine.redlineRpm',e.idleRpm);
 const stall=e.stallRpm??e.idleRpm*.55;if(!Number.isFinite(stall)||stall<0||stall>=e.idleRpm)throw new RangeError('engine.stallRpm');
 positive(e.inertiaKgM2,'engine.inertiaKgM2');if(!Number.isFinite(e.dragTorqueNm??0)||(e.dragTorqueNm??0)<0)throw new RangeError('engine.dragTorqueNm');
 if(!Array.isArray(e.torqueCurve)||e.torqueCurve.length<2)throw new RangeError('engine.torqueCurve');
 let last=-Infinity;for(const p of e.torqueCurve){if(!Number.isFinite(p.rpm)||p.rpm<0||p.rpm<=last||!Number.isFinite(p.torqueNm)||p.torqueNm<0)throw new RangeError('engine.torqueCurve points');last=p.rpm;}
 positive(c.maxTorqueNm,'clutch.maxTorqueNm');positive(c.stiffnessNmPerRadS,'clutch.stiffnessNmPerRadS');if(c.thermal)validateThermalSpec(c.thermal);
 if(!g.forwardRatios.length||g.forwardRatios.length>16||g.forwardRatios.some(x=>!Number.isFinite(x)||x<=0))throw new RangeError('gearbox.forwardRatios');
 positive(g.reverseRatio,'gearbox.reverseRatio');positive(g.finalDrive,'gearbox.finalDrive');
 if(!Number.isFinite(g.efficiency??.94)||(g.efficiency??.94)<=0||(g.efficiency??.94)>1)throw new RangeError('gearbox.efficiency');
 if(!Array.isArray(d.outputs)||d.outputs.length<1||d.outputs.length>8||new Set(d.outputs).size!==d.outputs.length||d.outputs.some(id=>!id||id.length>180))throw new RangeError('differential.outputs');
 for(const [value,label,max] of [[d.lockFraction??0,'differential.lockFraction',1],[d.preloadNm??0,'differential.preloadNm',1e7],[d.couplingNmPerRadS??12,'differential.couplingNmPerRadS',1e7]] as const)if(!Number.isFinite(value)||value<0||value>max)throw new RangeError(label);
}

export function torqueAtRpm(spec:CombustionEngineSpec,rpm:number):number{
 const curve=spec.torqueCurve,x=Math.max(0,rpm);
 if(x<=curve[0]!.rpm)return curve[0]!.torqueNm;
 for(let i=1;i<curve.length;i++)if(x<=curve[i]!.rpm){const a=curve[i-1]!,b=curve[i]!,t=(x-a.rpm)/(b.rpm-a.rpm);return a.torqueNm+(b.torqueNm-a.torqueNm)*t;}
 return curve.at(-1)!.torqueNm;
}

/** Rotational drivetrain only. Vehicle translation is still a consequence of tyre contact.
 * No speed-sign gate exists: forward gear can decelerate a body that is still rolling backward. */
export class Drivetrain {
 private engineOmega:number;
 private gearValue=1;
 private clutchHeat=0;
 private readonly clutchThermal:ThermalMass|undefined;
 private readonly outputTorque=new Map<string,number>();
 private stateValue:DrivetrainState;
 constructor(readonly spec:DrivetrainSpec){
  validateDrivetrainSpec(spec);this.engineOmega=spec.engine.idleRpm/RPM_PER_RAD_S;
  this.clutchThermal=spec.clutch.thermal?new ThermalMass(spec.clutch.thermal):undefined;
  for(const id of spec.differential.outputs)this.outputTorque.set(id,0);
  this.stateValue=Object.freeze({engineRpm:spec.engine.idleRpm,gear:1,clutchSlipRadS:0,clutchTorqueNm:0,outputTorqueNm:0,clutchDissipatedJ:0,clutchTemperatureC:this.clutchThermal?.temperatureC??20,clutchPerformance:this.clutchThermal?.performance??1,stalled:false});
 }
 get gear():number{return this.gearValue;}
 setGear(value:number):void{
  if(!Number.isSafeInteger(value)||value < -1||value>this.spec.gearbox.forwardRatios.length)throw new RangeError('gear');
  this.gearValue=value;
 }
 get state():DrivetrainState{return this.stateValue;}
 torqueFor(outputId:string):number{return this.outputTorque.get(outputId)??0;}
 step(dt:number,input:DrivetrainInput):DrivetrainState{
  if(!Number.isFinite(dt)||dt<=0||dt>.1)throw new RangeError('drivetrain dt');
  const throttle=clamp(input.throttle,0,1),engagement=clamp(input.clutch,0,1),g=this.spec.gearbox,e=this.spec.engine,c=this.spec.clutch,d=this.spec.differential;
  this.clutchThermal?.step(dt,input.ambientTemperatureC??20,input.airSpeedMps??0);
  const ratio=this.gearValue>0?g.forwardRatios[this.gearValue-1]!*g.finalDrive:this.gearValue<0?-g.reverseRatio*g.finalDrive:0;
  let meanOmega=0;for(const id of d.outputs){const w=input.wheelOmega(id);if(!Number.isFinite(w))throw new TypeError('wheel omega');meanOmega+=w;}meanOmega/=d.outputs.length;
  const shaftOmega=ratio===0?0:meanOmega*ratio,slip=this.engineOmega-shaftOmega;
  const clutchPerformance=this.clutchThermal?.performance??1,clutchLimit=c.maxTorqueNm*engagement*clutchPerformance,clutchTorque=ratio===0?0:clamp(slip*c.stiffnessNmPerRadS,-clutchLimit,clutchLimit);
  const rpm=Math.max(0,this.engineOmega*RPM_PER_RAD_S),stall=e.stallRpm??e.idleRpm*.55,combustion=rpm>=stall&&rpm<e.redlineRpm?torqueAtRpm(e,rpm)*throttle:0;
  const drag=(e.dragTorqueNm??0)*(this.engineOmega===0?0:Math.sign(this.engineOmega));
  this.engineOmega=Math.max(0,this.engineOmega+(combustion-drag-clutchTorque)*dt/e.inertiaKgM2);
  // Hard redline is a fuel cut, not a tachometer clamp. Only numerical overshoot is bounded.
  this.engineOmega=Math.min(this.engineOmega,e.redlineRpm/RPM_PER_RAD_S*1.08);
  const total=clutchTorque*ratio*(g.efficiency??.94);
  for(const id of d.outputs)this.outputTorque.set(id,total/d.outputs.length);
  if(d.outputs.length===2&&(d.lockFraction??0)>0){
   const [a,b]=d.outputs,wa=input.wheelOmega(a!),wb=input.wheelOmega(b!),ia=Math.max(.001,input.wheelInertia(a!)),ib=Math.max(.001,input.wheelInertia(b!)),delta=wa-wb;
   const limit=(d.preloadNm??0)+Math.abs(total)*(d.lockFraction??0)*.5,stop=Math.abs(delta)/(dt*(1/ia+1/ib)),transfer=Math.sign(delta)*Math.min(limit,Math.abs(delta)*(d.couplingNmPerRadS??12),stop);
   this.outputTorque.set(a!,this.outputTorque.get(a!)!-transfer);this.outputTorque.set(b!,this.outputTorque.get(b!)!+transfer);
  }
  const clutchWork=Math.abs(clutchTorque*slip)*dt;this.clutchHeat+=clutchWork;this.clutchThermal?.addHeat(clutchWork);
  const engineRpm=this.engineOmega*RPM_PER_RAD_S;
  this.stateValue=Object.freeze({engineRpm,gear:this.gearValue,clutchSlipRadS:slip,clutchTorqueNm:clutchTorque,outputTorqueNm:total,clutchDissipatedJ:this.clutchHeat,clutchTemperatureC:this.clutchThermal?.temperatureC??(input.ambientTemperatureC??20),clutchPerformance:this.clutchThermal?.performance??1,stalled:engineRpm<stall});
  return this.stateValue;
 }
}
