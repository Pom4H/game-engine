/**
 * Clean-room Liljencrants-Fant (LF) glottal-flow source.
 *
 * The implementation follows the published LF piecewise model and uses the
 * same conventional control quantities exposed by VocalTractLab:
 * open quotient OQ, speed quotient SQ and return-phase time TL.
 * No VocalTractLab source code is copied here.
 */

export interface LfGlottalControl{
  readonly f0Hz:number;
  /** Peak glottal volume flow in cm^3/s. */
  readonly amplitudeCm3S:number;
  /** Fraction of the period from opening to maximum negative flow derivative. */
  readonly openQuotient?:number;
  /** te/tp relationship: tp = te*SQ/(1+SQ). */
  readonly speedQuotient?:number;
  /** Return-phase time constant as a fraction of period. */
  readonly returnPhase?:number;
  /** 0..1 fold adduction / voicing gate. */
  readonly voiced?:number;
}

export interface LfGlottalSample{
  /** Glottal volume flow in cm^3/s. */
  readonly flowCm3S:number;
  /** Time derivative of glottal volume flow in cm^3/s^2. */
  readonly derivativeCm3S2:number;
  readonly phase:number;
}

const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));

interface LfShape{
  readonly te:number;
  readonly tp:number;
  readonly ta:number;
  readonly epsilon:number;
  readonly alpha:number;
  readonly omega:number;
  readonly derivativeScale:number;
  readonly flowAtTe:number;
  readonly returnPrefactor:number;
  readonly returnOffset:number;
}

function solveEpsilon(ta:number,te:number):number{
  const c=Math.max(.001,1-te),safeTa=clamp(ta,.0001,c-1e-5);
  let e=1/safeTa;
  for(let i=0;i<40;i++){
    const exp=Math.exp(-e*c);
    const h=1-exp-e*safeTa;
    const dh=c*exp-safeTa;
    if(Math.abs(dh)<1e-10)break;
    const next=e-h/dh;
    if(!Number.isFinite(next)||next<=0)break;
    e=next;
    if(Math.abs(h)<1e-10)break;
  }
  return e;
}

function alphaResidual(alpha:number,omega:number,tp:number,te:number,ta:number,epsilon:number):number{
  const sin=Math.sin(omega*te),cos=Math.cos(omega*te);
  const x=(sin*Math.exp(epsilon*te)*(-Math.exp(-epsilon)/epsilon-Math.exp(-epsilon)))/(epsilon*ta);
  const y=(sin*Math.exp(epsilon*te)*(-Math.exp(-epsilon*te)/epsilon-te*Math.exp(-epsilon)))/(epsilon*ta);
  return omega/(omega*omega+alpha*alpha)+Math.exp(alpha*te)*(
    (alpha*sin-omega*cos)/(omega*omega+alpha*alpha)+x-y
  );
}

function solveAlpha(tp:number,te:number,ta:number,epsilon:number):number{
  const omega=Math.PI/tp;
  let lo=0,hi=1,fh=alphaResidual(hi,omega,tp,te,ta,epsilon);
  for(let i=0;i<40&&fh>=0;i++){hi*=1.6;fh=alphaResidual(hi,omega,tp,te,ta,epsilon);}
  if(fh>=0)return 0;
  let flo=alphaResidual(lo,omega,tp,te,ta,epsilon);
  for(let i=0;i<60;i++){
    const mid=(lo+hi)*.5,fm=alphaResidual(mid,omega,tp,te,ta,epsilon);
    if(Math.abs(fm)<1e-10)return mid;
    if(Math.sign(fm)===Math.sign(flo)){lo=mid;flo=fm;}else hi=mid;
  }
  return(lo+hi)*.5;
}

function unscaledOpenFlow(t:number,alpha:number,omega:number):number{
  const d=omega*omega+alpha*alpha;
  return (Math.exp(alpha*t)*(alpha*Math.sin(omega*t)-omega*Math.cos(omega*t))+omega)/d;
}

