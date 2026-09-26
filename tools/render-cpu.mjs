import {mkdir,writeFile} from 'node:fs/promises';
import {Scene,CpuRenderer,encodePng} from '../dist/index.js';
import {scene} from './render-demo.scene.mjs';

const width=Number(process.argv[2]??1280),height=Number(process.argv[3]??720),out=process.argv[4]??'artifacts/render-cpu.png';
const world=new Scene(scene),renderer=new CpuRenderer({width,height});
renderer.render(world,world.camera);
const stats=renderer.inspect();
if(stats.drawCalls<=0||stats.triangles<=0)throw new Error('CPU renderer produced no geometry: '+JSON.stringify(stats));
await mkdir('artifacts',{recursive:true});
await writeFile(out,encodePng(renderer.framebuffer(),width,height));
console.log(JSON.stringify({out,renderer:stats},null,2));
