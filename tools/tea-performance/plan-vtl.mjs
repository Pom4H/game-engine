import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {planVtlDialogue} from '../../dist/audio/vtl-external.js';
import {createTeaPerformancePlan,TEA_PERFORMANCE_DURATION} from './plan.mjs';

const out=resolve(process.env.TEA_OUTPUT??'artifacts/tea-performance-vtl');
await mkdir(out,{recursive:true});

const native=createTeaPerformancePlan();
// The native motor inventory is slightly broader than pinned VTL's SAMPA.
// This is a symbol-layer conversion only: total segment duration, text, turn
// starts and prosody remain unchanged.
const vtlSegments=segments=>segments.flatMap(segment=>{
  const {phone,durationS}=segment;
  if(phone==='oU')return [{phone:'o',durationS:durationS*.58},{phone:'U',durationS:durationS*.42}];
  if(phone==='eI')return [{phone:'e',durationS:durationS*.58},{phone:'I',durationS:durationS*.42}];
  const mapped=phone==='V'||phone==='A'?'a':phone==='ae'?'E':phone;
  return [{phone:mapped,durationS}];
});
const speakers=native.speakers.map(speaker=>({
  id:speaker.id,
  name:speaker.name,
  anatomy:speaker.id==='anna'?{ageMonths:300,isMale:false}:null,
  pan:speaker.pan,
}));
const turns=native.turns.map(turn=>({...turn,segments:vtlSegments(turn.segments)}));
const plan=planVtlDialogue(speakers,turns);
const end=Math.max(...plan.turns.map(turn=>turn.startS+turn.segments.reduce((sum,s)=>sum+s.durationS,0)));
if(end>TEA_PERFORMANCE_DURATION)throw new Error('Speech plan exceeds performance duration');
for(let i=0;i<plan.turns.length;i++){
  const before=native.turns[i].segments.reduce((sum,s)=>sum+s.durationS,0);
  const after=plan.turns[i].segments.reduce((sum,s)=>sum+s.durationS,0);
  if(Math.abs(before-after)>1e-9)throw new Error('VTL phonetic conversion changed turn duration');
}
await writeFile(out+'/plan.json',JSON.stringify(plan,null,2)+'\n');
await writeFile(out+'/expected.txt',plan.turns.map(t=>t.text).join(' ')+'\n');
console.log(JSON.stringify({backend:'vocaltractlab-external',sampleRate:plan.sampleRate,turns:plan.turns.length,durationS:TEA_PERFORMANCE_DURATION,lastSpeechEndS:end,output:out}));
