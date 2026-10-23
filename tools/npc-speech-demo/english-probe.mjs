#!/usr/bin/env node
import {mkdir,writeFile} from 'node:fs/promises';
import {synthesizeNpcEnglishSpeech,wavBytes} from '../../dist/index.js';

const out='artifacts/npc-speech/probe';await mkdir(out,{recursive:true});
const cases=['yeah','mama','me','mom','yeah mama'];
for(const text of cases){
  const file=text.replace(/\s+/g,'-');
  const result=synthesizeNpcEnglishSpeech(text,{sampleRate:48_000,controlRateHz:240});
  await writeFile(`${out}/${file}.wav`,wavBytes(result.audio));
  await writeFile(`${out}/${file}.json`,JSON.stringify({text,diagnostics:result.diagnostics},null,2));
  console.log(JSON.stringify({text,wav:`${out}/${file}.wav`,duration:result.diagnostics.durationS}));
}
