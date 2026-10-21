import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Scene} from '../dist/index.js';
import {CpuRenderer,encodePng} from '../dist/index.js';
import {scene} from './render-demo.scene.mjs';

const [widthArg='640',heightArg='360',outArg='artifacts/cpu-render.png']=process.argv.slice(2);
const width=Number(widthArg),height=Number(heightArg),out=resolve(outArg);
if(!Number.isInteger(width)||!Number.isInteger(height))throw new Error('width/height must be integers');
const world=new Scene(scene);
const renderer=new CpuRenderer({width,height});
renderer.render(world,world.camera);
const stats=renderer.inspect();
if(stats.drawCalls<=0||stats.triangles<=0)throw new Error('CPU renderer produced no geometry: '+JSON.stringify(stats));
await mkdir(resolve('artifacts'),{recursive:true});
await writeFile(out,encodePng(renderer.framebuffer(),width,height));
console.log(JSON.stringify({out,width,height,stats},null,2));
