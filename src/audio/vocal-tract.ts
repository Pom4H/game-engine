import {mulberry32} from '../core/random.js';
import {CompliantVelopharyngealValve,DiaphragmBreathSupport,PressureDrivenVocalFolds} from './vocal-source.js';
import type {AudioChannels} from './synth.js';

export type VocalArticulation='silence'|'a'|'i'|'ae'|'schwa'|'l'|'m'|'v';

export interface VocalArticulators {
  /** 0 closed .. 1 maximally open. */
  readonly jawOpen:number;
  /** 0 back/pharyngeal .. 1 front/alveolar. */
  readonly tonguePosition:number;
  /** 0 low .. 1 high toward palate. */
  readonly tongueHeight:number;
  /** 0 relaxed .. 1 strong tongue-tip constriction near alveolar ridge. */
  readonly tongueTip:number;
  /** 0 spread/neutral .. 1 rounded/protruded lips. */
  readonly lipRound:number;
  /** 0 open lips .. 1 bilabial closure. */
  readonly lipClosure:number;
  /** 0 closed velopharyngeal port .. 1 open nasal coupling. */
  readonly velumOpen:number;
  /** 0 none .. 1 lower-lip/upper-teeth constriction. */
  readonly labiodental:number;
}

export interface ArticulatorGesture {
  readonly startS:number;
  readonly endS:number;
  readonly from:VocalArticulators;
  readonly to?:VocalArticulators;
  /** Fold adduction command. */
  readonly voiced?:number;
  readonly frication?:number;
  /** Tissue tension target, not an authored oscillator phase. */
  readonly pitchHz?:number;
  /** Legacy speech effort; used to derive pressure when lungPressurePa is absent. */
  readonly gain?:number;
  /** Respiratory muscle target pressure. Typical speech ~700-1000 Pa, opera can exceed 1400 Pa. */
  readonly lungPressurePa?:number;
  /** Neuromuscular tension modulation for singing vibrato. */
  readonly vibratoHz?:number;
  readonly vibratoSemitones?:number;
}

export interface SampledArticulatorScore {
  readonly articulators:VocalArticulators;
  readonly voiced:number;
  readonly frication:number;
  readonly pitchHz:number;
  readonly gain:number;
  readonly lungPressurePa:number;
  readonly vibratoHz:number;
  readonly vibratoSemitones:number;
}

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
  readonly articulatorGestures?:readonly ArticulatorGesture[];
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

export const VOCAL_ARTICULATOR_PRESETS:Readonly<Record<VocalArticulation,VocalArticulators>>=Object.freeze({
  silence:Object.freeze({jawOpen:.14,tonguePosition:.50,tongueHeight:.30,tongueTip:0,lipRound:0,lipClosure:.06,velumOpen:0,labiodental:0}),
  a:Object.freeze({jawOpen:.92,tonguePosition:.18,tongueHeight:.18,tongueTip:0,lipRound:.02,lipClosure:0,velumOpen:0,labiodental:0}),
  i:Object.freeze({jawOpen:.28,tonguePosition:.82,tongueHeight:.92,tongueTip:.08,lipRound:0,lipClosure:0,velumOpen:0,labiodental:0}),
  ae:Object.freeze({jawOpen:.72,tonguePosition:.64,tongueHeight:.46,tongueTip:.04,lipRound:0,lipClosure:0,velumOpen:0,labiodental:0}),
  schwa:Object.freeze({jawOpen:.45,tonguePosition:.50,tongueHeight:.42,tongueTip:0,lipRound:.02,lipClosure:0,velumOpen:0,labiodental:0}),
  l:Object.freeze({jawOpen:.45,tonguePosition:.72,tongueHeight:.58,tongueTip:.82,lipRound:0,lipClosure:0,velumOpen:0,labiodental:0}),
  m:Object.freeze({jawOpen:.18,tonguePosition:.45,tongueHeight:.35,tongueTip:0,lipRound:.08,lipClosure:.99,velumOpen:1,labiodental:0}),
  v:Object.freeze({jawOpen:.20,tonguePosition:.48,tongueHeight:.34,tongueTip:0,lipRound:.03,lipClosure:.18,velumOpen:0,labiodental:.86}),
});

