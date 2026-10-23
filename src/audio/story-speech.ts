import {mulberry32} from '../core/random.js';
import {LfGlottalSource} from './lf-glottal.js';
import {
  renderArticulatedVocalTract,
  VOCAL_ARTICULATOR_PRESETS,
  type ArticulatorGesture,
  type VocalAreaFrame,
  type VocalArticulators,
  type VocalTractRender,
  scatterThreePort,
  type VocalGesture,
  type VocalTractRenderOptions,
} from './vocal-tract.js';
import {
  STORY_NOMINAL_TRACT_LENGTH_CM,
  STORY_SECTIONS,
  STORY_TUBELET_LENGTH_CM,
  resampleStoryArea,
  storyArea,
  storyControlForConsonant,
  storyControlForVowel,
  type StoryAreaControl,
} from './story-area-model.js';

const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const smooth=(t:number)=>{const x=clamp(t,0,1);return x*x*(3-2*x);};

export interface StorySpeechGesture{
  readonly startS:number;
  readonly endS:number;
  readonly control:StoryAreaControl;
  readonly articulators:VocalArticulators;
  readonly voiced:number;
  readonly pitchHz:number;
  readonly lungPressurePa:number;
  readonly gain:number;
}

export interface StorySpeechOptions extends Omit<VocalTractRenderOptions,'areaFrames'|'tractLengthM'>{
  readonly controlRateHz?:number;
  readonly tractLengthM?:number;
}

function validateScore(score:readonly StorySpeechGesture[]):void{
  if(!score.length)throw new RangeError('Story speech score must not be empty');
  for(let i=0;i<score.length;i++){
    const g=score[i]!;
    if(!Number.isFinite(g.startS)||!Number.isFinite(g.endS)||g.endS<=g.startS)throw new RangeError('Story speech gestures need finite positive duration');
    if(i&&Math.abs(g.startS-score[i-1]!.endS)>1e-6)throw new RangeError('Story speech gestures must be contiguous');
  }
}

function areaAt(score:readonly StorySpeechGesture[],timeS:number,transitionS:number):{area:Float64Array;nasal:number}{
  let index=0;while(index<score.length-1&&timeS>=score[index]!.endS)index++;
  const g=score[index]!,base=storyArea(g.control);
  const nasalBase=g.control.nasalPortAreaCm2??0;
  if(index>=score.length-1||transitionS<=0)return{area:base,nasal:nasalBase};

  const begin=Math.max(g.startS,g.endS-transitionS);
  if(timeS<=begin)return{area:base,nasal:nasalBase};
  const next=score[index+1]!,target=storyArea(next.control),u=smooth((timeS-begin)/Math.max(1e-9,g.endS-begin));
  const mixed=new Float64Array(STORY_SECTIONS);
  for(let i=0;i<STORY_SECTIONS;i++)mixed[i]=base[i]!+(target[i]!-base[i]!)*u;
  const nasalTarget=next.control.nasalPortAreaCm2??0;
  return{area:mixed,nasal:nasalBase+(nasalTarget-nasalBase)*u};
}

export function buildStoryAreaFrames(
  score:readonly StorySpeechGesture[],
  options:StorySpeechOptions={},
):readonly VocalAreaFrame[]{
  validateScore(score);
  const sampleRate=options.sampleRate??48_000;
  const tractLengthM=options.tractLengthM??STORY_NOMINAL_TRACT_LENGTH_CM/100;
  const sections=options.sections??Math.max(12,Math.round(tractLengthM/(343/sampleRate)));
  const controlRateHz=options.controlRateHz??240,dt=1/controlRateHz,duration=score.at(-1)!.endS;
  const transitionS=options.transitionS??.035;
  const frames:VocalAreaFrame[]=[];
  const count=Math.ceil(duration*controlRateHz);
  for(let k=0;k<=count;k++){
    const timeS=Math.min(duration,k*dt),state=areaAt(score,timeS,transitionS);
    frames.push(Object.freeze({
      timeS,
      oralAreaCm2:Object.freeze([...resampleStoryArea(state.area,sections)]),
      // Story's /m/ uses ~1.04 cm² nasal coupling. The existing compliant
      // velopharyngeal valve receives a normalized muscle command.
      velumOpen:clamp(state.nasal/1.04,0,1),
    }));
  }
  for(let i=frames.length-1;i>0;i--)if(frames[i]!.timeS<=frames[i-1]!.timeS)frames.splice(i,1);
  return Object.freeze(frames);
}

