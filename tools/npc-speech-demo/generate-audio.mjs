#!/usr/bin/env node
import {mkdir,writeFile} from 'node:fs/promises';
import {
  planNpcEnglishSpeech,
  synthesizeNpcEnglishSpeech,
  wavBytes,
} from '../../dist/index.js';

export const NPC_DEMO_TEXT='I am alive';
const out='artifacts/npc-speech';await mkdir(out,{recursive:true});
const score=planNpcEnglishSpeech(NPC_DEMO_TEXT);
const voice=synthesizeNpcEnglishSpeech(NPC_DEMO_TEXT,{sampleRate:48_000,controlRateHz:240});
await writeFile(out+'/npc-english.wav',wavBytes(voice.audio));
await writeFile(out+'/audio-evidence.json',JSON.stringify({
  text:NPC_DEMO_TEXT,
  score,
  diagnostics:voice.diagnostics,
},null,2));
console.log(JSON.stringify({
  text:NPC_DEMO_TEXT,
  wav:out+'/npc-english.wav',
  duration:voice.diagnostics.durationS,
  geometryDriven:voice.diagnostics.geometryDriven,
  gestures:score.length,
},null,2));
