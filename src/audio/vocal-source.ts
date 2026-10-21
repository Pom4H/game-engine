export interface BreathSupportControl {
  /** Respiratory muscle target pressure; opera can sustain substantially more than speech. */
  readonly targetPressurePa:number;
  /** Previous-cycle glottal flow loading the lungs. */
  readonly glottalFlowM3S:number;
}

export interface BreathSupportSample {
  readonly pressurePa:number;
  readonly pressureVelocityPaS:number;
}

/** Low-frequency pressure reservoir representing diaphragm/intercostal support.
 * Muscle activation sets an equilibrium pressure; glottal flow unloads it.
 * The state cannot jump at syllable/note boundaries. */
export class DiaphragmBreathSupport {
  private pressurePa=0;
  private velocityPaS=0;
  maxPressurePa=0;

  constructor(readonly sampleRate:number){
    if(!Number.isSafeInteger(sampleRate)||sampleRate<8_000||sampleRate>384_000)throw new RangeError('Breath-support sample rate must be 8k..384k');
  }

  step(control:BreathSupportControl):BreathSupportSample{
    const dt=1/this.sampleRate,target=clamp(control.targetPressurePa,0,2200);
    const flowDrop=clamp(control.glottalFlowM3S*320_000,0,380);
    const equilibrium=Math.max(0,target-flowDrop);
    const omega=2*Math.PI*3.2,zeta=.9;
    const acceleration=omega*omega*(equilibrium-this.pressurePa)-2*zeta*omega*this.velocityPaS;
    this.velocityPaS+=acceleration*dt;
    this.pressurePa=clamp(this.pressurePa+this.velocityPaS*dt,0,2300);
    this.maxPressurePa=Math.max(this.maxPressurePa,this.pressurePa);
    return Object.freeze({pressurePa:this.pressurePa,pressureVelocityPaS:this.velocityPaS});
  }
}

export interface VocalFoldControl {
  /** Neuromuscular adduction: 0 abducted/breathing, 1 tightly approximated. */
  readonly adduction:number;
  /** Tissue-tension target. This is not an oscillator phase or waveform frequency. */
  readonly tensionHz:number;
  /** Driving pressure below the glottis. */
  readonly lungPressurePa:number;
  /** Acoustic pressure immediately above the glottis. */
  readonly supraglottalPressurePa?:number;
}

export interface VocalFoldSample {
  readonly gapM:number;
  readonly flowM3S:number;
  readonly source:number;
}

/**
 * Symmetric compliant vocal-fold valve with pressure-fed self oscillation.
 * The pressure term supplies energy as negative aerodynamic damping only when
 * the folds are sufficiently adducted; nonlinear tissue damping limits amplitude.
 *
 * It is deliberately small, but unlike the old source there is no phase
 * accumulator and no authored glottal pulse waveform.
 */
export class PressureDrivenVocalFolds {
  private displacementM=0;
  private velocityMps=0;
  private previousFlow=0;
  private sourceState=0;
  readonly airDensityKgM3=1.225;
  readonly foldLengthM=.014;
  readonly dischargeCoefficient=.68;
  maxGapM=0;
  maxFlowM3S=0;

  constructor(readonly sampleRate:number){
    if(!Number.isSafeInteger(sampleRate)||sampleRate<8_000||sampleRate>384_000)throw new RangeError('Vocal-fold sample rate must be 8k..384k');
  }

  step(control:VocalFoldControl):VocalFoldSample{
    const dt=1/this.sampleRate;
    const adduction=clamp(control.adduction,0,1);
    const tensionHz=clamp(control.tensionHz,60,420);
    const pressure=Math.max(0,control.lungPressurePa-(control.supraglottalPressurePa??0));

    const omega=2*Math.PI*tensionHz;
    const restGap=.000045+(1-adduction)*.00115;
    const amplitude=.00042+.00018*(1-adduction);
    const tissueDamping=.11*omega;
    const pressureDrive=pressure>120?adduction*(pressure-120)/680*.34*omega:0;
    const y=this.displacementM,v=this.velocityMps;
    const nonlinear=pressureDrive*(1-(y/amplitude)**2)*v;
    const pressureBias=pressure*adduction*1.4e-4;
    let acceleration=-omega*omega*y-tissueDamping*v+nonlinear+pressureBias;

    const rawGap=restGap+y;
    if(rawGap<.000015){
      const penetration=.000015-rawGap;
      acceleration+=omega*omega*penetration*9;
      if(v<0)this.velocityMps*=.42;
    }

    this.velocityMps+=acceleration*dt;
    this.displacementM+=this.velocityMps*dt;

    const gap=Math.max(.000015,restGap+this.displacementM);
    const area=this.foldLengthM*gap;
    const flow=pressure>0?this.dischargeCoefficient*area*Math.sqrt(2*pressure/this.airDensityKgM3):0;
    const flowScale=.00020;
    const normalizedFlow=flow/flowScale;
    const pressureGate=clamp((pressure-70)/180,0,1);
    const derivative=normalizedFlow-this.previousFlow;
    const targetSource=((derivative*.88)+normalizedFlow*.075)*pressureGate*adduction;
    const sourceAlpha=1-Math.exp(-2*Math.PI*3200/this.sampleRate);
    this.sourceState+=sourceAlpha*(targetSource-this.sourceState);
    const source=clamp(this.sourceState,-1.6,1.6);
    this.previousFlow=normalizedFlow;
    this.maxGapM=Math.max(this.maxGapM,gap);
    this.maxFlowM3S=Math.max(this.maxFlowM3S,flow);
    return Object.freeze({gapM:gap,flowM3S:flow,source});
  }
}

export interface VelopharyngealControl {
  readonly muscleOpen:number;
  readonly pressureDeltaPa:number;
}

/**
 * Compliant soft-palate/uvula valve. Muscle activation sets the equilibrium
 * opening; acoustic pressure can deflect the flap around that equilibrium.
 */
export class CompliantVelopharyngealValve {
  private areaCm2=.005;
  private velocity=0;
  maxPressureDeflectionCm2=0;

  constructor(readonly sampleRate:number){
    if(!Number.isSafeInteger(sampleRate)||sampleRate<8_000||sampleRate>384_000)throw new RangeError('Velopharyngeal sample rate must be 8k..384k');
  }

  step(control:VelopharyngealControl):number{
    const dt=1/this.sampleRate,open=clamp(control.muscleOpen,0,1);
    const target=.005+1.10*open**1.6;
    const omega=2*Math.PI*34,zeta=.72;
    const pressureDeflection=clamp(control.pressureDeltaPa*2.0e-5,-.09,.09);
    const equilibrium=clamp(target+pressureDeflection,.003,1.28);
    const acceleration=omega*omega*(equilibrium-this.areaCm2)-2*zeta*omega*this.velocity;
    this.velocity+=acceleration*dt;
    this.areaCm2=clamp(this.areaCm2+this.velocity*dt,.003,1.28);
    this.maxPressureDeflectionCm2=Math.max(this.maxPressureDeflectionCm2,Math.abs(this.areaCm2-target));
    return this.areaCm2;
  }
}

const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