export function renderStorySpeech(
  score:readonly StorySpeechGesture[],
  options:StorySpeechOptions={},
  phrase='Story-model speech',
):VocalTractRender{
  validateScore(score);
  const sampleRate=options.sampleRate??48_000;
  const tractLengthM=options.tractLengthM??STORY_NOMINAL_TRACT_LENGTH_CM/100;
  const sections=options.sections??Math.max(12,Math.round(tractLengthM/(343/sampleRate)));
  const areaFrames=buildStoryAreaFrames(score,{...options,sampleRate,tractLengthM,sections});
  const proxy:ArticulatorGesture[]=score.map(g=>Object.freeze({
    startS:g.startS,endS:g.endS,from:g.articulators,
    voiced:g.voiced,pitchHz:g.pitchHz,lungPressurePa:g.lungPressurePa,gain:g.gain,
  }));
  const {controlRateHz:_control,...renderOptions}=options;
  return renderArticulatedVocalTract(
    Object.freeze(proxy),
    {...renderOptions,sampleRate,tractLengthM,sections,areaFrames},
    phrase,
  );
}


class StoryTube{
  readonly areas:Float64Array;
  private readonly forward:Float64Array;
  private readonly backward:Float64Array;
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
      const left=Math.max(.0001,this.areas[i]!),right=Math.max(.0001,this.areas[i+1]!);
      const r=(left-right)/(left+right);
      this.maxAbsReflection=Math.max(this.maxAbsReflection,Math.abs(r));
      const fromLeft=this.forward[i]!,fromRight=this.backward[i+1]!;
      this.nextBackward[i]=(r*fromLeft+(1-r)*fromRight)*this.wallLoss;
      this.nextForward[i+1]=((1+r)*fromLeft-r*fromRight)*this.wallLoss;
    }
  }
  leftIncoming():{incoming:number;area:number}{return{incoming:this.backward[0]!,area:Math.max(.0001,this.areas[0]!)};}
  rightIncoming():{incoming:number;area:number}{const i=this.sections-1;return{incoming:this.forward[i]!,area:Math.max(.0001,this.areas[i]!)};}
  setLeftOutgoing(v:number):void{this.nextForward[0]=v*this.wallLoss;}
  setRightOutgoing(v:number):void{this.nextBackward[this.sections-1]=v*this.wallLoss;}
  inject(section:number,v:number):void{
    const k=Math.max(1,Math.min(this.sections-2,section));
    this.nextForward[k]=this.nextForward[k]!+v*.5;
    this.nextBackward[k]=this.nextBackward[k]!+v*.5;
  }
  commit():void{this.forward.set(this.nextForward);this.backward.set(this.nextBackward);}
}

class StoryRadiator{
  private previous=0;
  radiate(incoming:number,areaCm2:number):{reflected:number;output:number}{
    const radiusScale=Math.sqrt(Math.max(.0001,areaCm2));
    const reflection=-clamp(.94-.11*radiusScale,.58,.93);
    const pressure=(1+reflection)*incoming;
    const output=(pressure-this.previous)*.78+pressure*.22;
    this.previous=pressure;
    return{reflected:reflection*incoming,output};
  }
}

class StoryTransmissionNetwork{
  readonly pharynx=new StoryTube(22,.9985);
  readonly oral=new StoryTube(22,.9980);
  readonly nasal=new StoryTube(30,.9970);
  private readonly mouthRadiator=new StoryRadiator();
  private readonly noseRadiator=new StoryRadiator();
  private readonly nasalBase=new Float64Array(30);
  private nasalPortAreaCm2=0;
  maxBranchEnergyResidual=0;

  constructor(){
    for(let i=0;i<this.nasalBase.length;i++){
      const x=(i+.5)/this.nasalBase.length;
      this.nasalBase[i]=clamp(.55+2.4*x+1.0*Math.exp(-(((x-.48)/.25)**2))-.65*Math.exp(-(((x-.82)/.14)**2)),.16,4.2);
    }
    this.nasal.areas.set(this.nasalBase);
  }

