import {
  VOCAL_ARTICULATOR_PRESETS,
  type ArticulatorGesture,
  type VocalArticulators,
  type VocalTractRender,
} from './vocal-tract.js';
import {renderSoftGeometrySpeech,type SoftAirwayTimelineOptions} from './airway-geometry.js';

const P=VOCAL_ARTICULATOR_PRESETS;
const freeze=(v:VocalArticulators)=>Object.freeze(v);
const state=(base:VocalArticulators,patch:Partial<VocalArticulators>):VocalArticulators=>freeze({...base,...patch});
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));

export type RussianNpcPhone=
  |'a'|'o'|'u'|'i'|'y'|'e'|'j'
  |'m'|'n'|'p'|'b'|'f'|'v'
  |'t'|'d'|'k'|'g'|'s'|'z'
  |'sh'|'zh'|'ch'|'h'|'l'|'r'
  |'silence';

export interface RussianNpcPhoneToken{
  readonly phone:RussianNpcPhone;
  readonly soft?:boolean;
  readonly stressed?:boolean;
  readonly pauseS?:number;
}

export interface NpcRussianVoice{
  readonly basePitchHz:number;
  readonly pressurePa:number;
  readonly tractLengthM:number;
  readonly rate:number;
}

export const DEFAULT_NPC_RUSSIAN_VOICE:NpcRussianVoice=Object.freeze({
  basePitchHz:126,
  pressurePa:900,
  tractLengthM:.1715,
  rate:.90,
});

const A=state(P.a,{jawOpen:.76,tonguePosition:.25,tongueHeight:.22,lipRound:.01});
const O=state(P.a,{jawOpen:.53,tonguePosition:.27,tongueHeight:.40,lipRound:.55});
const U=state(P.a,{jawOpen:.28,tonguePosition:.20,tongueHeight:.74,lipRound:.88});
const I=state(P.i,{jawOpen:.29,tonguePosition:.82,tongueHeight:.90,lipRound:0});
const Y=state(P.i,{jawOpen:.34,tonguePosition:.48,tongueHeight:.80,tongueTip:.04});
const E=state(P.i,{jawOpen:.45,tonguePosition:.68,tongueHeight:.64,tongueTip:.06});
const J=state(P.i,{jawOpen:.27,tonguePosition:.89,tongueHeight:.94,tongueTip:.12});

const PHONE:Readonly<Record<Exclude<RussianNpcPhone,'silence'>,VocalArticulators>>=Object.freeze({
  a:A,o:O,u:U,i:I,y:Y,e:E,j:J,
  m:P.m,
  n:state(I,{jawOpen:.22,tonguePosition:.82,tongueHeight:.70,tongueTip:1,velumOpen:.94,lipClosure:0}),
  p:state(P.m,{jawOpen:.16,velumOpen:0,lipClosure:.995}),
  b:state(P.m,{jawOpen:.17,velumOpen:0,lipClosure:.99}),
  f:state(P.v,{jawOpen:.24,labiodental:.94,lipClosure:.10}),
  v:state(P.v,{jawOpen:.24,labiodental:.86,lipClosure:.10}),
  t:state(I,{jawOpen:.21,tonguePosition:.83,tongueHeight:.73,tongueTip:1,lipClosure:0}),
  d:state(I,{jawOpen:.22,tonguePosition:.82,tongueHeight:.72,tongueTip:1,lipClosure:0}),
  k:state(A,{jawOpen:.22,tonguePosition:.18,tongueHeight:1,tongueTip:0,lipClosure:0}),
  g:state(A,{jawOpen:.23,tonguePosition:.19,tongueHeight:.98,tongueTip:0,lipClosure:0}),
  s:state(I,{jawOpen:.25,tonguePosition:.84,tongueHeight:.81,tongueTip:.90,lipClosure:0}),
  z:state(I,{jawOpen:.25,tonguePosition:.83,tongueHeight:.80,tongueTip:.86,lipClosure:0}),
  sh:state(I,{jawOpen:.28,tonguePosition:.62,tongueHeight:.75,tongueTip:.72,lipRound:.16,lipClosure:0}),
  zh:state(I,{jawOpen:.28,tonguePosition:.63,tongueHeight:.74,tongueTip:.70,lipRound:.15,lipClosure:0}),
  ch:state(I,{jawOpen:.24,tonguePosition:.76,tongueHeight:.86,tongueTip:.98,lipRound:.10,lipClosure:0}),
  h:state(A,{jawOpen:.38,tonguePosition:.28,tongueHeight:.76,tongueTip:0,lipClosure:0}),
  l:state(P.l,{jawOpen:.35,tonguePosition:.76,tongueHeight:.62,tongueTip:.80}),
  r:state(P.schwa,{jawOpen:.34,tonguePosition:.77,tongueHeight:.57,tongueTip:.96}),
});

