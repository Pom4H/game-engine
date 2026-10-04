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

export type EnglishNpcPhone='a'|'o'|'i'|'ae'|'schwa'|'j'|'l'|'m'|'v'|'silence';
export interface EnglishNpcPhoneToken{
  readonly phone:EnglishNpcPhone;
  readonly durationS:number;
  readonly to?:EnglishNpcPhone;
}

export interface NpcEnglishVoice{
  readonly basePitchHz:number;
  readonly pressurePa:number;
  readonly tractLengthM:number;
  readonly rate:number;
}
export const DEFAULT_NPC_ENGLISH_VOICE:NpcEnglishVoice=Object.freeze({
  basePitchHz:118,
  pressurePa:930,
  tractLengthM:.173,
  rate:.86,
});

const A=state(P.a,{jawOpen:.78,tonguePosition:.22,tongueHeight:.20,lipRound:.01});
const O=state(P.a,{jawOpen:.50,tonguePosition:.28,tongueHeight:.40,lipRound:.52});
const I=state(P.i,{jawOpen:.28,tonguePosition:.84,tongueHeight:.91,lipRound:0});
const AE=state(P.ae,{jawOpen:.66,tonguePosition:.62,tongueHeight:.42,lipRound:0});
const J=state(P.i,{jawOpen:.30,tonguePosition:.88,tongueHeight:.94,tongueTip:.12,lipRound:0});
const SCHWA=state(P.schwa,{jawOpen:.39,tonguePosition:.50,tongueHeight:.40,lipRound:0});
const L=state(P.l,{jawOpen:.36,tonguePosition:.75,tongueHeight:.58,tongueTip:.84,lipRound:0});
const M=state(P.m,{jawOpen:.18,tonguePosition:.45,tongueHeight:.35,lipClosure:.995,velumOpen:1});
const V=state(P.v,{jawOpen:.22,tonguePosition:.48,tongueHeight:.34,labiodental:.90,lipClosure:.10});

const token=(phone:EnglishNpcPhone,durationS:number,to?:EnglishNpcPhone):EnglishNpcPhoneToken=>
  Object.freeze({phone,durationS,...(to?{to}:{})});

const PHONE:Readonly<Record<Exclude<EnglishNpcPhone,'silence'>,VocalArticulators>>=Object.freeze({
  a:A,o:O,i:I,ae:AE,schwa:SCHWA,j:J,l:L,m:M,v:V,
});

export const ENGLISH_NPC_LEXICON:Readonly<Record<string,readonly EnglishNpcPhoneToken[]>>=Object.freeze({
  'i':Object.freeze([
    token('a',.16,'i'),
    token('i',.15),
  ]),
  'am':Object.freeze([
    token('ae',.22),
    token('m',.16),
  ]),
  'yeah':Object.freeze([
    token('j',.10),
    token('ae',.22),
  ]),
  'mama':Object.freeze([
    token('m',.14),
    token('a',.22),
    token('m',.14),
    token('a',.24),
  ]),
  'me':Object.freeze([
    token('m',.15),
    token('i',.24),
  ]),
  'mom':Object.freeze([
    token('m',.15),
    token('o',.23),
    token('m',.16),
  ]),
  'alive':Object.freeze([
    token('schwa',.13),
    token('l',.12),
    token('a',.16,'i'),
    token('i',.15),
    token('v',.13),
  ]),
});

const VOICED=new Set<EnglishNpcPhone>(['a','o','i','ae','schwa','j','l','m','v']);

function phoneState(phone:EnglishNpcPhone):VocalArticulators{
  return phone==='silence'?P.silence:PHONE[phone];
}
function voiced(phone:EnglishNpcPhone):number{
  if(phone==='silence')return 0;
  if(phone==='v')return .90;
  return VOICED.has(phone)?.97:.02;
}

export function englishTextToNpcPhones(text:string):readonly EnglishNpcPhoneToken[]{
  const words=text.toLowerCase().replace(/[^a-z' ]+/g,' ').split(/\s+/).filter(Boolean);
  const out:EnglishNpcPhoneToken[]=[];
  for(let w=0;w<words.length;w++){
    const lexical=ENGLISH_NPC_LEXICON[words[w]!];
    if(!lexical)throw new RangeError('English NPC seed lexicon does not contain: '+words[w]);
    out.push(...lexical);
    if(w<words.length-1)out.push(Object.freeze({phone:'silence',durationS:.055}));
  }
  return Object.freeze(out);
}

export function planNpcEnglishSpeech(
  text:string,
  voice:NpcEnglishVoice=DEFAULT_NPC_ENGLISH_VOICE,
):readonly ArticulatorGesture[]{
  const tokens=englishTextToNpcPhones(text),out:ArticulatorGesture[]=[];
  let time=0;
  for(const token of tokens){
    const duration=token.durationS/voice.rate,end=time+duration;
    const from=phoneState(token.phone);
    const to=token.to?phoneState(token.to):undefined;
    out.push(Object.freeze({
      startS:time,endS:end,from,...(to?{to}:{}),
      voiced:voiced(token.phone),
      pitchHz:voice.basePitchHz,
      lungPressurePa:token.phone==='silence'?0:voice.pressurePa,
      gain:token.phone==='silence'?0:1,
    }));
    time=end;
  }
  out.push(Object.freeze({
    startS:time,endS:time+.18,from:P.silence,
    voiced:0,pitchHz:voice.basePitchHz,lungPressurePa:0,gain:0,
  }));
  return Object.freeze(out);
}

export interface NpcEnglishSpeechOptions extends SoftAirwayTimelineOptions{
  readonly voice?:NpcEnglishVoice;
}

export function synthesizeNpcEnglishSpeech(
  text:string,
  options:NpcEnglishSpeechOptions={},
):VocalTractRender{
  const voice=options.voice??DEFAULT_NPC_ENGLISH_VOICE;
  const score=planNpcEnglishSpeech(text,voice);
  const {voice:_voice,...renderOptions}=options;
  return renderSoftGeometrySpeech(score,{...renderOptions,tractLengthM:voice.tractLengthM},text);
}