  setGeometry(area:Float64Array,nasalPortAreaCm2:number):void{
    if(area.length!==STORY_SECTIONS)throw new RangeError('Story transmission network requires 44-section area');
    for(let i=0;i<22;i++)this.pharynx.areas[i]=Math.max(.0001,area[i]!);
    for(let i=0;i<22;i++)this.oral.areas[i]=Math.max(.0001,area[i+22]!);
    this.nasalPortAreaCm2=Math.max(0,nasalPortAreaCm2);
  }

  get supraglottalPressurePa():number{return clamp(this.pharynx.leftIncoming().incoming*420,-600,600);}

  private halfStep(source:number,flow:number,articulators:VocalArticulators,rng:()=>number):number{
    const p=this.pharynx,o=this.oral,n=this.nasal;
    const port=Math.max(.0001,this.nasalPortAreaCm2);
    for(let i=0;i<n.sections;i++){
      const q=clamp(i/4,0,1);
      n.areas[i]=port+(this.nasalBase[i]!-port)*q;
    }
    p.beginStep();o.beginStep();n.beginStep();

    const glottalIncoming=p.leftIncoming().incoming;
    p.setLeftOutgoing(source+.70*glottalIncoming);

    const pi=p.rightIncoming(),oi=o.leftIncoming(),ni=n.leftIncoming();
    const branch=scatterThreePort([pi.incoming,oi.incoming,ni.incoming],[pi.area,oi.area,ni.area]);
    this.maxBranchEnergyResidual=Math.max(this.maxBranchEnergyResidual,Math.abs(branch.energyResidual));
    p.setRightOutgoing(branch.outgoing[0]);o.setLeftOutgoing(branch.outgoing[1]);n.setLeftOutgoing(branch.outgoing[2]);

    let minArea=Infinity,minIndex=1;
    for(let i=1;i<o.sections-1;i++)if(o.areas[i]!<minArea){minArea=o.areas[i]!;minIndex=i;}
    const constrictionDrive=Math.max(articulators.labiodental,articulators.tongueTip);
    const contraction=clamp((.55-minArea)/.53,0,1);
    const jet=Math.abs(flow)/Math.max(.03,minArea)*constrictionDrive*contraction;
    const noise=(rng()*2-1)*Math.max(0,jet-.05)*.035;
    if(Math.abs(noise)>1e-12)o.inject(minIndex,noise);

    const mouth=o.rightIncoming(),mr=this.mouthRadiator.radiate(mouth.incoming,mouth.area);
    o.setRightOutgoing(mr.reflected);
    const nose=n.rightIncoming(),nr=this.noseRadiator.radiate(nose.incoming,nose.area);
    n.setRightOutgoing(nr.reflected);
    p.commit();o.commit();n.commit();
    return mr.output+nr.output*.86;
  }

  step(source:number,flow:number,articulators:VocalArticulators,rng:()=>number):number{
    // Story's published D=c/(2Fs): two tubelet propagation updates per
    // audio sample reproduce c when D=.396825 cm at Fs=44.1 kHz.
    return .5*(
      this.halfStep(source*.5,flow*.5,articulators,rng)+
      this.halfStep(source*.5,flow*.5,articulators,rng)
    );
  }

  get maxAbsReflection():number{return Math.max(this.pharynx.maxAbsReflection,this.oral.maxAbsReflection,this.nasal.maxAbsReflection);}
}

