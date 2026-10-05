import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {planVtlDialogue} from '../../dist/audio/vtl-external.js';
import {createTeaPerformancePlan,TEA_PERFORMANCE_DURATION} from './plan.mjs';

const out=resolve(process.env.TEA_OUTPUT??'artifacts/tea-performance-vtl');
await mkdir(out,{recursive:true});

const native=createTeaPerformancePlan();
// Audio and animation consume one absolute turn timeline. VTL's SAMPA inventory
// represents these two English diphthongs as consecutive phone gestures rather
// than single symbols; split their authored duration evenly, preserving the
// utterance duration and all prosody control times.
const VTL_EQUIVALENT=Object.freeze({
  A:'O',      // HOT-like target: VTL /O/ avoids the hard/heart-like /a/ quality
  ae:'E',     // front-open English target approximated by VTL /E/
  V:'@',      // STRUT-like target: central vowel is closer than open /a/
  w:'u:',     // labial-velar glide represented as a short rounded /u:/ gesture
});
const splitForVtl=segment=>{
  const pair=null;
  const diphthong=segment.phone==='oU'?'o:':segment.phone==='eI'?'e:':null;
  if(diphthong)return [{...segment,phone:diphthong}];
  const equivalent=VTL_EQUIVALENT[segment.phone];
  return equivalent?[{...segment,phone:equivalent}]:[segment];
};
const speakers=native.speakers.map(speaker=>({
  id:speaker.id,
  name:speaker.name,
  anatomy:speaker.id==='anna'?{ageMonths:300,isMale:false}:null,
  pan:speaker.pan,
}));
const turns=native.turns.map(turn=>({
  ...turn,
  segments:turn.segments.flatMap(splitForVtl),
}));
const plan=planVtlDialogue(speakers,turns);
const nativeEnd=Math.max(...native.turns.map(turn=>turn.startS+turn.segments.reduce((sum,s)=>sum+s.durationS,0)));
const vtlEnd=Math.max(...plan.turns.map(turn=>turn.startS+turn.segments.reduce((sum,s)=>sum+s.durationS,0)));
if(Math.abs(nativeEnd-vtlEnd)>1e-9)throw new Error('VTL phoneme expansion changed performance timing');
if(vtlEnd>TEA_PERFORMANCE_DURATION)throw new Error('Speech plan exceeds performance duration');
await writeFile(out+'/plan.json',JSON.stringify(plan,null,2)+'\n');
await writeFile(out+'/motor-plan.json',JSON.stringify(native,null,2)+'\n');
await writeFile(out+'/expected.txt',plan.turns.map(t=>t.text).join(' ')+'\n');
console.log(JSON.stringify({backend:'vocaltractlab-external',sampleRate:plan.sampleRate,turns:plan.turns.length,durationS:TEA_PERFORMANCE_DURATION,lastSpeechEndS:vtlEnd,output:out}));
