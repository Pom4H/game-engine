import {resolve} from 'node:path';
import {startTeaServer} from '../tea-scene/server.mjs';
const root=resolve('.'),out=resolve(process.env.TEA_OUTPUT??'artifacts/tea-performance'),port=Number(process.env.TEA_PORT??4173);
if(!Number.isInteger(port)||port<0||port>65535)throw new RangeError('TEA_PORT');
const server=await startTeaServer({root,port,planPath:out+'/plan.json',audioPath:out+'/dialogue.wav'});
console.log(`http://127.0.0.1:${server.address().port}/tools/tea-performance/player.html`);
const close=()=>{server.closeAllConnections();server.close();};process.once('SIGINT',close);process.once('SIGTERM',close);