export function renderStoryTransmissionLineSpeech(
  score:readonly StorySpeechGesture[],
  options:StorySpeechOptions={},
  phrase='Story transmission-line speech',
):VocalTractRender{
  validateScore(score);
  const sampleRate=options.sampleRate??44_100;
  if(sampleRate!==44_100)throw new RangeError('Story 44-section transmission-line proof currently requires 44.1 kHz');
  const duration=score.at(-1)!.endS,count=Math.ceil(duration*sampleRate),left=new Float32Array(count),right=new Float32Array(count);
  const network=new StoryTransmissionNetwork(),lf=new LfGlottalSource(sampleRate),rng=mulberry32(options.seed??0x5707);
  const transition=options.transitionS??.035;
  let gestureIndex=0,voicedState=0,gainState=0,pitchState=112,peak=0,minArea=Infinity,maxArea=0;
  const attack=1-Math.exp(-1/(sampleRate*.008)),release=1-Math.exp(-1/(sampleRate*.004));

  for(let sample=0;sample<count;sample++){
    const time=sample/sampleRate;
    while(gestureIndex<score.length-1&&time>=score[gestureIndex]!.endS)gestureIndex++;
    const g=score[gestureIndex]!,state=areaAt(score,time,transition);
    network.setGeometry(state.area,state.nasal);
    for(const a of state.area){minArea=Math.min(minArea,a);maxArea=Math.max(maxArea,a);}
    voicedState+=(g.voiced<voicedState?release:attack)*(g.voiced-voicedState);
    gainState+=(g.gain<gainState?release:attack)*(g.gain-gainState);
    pitchState+=attack*(g.pitchHz-pitchState);
    // VTL/Story-style parametric synthesis: the calibrated tract is excited by
    // an LF glottal volume-flow pulse instead of the separate self-oscillating
    // fold model used elsewhere in the engine.
    const pressureScale=Math.sqrt(clamp(g.lungPressurePa/900,0,2));
    const source=lf.step({
      f0Hz:pitchState,
      amplitudeCm3S:300*pressureScale*gainState,
      openQuotient:.5,
      speedQuotient:3,
      returnPhase:.02,
      voiced:voicedState,
    });
    const normalizedFlow=source.flowCm3S/300;
    const out=network.step(normalizedFlow,normalizedFlow,g.articulators,rng)*4.0;
    peak=Math.max(peak,Math.abs(out));left[sample]=out;right[sample]=out;
  }

  let energy=0;for(const v of left)energy+=v*v;
  const rms=Math.sqrt(energy/Math.max(1,left.length)),normalize=rms>1e-9?.20/rms:1;
  for(let i=0;i<left.length;i++){left[i]=Math.tanh(left[i]!*normalize*1.28);right[i]=left[i]!;}
  const proxy:VocalGesture[]=score.map(g=>Object.freeze({
    startS:g.startS,endS:g.endS,from:'schwa',
    voiced:g.voiced,pitchHz:g.pitchHz,gain:g.gain,
  }));
  const articulatorGestures:ArticulatorGesture[]=score.map(g=>Object.freeze({
    startS:g.startS,endS:g.endS,from:g.articulators,
    voiced:g.voiced,pitchHz:g.pitchHz,lungPressurePa:g.lungPressurePa,gain:g.gain,
  }));
  return{
    audio:{left,right,sampleRate},
    diagnostics:Object.freeze({
      phrase,durationS:duration,sampleRate,sections:STORY_SECTIONS,
      tractLengthM:STORY_NOMINAL_TRACT_LENGTH_CM/100,
      sectionLengthM:STORY_TUBELET_LENGTH_CM/100,
      propagationDelayPerSectionS:(STORY_TUBELET_LENGTH_CM/100)/343,
      maxAbsReflection:network.maxAbsReflection,
      minAreaCm2:minArea,maxAreaCm2:maxArea,
      gestures:Object.freeze(proxy),
      articulatorGestures:Object.freeze(articulatorGestures),
      geometryDriven:true,
    }),
  };
}

const P=VOCAL_ARTICULATOR_PRESETS;
const silenceControl=storyControlForVowel('schwa');
const aaControl=storyControlForVowel('aa');
const mControl=storyControlForConsonant('m');

export function storyMamaScore():readonly StorySpeechGesture[]{
  return Object.freeze([
    Object.freeze({startS:0,endS:.32,control:silenceControl,articulators:P.silence,voiced:0,pitchHz:112,lungPressurePa:0,gain:0}),
    Object.freeze({startS:.32,endS:.50,control:mControl,articulators:P.m,voiced:.94,pitchHz:112,lungPressurePa:900,gain:1}),
    Object.freeze({startS:.50,endS:.80,control:aaControl,articulators:P.a,voiced:.98,pitchHz:112,lungPressurePa:960,gain:1}),
    Object.freeze({startS:.80,endS:.98,control:mControl,articulators:P.m,voiced:.94,pitchHz:110,lungPressurePa:900,gain:1}),
    Object.freeze({startS:.98,endS:1.34,control:aaControl,articulators:P.a,voiced:.98,pitchHz:108,lungPressurePa:960,gain:1}),
    Object.freeze({startS:1.34,endS:1.72,control:silenceControl,articulators:P.silence,voiced:0,pitchHz:108,lungPressurePa:0,gain:0}),
  ]);
}

export function synthesizeStoryMama(options:StorySpeechOptions={}):VocalTractRender{
  return renderStoryTransmissionLineSpeech(storyMamaScore(),options,'mama');
}
