#!/usr/bin/env node
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {startTeaServer} from './server.mjs';

const root=resolve(fileURLToPath(new URL('../../',import.meta.url))),port=Number(process.env.TEA_PORT??4173);
if(!Number.isInteger(port)||port<0||port>65535)throw new RangeError('TEA_PORT must be in 0..65535');
const server=await startTeaServer({root,port,
  planPath:resolve(root,process.env.TEA_PLAN??'artifacts/tea-scene/plan.json'),
  audioPath:resolve(root,process.env.TEA_AUDIO??'artifacts/tea-scene/dialogue.wav'),
});
console.log(`Чай в зимнем городе: http://127.0.0.1:${server.address().port}/`);
const stop=()=>{server.closeAllConnections();server.close();};
process.once('SIGINT',stop);process.once('SIGTERM',stop);