export function articulatorAreaFunction(state:VocalArticulators,sections=24):Float64Array{
  if(!Number.isInteger(sections)||sections<12||sections>96)throw new RangeError('Vocal tract sections must be 12..96');
  for(const [key,value] of Object.entries(state))if(!Number.isFinite(value)||value<0||value>1)throw new RangeError(`Vocal articulator ${key} must be within 0..1`);
  const out=new Float64Array(sections);
  const tongueCenter=.25+.52*state.tonguePosition;
  const tongueWidth=.11+.12*(1-state.tongueHeight);
  const tongueDepth=.45+2.45*state.tongueHeight;
  for(let i=0;i<sections;i++){
    const x=(i+.5)/sections;
    // Baseline tube opens with the jaw and slowly widens toward the lips.
    let area=.72+3.25*state.jawOpen+1.05*x;
    area*=.42+.58*Math.min(1,x/.12);

    // Tongue body subtracts oral volume at a location determined by front/back
    // position. Jaw opening counteracts part of that constriction.
    area-=tongueDepth*(1-.28*state.jawOpen)*GAUSS(x,tongueCenter,tongueWidth);

    // A low/back tongue also narrows the pharynx, which is what gives /a/-like
    // shapes their strong first resonance without specifying a formant frequency.
    const pharyngeal=(1-state.tonguePosition)*(1-state.tongueHeight);
    area-=1.25*pharyngeal*GAUSS(x,.22,.13);

    // Tongue tip produces an alveolar constriction. 1-D cannot model lateral
    // channels explicitly, so /l/ retains a small non-zero bypass area.
    area-=2.75*state.tongueTip*GAUSS(x,.79,.055);

    // Lip rounding lengthens/narrows the terminal aperture; closure and
    // labiodental contact are separate physical constrictions.
    area-=1.15*state.lipRound*GAUSS(x,.94,.09);
    if(x>.84){
      const lipT=clamp((x-.84)/.16,0,1);
      const lipCap=.025+(1-state.lipClosure)*4.5+(1-lipT)**3*4.0;
      area=Math.min(area,lipCap);
      const dentalCap=.055+(1-state.labiodental)*3.8+(1-lipT)**3*3.2;
      area=Math.min(area,dentalCap);
    }

    out[i]=clamp(area,.025,7);
  }
  return out;
}

export function vocalAreaFunction(kind:VocalArticulation,sections=24):Float64Array{
  return articulatorAreaFunction(VOCAL_ARTICULATOR_PRESETS[kind],sections);
}

export function interpolateArticulators(a:VocalArticulators,b:VocalArticulators,t:number):VocalArticulators{
  const u=clamp(t,0,1);
  return Object.freeze({
    jawOpen:a.jawOpen+(b.jawOpen-a.jawOpen)*u,
    tonguePosition:a.tonguePosition+(b.tonguePosition-a.tonguePosition)*u,
    tongueHeight:a.tongueHeight+(b.tongueHeight-a.tongueHeight)*u,
    tongueTip:a.tongueTip+(b.tongueTip-a.tongueTip)*u,
    lipRound:a.lipRound+(b.lipRound-a.lipRound)*u,
    lipClosure:a.lipClosure+(b.lipClosure-a.lipClosure)*u,
    velumOpen:a.velumOpen+(b.velumOpen-a.velumOpen)*u,
    labiodental:a.labiodental+(b.labiodental-a.labiodental)*u,
  });
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
    {startS:1.61,endS:1.72,from:'v',voiced:.94,frication:.28,pitchHz:129,gain:.82},
    {startS:1.72,endS:2.00,from:'silence',voiced:0,frication:0,gain:0},
  ]);
}

