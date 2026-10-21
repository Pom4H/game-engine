#!/usr/bin/env node
import {mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {planVtlDialogue,VTL_EXTERNAL_BACKEND} from '../../dist/audio/vtl-external.js';

// Hand-authored pronunciation and speech intent. All audio is produced later
// from the articulatory gestures, glottis, airflow and vocal tract model.
const speakers=[
  {id:'mike',name:'Mike',anatomy:null,pan:-.24},
  {id:'anna',name:'Anna',anatomy:{ageMonths:300,isMale:false},pan:.24},
];
const phone=(symbol,durationS)=>({phone:symbol,durationS});
const phones=spec=>spec.map(([symbol,durationS])=>phone(symbol,durationS));
const lines=[
  {speakerId:"mike",text:"Do you want some tea?",gap:0.2,
    score:[["d",0.06],["u",0.09],["j",0.045],["u",0.095],["u",0.06],["O",0.15],["n",0.065],["t",0.05],["s",0.09],["a",0.095],["m",0.06],["t",0.1],["i:",0.27]],
    hz:[[0.0,120],[0.27,141],[0.57,123],[1.0,153]],pa:[[0,800],[0.3,840],[0.65,780],[1,700]]},
  {speakerId:"anna",text:"Yes, please.",gap:0.24,
    score:[["j",0.055],["E",0.14],["s",0.085],["p",0.07],["l",0.06],["i:",0.23],["z",0.065]],
    hz:[[0,186],[0.27,219],[0.57,191],[1,171]],pa:[[0,800],[0.3,840],[0.65,780],[1,700]]},
  {speakerId:"mike",text:"Okay, just a minute.",gap:0.2,
    score:[["o",0.1],["U",0.07],["k",0.075],["e",0.14],["I",0.075],["",0.1],["dZ",0.08],["a",0.11],["s",0.07],["t",0.05],["@",0.075],["m",0.08],["I",0.1],["n",0.065],["I",0.095],["t",0.07]],
    hz:[[0.0,120],[0.27,141],[0.57,123],[1.0,110]],pa:[[0,800],[0.3,840],[0.65,780],[1,700]]},
  {speakerId:"anna",text:"Okay.",gap:1.15,
    score:[["o",0.1],["U",0.07],["k",0.075],["e",0.14],["I",0.075]],
    hz:[[0,186],[0.27,219],[0.57,191],[1,171]],pa:[[0,800],[0.3,840],[0.65,780],[1,700]]},
  {speakerId:"mike",text:"Here you go.",gap:0.18,
    score:[["h",0.065],["i:6",0.24],["j",0.055],["u:",0.15],["g",0.12],["o",0.15],["U",0.08]],
    hz:[[0.0,120],[0.27,141],[0.57,123],[1.0,110]],pa:[[0,800],[0.3,840],[0.65,780],[1,700]]},
  {speakerId:"anna",text:"Thank you.",gap:0,
    score:[["T",0.075],["E",0.14],["N",0.07],["k",0.06],["j",0.055],["u:",0.25]],
    hz:[[0,186],[0.27,219],[0.57,191],[1,171]],pa:[[0,800],[0.3,840],[0.65,780],[1,700]]}
];

export function createVtlDialoguePlan(){
let startS=.20;
const turns=lines.map((line,index)=>{
  const lead=.12,tail=.20,duration=line.score.reduce((sum,p)=>sum+p[1],0);
  const pitch=[{timeS:0,hz:line.hz[0][1]},...line.hz.map(([time,hz])=>({timeS:lead+time*duration,hz}))];
  const pressure=[{timeS:0,pa:line.pa[0][1]},...line.pa.map(([time,pa])=>({timeS:lead+time*duration,pa}))];
  const turn={id:`turn-${String(index+1).padStart(2,'0')}`,speakerId:line.speakerId,text:line.text,startS,
    segments:[phone('',lead),...phones(line.score),phone('',tail)],pitch,pressure};
  startS+=lead+duration+tail+line.gap;
  return turn;
});
return planVtlDialogue(speakers,turns);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
const plan=createVtlDialoguePlan();
const out=process.argv[2]??'artifacts/vtl-dialogue';
await mkdir(out,{recursive:true});
await writeFile(out+'/plan.json',JSON.stringify(plan,null,2)+'\n');
await writeFile(out+'/backend.json',JSON.stringify(VTL_EXTERNAL_BACKEND,null,2)+'\n');
const durationS=Math.max(...plan.turns.map(t=>t.startS+t.segments.reduce((sum,s)=>sum+s.durationS,0)));
console.log(JSON.stringify({plan:out+'/plan.json',durationS,turns:plan.turns.map(t=>({speaker:t.speakerId,text:t.text,startS:t.startS}))},null,2));
}
