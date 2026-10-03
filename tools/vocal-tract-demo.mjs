import {mkdir,writeFile} from 'node:fs/promises';
import {synthesizeIAmAlive,wavBytes,vocalAreaFunction,iAmAliveArticulatorScore} from '../dist/index.js';

const out='artifacts/vocal-tract-demo';await mkdir(out,{recursive:true});
const result=synthesizeIAmAlive({sampleRate:48_000,seed:0xA11CE});
await writeFile(`${out}/i-am-alive-physical.wav`,wavBytes(result.audio));
await writeFile(`${out}/diagnostics.json`,JSON.stringify(result.diagnostics,null,2));
await writeFile(`${out}/articulator-score.json`,JSON.stringify(iAmAliveArticulatorScore(),null,2));
const profiles={};for(const kind of ['a','i','ae','schwa','l','m','v'])profiles[kind]=Array.from(vocalAreaFunction(kind));
await writeFile(`${out}/area-functions.json`,JSON.stringify({sections:result.diagnostics.sections,profiles},null,2));
console.log(JSON.stringify(result.diagnostics,null,2));
