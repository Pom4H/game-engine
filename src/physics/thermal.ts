export interface ThermalSpec {
 readonly heatCapacityJPerK:number;
 /** Passive heat transfer to ambient at zero speed. */
 readonly coolingWPerK:number;
 /** Additional forced-convection conductance per m/s of relative air speed. */
 readonly airflowCoolingWPerKPerMps?:number;
 readonly initialTemperatureC?:number;
 /** Optional performance fade interval. */
 readonly fadeStartC?:number;
 readonly fadeEndC?:number;
 readonly minPerformanceFraction?:number;
}
const finite=(x:number)=>Number.isFinite(x);
export function validateThermalSpec(s:ThermalSpec):void{
 if(!finite(s.heatCapacityJPerK)||s.heatCapacityJPerK<=0)throw new RangeError('thermal heat capacity');
 if(!finite(s.coolingWPerK)||s.coolingWPerK<0)throw new RangeError('thermal cooling');
 if(!finite(s.airflowCoolingWPerKPerMps??0)||(s.airflowCoolingWPerKPerMps??0)<0)throw new RangeError('thermal airflow cooling');
 if(!finite(s.initialTemperatureC??20))throw new RangeError('thermal initial temperature');
 if(s.fadeStartC!==undefined||s.fadeEndC!==undefined){
  if(!finite(s.fadeStartC??NaN)||!finite(s.fadeEndC??NaN)||(s.fadeEndC??0)<=(s.fadeStartC??0))throw new RangeError('thermal fade range');
 }
 if(!finite(s.minPerformanceFraction??1)||(s.minPerformanceFraction??1)<0||(s.minPerformanceFraction??1)>1)throw new RangeError('thermal minimum performance');
}
/** One lumped thermal mass. Heat is energy; cooling uses simulation time only. */
export class ThermalMass {
 private energyAboveReferenceJ=0;
 readonly referenceTemperatureC:number;
 readonly spec:Readonly<ThermalSpec>;
 dissipatedJ=0;
 rejectedJ=0;
 constructor(spec:ThermalSpec){
  validateThermalSpec(spec);this.spec=Object.freeze({...spec});this.referenceTemperatureC=spec.initialTemperatureC??20;
 }
 get temperatureC():number{return this.referenceTemperatureC+this.energyAboveReferenceJ/this.spec.heatCapacityJPerK;}
 get performance():number{
  const start=this.spec.fadeStartC,end=this.spec.fadeEndC,min=this.spec.minPerformanceFraction??1;
  if(start===undefined||end===undefined||this.temperatureC<=start)return 1;
  if(this.temperatureC>=end)return min;
  const t=(this.temperatureC-start)/(end-start),u=t*t*(3-2*t);return 1-(1-min)*u;
 }
 addHeat(joules:number):void{
  if(!finite(joules)||joules<0)throw new RangeError('thermal heat must be nonnegative');
  this.energyAboveReferenceJ+=joules;this.dissipatedJ+=joules;
 }
 step(dt:number,ambientC:number,airSpeedMps=0):void{
  if(!finite(dt)||dt<=0||dt>.25||!finite(ambientC)||!finite(airSpeedMps)||airSpeedMps<0)throw new RangeError('thermal step');
  const delta=this.temperatureC-ambientC;if(delta===0)return;
  const conductance=this.spec.coolingWPerK+(this.spec.airflowCoolingWPerKPerMps??0)*airSpeedMps;
  const requested=conductance*delta*dt;
  // Cooling/heating cannot numerically cross ambient in one step.
  const toAmbient=(this.temperatureC-ambientC)*this.spec.heatCapacityJPerK;
  const transfer=Math.sign(requested)*Math.min(Math.abs(requested),Math.abs(toAmbient));
  this.energyAboveReferenceJ-=transfer;this.rejectedJ+=Math.max(0,transfer);
 }
}
