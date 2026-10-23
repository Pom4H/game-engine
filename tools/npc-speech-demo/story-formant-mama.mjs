#!/usr/bin/env node
import {mkdir,writeFile} from 'node:fs/promises';
import {synthesizeStoryFormantMama,wavBytes} from '../../dist/index.js';

const out='artifacts/npc-speech';await mkdir(out,{recursive:true});
const render=synthesizeStoryFormantMama(44_100);
await writeFile(out+'/story-formant-mama.wav',wavBytes(render.audio));
await writeFile(out+'/story-formant-mama.json',JSON.stringify({
  text:'mama',
  model:'Story MRI area function -> transfer-matrix formants -> LF source',
  analysis:render.analysis,
},null,2));
console.log(JSON.stringify({
  wav:out+'/story-formant-mama.wav',
  formants:render.analysis.formants,
},null,2));
