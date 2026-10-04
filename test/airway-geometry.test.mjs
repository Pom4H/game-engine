import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VOCAL_ARTICULATOR_PRESETS,
  buildSoftAirwayTimeline,
  synthesizeRussianMouthPhrase,
} from '../dist/index.js';

const P=VOCAL_ARTICULATOR_PRESETS;
const freeze=v=>Object.freeze(v);
const state=(base,patch)=>freeze({...base,...patch});
const U=state(P.a,{jawOpen:.25,tonguePosition:.20,tongueHeight:.76,lipRound:.88});
const T=state(P.i,{jawOpen:.20,tonguePosition:.83,tongueHeight:.74,tongueTip:1,lipClosure:0});
const K=state(P.a,{jawOpen:.20,tonguePosition:.18,tongueHeight:1,tongueTip:0,lipClosure:0});

const score=Object.freeze([
  {startS:0,endS:.28,from:P.a,voiced:1,gain:.85,pitchHz:120},
  {startS:.28,endS:.56,from:P.i,voiced:1,gain:.85,pitchHz:120},
  {startS:.56,endS:.84,from:U,voiced:1,gain:.85,pitchHz:120},
  {startS:.84,endS:1.12,from:P.m,voiced:.9,gain:.8,pitchHz:118},
  {startS:1.12,endS:1.40,from:T,voiced:.02,gain:.8,pitchHz:118},
  {startS:1.40,endS:1.68,from:K,voiced:.02,gain:.8,pitchHz:118},
]);

const frameAt=(timeline,time)=>timeline.frames.reduce((best,frame)=>Math.abs(frame.timeS-time)<Math.abs(best.timeS-time)?frame:best,timeline.frames[0]);
const distance=(a,b)=>Math.sqrt(a.reduce((sum,v,i)=>sum+(v-b[i])**2,0)/a.length);
const constriction=(frame)=>{
  const stop=frame.oralAreaCm2.length-3;
  let index=0,area=Infinity;
  for(let i=2;i<stop;i++)if(frame.oralAreaCm2[i]<area){area=frame.oralAreaCm2[i];index=i;}
  return{index,area};
};

test('soft-tissue airway creates distinct Russian vowel geometries',()=>{
  const timeline=buildSoftAirwayTimeline(score,{sampleRate:24000,sections:18,controlRateHz:120,warmupS:.04});
  const a=frameAt(timeline,.16),i=frameAt(timeline,.44),u=frameAt(timeline,.72);
  assert.ok(distance(a.oralAreaCm2,i.oralAreaCm2)>.35,'/a/ and /i/ airway profiles collapsed');
  assert.ok(distance(i.oralAreaCm2,u.oralAreaCm2)>.28,'/i/ and /u/ airway profiles collapsed');
  assert.ok((u.lipAreaCm2??99)<(a.lipAreaCm2??0)*.72,'rounded /u/ must physically narrow the lip aperture');
});

test('bilabial nasal closure comes from physical lips and nasal port',()=>{
  const timeline=buildSoftAirwayTimeline(score,{sampleRate:24000,sections:18,controlRateHz:120,warmupS:.04});
  const m=frameAt(timeline,.99),a=frameAt(timeline,.16);
  assert.ok((m.lipAreaCm2??99)<.8,'/m/ lips are not physically closed enough: '+m.lipAreaCm2);
  assert.ok((m.lipAreaCm2??99)<(a.lipAreaCm2??0)*.25);
  assert.ok(m.velumOpen>.85,'/m/ must route acoustic energy into the nasal branch');
});

test('alveolar and dorsal stops constrict different parts of the physical airway',()=>{
  const timeline=buildSoftAirwayTimeline(score,{sampleRate:24000,sections:18,controlRateHz:120,warmupS:.04});
  const t=constriction(frameAt(timeline,1.27)),k=constriction(frameAt(timeline,1.55));
  assert.ok(t.index>k.index+1,'/t/ constriction must be anterior to /k/: '+JSON.stringify({t,k}));
  assert.ok(t.area<1.8&&k.area<1.8,'stops must form strong constrictions: '+JSON.stringify({t,k}));
});

test('Russian physical phrase now renders through geometry-driven acoustics',()=>{
  const result=synthesizeRussianMouthPhrase({sampleRate:16000,controlRateHz:120});
  assert.equal(result.diagnostics.geometryDriven,true);
  assert.ok(result.audio.left.some(v=>Math.abs(v)>.02));
});


test('open a has a substantially larger oral cavity than high vowels',()=>{
  const timeline=buildSoftAirwayTimeline(score,{sampleRate:24000,sections:18,controlRateHz:120,warmupS:.04});
  const a=frameAt(timeline,.16),i=frameAt(timeline,.44),u=frameAt(timeline,.72);
  const mean=x=>x.reduce((s,v)=>s+v,0)/x.length;
  const aMid=mean(a.oralAreaCm2.slice(5,15)),iMid=mean(i.oralAreaCm2.slice(5,15)),uMid=mean(u.oralAreaCm2.slice(5,15));
  assert.ok(aMid>iMid*1.35,'/a/ cavity not sufficiently more open than /i/: '+JSON.stringify({aMid,iMid}));
  assert.ok(aMid>uMid*1.25,'/a/ cavity not sufficiently more open than /u/: '+JSON.stringify({aMid,uMid}));
  assert.ok((u.lipAreaCm2??99)<1.8,'/u/ lip aperture remains too open: '+u.lipAreaCm2);
});
