import {
  VOCAL_ARTICULATOR_PRESETS,
  renderArticulatedVocalTract,
  type ArticulatorGesture,
  type VocalArticulators,
  type VocalTractDiagnostics,
} from './vocal-tract.js';
import type {AudioChannels} from './synth.js';

const P=VOCAL_ARTICULATOR_PRESETS;
const freeze=(v:VocalArticulators)=>Object.freeze(v);
const state=(base:VocalArticulators,patch:Partial<VocalArticulators>):VocalArticulators=>freeze({...base,...patch});

const R=Object.freeze({
  silence:P.silence,
  a:P.a,
  i:P.i,
  y:state(P.i,{jawOpen:.34,tonguePosition:.77,tongueHeight:.80,tongueTip:.10}),
  e:state(P.i,{jawOpen:.44,tonguePosition:.69,tongueHeight:.64,tongueTip:.08}),
  o:state(P.a,{jawOpen:.58,tonguePosition:.24,tongueHeight:.35,lipRound:.50}),
  u:state(P.a,{jawOpen:.27,tonguePosition:.20,tongueHeight:.75,lipRound:.86}),
  j:state(P.i,{jawOpen:.29,tonguePosition:.88,tongueHeight:.93,tongueTip:.12}),
  l:state(P.l,{jawOpen:.36,tonguePosition:.77,tongueHeight:.63,tongueTip:.78}),
  r:state(P.schwa,{jawOpen:.36,tonguePosition:.77,tongueHeight:.58,tongueTip:.94}),
  rOpen:state(P.schwa,{jawOpen:.38,tonguePosition:.70,tongueHeight:.48,tongueTip:.18}),
  m:P.m,
  n:state(P.i,{jawOpen:.22,tonguePosition:.82,tongueHeight:.70,tongueTip:1,velumOpen:.92,lipClosure:0}),
  p:state(P.m,{jawOpen:.16,velumOpen:0,lipClosure:.995}),
  b:state(P.m,{jawOpen:.18,velumOpen:0,lipClosure:.985}),
  v:state(P.v,{jawOpen:.24,labiodental:.86,lipClosure:.10}),
  f:state(P.v,{jawOpen:.24,labiodental:.92,lipClosure:.10}),
  z:state(P.i,{jawOpen:.25,tonguePosition:.82,tongueHeight:.80,tongueTip:.86,lipClosure:0}),
  s:state(P.i,{jawOpen:.25,tonguePosition:.84,tongueHeight:.82,tongueTip:.92,lipClosure:0}),
  t:state(P.i,{jawOpen:.21,tonguePosition:.83,tongueHeight:.74,tongueTip:1,lipClosure:0}),
  d:state(P.i,{jawOpen:.22,tonguePosition:.82,tongueHeight:.72,tongueTip:1,lipClosure:0}),
  k:state(P.a,{jawOpen:.21,tonguePosition:.18,tongueHeight:1,tongueTip:0,lipClosure:0}),
  g:state(P.a,{jawOpen:.22,tonguePosition:.18,tongueHeight:.98,tongueTip:0,lipClosure:0}),
  sh:state(P.i,{jawOpen:.28,tonguePosition:.68,tongueHeight:.76,tongueTip:.74,lipRound:.15,lipClosure:0}),
  zh:state(P.i,{jawOpen:.28,tonguePosition:.68,tongueHeight:.76,tongueTip:.72,lipRound:.15,lipClosure:0}),
  ch:state(P.i,{jawOpen:.24,tonguePosition:.76,tongueHeight:.84,tongueTip:.96,lipRound:.12,lipClosure:0}),
  h:state(P.a,{jawOpen:.42,tonguePosition:.28,tongueHeight:.72,tongueTip:0,lipClosure:0}),
});

type PhoneKey=keyof typeof R;
type PhoneSpec=readonly [PhoneKey,number?];

const VOICED=new Set<PhoneKey>(['a','i','y','e','o','u','j','l','r','rOpen','m','n','b','v','z','d','g','zh']);
const DEFAULT_DURATION:Readonly<Record<PhoneKey,number>>=Object.freeze({
  silence:.06,a:.12,i:.11,y:.11,e:.11,o:.12,u:.12,j:.07,l:.08,r:.08,rOpen:.03,m:.09,n:.08,p:.065,b:.07,v:.08,f:.08,z:.08,s:.085,t:.065,d:.07,k:.07,g:.075,sh:.10,zh:.095,ch:.09,h:.08,
});

interface VoiceProfile{
  readonly name:string;
  readonly basePitchHz:number;
  readonly pressurePa:number;
  readonly tractLengthM:number;
  readonly pan:number;
}

