import test from 'node:test';
import assert from 'node:assert/strict';
import {MeshLeasePool,OrderedSegmentAssembler} from '../dist/meshwork/index.js';

const base={streamId:'s',epoch:2n,segment:0n,attempt:0,firstOutputFrame:0n,outputFrames:2,warmupFrames:0,programHash:'program:x',executionGraphRefHash:'graph-ref:x',checkpointHash:'checkpoint:x',resourceManifestHash:'manifest:x',cameraHash:'camera:x',renderProfileHash:'profile:x',deadlineNs:10_000n};
test('lease heartbeat extends ownership, expiry creates a new attempt, stale lease cannot commit',()=>{
 const pool=new MeshLeasePool(2n).add(base,'A'),old=pool.claim('A',0n,100n);assert.ok(old);
 const renewed=pool.heartbeat(old,50n,200n);assert.equal(renewed.expiresNs,250n);assert.equal(pool.expire(251n),1);
 const next=pool.claim('B',251n,100n);assert.ok(next);assert.equal(next.task.attempt,1);assert.equal(next.workerId,'B');
 const stale={streamId:'s',epoch:2n,segment:0n,attempt:0,firstFrame:0n,frameCount:2,inputHash:'input:x',outputHash:'segment:x',finishedNs:50n};assert.equal(pool.accept(old,stale,50n),'wrong-task');
});
test('arrival after coordinator deadline is late regardless of worker-local finishedNs',()=>{
 const task={...base,deadlineNs:100n},pool=new MeshLeasePool(2n).add(task,'A'),lease=pool.claim('A',0n,1_000n);assert.ok(lease);assert.equal(lease.expiresNs,100n);
 const result={streamId:'s',epoch:2n,segment:0n,attempt:0,firstFrame:0n,frameCount:2,inputHash:'i',outputHash:'o',finishedNs:1n};
 assert.equal(pool.accept(lease,result,101n),'late');assert.equal(pool.missed,1);assert.equal(pool.pending,0);
});
test('ordered assembler hides out-of-order worker completion',()=>{
 const assembler=new OrderedSegmentAssembler(0n),a={streamId:'s',epoch:1n,segment:0n,attempt:0,firstFrame:0n,frameCount:2,inputHash:'i0',outputHash:'o0',finishedNs:1n},b={...a,segment:1n,firstFrame:2n,inputHash:'i1',outputHash:'o1'};
 assembler.push(b);assert.deepEqual(assembler.drainReady(),[]);assembler.push(a);const ready=assembler.drainReady();assert.equal(ready.length,2);assert.equal(assembler.nextOutputFrame,4n);
});