function defaultIAmAliveArticulatorScore():readonly ArticulatorGesture[]{
  const p=VOCAL_ARTICULATOR_PRESETS;
  return Object.freeze([
    {startS:0,endS:.08,from:p.silence,voiced:0,gain:0},
    {startS:.08,endS:.27,from:p.a,to:p.i,voiced:1,pitchHz:124,gain:.86},
    {startS:.27,endS:.43,from:p.i,voiced:1,pitchHz:126,gain:.82},
    {startS:.43,endS:.68,from:p.ae,voiced:1,pitchHz:121,gain:.92},
    {startS:.68,endS:.84,from:p.m,voiced:.9,pitchHz:119,gain:.78},
    {startS:.84,endS:1.00,from:p.schwa,voiced:.82,pitchHz:118,gain:.66},
    {startS:1.00,endS:1.16,from:p.l,voiced:.9,pitchHz:121,gain:.78},
    {startS:1.16,endS:1.39,from:p.a,to:p.i,voiced:1,pitchHz:127,gain:1},
    {startS:1.39,endS:1.61,from:p.i,voiced:1,pitchHz:133,gain:.94},
    {startS:1.61,endS:1.72,from:p.v,voiced:.94,pitchHz:129,gain:.82},
    {startS:1.72,endS:1.84,from:p.v,to:p.silence,voiced:0,frication:0,gain:0},
    {startS:1.84,endS:2.00,from:p.silence,voiced:0,frication:0,gain:0},
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


interface TubeBoundaryState {readonly incoming:number;readonly area:number}

class AcousticTube {
  readonly areas:Float64Array;
  readonly forward:Float64Array;
  readonly backward:Float64Array;
  private readonly nextForward:Float64Array;
  private readonly nextBackward:Float64Array;
  maxAbsReflection=0;

  constructor(readonly sections:number,readonly wallLoss:number){
    this.areas=new Float64Array(sections);
    this.forward=new Float64Array(sections);
    this.backward=new Float64Array(sections);
    this.nextForward=new Float64Array(sections);
    this.nextBackward=new Float64Array(sections);
  }

  beginStep():void{
    this.nextForward.fill(0);this.nextBackward.fill(0);
    for(let i=0;i<this.sections-1;i++){
      const left=Math.max(.005,this.areas[i]!),right=Math.max(.005,this.areas[i+1]!);
      const r=(left-right)/(left+right);
      this.maxAbsReflection=Math.max(this.maxAbsReflection,Math.abs(r));
      const fromLeft=this.forward[i]!,fromRight=this.backward[i+1]!;
      this.nextBackward[i]=(r*fromLeft+(1-r)*fromRight)*this.wallLoss;
      this.nextForward[i+1]=((1+r)*fromLeft-r*fromRight)*this.wallLoss;
    }
  }
  leftIncoming():TubeBoundaryState{return{incoming:this.backward[0]!,area:Math.max(.005,this.areas[0]!)};}
  rightIncoming():TubeBoundaryState{const i=this.sections-1;return{incoming:this.forward[i]!,area:Math.max(.005,this.areas[i]!)};}
  setLeftOutgoing(value:number):void{this.nextForward[0]=value*this.wallLoss;}
  setRightOutgoing(value:number):void{this.nextBackward[this.sections-1]=value*this.wallLoss;}
  inject(section:number,value:number):void{
    const k=Math.max(1,Math.min(this.sections-2,section));
    this.nextForward[k]=this.nextForward[k]!+value*.5;
    this.nextBackward[k]=this.nextBackward[k]!+value*.5;
  }
  commit():void{this.forward.set(this.nextForward);this.backward.set(this.nextBackward);}
}

class ApertureRadiator {
  private previous=0;
  radiate(incoming:number,areaCm2:number):{reflected:number;output:number}{
    const radiusScale=Math.sqrt(Math.max(.005,areaCm2));
    const reflection=-clamp(.92-.12*radiusScale,.55,.91);
    const pressure=(1+reflection)*incoming;
    const output=(pressure-this.previous)*.74+pressure*.26;
    this.previous=pressure;
    return{reflected:reflection*incoming,output};
  }
}

export interface ThreePortScatterResult {
  readonly commonPressure:number;
  readonly outgoing:readonly [number,number,number];
  readonly energyResidual:number;
}

/** Lossless pressure-wave scattering at a three-way acoustic junction.
 * Characteristic admittance is proportional to cross-sectional area. */
export function scatterThreePort(
  incoming:readonly [number,number,number],
  areas:readonly [number,number,number],
):ThreePortScatterResult{
  const y0=Math.max(1e-6,areas[0]),y1=Math.max(1e-6,areas[1]),y2=Math.max(1e-6,areas[2]),sum=y0+y1+y2;
  const common=2*(y0*incoming[0]+y1*incoming[1]+y2*incoming[2])/sum;
  const outgoing:[number,number,number]=[common-incoming[0],common-incoming[1],common-incoming[2]];
  const before=y0*incoming[0]**2+y1*incoming[1]**2+y2*incoming[2]**2;
  const after=y0*outgoing[0]**2+y1*outgoing[1]**2+y2*outgoing[2]**2;
  return Object.freeze({commonPressure:common,outgoing:Object.freeze(outgoing),energyResidual:after-before});
}

class BranchedVocalNetwork {
  readonly pharynx:AcousticTube;
  readonly oral:AcousticTube;
  readonly nasal:AcousticTube;
  private readonly mouthRadiator=new ApertureRadiator();
  private readonly noseRadiator=new ApertureRadiator();
  private readonly velopharyngeal:CompliantVelopharyngealValve;
  private readonly nasalBase:Float64Array;
  private velumControl=0;
  maxBranchEnergyResidual=0;

  constructor(readonly sections:number,readonly sampleRate:number){
    const pharynxSections=Math.max(5,Math.round(sections*.38));
    this.pharynx=new AcousticTube(pharynxSections,.9982);
    this.oral=new AcousticTube(Math.max(7,sections-pharynxSections),.9975);
    const sectionLength=SPEED_OF_SOUND_MPS/sampleRate;
    const nasalSections=Math.max(12,Math.round(.12/sectionLength));
    this.nasal=new AcousticTube(nasalSections,.9965);
    this.nasalBase=nasalAreaFunction(nasalSections);
    this.nasal.areas.set(this.nasalBase);
    this.velopharyngeal=new CompliantVelopharyngealValve(sampleRate);
  }

  setGeometry(fullArea:Float64Array,velumOpen:number):void{
    const p=this.pharynx.sections,o=this.oral.sections;
    for(let i=0;i<p;i++)this.pharynx.areas[i]=fullArea[Math.min(fullArea.length-1,i)]!;
    for(let i=0;i<o;i++)this.oral.areas[i]=fullArea[Math.min(fullArea.length-1,p+i)]!;
    this.velumControl=clamp(velumOpen,0,1);
  }

  get supraglottalPressurePa():number{
    return clamp(this.pharynx.leftIncoming().incoming*420,-600,600);
  }

  step(glottalSource:number,glottalFlow:number,state:VocalArticulators,rng:()=>number):number{
    const p=this.pharynx,o=this.oral,n=this.nasal;
    const pressureDelta=(p.rightIncoming().incoming-n.leftIncoming().incoming)*360;
    const portArea=this.velopharyngeal.step({muscleOpen:this.velumControl,pressureDeltaPa:pressureDelta});
    for(let i=0;i<n.sections;i++){
      const t=clamp(i/4,0,1);
      n.areas[i]=portArea+(this.nasalBase[i]!-portArea)*t;
    }
    p.beginStep();o.beginStep();n.beginStep();

    // Glottis: flow source plus compliant subglottal reflection.
    const glottalIncoming=p.leftIncoming().incoming;
    p.setLeftOutgoing(glottalSource+.68*glottalIncoming);

    // True velopharyngeal three-port junction: pharynx -> oral + nasal.
    const pi=p.rightIncoming(),oi=o.leftIncoming(),ni=n.leftIncoming();
    const branch=scatterThreePort(
      [pi.incoming,oi.incoming,ni.incoming],
      [pi.area,oi.area,ni.area],
    );
    this.maxBranchEnergyResidual=Math.max(this.maxBranchEnergyResidual,Math.abs(branch.energyResidual));
    p.setRightOutgoing(branch.outgoing[0]);
    o.setLeftOutgoing(branch.outgoing[1]);
    n.setLeftOutgoing(branch.outgoing[2]);

    // Turbulence is generated by jet flow through the actual terminal
    // labiodental constriction, not by a free-standing frication oscillator.
    const oralAreas=o.areas;
    let minArea=Infinity,minIndex=o.sections-2;
    for(let i=Math.max(1,o.sections-6);i<o.sections-1;i++)if(oralAreas[i]!<minArea){minArea=oralAreas[i]!;minIndex=i;}
    const aperture=Math.max(.02,minArea);
    const contraction=clamp((.55-aperture)/.53,0,1);
    const jetVelocity=glottalFlow/Math.max(.035,aperture);
    const reynoldsProxy=Math.abs(jetVelocity)*state.labiodental*contraction;
    const turbulence=(rng()*2-1)*Math.max(0,reynoldsProxy-.08)*.035;
    if(Math.abs(turbulence)>1e-12)o.inject(minIndex,turbulence);

    const mouth=o.rightIncoming(),mouthRad=this.mouthRadiator.radiate(mouth.incoming,mouth.area);
    o.setRightOutgoing(mouthRad.reflected);
    const nose=n.rightIncoming(),noseRad=this.noseRadiator.radiate(nose.incoming,nose.area);
    n.setRightOutgoing(noseRad.reflected);

    p.commit();o.commit();n.commit();
    return mouthRad.output+noseRad.output*.88;
  }

  get maxAbsReflection():number{return Math.max(this.pharynx.maxAbsReflection,this.oral.maxAbsReflection,this.nasal.maxAbsReflection);}
}

export function renderArticulatedVocalTract(
  gestures:readonly ArticulatorGesture[],
  options:VocalTractRenderOptions={},
  phrase='custom',
):VocalTractRender{
  const proxy:VocalGesture[]=gestures.map(g=>({
    startS:g.startS,endS:g.endS,from:'schwa',
    ...(g.voiced!==undefined?{voiced:g.voiced}:{}),
    ...(g.frication!==undefined?{frication:g.frication}:{}),
    ...(g.pitchHz!==undefined?{pitchHz:g.pitchHz}:{}),
    ...(g.gain!==undefined?{gain:g.gain}:{}),
  }));
  const sampleRate=options.sampleRate??48_000,tractLengthM=options.tractLengthM??.1715;
  if(!Number.isSafeInteger(sampleRate)||sampleRate<16_000||sampleRate>192_000)throw new RangeError('Vocal sample rate must be 16k..192k');
  const idealSections=Math.round(tractLengthM/(SPEED_OF_SOUND_MPS/sampleRate)),sections=options.sections??idealSections;
  if(!Number.isInteger(sections)||sections<12||sections>96)throw new RangeError('Vocal tract sections must be 12..96');
  const duration=gestures.at(-1)?.endS??0;if(duration<=0)throw new RangeError('Articulator score must contain gestures');
  const count=Math.ceil(duration*sampleRate),left=new Float32Array(count),right=new Float32Array(count);
  const network=new BranchedVocalNetwork(sections,sampleRate),folds=new PressureDrivenVocalFolds(sampleRate),breath=new DiaphragmBreathSupport(sampleRate);
  const current=new Float64Array(articulatorAreaFunction(gestures[0]!.from,sections)),target=new Float64Array(sections),rng=mulberry32(options.seed??0xA11CE),transition=options.transitionS??.014;
  const areaAlpha=1-Math.exp(-1/(sampleRate*Math.max(.002,transition))),scalarAttack=1-Math.exp(-1/(sampleRate*.007)),scalarRelease=1-Math.exp(-1/(sampleRate*.003));
  let gestureIndex=0,voicedState=0,gainState=0,pitchState=120,previousFoldFlow=0,peak=0,minArea=Infinity,maxArea=0;
  for(let sample=0;sample<count;sample++){
    const time=sample/sampleRate;while(gestureIndex<gestures.length-1&&time>=gestures[gestureIndex]!.endS)gestureIndex++;
    const gesture=gestures[gestureIndex]!,u=clamp((time-gesture.startS)/(gesture.endS-gesture.startS),0,1),state=interpolateArticulators(gesture.from,gesture.to??gesture.from,u);
    target.set(articulatorAreaFunction(state,sections));
    for(let i=0;i<sections;i++){current[i]=current[i]!+(target[i]!-current[i]!)*areaAlpha;minArea=Math.min(minArea,current[i]!);maxArea=Math.max(maxArea,current[i]!);}
    network.setGeometry(current,state.velumOpen);

    const voicedTarget=gesture.voiced??1,gainTarget=gesture.gain??1,pitchTarget=gesture.pitchHz??120;
    voicedState+=(voicedTarget<voicedState?scalarRelease:scalarAttack)*(voicedTarget-voicedState);
    gainState+=(gainTarget<gainState?scalarRelease:scalarAttack)*(gainTarget-gainState);
    pitchState+=scalarAttack*(pitchTarget-pitchState);
    const vibratoHz=gesture.vibratoHz??0,vibratoSemitones=gesture.vibratoSemitones??0;
    const vibratoRatio=vibratoHz>0&&vibratoSemitones!==0?2**((Math.sin(2*Math.PI*vibratoHz*time)*vibratoSemitones)/12):1;
    const pressureTarget=gesture.lungPressurePa??gainState*900;
    const support=breath.step({targetPressurePa:pressureTarget,glottalFlowM3S:previousFoldFlow});
    const fold=folds.step({
      adduction:voicedState,
      tensionHz:pitchState*vibratoRatio,
      lungPressurePa:support.pressurePa,
      supraglottalPressurePa:network.supraglottalPressurePa,
    });
    previousFoldFlow=fold.flowM3S;
    const flowNormalized=fold.flowM3S/.00020;
    const sampleOut=network.step(fold.source,flowNormalized,state,rng)*4.1;
    peak=Math.max(peak,Math.abs(sampleOut));left[sample]=sampleOut;right[sample]=sampleOut;
  }

  let rawEnergy=0;for(let i=0;i<count;i++)rawEnergy+=left[i]!*left[i]!;
  const rawRms=Math.sqrt(rawEnergy/Math.max(1,count)),normalize=rawRms>1e-9?.22/rawRms:1;
  for(let i=0;i<count;i++){left[i]=Math.tanh(left[i]!*normalize*1.34);right[i]=left[i]!;}
  const sectionLengthM=tractLengthM/sections;
  const articulated=Object.freeze(gestures.map(g=>Object.freeze({...g,from:Object.freeze({...g.from}),...(g.to?{to:Object.freeze({...g.to})}:{})})));
  const diagnostics:VocalTractDiagnostics=Object.freeze({
    phrase,durationS:duration,sampleRate,sections,tractLengthM,sectionLengthM,
    propagationDelayPerSectionS:sectionLengthM/SPEED_OF_SOUND_MPS,
    maxAbsReflection:network.maxAbsReflection,
    minAreaCm2:minArea,maxAreaCm2:maxArea,
    gestures:Object.freeze(proxy.map(g=>Object.freeze(g))),
    articulatorGestures:articulated,
  });
  return{audio:{left,right,sampleRate},diagnostics};
}

export function sampleArticulatorScore(gestures:readonly ArticulatorGesture[],timeS:number):SampledArticulatorScore{
  if(!gestures.length)throw new RangeError('Articulator score must contain gestures');
  if(!Number.isFinite(timeS)||timeS<0)throw new RangeError('Articulator sample time must be non-negative');
  let index=0;
  while(index<gestures.length-1&&timeS>=gestures[index]!.endS)index++;
  const gesture=gestures[index]!,duration=Math.max(1e-9,gesture.endS-gesture.startS);
  const u=clamp((timeS-gesture.startS)/duration,0,1);
  const articulators=interpolateArticulators(gesture.from,gesture.to??gesture.from,u);
  return Object.freeze({
    articulators,
    voiced:gesture.voiced??1,
    frication:gesture.frication??articulators.labiodental*.72,
    pitchHz:gesture.pitchHz??120,
    gain:gesture.gain??1,
    lungPressurePa:gesture.lungPressurePa??(gesture.gain??1)*900,
    vibratoHz:gesture.vibratoHz??0,
    vibratoSemitones:gesture.vibratoSemitones??0,
  });
}

export function synthesizeIAmAlive(options:VocalTractRenderOptions={}):VocalTractRender{
  return renderArticulatedVocalTract(defaultIAmAliveArticulatorScore(),options,'I am alive!');
}

export function iAmAliveVocalScore():readonly VocalGesture[]{return defaultIAmAliveScore();}
export function iAmAliveArticulatorScore():readonly ArticulatorGesture[]{return defaultIAmAliveArticulatorScore();}
