#!/usr/bin/env node
import {mkdir,writeFile} from 'node:fs/promises';
import {
  VOCAL_ARTICULATOR_PRESETS,
  renderArticulatedVocalTract,
  wavBytes,
} from '../../dist/index.js';

const out='artifacts/npc-motor-search/mama';await mkdir(out,{recursive:true});
const P=VOCAL_ARTICULATOR_PRESETS;
const state=(base,patch)=>Object.freeze({...base,...patch});
const silence=Object.freeze({...P.silence,lipClosure:.06,velumOpen:0});

const jaws=[.55,.70,.84];
const tonguePositions=[.16,.30,.44];
const tongueHeights=[.16,.28,.40];
const pitches=[100,118];
const tracts=[.166,.176];
const candidates=[];

const add=(arr,startS,endS,from,voiced,pitchHz,pressure,gain=1)=>arr.push(Object.freeze({
  startS,endS,from,voiced,pitchHz,lungPressurePa:pressure,gain,
}));

let id=0;
for(const jawOpen of jaws)for(const tonguePosition of tonguePositions)for(const tongueHeight of tongueHeights)for(const pitchHz of pitches)for(const tractLengthM of tracts){
  const a=state(P.a,{jawOpen,tonguePosition,tongueHeight,lipRound:0,lipClosure:0,velumOpen:0});
  const m=state(P.m,{jawOpen:.16,tonguePosition:.44,tongueHeight:.34,lipClosure:.995,velumOpen:1,labiodental:0});
  const score=[];
  add(score,0,.34,silence,0,pitchHz,0,0);
  add(score,.34,.50,m,.95,pitchHz,900,1);
  add(score,.50,.78,a,.98,pitchHz,970,1);
  add(score,.78,.94,m,.95,pitchHz,900,1);
  add(score,.94,1.28,a,.98,pitchHz,970,1);
  add(score,1.28,1.66,silence,0,pitchHz,0,0);
  const render=renderArticulatedVocalTract(Object.freeze(score),{
    sampleRate:16_000,tractLengthM,seed:20261004,
  },'mama');
  const name=String(id).padStart(3,'0');
  await writeFile(`${out}/${name}.wav`,wavBytes(render.audio));
  candidates.push({id:name,jawOpen,tonguePosition,tongueHeight,pitchHz,tractLengthM,diagnostics:render.diagnostics});
  id++;
}
await writeFile(`${out}/candidates.json`,JSON.stringify(candidates,null,2));
console.log(JSON.stringify({candidates:candidates.length,out},null,2));
