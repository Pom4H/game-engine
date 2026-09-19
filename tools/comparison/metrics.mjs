import {writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {scenes,durations} from './scenes.mjs';
const oldRoot=process.argv[2];if(!oldRoot)throw new Error('Pass baseline worktree root');
const roots={before:resolve(oldRoot),after:resolve('.')};
const result={};
for(const [version,root] of Object.entries(roots)){
 const {Scene}=await import(pathToFileURL(`${root}/dist/index.js`).href);result[version]={};
 for(const [id,spec] of Object.entries(scenes)){
  const scene=new Scene(spec),events=[],samples=[];
  const sample=()=>({time:scene.time,tick:scene.tick,entities:scene.entities.size,glassIntact:scene.entities.has('glass'),momentumX:[...scene.physics.bodies.values()].reduce((sum,b)=>sum+b.mass*b.velocity[0],0),shards:[...scene.entities.keys()].filter(id=>id.startsWith('glass:shard:')).length,roughX:scene.entities.get('rough-slider')?.position[0],slipperyX:scene.entities.get('slippery-slider')?.position[0]});
  samples.push(sample());let firstFracture;
  for(let tick=0;tick<Math.ceil(durations[id]*60);tick++){
   scene.step();const e=scene.drainEvents();events.push(...e);if(e.some(event=>event.type==='fracture')&&!firstFracture)firstFracture=sample();
   if((tick+1)%2===0)samples.push(sample());
  }
  result[version][id]={initial:samples[0],final:sample(),firstFracture,events,samples};
 }
}
await writeFile('artifacts/comparison/metrics.json',JSON.stringify(result,null,2));
for(const [version,cases] of Object.entries(result))for(const [id,data] of Object.entries(cases))console.log(version,id,JSON.stringify({initial:data.initial,firstFracture:data.firstFracture,final:data.final,eventCount:data.events.length}));
