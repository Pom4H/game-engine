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

const base=[...iAmAliveArticulatorScore()];
const fallback=renderArticulatedVocalTract(base,{sampleRate:48_000,seed:0xA11CE},NPC_DEMO_TEXT);
await writeFile(out+'/npc-english-waveguide.wav',wavBytes(fallback.audio));

const shiftScore=(score,offset)=>score.map(g=>Object.freeze({...g,startS:g.startS+offset,endS:g.endS+offset}));
const gap=.32;
const oneDuration=base.at(-1).endS;
const first=shiftScore(base,0);
const gapGesture=Object.freeze({
  startS:oneDuration,endS:oneDuration+gap,
  from:base.at(-1).from,voiced:0,lungPressurePa:0,gain:0,pitchHz:118,
});
const second=shiftScore(base,oneDuration+gap);
const repeated=Object.freeze([...first,gapGesture,...second]);
const yeahYeah=renderArticulatedVocalTract(repeated,{sampleRate:48_000,seed:0xA11CE},'yeah yeah');
await writeFile(out+'/npc-calibrated-yeah-yeah.wav',wavBytes(yeahYeah.audio));

await writeFile(out+'/audio-evidence.json',JSON.stringify({
  text:NPC_DEMO_TEXT,
  softGeometry:soft.diagnostics,
  waveguideFallback:fallback.diagnostics,
  asrCalibrated:{expected:'yeah yeah',diagnostics:yeahYeah.diagnostics},
},null,2));
console.log(JSON.stringify({
  text:NPC_DEMO_TEXT,
  calibrated:'yeah yeah',
  calibratedWav:out+'/npc-calibrated-yeah-yeah.wav',
  duration:yeahYeah.diagnostics.durationS,
},null,2));
