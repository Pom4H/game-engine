import {performance} from 'node:perf_hooks';
import {SpatialHash} from '../../dist/index.js';

const small=Array.from({length:100},(_,i)=>({x:(i%10)*9,z:Math.floor(i/10)*9}));
const large=Array.from({length:5},(_,i)=>({x:40+i,z:40-i}));
function run(iterations=80){
  const index=new SpatialHash(8),scratch=[];
  for(let j=0;j<iterations;j++){
    index.clear();index.beginBatch();
    for(const item of large)index.add(item,Math.hypot(140,140)/2);
    for(const item of small)index.add(item,.8);
    index.endBatch();
    for(const item of small)index.near(item.x,item.z,2,scratch);
  }
  return index.diagnostics;
}
run(10);
const samples=[];
for(let i=0;i<8;i++){const start=performance.now();const diagnostics=run();samples.push(performance.now()-start)}
samples.sort((a,b)=>a-b);
console.log(JSON.stringify({fixture:'5 large surfaces, 100 small bodies, 80 rebuilds and 8000 queries per sample',
  medianMs:(samples[3]+samples[4])/2,samplesMs:samples,diagnostics:run(1)},null,2));
