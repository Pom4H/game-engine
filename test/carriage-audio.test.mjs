import test from 'node:test';
import assert from 'node:assert/strict';
import {renderAudio,acousticPose,carriage} from '../tools/arcade/carriage-audio.mjs';

test('one horse and four wheels stay behind the moving camera throughout every pass',()=>{
 assert.equal(carriage.horses,1);assert.equal(carriage.wheels.length,4);
 for(let t=0;t<180;t+=.25){
  const p=acousticPose(t),v=p.position.map((n,i)=>n-p.listener[i]);
  assert(v.reduce((sum,n,i)=>sum+n*p.forward[i],0)<-7.9);
  assert.equal(p.active,(t%90>=12&&t%90<27)||(t%90>=58&&t%90<73));
 }
});
test('PCM has no segment seam and passes are louder than the quiet air',()=>{
 const full=renderAudio({startTime:18,duration:2}),a=renderAudio({startTime:18,duration:1}),b=renderAudio({startTime:19,duration:1});
 assert.deepEqual(full.slice(0,a.length),a);assert.deepEqual(full.slice(a.length),b);
 const rms=pcm=>Math.sqrt(pcm.reduce((sum,n)=>sum+n*n,0)/pcm.length);
 const quiet=renderAudio({startTime:0,duration:1});
 assert(rms(full)>rms(quiet)*8);assert(full.every(v=>Number.isFinite(v)&&Math.abs(v)<.9));
 const left=renderAudio({startTime:15,duration:1}),right=renderAudio({startTime:24,duration:1});
 const energy=(pcm,side)=>pcm.reduce((sum,n,i)=>sum+(i%2===side?n*n:0),0);
 assert(energy(left,0)>energy(left,1));assert(energy(right,1)>energy(right,0));
});