export const DIALOGUE_VOICE_A:VoiceProfile=Object.freeze({name:'Антон',basePitchHz:116,pressurePa:860,tractLengthM:.180,pan:-.36});
export const DIALOGUE_VOICE_B:VoiceProfile=Object.freeze({name:'Лена',basePitchHz:171,pressurePa:790,tractLengthM:.158,pan:.36});

export const PHYSICAL_DIALOGUE_SCRIPT=Object.freeze([
  'Антон: Ты слышал? Мой чайник сказал: «Я устал».',
  'Лена: Что? Чайник устал?',
  'Антон: Да. Я дал ему умную розетку.',
  'Лена: Ха-ха! А мой робот украл носок соседа.',
  'Антон: Серьёзно?!',
  'Лена: Вернул утром.',
  'Оба смеются.',
] as const);

const A1:readonly PhoneSpec[]=[
  ['t'],['y'], ['s'],['l'],['y'],['sh'],['a'],['l'],
  ['m'],['o'],['j'], ['ch'],['a'],['j'],['n'],['i'],['k'],
  ['s'],['k'],['a'],['z'],['a'],['l'], ['j'],['a'], ['u'],['s'],['t'],['a'],['l'],
];
const B1:readonly PhoneSpec[]=[
  ['sh'],['t'],['o'], ['ch'],['a'],['j'],['n'],['i'],['k'], ['u'],['s'],['t'],['a'],['l'],
];
const A2:readonly PhoneSpec[]=[
  ['d'],['a'], ['j'],['a'], ['d'],['a'],['l'], ['j'],['e'],['m'],['u'],
  ['u'],['m'],['n'],['u'],['j'],['u'], ['r'],['o'],['z'],['e'],['t'],['k'],['u'],
];
const B2:readonly PhoneSpec[]=[
  ['a'], ['m'],['o'],['j'], ['r'],['o'],['b'],['o'],['t'],
  ['u'],['k'],['r'],['a'],['l'], ['n'],['a'],['s'],['o'],['k'],
  ['s'],['a'],['s'],['e'],['d'],['a'],
];
const A3:readonly PhoneSpec[]=[
  ['s'],['e'],['r'],['j'],['o'],['z'],['n'],['a'],
];
const B3:readonly PhoneSpec[]=[
  ['v'],['e'],['r'],['n'],['u'],['l'], ['u'],['t'],['r'],['a'],['m'],
];

interface UtteranceOptions{
  readonly pitchScale?:number;
  readonly pressureScale?:number;
  readonly surprise?:number;
}

function phoneVoicing(key:PhoneKey):number{
  if(key==='silence')return 0;
  if(key==='v'||key==='z'||key==='zh')return .86;
  if(key==='b'||key==='d'||key==='g')return .80;
  return VOICED.has(key)?.96:.025;
}

function appendPhones(
  out:ArticulatorGesture[],
  start:number,
  phones:readonly PhoneSpec[],
  voice:VoiceProfile,
  options:UtteranceOptions={},
):number{
  let time=start;
  const pitchScale=options.pitchScale??1,pressureScale=options.pressureScale??1,surprise=options.surprise??0;
  for(let index=0;index<phones.length;index++){
    const [key,overrideDuration]=phones[index]!,duration=(overrideDuration??DEFAULT_DURATION[key])*(surprise? .88:1);
    const articulation=R[key];
    if(key==='r'){
      const micro:[VocalArticulators,number][]=[[R.r,.030],[R.rOpen,.026],[R.r,.029]];
      for(const [form,part] of micro){
        const end=time+part;
        out.push(Object.freeze({startS:time,endS:end,from:form,voiced:.94,pitchHz:voice.basePitchHz*pitchScale*(1+surprise*.16),lungPressurePa:voice.pressurePa*pressureScale*(1+surprise*.16),gain:1}));
        time=end;
      }
      continue;
    }
    const next=phones[index+1]?.[0],to=next&&key!=='t'&&key!=='d'&&key!=='k'&&key!=='g'&&key!=='p'&&key!=='b'?R[next]:undefined;
    const end=time+duration;
    out.push(Object.freeze({
      startS:time,endS:end,from:articulation,...(to?{to}:{}),
      voiced:phoneVoicing(key),
      pitchHz:voice.basePitchHz*pitchScale*(1+surprise*.16),
      lungPressurePa:key==='silence'?0:voice.pressurePa*pressureScale*(1+surprise*.20),
      gain:key==='silence'?0:1,
    }));
    time=end;
  }
  return time;
}

function appendSilence(out:ArticulatorGesture[],start:number,end:number):void{
  if(end<=start)return;
  out.push(Object.freeze({startS:start,endS:end,from:R.silence,voiced:0,lungPressurePa:0,gain:0,pitchHz:120}));
}

