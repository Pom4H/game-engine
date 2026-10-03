import {
  VOCAL_ARTICULATOR_PRESETS,
  renderArticulatedVocalTract,
  type ArticulatorGesture,
  type VocalArticulators,
  type VocalTractRender,
  type VocalTractRenderOptions,
} from './vocal-tract.js';

const P=VOCAL_ARTICULATOR_PRESETS;
const freeze=(v:VocalArticulators)=>Object.freeze(v);
const state=(base:VocalArticulators,patch:Partial<VocalArticulators>):VocalArticulators=>freeze({...base,...patch});

const OPERA=Object.freeze({
  silence:P.silence,
  o:state(P.a,{jawOpen:.74,tonguePosition:.24,tongueHeight:.34,lipRound:.55,lipClosure:0}),
  e:state(P.i,{jawOpen:.56,tonguePosition:.68,tongueHeight:.62,tongueTip:.08,lipRound:.04,lipClosure:0}),
  i:state(P.i,{jawOpen:.48,tonguePosition:.82,tongueHeight:.86,tongueTip:.10,lipRound:0,lipClosure:0}),
  s:state(P.i,{jawOpen:.44,tonguePosition:.84,tongueHeight:.82,tongueTip:.90,lipClosure:0}),
  v:state(P.v,{jawOpen:.42,labiodental:.78,lipClosure:.08}),
  l:state(P.l,{jawOpen:.50,tonguePosition:.79,tongueHeight:.66,tongueTip:.74,lipClosure:0}),
  t:state(P.i,{jawOpen:.38,tonguePosition:.83,tongueHeight:.74,tongueTip:1,lipClosure:0}),
});

export const ORIGINAL_OPERA_LYRICS='О, свет, лети!';

type Note={
  readonly articulation:VocalArticulators;
  readonly duration:number;
  readonly pitchHz:number;
  readonly pressurePa:number;
  readonly adduction?:number;
  readonly vibrato?:boolean;
  readonly to?:VocalArticulators;
};

export function originalOperaScore():readonly ArticulatorGesture[]{
  const notes:Note[]=[
    {articulation:OPERA.silence,duration:.32,pitchHz:190,pressurePa:0,adduction:0},

    // "О" — supported onset, then crescendo without changing the vowel geometry.
    {articulation:OPERA.o,duration:.30,pitchHz:196.00,pressurePa:1180,adduction:.92},
    {articulation:OPERA.o,duration:.55,pitchHz:196.00,pressurePa:1380,adduction:.94,vibrato:true},
    {articulation:OPERA.o,duration:.62,pitchHz:220.00,pressurePa:1480,adduction:.94,vibrato:true},

    {articulation:OPERA.s,duration:.10,pitchHz:220.00,pressurePa:1180,adduction:.03},
    {articulation:OPERA.v,duration:.11,pitchHz:220.00,pressurePa:1260,adduction:.88},
    {articulation:OPERA.e,duration:.42,pitchHz:220.00,pressurePa:1420,adduction:.94,vibrato:true},
    {articulation:OPERA.e,duration:.52,pitchHz:246.94,pressurePa:1500,adduction:.95,vibrato:true},
    {articulation:OPERA.t,duration:.08,pitchHz:246.94,pressurePa:1120,adduction:.04},

    {articulation:OPERA.silence,duration:.22,pitchHz:220,pressurePa:260,adduction:0},

    {articulation:OPERA.l,duration:.14,pitchHz:246.94,pressurePa:1250,adduction:.92},
    {articulation:OPERA.e,duration:.38,pitchHz:246.94,pressurePa:1440,adduction:.95,vibrato:true},
    {articulation:OPERA.t,duration:.075,pitchHz:246.94,pressurePa:1150,adduction:.04},
    {articulation:OPERA.i,duration:.40,pitchHz:261.63,pressurePa:1450,adduction:.95,vibrato:true},
    {articulation:OPERA.i,duration:.70,pitchHz:293.66,pressurePa:1550,adduction:.96,vibrato:true},
    {articulation:OPERA.i,duration:.75,pitchHz:261.63,pressurePa:1460,adduction:.94,vibrato:true},

    {articulation:OPERA.i,to:OPERA.silence,duration:.24,pitchHz:246.94,pressurePa:500,adduction:.35},
    {articulation:OPERA.silence,duration:.28,pitchHz:220,pressurePa:0,adduction:0},
  ];
  let time=0;
  return Object.freeze(notes.map(note=>{
    const startS=time,endS=time+note.duration;time=endS;
    return Object.freeze({
      startS,endS,from:note.articulation,...(note.to?{to:note.to}:{}),
      voiced:note.adduction??.94,gain:1,pitchHz:note.pitchHz,lungPressurePa:note.pressurePa,
      vibratoHz:note.vibrato?5.6:0,vibratoSemitones:note.vibrato?.42:0,
    });
  }));
}

export function synthesizeOriginalOpera(options:VocalTractRenderOptions={}):VocalTractRender{
  return renderArticulatedVocalTract(originalOperaScore(),options,ORIGINAL_OPERA_LYRICS);
}
