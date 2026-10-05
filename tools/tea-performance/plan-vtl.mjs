import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {planVtlDialogue} from '../../dist/audio/vtl-external.js';
import {createTeaPerformancePlan,TEA_PERFORMANCE_DURATION} from './plan.mjs';

const out=resolve(process.env.TEA_OUTPUT??'artifacts/tea-performance-vtl');
await mkdir(out,{recursive:true});

const native=createTeaPerformancePlan();
// Audio and animation consume the same phones, absolute turn starts, F0 and
// pressure targets. VTL only replaces the acoustic backend/anatomy.
const speakers=native.speakers.map(speaker=>({
  id:speaker.id,
  name:speaker.name,
  anatomy:speaker.id==='anna'?{ageMonths:300,isMale:false}:null,
  pan:speaker.pan,
}));
const plan=planVtlDialogue(speakers,native.turns);
const end=Math.max(...plan.turns.map(turn=>turn.startS+turn.segments.reduce((sum,s)=>sum+s.durationS,0)));
if(end>TEA_PERFORMANCE_DURATION)throw new Error('Speech plan exceeds performance duration');
await writeFile(out+'/plan.json',JSON.stringify(plan,null,2)+'\n');
await writeFile(out+'/expected.txt',plan.turns.map(t=>t.text).join(' ')+'\n');
console.log(JSON.stringify({backend:'vocaltractlab-external',sampleRate:plan.sampleRate,turns:plan.turns.length,durationS:TEA_PERFORMANCE_DURATION,lastSpeechEndS:end,output:out}));
