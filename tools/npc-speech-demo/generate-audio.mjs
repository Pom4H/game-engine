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

const compact=(items,startAt)=>{
  const firstStart=items[0].startS;
  return items.map(g=>Object.freeze({...g,startS:startAt+(g.startS-firstStart),endS:startAt+(g.endS-firstStart)}));
};
const wordI=compact(base.slice(1,3),.10);
let cursor=wordI.at(-1).endS;
const pause=(from,to)=>Object.freeze({startS:from,endS:to,from:base.at(-1).from,voiced:0,lungPressurePa:0,gain:0,pitchHz:118});
const gap1=pause(cursor,cursor+.30);cursor=gap1.endS;
const wordAm=compact(base.slice(3,5),cursor);cursor=wordAm.at(-1).endS;
const gap2=pause(cursor,cursor+.30);cursor=gap2.endS;
const wordAlive=compact(base.slice(5,10),cursor);cursor=wordAlive.at(-1).endS;
const tail=pause(cursor,cursor+.24);
const segmentedScore=Object.freeze([...wordI,gap1,...wordAm,gap2,...wordAlive,tail]);
const segmented=renderArticulatedVocalTract(segmentedScore,{sampleRate:48_000,seed:0xA11CE},'I am alive');
await writeFile(out+'/npc-segmented-i-am-alive.wav',wavBytes(segmented.audio));

const wordClip=(slice,name)=>{
  const pre=.42,post=.48,part=compact(base.slice(slice[0],slice[1]),pre);
  const silenceState=base.at(-1).from;
  const preRoll=Object.freeze({startS:0,endS:pre,from:silenceState,voiced:0,lungPressurePa:0,gain:0,pitchHz:118});
  const end=part.at(-1).endS;
  const postRoll=Object.freeze({startS:end,endS:end+post,from:silenceState,voiced:0,lungPressurePa:0,gain:0,pitchHz:118});
  return renderArticulatedVocalTract(Object.freeze([preRoll,...part,postRoll]),{sampleRate:48_000,seed:0xA11CE},name);
};
const clipI=wordClip([1,3],'I');
const clipAm=wordClip([3,5],'am');
const clipAlive=wordClip([5,10],'alive');
await writeFile(out+'/npc-word-i.wav',wavBytes(clipI.audio));
await writeFile(out+'/npc-word-am.wav',wavBytes(clipAm.audio));
await writeFile(out+'/npc-word-alive.wav',wavBytes(clipAlive.audio));

await writeFile(out+'/audio-evidence.json',JSON.stringify({
  text:NPC_DEMO_TEXT,
  softGeometry:soft.diagnostics,
  waveguideFallback:fallback.diagnostics,
  asrCalibrated:{expected:'yeah yeah',diagnostics:yeahYeah.diagnostics},
  segmentedIAmAlive:segmented.diagnostics,
},null,2));
console.log(JSON.stringify({
  text:NPC_DEMO_TEXT,
  calibrated:'yeah yeah',
  calibratedWav:out+'/npc-calibrated-yeah-yeah.wav',
  segmented:out+'/npc-segmented-i-am-alive.wav',
  wordClips:{i:out+'/npc-word-i.wav',am:out+'/npc-word-am.wav',alive:out+'/npc-word-alive.wav'},
  duration:segmented.diagnostics.durationS,
},null,2));
