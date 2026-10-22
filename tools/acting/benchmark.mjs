import {performance} from 'node:perf_hooks';
import {createActingMind,appraiseActingOutcome,reappraiseActingOutcome,actingEmotionsAt} from '../../dist/acting/motivation.js';

// One warm, single-process JS run; not a game, renderer, memory-profiler or speedup claim.
const results=[];
for(const subjects of [1,24]){
 let mind=createActingMind('actor',[{id:'goal',importance:1}]);
 const event=i=>({id:`event${i}`,sequence:i,goalId:'goal',subject:`object${i%subjects}`,otherId:`person${i%subjects}`,
  atS:i*.1,progress:Math.sin(i),expectedProgress:.2,certainty:.8,attribution:'unknown'});
 for(let i=1;i<=1000;i++)mind=appraiseActingOutcome(mind,event(i));
 let start=performance.now();
 for(let i=1001;i<=11000;i++)mind=appraiseActingOutcome(mind,event(i));
 const observationMs=performance.now()-start;
 start=performance.now();
 for(let i=1;i<=1000;i++)mind=reappraiseActingOutcome(mind,{eventId:'event10999',revision:i,basisId:`basis${i}`,atS:1100+i*.001,
  interpretation:{progress:Math.sin(10999),expectedProgress:.2,certainty:.8,attribution:'unknown',otherId:`person${10999%subjects}`}});
 const revisionMs=performance.now()-start;
 let checksum=0;start=performance.now();
 for(let i=0;i<1000000;i++)checksum+=actingEmotionsAt(mind,1101+i*.0001).arousal;
 const sampleMs=performance.now()-start;
 results.push({subjects,observations:10000,observationMs,revisions:1000,revisionMs,samples:1000000,sampleMs,
  checkpointBytes:Buffer.byteLength(JSON.stringify(mind)),checksum});
}
console.log(JSON.stringify({node:process.version,scope:'Warm single-process JS microbenchmark; no old-version speed comparison, game FPS or zero-allocation claim',results},null,2));