function buildShape(oq:number,sq:number,tl:number):LfShape{
  const te=clamp(oq,.2,.9),safeSq=clamp(sq,.5,8),tp=te*safeSq/(1+safeSq);
  const ta=clamp(tl,.01,Math.max(.011,1-te-.001));
  const epsilon=solveEpsilon(ta,te),omega=Math.PI/tp,alpha=solveAlpha(tp,te,ta,epsilon);
  const peakUnit=Math.max(1e-12,unscaledOpenFlow(tp,alpha,omega));
  const derivativeScale=1/peakUnit;
  const flowAtTe=unscaledOpenFlow(te,alpha,omega)*derivativeScale;
  const derivativeAtTe=derivativeScale*Math.exp(alpha*te)*Math.sin(omega*te);
  const returnPrefactor=derivativeAtTe*Math.exp(epsilon*te)/(epsilon*ta);
  const primitiveAtTe=-returnPrefactor*Math.exp(-epsilon*te)/epsilon-returnPrefactor*te*Math.exp(-epsilon);
  const returnOffset=flowAtTe-primitiveAtTe;
  return Object.freeze({te,tp,ta,epsilon,alpha,omega,derivativeScale,flowAtTe,returnPrefactor,returnOffset});
}

function sampleShape(shape:LfShape,t:number):{flow:number;derivative:number}{
  if(t<=shape.te){
    const derivative=shape.derivativeScale*Math.exp(shape.alpha*t)*Math.sin(shape.omega*t);
    const flow=unscaledOpenFlow(t,shape.alpha,shape.omega)*shape.derivativeScale;
    return{flow,derivative};
  }
  const e=Math.exp(-shape.epsilon*t),eEnd=Math.exp(-shape.epsilon);
  const derivative=shape.returnPrefactor*(-shape.epsilon*e-eEnd);
  const flow=shape.returnOffset+shape.returnPrefactor*(-e/shape.epsilon-t*eEnd);
  return{flow:Math.max(0,flow),derivative};
}

export class LfGlottalSource{
  private phase=0;
  private cacheKey='';
  private shape=buildShape(.5,3,.02);
  private previousFlow=0;

  constructor(readonly sampleRate:number){
    if(!Number.isSafeInteger(sampleRate)||sampleRate<8_000||sampleRate>192_000)throw new RangeError('LF sample rate must be 8k..192k');
  }

  reset():void{this.phase=0;this.previousFlow=0;}

  step(control:LfGlottalControl):LfGlottalSample{
    const f0=clamp(control.f0Hz,40,500),amp=Math.max(0,control.amplitudeCm3S),voiced=clamp(control.voiced??1,0,1);
    const oq=control.openQuotient??.5,sq=control.speedQuotient??3,tl=control.returnPhase??.02;
    const key=[oq,sq,tl].map(v=>v.toFixed(6)).join(':');
    if(key!==this.cacheKey){this.shape=buildShape(oq,sq,tl);this.cacheKey=key;}

    this.phase+=f0/this.sampleRate;
    if(this.phase>=1)this.phase-=Math.floor(this.phase);
    const unit=sampleShape(this.shape,this.phase);
    const flow=unit.flow*amp*voiced;
    // Analytic derivative is expressed per normalized period. Convert dU/dtau
    // to dU/dt by multiplying by F0.
    const derivative=unit.derivative*amp*f0*voiced;
    this.previousFlow=flow;
    return Object.freeze({flowCm3S:flow,derivativeCm3S2:derivative,phase:this.phase});
  }
}

export function lfPulseCycle(
  samples:number,
  control:Omit<LfGlottalControl,'f0Hz'>={amplitudeCm3S:300},
):Float64Array{
  if(!Number.isInteger(samples)||samples<32)throw new RangeError('LF pulse cycle needs at least 32 samples');
  const shape=buildShape(control.openQuotient??.5,control.speedQuotient??3,control.returnPhase??.02);
  const out=new Float64Array(samples),amp=Math.max(0,control.amplitudeCm3S),voiced=clamp(control.voiced??1,0,1);
  for(let i=0;i<samples;i++)out[i]=sampleShape(shape,i/samples).flow*amp*voiced;
  return out;
}
