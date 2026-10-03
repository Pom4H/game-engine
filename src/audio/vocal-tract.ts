import {mulberry32} from '../core/random.js';
import type {AudioChannels} from './synth.js';

export type VocalArticulation='silence'|'a'|'i'|'ae'|'schwa'|'l'|'m'|'v';

export interface VocalGesture {
  readonly startS:number;
  readonly endS:number;
  readonly from:VocalArticulation;
  readonly to?:VocalArticulation;
  readonly voiced?:number;
  readonly nasal?:number;
  readonly frication?:number;
  readonly pitchHz?:number;
  readonly gain?:number;
}

export interface VocalTractRenderOptions {
  readonly sampleRate?:number;
  readonly sections?:number;
  readonly tractLengthM?:number;
  readonly seed?:number;
  readonly transitionS?:number;
}

export interface VocalTractDiagnostics {
  readonly phrase:string;
  readonly durationS:number;
  readonly sampleRate:number;
  readonly sections:number;
  readonly tractLengthM:number;
  readonly sectionLengthM:number;
  readonly propagationDelayPerSectionS:number;
  readonly maxAbsReflection:number;
  readonly minAreaCm2:number;
  readonly maxAreaCm2:number;
  readonly gestures:readonly VocalGesture[];
}

export interface VocalTractRender {
  readonly audio:AudioChannels;
  readonly diagnostics:VocalTractDiagnostics;
}

const SPEED_OF_SOUND_MPS=343;
const clamp=(v:number,min:number,max:number)=>Math.max(min,Math.min(max,v));

/**
 * One-dimensional loss-bearing Kelly-Lochbaum vocal tract.
 *
 * Each section is one sample of acoustic propagation. At a junction between
 * areas A1 and A2, pressure reflection is
 *
 *   r = (A1 - A2) / (A1 + A2)
 *
 * which follows directly from Z = rho*c/A. No formant filters are authored:
 * resonances emerge from repeated scattering between the glottis, constrictions
 * and lips as the area function changes.
 */
class TubeWaveguide {
  readonly areas:Float64Array;
  private readonly forward:Float64Array;
  private readonly backward:Float64Array;
  private readonly nextForward:Float64Array;
  private readonly nextBackward:Float64Array;
  private previousRadiation=0;
  maxAbsReflection=0;

  constructor(
    readonly sections:number,
    readonly wallLoss:number,
    readonly lipReflection:number,
    readonly glottalReflection:number,
  ){
    this.areas=new Float64Array(sections);
    this.forward=new Float64Array(sections);
    this.backward=new Float64Array(sections);
    this.nextForward=new Float64Array(sections);
    this.nextBackward=new Float64Array(sections);
  }

  step(source:number,noise:number,noiseSection:number):number{
    const n=this.sections,A=this.areas,f=this.forward,b=this.backward,nf=this.nextForward,nb=this.nextBackward;
    nf.fill(0);nb.fill(0);
    nf[0]=source+this.glottalReflection*b[0]!;
    for(let i=0;i<n-1;i++){
      const left=Math.max(.01,A[i]!),right=Math.max(.01,A[i+1]!),reflection=(left-right)/(left+right);
      this.maxAbsReflection=Math.max(this.maxAbsReflection,Math.abs(reflection));
      const incomingRight=f[i]!,incomingLeft=b[i+1]!;
      nb[i]=(reflection*incomingRight+(1-reflection)*incomingLeft)*this.wallLoss;
      nf[i+1]=((1+reflection)*incomingRight-reflection*incomingLeft)*this.wallLoss;
    }
    if(noise!==0){
      const k=Math.max(1,Math.min(n-2,noiseSection));
      nf[k]=nf[k]!+noise*.5;
      nb[k]=nb[k]!+noise*.5;
    }
    nb[n-1]=this.lipReflection*f[n-1]!*this.wallLoss;
    const mouth=(1+this.lipReflection)*f[n-1]!;
    const radiation=(mouth-this.previousRadiation)*.82+mouth*.18;
    this.previousRadiation=mouth;
    this.forward.set(nf);this.backward.set(nb);
    return radiation;
  }
}

const GAUSS=(x:number,c:number,w:number)=>Math.exp(-(((x-c)/w)**2));

