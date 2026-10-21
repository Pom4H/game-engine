#!/usr/bin/env node
import {mkdir,writeFile} from 'node:fs/promises';
import {synthesizeStoryFormantLala,wavBytes} from '../../dist/index.js';
const out='artifacts/npc-speech';await mkdir(out,{recursive:true});
const render=synthesizeStoryFormantLala(44_100);
await writeFile(out+'/story-formant-lala.wav',wavBytes(render.audio));
await writeFile(out+'/story-formant-lala.json',JSON.stringify({
  text:'la la',
  model:'Story MRI area function -> transfer-matrix formants -> LF source',
  analysis:render.analysis,
},null,2));
console.log(JSON.stringify({wav:out+'/story-formant-lala.wav',formants:render.analysis.formants},null,2));
