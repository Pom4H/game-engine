#!/usr/bin/env node
import {writeFile,mkdir} from 'node:fs/promises';
import {
  VOCAL_ARTICULATOR_PRESETS,
  buildSoftAirwayTimeline,
} from '../../dist/index.js';

const P=VOCAL_ARTICULATOR_PRESETS;
const state=(base,patch)=>Object.freeze({...base,...patch});
const vowels={
  a:state(P.a,{jawOpen:.76,tonguePosition:.25,tongueHeight:.22,lipRound:.01}),
  i:state(P.i,{jawOpen:.29,tonguePosition:.82,tongueHeight:.90,lipRound:0}),
  u:state(P.a,{jawOpen:.28,tonguePosition:.20,tongueHeight:.74,lipRound:.88}),
  e:state(P.i,{jawOpen:.45,tonguePosition:.68,tongueHeight:.64,tongueTip:.06}),
  y:state(P.i,{jawOpen:.34,tonguePosition:.48,tongueHeight:.80,tongueTip:.04}),
  schwa:P.schwa,
};

const out={};
for(const [name,shape] of Object.entries(vowels)){
  const score=Object.freeze([{startS:0,endS:.45,from:shape,voiced:1,gain:.9,pitchHz:112,lungPressurePa:950}]);
  const timeline=buildSoftAirwayTimeline(score,{sampleRate:48000,sections:24,controlRateHz:240,warmupS:.12});
  const frame=timeline.frames.reduce((best,f)=>Math.abs(f.timeS-.32)<Math.abs(best.timeS-.32)?f:best,timeline.frames[0]);
  const areas=[...frame.oralAreaCm2];
  let min=Infinity,minIndex=-1,max=0;
  for(let i=0;i<areas.length;i++){if(areas[i]<min){min=areas[i];minIndex=i;}max=Math.max(max,areas[i]);}
  out[name]={lipAreaCm2:frame.lipAreaCm2,velumOpen:frame.velumOpen,minAreaCm2:min,minIndex,maxAreaCm2:max,areas};
}
await mkdir('artifacts/npc-speech',{recursive:true});
await writeFile('artifacts/npc-speech/airway-vowels.json',JSON.stringify(out,null,2));
console.log(JSON.stringify(out,null,2));
