#!/usr/bin/env node
import {mkdir,writeFile} from 'node:fs/promises';
import {
  planNpcRussianSpeech,
  synthesizeNpcRussianSpeech,
  wavBytes,
} from '../../dist/index.js';

export const NPC_DEMO_TEXT='Привет. Я говорю своим голосом.';
const out='artifacts/npc-speech';await mkdir(out,{recursive:true});
const score=planNpcRussianSpeech(NPC_DEMO_TEXT);
const voice=synthesizeNpcRussianSpeech(NPC_DEMO_TEXT,{sampleRate:48_000,controlRateHz:240});
await writeFile(out+'/npc-russian.wav',wavBytes(voice.audio));
await writeFile(out+'/audio-evidence.json',JSON.stringify({
  text:NPC_DEMO_TEXT,
  score,
  diagnostics:voice.diagnostics,
},null,2));
console.log(JSON.stringify({
  text:NPC_DEMO_TEXT,
  wav:out+'/npc-russian.wav',
  duration:voice.diagnostics.durationS,
  geometryDriven:voice.diagnostics.geometryDriven,
  gestures:score.length,
},null,2));
