#!/usr/bin/env node
import {mkdir,writeFile} from 'node:fs/promises';
import {
  buildStoryAreaFrames,
  storyMamaScore,
  synthesizeStoryMama,
  wavBytes,
} from '../../dist/index.js';

const out='artifacts/npc-speech';await mkdir(out,{recursive:true});
const score=storyMamaScore();
const render=synthesizeStoryMama({controlRateHz:240,seed:20261004});
const frames=buildStoryAreaFrames(score,{sampleRate:44_100,controlRateHz:240,sections:44});
await writeFile(out+'/story-mama.wav',wavBytes(render.audio));
await writeFile(out+'/story-mama.json',JSON.stringify({
  text:'mama',
  model:'Story 2005 four-tier MRI-calibrated area function',
  diagnostics:render.diagnostics,
  frames:frames.filter((_,i)=>i%24===0),
},null,2));
console.log(JSON.stringify({wav:out+'/story-mama.wav',duration:render.diagnostics.durationS,sections:render.diagnostics.sections},null,2));
