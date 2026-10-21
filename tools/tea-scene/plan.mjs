#!/usr/bin/env node
import {mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {planVtlDialogue,VTL_EXTERNAL_BACKEND} from '../../dist/audio/vtl-external.js';
import {createVtlDialoguePlan} from '../npc-speech-demo/vtl-dialogue-plan.mjs';

// Reuse the accepted utterances unchanged. Scene time allows the actors to
// establish eye contact, then pour and hand over the tea before the last reply.
export function createTeaSceneDialoguePlan(){
  const source=createVtlDialoguePlan();
  // The master camera looks along +Z: Mike at negative X appears on screen
  // right, so reverse the audio-only demo's panorama to match the actors.
  const speakers=source.speakers.map(speaker=>({...speaker,pan:-speaker.pan}));
  const turns=source.turns.map((turn,index)=>({
    ...turn,
    startS:turn.startS+1+(index>=source.turns.length-2?1.8:0),
  }));
  return planVtlDialogue(speakers,turns);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const plan=createTeaSceneDialoguePlan();
  const out=process.argv[2]??'artifacts/tea-scene';
  await mkdir(out,{recursive:true});
  await writeFile(out+'/plan.json',JSON.stringify(plan,null,2)+'\n');
  await writeFile(out+'/backend.json',JSON.stringify(VTL_EXTERNAL_BACKEND,null,2)+'\n');
  const durationS=Math.max(...plan.turns.map(t=>t.startS+t.segments.reduce((sum,s)=>sum+s.durationS,0)));
  console.log(JSON.stringify({plan:out+'/plan.json',durationS,turns:plan.turns.map(t=>({speaker:t.speakerId,text:t.text,startS:t.startS}))},null,2));
}
