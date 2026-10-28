import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FrameStallRecorder} from '../dist/observability/frame-stalls.js';

test('a delayed RAF retains the preceding expensive frame and separates between-frame callbacks',()=>{
 let now=0;const recorder=new FrameStallRecorder({now:()=>now,thresholdMs:50});
 recorder.begin(0);now=60;recorder.mark('geometry');recorder.end();
 now=65;const jobStart=now;now=85;recorder.job('receipt',jobStart);
 now=90;recorder.begin(90);now=92;recorder.mark('render');recorder.end();
 const stall=recorder.snapshot().stalls[1];assert.equal(stall.intervalMs,90);assert.equal(stall.cpuMs,2);assert.equal(stall.previousCpuMs,60);assert.equal(stall.betweenFramesMs,30);assert.deepEqual(stall.previousPhases,[{name:'geometry',ms:60}]);assert.deepEqual(stall.jobs,[{name:'receipt',atMs:85,ms:20}]);
});
test('bounded evidence is independent of reused phase storage and of returned snapshots',()=>{
 let now=0;const recorder=new FrameStallRecorder({now:()=>now,thresholdMs:10,capacity:2});
 for(let i=0;i<5;i++){recorder.begin(now);now+=11;recorder.mark('stage'+i);recorder.end();}
 const first=recorder.snapshot();assert.equal(first.totalStalls,5);assert.equal(first.overwrittenStalls,3);assert.equal(first.stalls.length,2);assert.equal(first.stalls[0].phases[0].name,'stage3');first.stalls[0].phases[0].name='external';assert.equal(recorder.snapshot().stalls[0].phases[0].name,'stage3');
});
test('visibility/pause reset excludes the dormant interval from later frames',()=>{
 let now=0;const recorder=new FrameStallRecorder({now:()=>now});recorder.begin(0);now=2;recorder.mark('render');recorder.end();recorder.reset();now=10000;recorder.begin(now);now+=2;recorder.mark('render');recorder.end();assert.equal(recorder.snapshot().totalStalls,0);
 assert.throws(()=>new FrameStallRecorder({capacity:0}),RangeError);assert.throws(()=>new FrameStallRecorder({thresholdMs:NaN}),RangeError);
});