export function vocalAreaFunction(kind:VocalArticulation,sections=24):Float64Array{
  if(!Number.isInteger(sections)||sections<12||sections>96)throw new RangeError('Vocal tract sections must be 12..96');
  const out=new Float64Array(sections);
  for(let i=0;i<sections;i++){
    const x=(i+.5)/sections;
    let area=2.5+1.1*x;
    area*=.45+.55*Math.min(1,x/.12);
    if(kind==='a'){
      area-=1.65*GAUSS(x,.28,.15);area+=1.5*GAUSS(x,.82,.23);area+=.7*x;
    }else if(kind==='i'){
      area+=1.7*GAUSS(x,.28,.22);area-=2.45*GAUSS(x,.72,.105);area-=.45*GAUSS(x,.93,.09);
    }else if(kind==='ae'){
      area-=1.25*GAUSS(x,.38,.17);area+=1.15*GAUSS(x,.78,.22);area+=.35*x;
    }else if(kind==='schwa'){
      area-=.35*GAUSS(x,.52,.24);area+=.2*GAUSS(x,.82,.20);
    }else if(kind==='l'){
      area+=.65*GAUSS(x,.34,.20);area-=2.15*GAUSS(x,.78,.09);area+=.35*GAUSS(x,.96,.06);
    }else if(kind==='m'){
      area-=.35*GAUSS(x,.45,.24);area=Math.min(area, x>.86?.035+(1-x)*.18:area);
    }else if(kind==='v'){
      area+=.25*GAUSS(x,.45,.23);area=Math.min(area,x>.88?.07+(1-x)*.35:area);
    }else if(kind==='silence'){
      area=2.7;
    }
    out[i]=clamp(area,.025,7);
  }
  return out;
}

function nasalAreaFunction(sections:number):Float64Array{
  const out=new Float64Array(sections);
  for(let i=0;i<sections;i++){
    const x=(i+.5)/sections;
    out[i]=clamp(.65+2.1*x+1.2*GAUSS(x,.48,.24)-.8*GAUSS(x,.82,.13),.18,4.2);
  }
  return out;
}

function interpolateAreas(a:Float64Array,b:Float64Array,t:number,out:Float64Array):void{
  const u=clamp(t,0,1);for(let i=0;i<out.length;i++)out[i]=a[i]!+(b[i]!-a[i]!)*u;
}

function defaultIAmAliveScore():readonly VocalGesture[]{
  return Object.freeze([
    {startS:0,endS:.08,from:'silence',voiced:0,gain:0},
    {startS:.08,endS:.27,from:'a',to:'i',voiced:1,pitchHz:124,gain:.86},
    {startS:.27,endS:.43,from:'i',voiced:1,pitchHz:126,gain:.82},
    {startS:.43,endS:.68,from:'ae',voiced:1,pitchHz:121,gain:.92},
    {startS:.68,endS:.84,from:'m',voiced:.9,nasal:1,pitchHz:119,gain:.78},
    {startS:.84,endS:1.00,from:'schwa',voiced:.82,pitchHz:118,gain:.66},
    {startS:1.00,endS:1.16,from:'l',voiced:.9,pitchHz:121,gain:.78},
    {startS:1.16,endS:1.39,from:'a',to:'i',voiced:1,pitchHz:127,gain:1},
    {startS:1.39,endS:1.61,from:'i',voiced:1,pitchHz:133,gain:.94},
    {startS:1.61,endS:1.76,from:'v',voiced:.72,frication:.78,pitchHz:129,gain:.74},
    {startS:1.76,endS:2.00,from:'silence',voiced:0,gain:0},
  ]);
}

