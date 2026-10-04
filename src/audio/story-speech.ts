import {
  renderArticulatedVocalTract,
  VOCAL_ARTICULATOR_PRESETS,
  type ArticulatorGesture,
  type VocalAreaFrame,
  type VocalArticulators,
  type VocalTractRender,
  type VocalTractRenderOptions,
} from './vocal-tract.js';
import {
  STORY_NOMINAL_TRACT_LENGTH_CM,
  STORY_SECTIONS,
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
  return renderStorySpeech(storyMamaScore(),options,'mama');
}
