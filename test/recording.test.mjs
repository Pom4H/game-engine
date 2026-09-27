import test from 'node:test';
import assert from 'node:assert/strict';
import {FrameRecording,chromeTrace} from '../tools/docs/recording.mjs';
import {RenderProfiler} from '../dist/render/profiler.js';
const event=(frame,kind='cpu',generation=0,startMs=frame*10)=>({kind,generation,startMs,timing:{frame,totalMs:2,quanta:{main:1.5},work:{triangles:200}},spans:[{name:'main',offsetMs:.25,durationMs:1.5}]});
const jpeg='data:image/jpeg;base64,/9j/AA==';
test('CPU and delayed/out-of-order GPU samples join only the matching generation/frame',()=>{
 const r=new FrameRecording();r.start(0);r.receive(event(1));r.receive(event(2));r.receive(event(1,'gpu'));
 assert.equal(r.at(0).gpu.frame,1);assert.equal(r.at(1).gpu,undefined);
 r.receive(event(1,'gpu',1));assert.equal(r.at(1).gpu,undefined);
 r.receive(event(1,'cpu',1,30));r.receive(event(1,'gpu',1));assert.equal(r.at(2).gpu.frame,1);
});
test('recording never needs a solver or mutable world; metadata is copied at capture',()=>{
 const r=new FrameRecording();r.start(0);const meta={tick:10};r.receive(event(1),meta);meta.tick=20;
 assert.equal(r.at(0).meta.tick,10);assert.ok(Object.isFrozen(r.at(0).meta));
 assert.equal(r.at(-5),r.at(0));assert.equal(r.at(5),r.at(0));
});
test('frame count, duration and image budgets are bounded; duplicate CPU delivery ignored',()=>{
 const r=new FrameRecording({maxFrames:2,maxImages:1,maxImageBytes:1024,maxDurationMs:25});r.start(0);
 r.receive(event(1));r.receive(event(1));r.receive(event(2));assert.equal(r.frames.length,2);
 r.receive(event(3));assert.equal(r.active,false);assert.equal(r.frames.length,2);
 assert.equal(r.attachImage(r.session,'0:1',jpeg,1),true);assert.equal(r.attachImage(r.session,'0:2',jpeg,1),false);
 const t=new FrameRecording({maxDurationMs:5});t.start(0);t.receive(event(1));assert.equal(t.frames.length,0);assert.equal(t.active,false);
 const b=new FrameRecording({maxImageBytes:2});b.start(0);b.receive(event(1));assert.equal(b.attachImage(b.session,'0:1',jpeg,1),false);
});
test('stop accepts pending GPU and image for recorded frames, not new CPU frames',()=>{
 const r=new FrameRecording();r.start(0);r.receive(event(1));r.stop();r.receive(event(2));r.receive(event(1,'gpu'));
 assert.equal(r.frames.length,1);assert.ok(r.at(0).gpu);assert.equal(r.attachImage(r.session,'0:1',jpeg,1),true);
});
test('a restarted session rejects old async image completions; no future image shown',()=>{
 const r=new FrameRecording();r.start(0);r.receive(event(1));const old=r.session;r.start(0);r.receive(event(1));r.receive(event(2));
 assert.equal(r.attachImage(old,'0:1',jpeg,1),false);r.attachImage(r.session,'0:2',jpeg,1);
 assert.equal(r.imageAt(0),undefined);assert.equal(r.imageAt(1).key,'0:2');r.receive(event(3));assert.equal(r.imageAt(2).key,'0:2');
});
test('export keeps measured CPU intervals, screenshots and unaligned GPU counters',()=>{
 const r=new FrameRecording();r.start(0);r.receive(event(1));r.receive(event(1,'gpu'));r.attachImage(r.session,'0:1',jpeg,.2);
 const trace=chromeTrace(r),span=trace.traceEvents.find(e=>e.name==='main');assert.equal(span.ts,10250);assert.equal(span.dur,1500);
 assert.equal(trace.traceEvents.filter(e=>e.ph==='O').length,1);assert.equal(trace.traceEvents.filter(e=>e.ph==='C').length,1);
 assert.equal(trace.metadata.gpuClockCalibrated,false);assert.equal(JSON.parse(JSON.stringify(r.export())).frames[0].image,jpeg);
});
test('invalid budgets and unsafe image URLs rejected',()=>{
 for(const options of [{maxFrames:0},{maxImages:Infinity},{maxDurationMs:60001},{maxImageBytes:-1}])assert.throws(()=>new FrameRecording(options));
 const r=new FrameRecording();r.start(0);r.receive(event(1));assert.equal(r.attachImage(r.session,'0:1','javascript:alert(1)',0),false);
});
test('existing profiler emits frozen frame evidence; unsubscribe disables interval capture',()=>{
 const device={createQuerySet:()=>({}),createBuffer:()=>({mapAsync:()=>new Promise(()=>{})})};const p=new RenderProfiler(device),seen=[];
 const off=p.subscribeFrames(e=>seen.push(e));p.beginFrame();p.measure('frame',()=>{});p.submitted();
 assert.equal(seen.length,1);assert.equal(seen[0].kind,'cpu');assert.ok(Object.isFrozen(seen[0]));assert.equal(seen[0].spans.length,1);
 assert.ok(seen[0].spans[0].offsetMs>=0);assert.ok(seen[0].startMs>=0);assert.ok(Object.isFrozen(seen[0].timing.work));
 off();p.beginFrame();p.measure('frame',()=>{});p.submitted();assert.equal(seen.length,1);
 const off2=p.subscribeFrames(e=>seen.push(e));p.reset();p.beginFrame();p.submitted();assert.equal(seen[1].generation,1);assert.equal(seen[1].timing.frame,1);off2();
});
