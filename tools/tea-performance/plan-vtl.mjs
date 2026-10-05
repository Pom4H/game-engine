import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createTeaPerformancePlan,TEA_PERFORMANCE_DURATION} from './plan.mjs';

const out=resolve(process.env.TEA_OUTPUT??'artifacts/tea-performance-vtl');
await mkdir(out,{recursive:true});
const plan=createTeaPerformancePlan();
const end=Math.max(...plan.turns.map(turn=>turn.startS+turn.segments.reduce((sum,s)=>sum+s.durationS,0)));
if(end>TEA_PERFORMANCE_DURATION)throw new Error('Speech plan exceeds performance duration');
await writeFile(out+'/plan.json',JSON.stringify(plan,null,2)+'\n');
await writeFile(out+'/expected.txt',plan.turns.map(t=>t.text).join(' ')+'\n');
console.log(JSON.stringify({turns:plan.turns.length,durationS:TEA_PERFORMANCE_DURATION,lastSpeechEndS:end,output:out}));
