/** Material lifetime calibration, not a universal rubber/metal law. All work is solver-owned. */
export interface ConditionSpec {
  readonly wearEnergyJ?:number;
  readonly heatCapacityJPerK?:number;
  /** Streaming reversal-range fatigue approximation, not full rainflow counting. */
  readonly fatigue?:{readonly enduranceRangeN:number;readonly referenceRangeN:number;readonly cyclesAtReference:number;readonly exponent:number};
  readonly failureLoadN?:number;
}
const positive=(n:number)=>Number.isFinite(n)&&n>0;
export function validateCondition(s:ConditionSpec):void {
  for(const n of [s.wearEnergyJ,s.heatCapacityJPerK,s.failureLoadN])if(n!==undefined&&!positive(n))throw new RangeError('Condition capacities must be positive finite numbers');
  const f=s.fatigue;
  if(f&&(![f.referenceRangeN,f.cyclesAtReference,f.exponent].every(positive)||!Number.isFinite(f.enduranceRangeN)||f.enduranceRangeN<0||f.enduranceRangeN>=f.referenceRangeN))throw new RangeError('Invalid fatigue calibration');
}
/** Constant-memory lifetime state. Idle time is not wear; static load is not a fatigue cycle. */
export class PartCondition {
  private work=0; private loss=0; private fatigueValue=0; private broken=false; private version=0;
  private previous=0; private extremum=0; private direction=0; private seen=false;
  private readonly wearPerJ:number;
  private readonly heatPerJ:number;
  readonly spec:ConditionSpec;
  constructor(spec:ConditionSpec={}) {
    validateCondition(spec);
    this.spec=Object.freeze({...spec,...(spec.fatigue?{fatigue:Object.freeze({...spec.fatigue})}:{})});
    this.wearPerJ=spec.wearEnergyJ?1/spec.wearEnergyJ:0;
    this.heatPerJ=spec.heatCapacityJPerK?1/spec.heatCapacityJPerK:0;
  }
  get revision():number{return this.version;}
  get dissipatedJ():number{return this.work;}
  get wear():number{return this.loss;}
  get fatigue():number{return this.fatigueValue;}
  get failed():boolean{return this.broken;}
  /** Adiabatic temperature rise diagnostic. Cooling is not modelled in this pass. */
  get temperatureRiseK():number{return this.work*this.heatPerJ;}
  consumeWork(joules:number):void {
    if(!Number.isFinite(joules)||joules<0)throw new RangeError('Dissipated work must be finite and nonnegative');
    if(joules===0)return;
    this.work+=joules;
    const next=Math.min(1,this.work*this.wearPerJ);
    if(next!==this.loss){this.loss=next;this.version++;}
  }
  observeLoad(forceN:number):void {
    if(!Number.isFinite(forceN))throw new RangeError('Load must be finite');
    if(this.spec.failureLoadN!==undefined&&Math.abs(forceN)>this.spec.failureLoadN&&!this.broken){this.broken=true;this.version++;}
    const f=this.spec.fatigue;if(!f||this.broken)return;
    if(!this.seen){this.previous=this.extremum=forceN;this.seen=true;return;}
    const delta=forceN-this.previous,next=Math.abs(delta)>1e-9?Math.sign(delta):this.direction;
    if(next!==0&&this.direction!==0&&next!==this.direction){
      const range=Math.abs(this.previous-this.extremum);this.extremum=this.previous;
      if(range>f.enduranceRangeN){
        this.fatigueValue=Math.min(1,this.fatigueValue+.5*Math.pow(range/f.referenceRangeN,f.exponent)/f.cyclesAtReference);
        this.broken=this.fatigueValue>=1;this.version++;
      }
    }
    this.direction=next;this.previous=forceN;
  }
}
