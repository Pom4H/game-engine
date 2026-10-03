import {
  VOCAL_ARTICULATOR_PRESETS,
  renderArticulatedVocalTract,
  type ArticulatorGesture,
  type VocalArticulators,
  type VocalTractRender,
  type VocalTractRenderOptions,
} from './vocal-tract.js';

const freeze=(value:VocalArticulators)=>Object.freeze(value);
const state=(base:VocalArticulators,patch:Partial<VocalArticulators>):VocalArticulators=>freeze({...base,...patch});
const P=VOCAL_ARTICULATOR_PRESETS;

const RU=Object.freeze({
  silence:P.silence,
  a:P.a,
  i:P.i,
  schwa:P.schwa,
  y:state(P.i,{jawOpen:.34,tonguePosition:.78,tongueHeight:.82,tongueTip:.10}),
  e:state(P.i,{jawOpen:.43,tonguePosition:.69,tongueHeight:.66,tongueTip:.08}),
  o:state(P.a,{jawOpen:.58,tonguePosition:.25,tongueHeight:.36,lipRound:.52}),
  u:state(P.a,{jawOpen:.25,tonguePosition:.20,tongueHeight:.76,lipRound:.88}),
  j:state(P.i,{jawOpen:.28,tonguePosition:.88,tongueHeight:.94,tongueTip:.12}),
  softL:state(P.l,{jawOpen:.30,tonguePosition:.84,tongueHeight:.76,tongueTip:.74}),
  v:state(P.v,{jawOpen:.23,labiodental:.86,lipClosure:.12}),
  z:state(P.i,{jawOpen:.24,tonguePosition:.82,tongueHeight:.80,tongueTip:.84,lipClosure:0}),
  s:state(P.i,{jawOpen:.24,tonguePosition:.84,tongueHeight:.82,tongueTip:.90,lipClosure:0}),
  r:state(P.schwa,{jawOpen:.34,tonguePosition:.77,tongueHeight:.58,tongueTip:.94}),
  rOpen:state(P.schwa,{jawOpen:.36,tonguePosition:.70,tongueHeight:.48,tongueTip:.18}),
  t:state(P.i,{jawOpen:.20,tonguePosition:.83,tongueHeight:.74,tongueTip:1,lipClosure:0}),
  k:state(P.a,{jawOpen:.20,tonguePosition:.18,tongueHeight:1,tongueTip:0,lipClosure:0}),
});

export const RUSSIAN_MOUTH_PHRASE='Я извлекаю звук из своего рта';

type Segment={
  readonly state:VocalArticulators;
  readonly duration:number;
  readonly voiced:number;
  readonly gain:number;
  readonly pitch?:number;
  readonly to?:VocalArticulators;
};

export function russianMouthArticulatorScore():readonly ArticulatorGesture[]{
  const segments:Segment[]=[
    {state:RU.silence,duration:.08,voiced:0,gain:0},
    {state:RU.j,to:RU.a,duration:.16,voiced:.9,gain:.72,pitch:122},
    {state:RU.a,duration:.16,voiced:1,gain:.86,pitch:123},

    {state:RU.y,duration:.13,voiced:1,gain:.75,pitch:121},
    {state:RU.z,duration:.10,voiced:.82,gain:.76,pitch:120},
    {state:RU.v,duration:.09,voiced:.90,gain:.72,pitch:119},
    {state:RU.softL,duration:.11,voiced:.96,gain:.80,pitch:119},
    {state:RU.y,duration:.12,voiced:1,gain:.78,pitch:121},
    {state:RU.k,duration:.075,voiced:.04,gain:.82},
    {state:RU.a,duration:.13,voiced:1,gain:.90,pitch:126},
    {state:RU.j,to:RU.u,duration:.12,voiced:.9,gain:.82,pitch:128},
    {state:RU.u,duration:.16,voiced:1,gain:.86,pitch:127},

    {state:RU.silence,duration:.055,voiced:0,gain:0},

    {state:RU.z,duration:.10,voiced:.84,gain:.78,pitch:121},
    {state:RU.v,duration:.10,voiced:.92,gain:.76,pitch:120},
    {state:RU.u,duration:.16,voiced:1,gain:.88,pitch:119},
    {state:RU.k,duration:.085,voiced:.03,gain:.84},

    {state:RU.silence,duration:.045,voiced:0,gain:0},

    {state:RU.y,duration:.12,voiced:1,gain:.74,pitch:117},
    {state:RU.s,duration:.10,voiced:.02,gain:.76},

    {state:RU.silence,duration:.035,voiced:0,gain:0},

    {state:RU.s,duration:.10,voiced:.02,gain:.78},
    {state:RU.v,duration:.09,voiced:.90,gain:.74,pitch:118},
    {state:RU.schwa,duration:.13,voiced:1,gain:.80,pitch:119},
    {state:RU.j,to:RU.e,duration:.12,voiced:.92,gain:.78,pitch:122},
    {state:RU.e,duration:.13,voiced:1,gain:.82,pitch:123},
    {state:RU.v,duration:.09,voiced:.92,gain:.76,pitch:120},
    {state:RU.o,duration:.16,voiced:1,gain:.88,pitch:118},

    {state:RU.silence,duration:.045,voiced:0,gain:0},

    {state:RU.r,duration:.035,voiced:.95,gain:.80,pitch:116},
    {state:RU.rOpen,duration:.028,voiced:.95,gain:.80,pitch:116},
    {state:RU.r,duration:.032,voiced:.95,gain:.80,pitch:116},
    {state:RU.t,duration:.070,voiced:.02,gain:.84},
    {state:RU.a,duration:.20,voiced:1,gain:.92,pitch:114},

    {state:RU.a,to:RU.silence,duration:.12,voiced:0,gain:0},
    {state:RU.silence,duration:.16,voiced:0,gain:0},
  ];

  let time=0;
  const out:ArticulatorGesture[]=[];
  for(const segment of segments){
    const startS=time,endS=time+segment.duration;
    time=endS;
    out.push(Object.freeze({
      startS,endS,from:segment.state,...(segment.to?{to:segment.to}:{}),
      voiced:segment.voiced,gain:segment.gain,...(segment.pitch?{pitchHz:segment.pitch}:{}),
    }));
  }
  return Object.freeze(out);
}

export function synthesizeRussianMouthPhrase(options:VocalTractRenderOptions={}):VocalTractRender{
  return renderArticulatedVocalTract(russianMouthArticulatorScore(),options,RUSSIAN_MOUTH_PHRASE);
}