const VOWELS=new Set<RussianNpcPhone>(['a','o','u','i','y','e']);
const VOICED=new Set<RussianNpcPhone>(['a','o','u','i','y','e','j','m','n','b','v','d','g','z','zh','l','r']);
const STOPS=new Set<RussianNpcPhone>(['p','b','t','d','k','g','ch']);

function soften(a:VocalArticulators):VocalArticulators{
  return state(a,{
    tonguePosition:Math.max(a.tonguePosition,.73),
    tongueHeight:Math.max(a.tongueHeight,.77),
  });
}

function punctuationPause(ch:string):number|undefined{
  if(ch==='.'||ch==='!'||ch==='?')return .22;
  if(ch===','||ch===';'||ch===':')return .11;
  if(ch==='—'||ch==='-')return .08;
  return undefined;
}

function isBoundary(text:string,index:number):boolean{
  if(index<=0)return true;
  const p=text[index-1]!;
  return /[\s.,!?;:—\-"'«»()]/u.test(p);
}

function nextLetter(text:string,index:number):string{
  for(let i=index+1;i<text.length;i++){
    const c=text[i]!;
    if(/[а-яё]/u.test(c))return c;
    if(!/[\u0301]/u.test(c))break;
  }
  return '';
}

const SOFT_VOWELS=new Set(['е','ё','и','ю','я']);

export function russianTextToNpcPhones(input:string):readonly RussianNpcPhoneToken[]{
  const text=input.toLowerCase().normalize('NFD');
  const out:RussianNpcPhoneToken[]=[];
  let stressNextVowel=false;

  const push=(phone:RussianNpcPhone,soft=false,stressed=false)=>out.push(Object.freeze({phone,...(soft?{soft:true}:{}),...(stressed?{stressed:true}:{})}));
  const markPreviousSoft=()=>{
    for(let i=out.length-1;i>=0;i--){
      const token=out[i]!;
      if(token.phone==='silence')continue;
      if(VOWELS.has(token.phone)||token.phone==='j')return;
      out[i]=Object.freeze({...token,soft:true});
      return;
    }
  };

  for(let i=0;i<text.length;i++){
    const ch=text[i]!;
    if(ch==='\u0301'){
      for(let j=out.length-1;j>=0;j--)if(VOWELS.has(out[j]!.phone)){out[j]=Object.freeze({...out[j]!,stressed:true});break;}
      continue;
    }
    const pause=punctuationPause(ch);
    if(pause!==undefined){out.push(Object.freeze({phone:'silence',pauseS:pause}));continue;}
    if(/\s/u.test(ch)){out.push(Object.freeze({phone:'silence',pauseS:.035}));continue;}
    if(ch==='ь'){markPreviousSoft();continue;}
    if(ch==='ъ')continue;

    const initial=isBoundary(text,i);
    switch(ch){
      case 'а':push('a',false,stressNextVowel);stressNextVowel=false;break;
      case 'о':push('o',false,stressNextVowel);stressNextVowel=false;break;
      case 'у':push('u',false,stressNextVowel);stressNextVowel=false;break;
      case 'ы':push('y',false,stressNextVowel);stressNextVowel=false;break;
      case 'э':push('e',false,stressNextVowel);stressNextVowel=false;break;
      case 'и':markPreviousSoft();push('i',false,stressNextVowel);stressNextVowel=false;break;
      case 'я':if(initial)push('j');else markPreviousSoft();push('a',false,stressNextVowel);stressNextVowel=false;break;
      case 'е':if(initial)push('j');else markPreviousSoft();push('e',false,stressNextVowel);stressNextVowel=false;break;
      case 'ё':if(initial)push('j');else markPreviousSoft();push('o',false,true);stressNextVowel=false;break;
      case 'ю':if(initial)push('j');else markPreviousSoft();push('u',false,stressNextVowel);stressNextVowel=false;break;
      case 'м':push('m',SOFT_VOWELS.has(nextLetter(text,i)));break;
      case 'н':push('n',SOFT_VOWELS.has(nextLetter(text,i)));break;
      case 'п':push('p',SOFT_VOWELS.has(nextLetter(text,i)));break;
      case 'б':push('b',SOFT_VOWELS.has(nextLetter(text,i)));break;
      case 'ф':push('f',SOFT_VOWELS.has(nextLetter(text,i)));break;
      case 'в':push('v',SOFT_VOWELS.has(nextLetter(text,i)));break;
      case 'т':push('t',SOFT_VOWELS.has(nextLetter(text,i)));break;
      case 'д':push('d',SOFT_VOWELS.has(nextLetter(text,i)));break;
      case 'к':push('k',SOFT_VOWELS.has(nextLetter(text,i)));break;
      case 'г':push('g',SOFT_VOWELS.has(nextLetter(text,i)));break;
      case 'с':push('s',SOFT_VOWELS.has(nextLetter(text,i)));break;
      case 'з':push('z',SOFT_VOWELS.has(nextLetter(text,i)));break;
      case 'ш':push('sh');break;
      case 'ж':push('zh');break;
      case 'ч':push('ch',true);break;
      case 'щ':push('sh',true);push('ch',true);break;
      case 'х':push('h',SOFT_VOWELS.has(nextLetter(text,i)));break;
      case 'л':push('l',SOFT_VOWELS.has(nextLetter(text,i)));break;
      case 'р':push('r',SOFT_VOWELS.has(nextLetter(text,i)));break;
      case 'ц':push('t');push('s');break;
      case 'й':push('j');break;
      default:break;
    }
  }

  // Collapse repeated tiny silences.
  const collapsed:RussianNpcPhoneToken[]=[];
  for(const token of out){
    const last=collapsed.at(-1);
    if(token.phone==='silence'&&last?.phone==='silence'){
      collapsed[collapsed.length-1]=Object.freeze({phone:'silence',pauseS:Math.max(last.pauseS??0,token.pauseS??0)});
    }else collapsed.push(token);
  }
  return Object.freeze(collapsed);
}

function durationFor(token:RussianNpcPhoneToken,rate:number):number{
  if(token.phone==='silence')return token.pauseS??.04;
  if(VOWELS.has(token.phone))return (token.stressed ? .165 : .125)/rate;
  if(token.phone==='r')return .095/rate;
  if(token.phone==='sh'||token.phone==='zh'||token.phone==='s'||token.phone==='z'||token.phone==='f'||token.phone==='v'||token.phone==='h')return .095/rate;
  if(STOPS.has(token.phone))return .075/rate;
  return .085/rate;
}

function phoneState(token:RussianNpcPhoneToken):VocalArticulators{
  if(token.phone==='silence')return P.silence;
  const base=PHONE[token.phone];
  return token.soft?soften(base):base;
}

function voicing(phone:RussianNpcPhone):number{
  if(phone==='silence')return 0;
  if(phone==='v'||phone==='z'||phone==='zh')return .86;
  if(phone==='b'||phone==='d'||phone==='g')return .80;
  return VOICED.has(phone)?.96:.02;
}

export function planNpcRussianSpeech(
  text:string,
  voice:NpcRussianVoice=DEFAULT_NPC_RUSSIAN_VOICE,
):readonly ArticulatorGesture[]{
  const tokens=russianTextToNpcPhones(text);
  if(!tokens.length)throw new RangeError('NPC speech text contains no pronounceable Russian phones');
  const gestures:ArticulatorGesture[]=[];
  let time=0;

  for(let i=0;i<tokens.length;i++){
    const token=tokens[i]!,duration=durationFor(token,clamp(voice.rate,.55,1.5));
    const from=phoneState(token),next=tokens[i+1],to=next&&!STOPS.has(token.phone)&&next.phone!=='silence'?phoneState(next):undefined;

    if(token.phone==='r'){
      const open=state(from,{tongueTip:.18,tongueHeight:Math.max(.48,from.tongueHeight-.1)});
      for(const [shape,fraction] of [[from,.34],[open,.28],[from,.38]] as const){
        const end=time+duration*fraction;
        gestures.push(Object.freeze({startS:time,endS:end,from:shape,voiced:.95,pitchHz:voice.basePitchHz,lungPressurePa:voice.pressurePa,gain:1}));
        time=end;
      }
      continue;
    }

    const end=time+duration;
    const pressure=token.phone==='silence'?0:voice.pressurePa*(VOWELS.has(token.phone)?1:.94);
    const common={
      voiced:voicing(token.phone),
      pitchHz:voice.basePitchHz*(token.stressed?1.035:1),
      lungPressurePa:pressure,
      gain:token.phone==='silence'?0:1,
    };

    // A phone needs a stable acoustic nucleus. Coarticulation belongs only to
    // the final tens of milliseconds; interpolating over the entire phone
    // destroys vowel/formant identity and makes connected speech unintelligible.
    const transitionS=to?Math.min(.035,duration*.28):0;
    const holdEnd=end-transitionS;
    if(transitionS>1e-5){
      gestures.push(Object.freeze({startS:time,endS:holdEnd,from,...common}));
      gestures.push(Object.freeze({startS:holdEnd,endS:end,from,to:to!,...common}));
    }else gestures.push(Object.freeze({startS:time,endS:end,from,...common}));
    time=end;
  }
  const releaseEnd=time+.12;
  gestures.push(Object.freeze({startS:time,endS:releaseEnd,from:P.silence,voiced:0,lungPressurePa:0,gain:0,pitchHz:voice.basePitchHz}));
  return Object.freeze(gestures);
}

export interface NpcRussianSpeechOptions extends SoftAirwayTimelineOptions{
  readonly voice?:NpcRussianVoice;
}

export function synthesizeNpcRussianSpeech(
  text:string,
  options:NpcRussianSpeechOptions={},
):VocalTractRender{
  const voice=options.voice??DEFAULT_NPC_RUSSIAN_VOICE;
  const score=planNpcRussianSpeech(text,voice);
  const {voice:_voice,...renderOptions}=options;
  return renderSoftGeometrySpeech(score,{...renderOptions,tractLengthM:voice.tractLengthM},text);
}
