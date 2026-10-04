#!/usr/bin/env node
import {mkdir,writeFile} from 'node:fs/promises';
import {
  iAmAliveArticulatorScore,
  renderArticulatedVocalTract,
  synthesizeNpcEnglishSpeech,
  wavBytes,
} from '../../dist/index.js';

export const NPC_DEMO_TEXT='I am alive';
const out='artifacts/npc-speech';await mkdir(out,{recursive:true});

const soft=synthesizeNpcEnglishSpeech(NPC_DEMO_TEXT,{sampleRate:48_000,controlRateHz:240});
await writeFile(out+'/npc-english-soft.wav',wavBytes(soft.audio));

const fallback=renderArticulatedVocalTract(
  iAmAliveArticulatorScore(),
  {sampleRate:48_000,seed:0xA11CE},
  NPC_DEMO_TEXT,
);
await writeFile(out+'/npc-english-waveguide.wav',wavBytes(fallback.audio));

await writeFile(out+'/audio-evidence.json',JSON.stringify({
  text:NPC_DEMO_TEXT,
  softGeometry:soft.diagnostics,
  waveguideFallback:fallback.diagnostics,
},null,2));
console.log(JSON.stringify({
  text:NPC_DEMO_TEXT,
  soft:out+'/npc-english-soft.wav',
  fallback:out+'/npc-english-waveguide.wav',
  softGeometryDriven:soft.diagnostics.geometryDriven,
  fallbackGeometryDriven:fallback.diagnostics.geometryDriven??false,
},null,2));
