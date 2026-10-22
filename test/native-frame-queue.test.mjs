import test from 'node:test';
import assert from 'node:assert/strict';
import {GPUFrameQueue} from '../tools/native/frame-queue.mjs';
import {NativeRuntime} from '../tools/native/runtime.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function device(){const fences=[];return {fences,queue:{onSubmittedWorkDone(){const d=deferred();fences.push(d);return d.promise;}}};}
test('two frames proceed without a completion wait, third waits for a slot',async()=>{
 const d=device(),q=new GPUFrameQueue(d,2);await q.acquire();q.submittedFrame();await q.acquire();q.submittedFrame();let acquired=false;const next=q.acquire().then(()=>acquired=true);await turn();assert.equal(acquired,false);assert.equal(q.inspect().peak,2);
 d.fences[0].resolve();await next;assert.equal(acquired,true);q.submittedFrame();assert.equal(q.inspect().pending,2);d.fences[1].resolve();d.fences[2].resolve();await q.drain();assert.equal(q.inspect().pending,0);
});
test('queue captures rejection immediately and propagates device loss at acquire/drain',async()=>{
 const d=device(),q=new GPUFrameQueue(d);q.submittedFrame();d.fences[0].reject(new Error('device lost'));await turn();await assert.rejects(()=>q.acquire(),/device lost/);await assert.rejects(()=>q.drain(),/device lost/);
 assert.throws(()=>new GPUFrameQueue(d,0),RangeError);assert.throws(()=>new GPUFrameQueue(d,3),RangeError);
});
function runtime(){const d=device(),events=[],scene={entities:new Map()},host={device:d,canvas:{width:64,height:64},options:{headless:false},keys:new Set(),resize:false,needsResize(){return this.resize;},syncSize(){events.push('resize');this.resize=false;return true;},assertHealthy(){},present(){events.push('present');},close(){events.push('host.close');},async captureRGBA(){events.push('capture');return {rgba:new Uint8Array(64*64*4)};}};
 const renderer={setResolution(){},setTimelineFrame(){},render(){events.push('render');},inspect(){return {errors:[]};},async flush(){events.push('flush');},dispose(){events.push('dispose');}};
 return {d,events,host,runtime:new NativeRuntime(scene,renderer,host,60)};
}
test('runtime keeps two frames in flight and drains before resizing targets',async()=>{
 const h=runtime();await h.runtime.frame({steps:0});await h.runtime.frame({steps:0});assert.equal(h.events.filter(e=>e==='flush').length,0);assert.equal(h.events.filter(e=>e==='present').length,2);
 h.host.resize=true;const before=h.events.length,next=h.runtime.frame({steps:0});await turn();assert.equal(h.events.length,before);h.d.fences[0].resolve();h.d.fences[1].resolve();await next;assert.equal(h.events[before],'resize');h.d.fences[2].resolve();await h.runtime.close();assert.deepEqual(h.events.slice(-3),['flush','dispose','host.close']);
});
test('capture retains swapchain image until readback and GPU completion, then presents',async()=>{
 const h=runtime(),pending=h.runtime.frame({steps:0,capture:true});await turn();assert.ok(h.events.includes('capture'));assert.equal(h.events.includes('present'),false);h.d.fences[0].resolve();await pending;assert.ok(h.events.indexOf('capture')<h.events.indexOf('present'));await h.runtime.close();
});
test('close during a blocked frame prevents a later render and waits before disposal',async()=>{
 const h=runtime();await h.runtime.frame({steps:0});await h.runtime.frame({steps:0});const next=h.runtime.frame({steps:0});await turn();const closing=h.runtime.close();assert.equal(h.runtime.close(),closing);await turn();assert.equal(h.events.includes('dispose'),false);h.d.fences[0].resolve();h.d.fences[1].resolve();assert.equal(await next,null);await closing;assert.equal(h.events.filter(e=>e==='render').length,2);
});
test('device loss still destroys renderer and host during close',async()=>{
 const h=runtime();await h.runtime.frame({steps:0});h.d.fences[0].reject(new Error('lost'));await turn();await assert.rejects(()=>h.runtime.close(),/lost/);assert.deepEqual(h.events.slice(-2),['dispose','host.close']);
});
