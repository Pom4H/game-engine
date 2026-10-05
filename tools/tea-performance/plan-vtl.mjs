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
const splitForVtl=segment=>{
  const pair=segment.phone==='oU'?['o','U']:segment.phone==='eI'?['e','I']:null;
  if(!pair)return [segment];
  const a=segment.durationS/2,b=segment.durationS-a;
  return [{phone:pair[0],durationS:a},{phone:pair[1],durationS:b}];
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
await writeFile(out+'/expected.txt',plan.turns.map(t=>t.text).join(' ')+'\n');
console.log(JSON.stringify({backend:'vocaltractlab-external',sampleRate:plan.sampleRate,turns:plan.turns.length,durationS:TEA_PERFORMANCE_DURATION,lastSpeechEndS:vtlEnd,output:out}));