function appendLaugh(out:ArticulatorGesture[],start:number,voice:VoiceProfile,cycles:number,kind:'open'|'chuckle'):number{
  let time=start;
  for(let i=0;i<cycles;i++){
    const open=kind==='open'?R.a:state(R.a,{jawOpen:.58,lipRound:.04});
    const pressure=voice.pressurePa*(kind==='open'?1.18:.86)*(1-.05*i);
    const voiced=kind==='open'?.86:.62;
    const pitch=voice.basePitchHz*(kind==='open'?1.24:1.10)*(1+.025*i);
    const pulse=kind==='open'?.13:.095,gap=kind==='open'?.075:.055;
    out.push(Object.freeze({startS:time,endS:time+pulse,from:open,voiced,pitchHz:pitch,lungPressurePa:pressure,gain:1}));
    time+=pulse;
    out.push(Object.freeze({startS:time,endS:time+gap,from:R.silence,voiced:0,pitchHz:pitch,lungPressurePa:pressure*.28,gain:.18}));
    time+=gap;
  }
  return time;
}

function buildTrack(voice:VoiceProfile,speaker:'A'|'B'):readonly ArticulatorGesture[]{
  const out:ArticulatorGesture[]=[];
  let cursor=0;
  const line=(at:number,phones:readonly PhoneSpec[],opts:UtteranceOptions={})=>{
    appendSilence(out,cursor,at);cursor=appendPhones(out,at,phones,voice,opts);
  };
  if(speaker==='A'){
    line(.30,A1);
    line(6.55,A2,{pressureScale:1.04});
    line(13.25,A3,{pitchScale:1.18,pressureScale:1.16,surprise:1});
    appendSilence(out,cursor,16.05);cursor=appendLaugh(out,16.05,voice,6,'open');
  }else{
    line(4.65,B1,{pitchScale:1.10,pressureScale:1.10,surprise:.8});
    appendSilence(out,cursor,9.35);cursor=appendLaugh(out,9.35,voice,3,'chuckle');
    line(cursor+.10,B2,{pressureScale:1.02});
    line(14.85,B3,{pitchScale:.96});
    appendSilence(out,cursor,16.18);cursor=appendLaugh(out,16.18,voice,7,'chuckle');
  }
  appendSilence(out,cursor,18.05);
  return Object.freeze(out);
}

export function physicalDialogueScoreA():readonly ArticulatorGesture[]{return buildTrack(DIALOGUE_VOICE_A,'A');}
export function physicalDialogueScoreB():readonly ArticulatorGesture[]{return buildTrack(DIALOGUE_VOICE_B,'B');}

export interface PhysicalDialogueRender{
  readonly audio:AudioChannels;
  readonly durationS:number;
  readonly speakerA:VocalTractDiagnostics;
  readonly speakerB:VocalTractDiagnostics;
}

function panMono(source:AudioChannels,pan:number,count:number):{left:Float64Array;right:Float64Array}{
  const left=new Float64Array(count),right=new Float64Array(count),theta=(Math.max(-1,Math.min(1,pan))+1)*Math.PI/4;
  const gl=Math.cos(theta),gr=Math.sin(theta);
  for(let i=0;i<Math.min(count,source.left.length);i++){
    const mono=(source.left[i]!+source.right[i]!)*.5;left[i]=mono*gl;right[i]=mono*gr;
  }
  return{left,right};
}

export function synthesizePhysicalDialogue(sampleRate=48_000):PhysicalDialogueRender{
  const scoreA=physicalDialogueScoreA(),scoreB=physicalDialogueScoreB(),durationS=Math.max(scoreA.at(-1)!.endS,scoreB.at(-1)!.endS),count=Math.ceil(durationS*sampleRate);
  const a=renderArticulatedVocalTract(scoreA,{sampleRate,tractLengthM:DIALOGUE_VOICE_A.tractLengthM,seed:1103},'dialogue:A');
  const b=renderArticulatedVocalTract(scoreB,{sampleRate,tractLengthM:DIALOGUE_VOICE_B.tractLengthM,seed:2207},'dialogue:B');
  const pa=panMono(a.audio,DIALOGUE_VOICE_A.pan,count),pb=panMono(b.audio,DIALOGUE_VOICE_B.pan,count),left=new Float32Array(count),right=new Float32Array(count);
  let peak=0;
  for(let i=0;i<count;i++){
    const l=pa.left[i]!+pb.left[i]!,r=pa.right[i]!+pb.right[i]!;
    left[i]=l;right[i]=r;peak=Math.max(peak,Math.abs(l),Math.abs(r));
  }
  const gain=peak>.92?.92/peak:1;
  for(let i=0;i<count;i++){left[i]=Math.tanh(left[i]!*gain*1.08);right[i]=Math.tanh(right[i]!*gain*1.08);}
  return Object.freeze({audio:{left,right,sampleRate},durationS,speakerA:a.diagnostics,speakerB:b.diagnostics});
}
