import type {VocalMotorFrame,NativeSpeechVoice} from './native-speech.js';
import {storyArea,storyControlForVowel,STORY_SECTIONS} from './story-area-model.js';
const TAU=2*Math.PI,C=343,RHO=1.225,CM2=1e-4;
const finite=(v:number,lo:number,hi:number,label:string)=>{if(!Number.isFinite(v)||v<lo||v>hi)throw new RangeError(label+' outside '+lo+'..'+hi);};

/** Kelly-Lochbaum pressure-wave network. One step moves a wave one tubelet.
 * The clock is c*N/L, not the PCM rate: changing anatomy cannot silently change
 * the speed of sound. Fractional resampling happens ONLY at the output. */
export class NativeVocalTract {
  readonly area=new Float64Array(STORY_SECTIONS);
  readonly forward=new Float64Array(STORY_SECTIONS);
  readonly backward=new Float64Array(STORY_SECTIONS);
  private nf=new Float64Array(STORY_SECTIONS);
  private nb=new Float64Array(STORY_SECTIONS);
  private nasalArea=Float64Array.from({length:28},(_,i)=>.6+2*Math.sin((i+1)/29*Math.PI));
  private nr=new Float64Array(28);private nl=new Float64Array(28);private nnr=new Float64Array(28);private nnl=new Float64Array(28);
  private port=0;private phase=0;private rng:number;private lowNoise=0;private previousFlow=0;private dcInput=0;private dcOutput=0;
  private mouthPrevious=0;private nosePrevious=0;
  readonly internalRate:number;readonly lengthM:number;readonly wallLoss:number;
  sourceFlowM3S=0;maxPressurePa=0;energyJ=0;
  constructor(lengthM:number,seed=1,wallLossPerMetre=.55){
    finite(lengthM,.12,.24,'tract length');finite(wallLossPerMetre,0,20,'wall loss');this.lengthM=lengthM;
    this.internalRate=C*STORY_SECTIONS/lengthM;this.wallLoss=Math.exp(-wallLossPerMetre*lengthM/STORY_SECTIONS);this.rng=seed>>>0||1;
    this.area.set(storyArea(storyControlForVowel('schwa')));
  }
  setGeometry(frame:VocalMotorFrame):void{
    if(frame.oralAreaCm2.length!==44||frame.tractLengthM!==this.lengthM)throw new RangeError('Geometry and acoustic anatomy disagree');
    finite(frame.nasalPortAreaCm2,0,8,'nasal port');
    for(let i=0;i<44;i++)finite(frame.oralAreaCm2[i]!,0,40,'tube area');
    // The tract is a quasi-static acoustic projection: articulator motion does
    // not inject acoustic work. Preserve A*(p+²+p-²) on each area change, i.e.
    // preserve power-normalised waves. Without this coordinate conversion a
    // pinched nasal port can release an enormous numerical pressure impulse.
    for(let i=0;i<44;i++){
      const next=Math.max(.0001,frame.oralAreaCm2[i]!),scale=Math.sqrt(this.area[i]!/next);
      this.forward[i]=this.forward[i]!*scale;this.backward[i]=this.backward[i]!*scale;
      if(i===43)this.mouthPrevious*=scale;
      this.area[i]=next;
    }
    const oldPort=Math.max(.0001,this.port),newPort=Math.max(.0001,frame.nasalPortAreaCm2);
    const scale=Math.sqrt(oldPort/newPort);this.nr[0]=this.nr[0]!*scale;this.nl[0]=this.nl[0]!*scale;
    this.port=frame.nasalPortAreaCm2;
  }
  private noise():number{let x=this.rng;x^=x<<13;x^=x>>>17;x^=x<<5;this.rng=x>>>0;return this.rng/2147483648-1;}
  /** Useful for an independent propagation/conservation experiment. */
  injectPressure(section:number,pascals:number):void{
    if(!Number.isInteger(section)||section<0||section>=44)throw new RangeError('tube section');finite(pascals,-10000,10000,'injection');this.forward[section]=this.forward[section]!+pascals;
  }
  measureEnergy():number{
    const factor=this.lengthM/STORY_SECTIONS*CM2/(RHO*C*C);let energy=0;
    for(let i=0;i<44;i++)energy+=this.area[i]!*(this.forward[i]!**2+this.backward[i]!**2)*factor;
    for(let i=0;i<28;i++)energy+=(i===0?Math.max(.0001,this.port):this.nasalArea[i]!)*(this.nr[i]!**2+this.nl[i]!**2)*factor;
    return energy;
  }
  step(frame:VocalMotorFrame,voice:NativeSpeechVoice):number{
    const f=this.forward,b=this.backward,nf=this.nf,nb=this.nb,A=this.area,loss=this.wallLoss;
    for(let i=0;i<43;i++){
      const r=(A[i]!-A[i+1]!)/(A[i]!+A[i+1]!),p=f[i]!,q=b[i+1]!;
      nb[i]=(r*p+(1-r)*q)*loss;nf[i+1]=((1+r)*p-r*q)*loss;
    }
    const na=this.nasalArea,nr=this.nr,nl=this.nl,nnr=this.nnr,nnl=this.nnl;
    for(let i=0;i<27;i++){
      const upstream=i===0?Math.max(.0001,this.port):na[i]!,r=(upstream-na[i+1]!)/(upstream+na[i+1]!),p=nr[i]!,q=nl[i+1]!;
      nnl[i]=(r*p+(1-r)*q)*loss;nnr[i+1]=((1+r)*p-r*q)*loss;
    }
    const branch=20,port=this.port;
    if(port>1e-6){
      // The first nose tubelet area is its physical coupling port.
      const sum=A[branch]!+A[branch+1]!+port;
      const p=2*(A[branch]!*f[branch]!+A[branch+1]!*b[branch+1]!+port*nl[0]!)/sum;
      nb[branch]=(p-f[branch]!)*loss;nf[branch+1]=(p-b[branch+1]!)*loss;nnr[0]=(p-nl[0]!)*loss;
    }else nnr[0]=nl[0]!*loss;
    this.phase+=frame.pitchHz/this.internalRate;this.phase-=Math.floor(this.phase);
    // Geometric, prescribed glottal cycle. Smooth open / faster closure.
    const open=.65,t=this.phase;let shape=0;
    if(t<open*.65)shape=.5-.5*Math.cos(Math.PI*t/(open*.65));
    else if(t<open)shape=Math.cos(Math.PI/2*(t-open*.65)/(open*.35))**2;
    const gate=frame.voicing,Ag=(voice.glottalAreaM2??.000018)*(gate*shape+(1-gate)*.55);
    const Z=RHO*C/(A[0]!*CM2),dp=frame.lungPressurePa-2*b[0]!;
    const resistance=RHO/(2*Math.max(1e-20,Ag*Ag));
    const flow=Ag<1e-10?0:2*dp/(Z+Math.sqrt(Z*Z+4*resistance*Math.abs(dp)));
    this.sourceFlowM3S=flow;nf[0]=(b[0]!+Z*flow)*loss;
    const random=this.noise();this.lowNoise+=.18*(random-this.lowNoise);const noise=random-this.lowNoise;
    if(frame.lungPressurePa>0){
      const idx=Math.min(42,Math.max(1,frame.constrictionSection)),jetArea=A[idx]!*CM2;
      const q=.5*RHO*(flow/Math.max(1e-8,jetArea))**2;
      const turbulence=frame.frication*.030*Math.min(frame.lungPressurePa,q)*noise;
      nf[idx+1]=nf[idx+1]!+turbulence;nb[idx]=nb[idx]!-turbulence;
      nf[0]+=(frame.aspiration*.010+(voice.breathiness??.025)*gate*.002)*frame.lungPressurePa*noise;
    }
    const mouthAlpha=Math.exp(-TAU*4000/this.internalRate),noseAlpha=Math.exp(-TAU*3000/this.internalRate);
    this.mouthPrevious=mouthAlpha*this.mouthPrevious+(1-mouthAlpha)*f[43]!;
    this.nosePrevious=noseAlpha*this.nosePrevious+(1-noseAlpha)*nr[27]!;
    nb[43]=-.96*this.mouthPrevious;nnl[27]=-.94*this.nosePrevious;
    const outputFlow=(f[43]!-nb[43]!)*A[43]!*CM2/(RHO*C)+(nr[27]!-nnl[27]!)*na[27]!*CM2/(RHO*C);
    const radiated=RHO/(4*Math.PI)*(outputFlow-this.previousFlow)*this.internalRate;this.previousFlow=outputFlow;
    const hp=radiated-this.dcInput+.999*this.dcOutput;this.dcInput=radiated;this.dcOutput=hp;
    f.set(nf);b.set(nb);nr.set(nnr);nl.set(nnl);
    if(!Number.isFinite(hp))throw new Error('Native acoustic solver became nonfinite');
    this.maxPressurePa=Math.max(this.maxPressurePa,Math.abs(hp));return hp;
  }
}