export function renderVocalTract(
  gestures:readonly VocalGesture[],
  options:VocalTractRenderOptions={},
  phrase='custom',
):VocalTractRender{
  if(!gestures.length)throw new RangeError('Vocal score must contain gestures');
  const sampleRate=options.sampleRate??48_000,tractLengthM=options.tractLengthM??.1715;
  if(!Number.isSafeInteger(sampleRate)||sampleRate<16_000||sampleRate>192_000)throw new RangeError('Vocal sample rate must be 16k..192k');
  if(!Number.isFinite(tractLengthM)||tractLengthM<.12||tractLengthM>.24)throw new RangeError('Vocal tract length must be 0.12..0.24 m');
  const idealSections=Math.round(tractLengthM/(SPEED_OF_SOUND_MPS/sampleRate)),sections=options.sections??idealSections;
  if(!Number.isInteger(sections)||sections<12||sections>96)throw new RangeError('Vocal tract sections must be 12..96');
  for(let i=0;i<gestures.length;i++){
    const g=gestures[i]!;
    if(!Number.isFinite(g.startS)||!Number.isFinite(g.endS)||g.startS<0||g.endS<=g.startS||(i>0&&g.startS<gestures[i-1]!.endS-1e-9))throw new RangeError('Vocal gestures must be finite, ordered and non-overlapping');
  }
  const duration=gestures.at(-1)!.endS,count=Math.ceil(duration*sampleRate),left=new Float32Array(count),right=new Float32Array(count);
  const oral=new TubeWaveguide(sections,.9975,-.82,.72),nasalSections=Math.max(12,Math.round(sections*.92)),nasal=new TubeWaveguide(nasalSections,.996,-.78,.62);
  nasal.areas.set(nasalAreaFunction(nasalSections));
  const areaCache=new Map<VocalArticulation,Float64Array>(),getArea=(kind:VocalArticulation)=>{let value=areaCache.get(kind);if(!value){value=vocalAreaFunction(kind,sections);areaCache.set(kind,value);}return value;};
  const target=new Float64Array(sections),current=new Float64Array(getArea('schwa')),rng=mulberry32(options.seed??0xA11CE),transition=options.transitionS??.014;
  const areaAlpha=1-Math.exp(-1/(sampleRate*Math.max(.002,transition)));
  let gestureIndex=0,phase=0,previousFlow=0,voicedState=0,nasalState=0,fricationState=0,gainState=0,pitchState=120,aspirationState=0,peak=0,minArea=Infinity,maxArea=0;
  const scalarAlpha=1-Math.exp(-1/(sampleRate*.008));

  for(let sample=0;sample<count;sample++){
    const time=sample/sampleRate;
    while(gestureIndex<gestures.length-1&&time>=gestures[gestureIndex]!.endS)gestureIndex++;
    const gesture=gestures[gestureIndex]!,local=clamp((time-gesture.startS)/(gesture.endS-gesture.startS),0,1);
    const from=getArea(gesture.from),to=getArea(gesture.to??gesture.from);interpolateAreas(from,to,local,target);
    for(let i=0;i<sections;i++){current[i]=current[i]!+(target[i]!-current[i]!)*areaAlpha;oral.areas[i]=current[i]!;minArea=Math.min(minArea,current[i]!);maxArea=Math.max(maxArea,current[i]!);}
    const voicedTarget=gesture.voiced??(gesture.from==='silence'?0:1),nasalTarget=gesture.nasal??0,fricTarget=gesture.frication??0,gainTarget=gesture.gain??1,pitchTarget=gesture.pitchHz??120;
    voicedState+=scalarAlpha*(voicedTarget-voicedState);nasalState+=scalarAlpha*(nasalTarget-nasalState);fricationState+=scalarAlpha*(fricTarget-fricationState);gainState+=scalarAlpha*(gainTarget-gainState);pitchState+=scalarAlpha*(pitchTarget-pitchState);
    aspirationState+=scalarAlpha*((voicedState>0?.012:.002)-aspirationState);

    phase+=pitchState/sampleRate;if(phase>=1)phase-=Math.floor(phase);
    const openQuotient=.64,flow=phase<openQuotient?Math.sin(Math.PI*phase/openQuotient)**2:0;
    const derivative=flow-previousFlow;previousFlow=flow;
    const breath=(rng()*2-1)*aspirationState;
    const glottal=(derivative*.92+flow*.055+breath)*voicedState*gainState;
    const constrictionNoise=(rng()*2-1)*fricationState*gainState*.16;
    const oralOut=oral.step(glottal*(1-.42*nasalState),constrictionNoise,Math.floor(sections*.90));
    const nasalOut=nasal.step(glottal*nasalState*.72,0,0);
    const sampleOut=(oralOut+nasalOut*.72)*3.5;
    peak=Math.max(peak,Math.abs(sampleOut));
    left[sample]=sampleOut;right[sample]=sampleOut;
  }

  const normalize=peak>1e-9?.88/peak:1;
  for(let i=0;i<count;i++){left[i]=Math.tanh(left[i]!*normalize*1.2);right[i]=left[i]!;}
  const sectionLengthM=tractLengthM/sections;
  return{
    audio:{left,right,sampleRate},
    diagnostics:Object.freeze({
      phrase,durationS:duration,sampleRate,sections,tractLengthM,sectionLengthM,
      propagationDelayPerSectionS:sectionLengthM/SPEED_OF_SOUND_MPS,
      maxAbsReflection:Math.max(oral.maxAbsReflection,nasal.maxAbsReflection),
      minAreaCm2:minArea,maxAreaCm2:maxArea,gestures:Object.freeze(gestures.map(g=>Object.freeze({...g}))),
    }),
  };
}

export function synthesizeIAmAlive(options:VocalTractRenderOptions={}):VocalTractRender{
  return renderVocalTract(defaultIAmAliveScore(),options,'I am alive!');
}

export function iAmAliveVocalScore():readonly VocalGesture[]{return defaultIAmAliveScore();}
