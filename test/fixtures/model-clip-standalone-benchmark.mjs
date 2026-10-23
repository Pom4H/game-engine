import {intersectsModelClip,intersectsClip} from '../../src/render/visibility.js';
import {compose,lookAt,multiply4,multiply4Into,perspective} from '../../src/math.js';
import {originalClipProduct,originalClipTrace} from './model-clip-before-staging.mjs';

// Standalone synthetic input, not captured actual-r7 objects or an FPS trace.
// Browser-buildable: no Node APIs, services, rendering, or GPU work.
export function createModelClipBenchmarkDataset(seed=0x5533a){
 let state=seed;
 const rnd=(a,b)=>a+(b-a)*((state=(Math.imul(state,1664525)+1013904223)>>>0)/4294967296);
 const bounds={center:[0,0,0],half:[.5,.5,.5]},view=multiply4(perspective(.95,1,.08,24),lookAt([0,1,0],[0,.9,-1]));
 const mixed=Array.from({length:2048},(_,n)=>{
  const position=n%5===0?[rnd(-2,2),rnd(.1,2),rnd(-15,-2)]:n%5===1?[rnd(-20,20),rnd(-10,10),rnd(-30,-1)]:[rnd(-200,200),rnd(-20,20),rnd(-200,200)];
  return compose(position,[rnd(-3,3),rnd(-3,3),rnd(-3,3)],[rnd(.2,5),rnd(.2,5),rnd(.2,5)]);
 });
 const inside=Array.from({length:1024},()=>compose([rnd(-.2,.2),rnd(.7,1.1),rnd(-14,-8)],[rnd(-3,3),rnd(-3,3),rnd(-3,3)],[rnd(.2,.5),rnd(.2,.5),rnd(.2,.5)]));
 return{bounds,view,datasets:[{label:'mixed 2048 synthetic road-like objects',models:mixed},{label:'all-visible 1024 synthetic objects',models:inside}]};
}

/** Both timed paths are allocation-free and use one preallocated scratch.
 * Frozen product/trace allocation occurs only while collecting distributions.
 * Alternating paired order reduces drift; raw paired samples stay inspectable. */
export function benchmarkModelClipPairs({input=createModelClipBenchmarkDataset(),repeats=16,pairs=15,warmup=8}={}){
 const {bounds,view}=input,scratch=new Float32Array(16);let checksum=0;
 function sample(models,staged){
  const start=performance.now();let count=0;
  for(let repeat=0;repeat<repeats;repeat++)for(const model of models){
   if(staged){if(intersectsModelClip(bounds,view,model,scratch))count++;}
   else{multiply4Into(view,model,scratch);if(intersectsClip(bounds,scratch))count++;}
  }
  checksum+=count;return{ms:performance.now()-start,count};
 }
 const summary=values=>{
  const sorted=[...values].sort((a,b)=>a-b);
  return{min:sorted[0],p10:sorted[Math.floor(sorted.length*.1)],median:sorted[Math.floor(sorted.length*.5)],p90:sorted[Math.floor(sorted.length*.9)],max:sorted.at(-1)};
 };
 const results=input.datasets.map(({label,models})=>{
  const distribution=[0,0,0,0,0,0,0];
  for(const model of models)distribution[originalClipTrace(bounds,originalClipProduct(view,model)).plane]++;
  for(let n=0;n<warmup;n++){sample(models,false);sample(models,true);}
  const samples=[];
  for(let n=0;n<pairs;n++){
   const stagedFirst=!!(n&1),first=sample(models,stagedFirst),second=sample(models,!stagedFirst);
   if(first.count!==second.count)throw new Error('Model clip candidate parity failed');
   const original=stagedFirst?second:first,staged=stagedFirst?first:second;
   samples.push({stagedFirst,originalMs:original.ms,stagedMs:staged.ms,ratio:staged.ms/original.ms,visible:original.count/repeats});
  }
  return{label,objects:models.length,callsPerSample:models.length*repeats,rejectedPlaneOrAccepted:distribution,originalMs:summary(samples.map(s=>s.originalMs)),stagedMs:summary(samples.map(s=>s.stagedMs)),pairedRatio:summary(samples.map(s=>s.ratio)),samples};
 });
 return{scope:'Standalone synthetic spotlight CPU replay; not captured actual-r7 objects, no GPU or end-to-end FPS measurement',repeats,pairs,warmup,results,checksum};
}
