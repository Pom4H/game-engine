import test from 'node:test';
import assert from 'node:assert/strict';
import {RenderProfiler} from '../dist/render/profiler.js';
import {EngineTrace} from '../dist/observability/trace.js';

function fixture(t,options={}){
 const previous=Object.getOwnPropertyDescriptor(globalThis,'performance'),clock={now:0,reads:0},maps=[];
 Object.defineProperty(globalThis,'performance',{configurable:true,value:{now:()=>{clock.reads++;return clock.now;}}});
 t.after(()=>Object.defineProperty(globalThis,'performance',previous));
 const device={
  createQuerySet(spec){return{...spec,data:new BigUint64Array(spec.count),destroy(){}};},
  createBuffer(spec){return{...spec,data:new ArrayBuffer(spec.size),unmaps:0,mapAsync(){return new Promise((resolve,reject)=>maps.push({buffer:this,resolve,reject}));},getMappedRange(){return this.data;},unmap(){this.unmaps++;},destroy(){}};},
 };
 const encoder={resolveQuerySet(query,first,count,buffer,offset){new BigUint64Array(buffer.data,offset,count).set(query.data.subarray(first,first+count));},copyBufferToBuffer(source,start,target,offset,size){new Uint8Array(target.data,offset,size).set(new Uint8Array(source.data,start,size));}};
 const profiler=new RenderProfiler(device,{enabled:true,timestampQueries:true,...options});t.after(()=>profiler.dispose());
 function frame(cpuMs,gpuMs,work={},shadowMs){
  const id=profiler.beginFrame();profiler.setWork(work);
  // Large absolute ticks detect conversion-before-subtraction precision loss.
  const base=(1n<<63n)+BigInt(id)*1000000000n;
  const write=(name,duration)=>{const writes=profiler.timestampWrites(name);if(writes){writes.querySet.data[writes.beginningOfPassWriteIndex]=base;writes.querySet.data[writes.endOfPassWriteIndex]=base+BigInt(Math.round(duration*1e6));}};
  if(gpuMs!==undefined)write('main',gpuMs);if(shadowMs!==undefined)write('shadow',shadowMs);
  profiler.resolve(encoder);clock.now+=cpuMs;profiler.submitted();return id;
 }
 async function complete(reverse=false){const pending=maps.splice(0);if(reverse)pending.reverse();for(const request of pending)request.resolve();await new Promise(resolve=>setImmediate(resolve));}
 return{profiler,frame,complete,maps,clock};
}

test('manual worst CPU inspection reuses up to eight frozen retained records and resets without hot-path sorts',async t=>{
 const f=fixture(t,{timestampQueries:false,capacity:16}),sort=Array.prototype.sort;
 Array.prototype.sort=function(){throw Error('frame path sorted history');};
 try{for(let frame=1;frame<=20;frame++)f.frame(frame===1?1000:frame,undefined,{drawCalls:frame});}
 finally{Array.prototype.sort=sort;}
 const snapshot=f.profiler.inspect();assert.equal(snapshot.cpuFrames,16);assert.deepEqual(snapshot.worstCpu.map(frame=>frame.frame),[20,19,18,17,16,15,14,13]);assert.deepEqual(snapshot.worstGpu,[]);
 for(const frame of snapshot.worstCpu){assert.equal(frame,f.profiler.cpuHistory.find(record=>record.frame===frame.frame));assert.ok(Object.isFrozen(frame));assert.ok(Object.isFrozen(frame.work));assert.ok(Object.isFrozen(frame.quanta));assert.equal(frame.work.drawCalls,frame.frame);}
 assert.ok(Object.isFrozen(snapshot.worstCpu));assert.throws(()=>snapshot.worstCpu.pop(),TypeError);
 assert.equal('worstCpu' in f.profiler.latest(),false,'streaming telemetry does not perform manual worst selection');
 f.profiler.reset();const reset=f.profiler.inspect();assert.equal(reset.cpuFrames,0);assert.deepEqual(reset.worstCpu,[]);assert.deepEqual(reset.worstGpu,[]);assert.equal(snapshot.worstCpu[0].frame,20,'prior snapshots remain immutable');await f.complete();
});

test('worst GPU inspection preserves actual frame work, nanosecond differences, unused masks and bounded capacity',async t=>{
 const f=fixture(t,{capacity:8});
 for(let frame=1;frame<=12;frame++){f.frame(1,frame===1?340:frame===8?100.125:frame,{drawCalls:frame*10},frame===1?79:undefined);await f.complete();}
 const snapshot=f.profiler.inspect();assert.equal(snapshot.gpuFrames,8);assert.equal(snapshot.worstGpu.length,8);assert.equal(snapshot.worstGpu[0].frame,8);assert.equal(snapshot.worstGpu[0].totalMs,100.125);assert.equal(snapshot.worstGpu[0].quanta.main,100.125);assert.equal(snapshot.worstGpu[0].quanta.shadow,0,'unused previous-frame queries cannot contaminate the interval');assert.equal(snapshot.worstGpu[0].work.drawCalls,80);
 assert.deepEqual(snapshot.worstGpu.map(frame=>frame.frame),[8,12,11,10,9,7,6,5]);
 for(const frame of snapshot.worstGpu)assert.equal(frame,f.profiler.gpuHistory.find(record=>record.frame===frame.frame));assert.ok(Object.isFrozen(snapshot.worstGpu));
});

test('ring saturation and out-of-order pre-reset readbacks cannot publish stale worst GPU generations',async t=>{
 const f=fixture(t);
 for(let frame=1;frame<=4;frame++)f.frame(frame,frame===1?340:frame,{drawCalls:frame});
 const gpuRequests=()=>f.maps.filter(request=>request.buffer.label.startsWith('render profile readback'));
 assert.equal(gpuRequests().length,4);f.frame(5,500,{drawCalls:5});assert.equal(gpuRequests().length,4,'full ring skips a sample without blocking or reusing pending storage');
 f.profiler.reset();f.frame(6,600,{drawCalls:999});assert.equal(gpuRequests().length,4,'reset leaves old pending ownership intact');
 await f.complete(true);let snapshot=f.profiler.inspect();assert.equal(snapshot.gpuFrames,0);assert.deepEqual(snapshot.worstGpu,[]);assert.equal(snapshot.worstCpu.length,1);assert.equal(snapshot.worstCpu[0].frame,1);assert.equal(snapshot.worstCpu[0].work.drawCalls,999);
 f.frame(7,3.125,{drawCalls:777});await f.complete();snapshot=f.profiler.inspect();assert.equal(snapshot.gpuFrames,1);assert.equal(snapshot.worstGpu[0].frame,2);assert.equal(snapshot.worstGpu[0].totalMs,3.125);assert.equal(snapshot.worstGpu[0].work.drawCalls,777);
});

test('host CPU intervals reuse existing clock reads and survive delayed/reversed GPU completion and slot reuse',async t=>{
 const f=fixture(t);f.clock.now=100.25;
 f.frame(4.5,30,{drawCalls:10});f.clock.now=200.75;f.frame(7.25,2,{drawCalls:20});
 assert.equal(f.clock.reads,4,'one existing start and one existing submission read per frame');
 const cpu=f.profiler.cpuHistory.slice();assert.deepEqual(cpu.map(r=>[r.frame,r.cpuStartedAtMs,r.cpuSubmittedAtMs,r.totalMs]),[[1,100.25,104.75,4.5],[2,200.75,208,7.25]]);
 f.clock.now=9000;await f.complete(true);assert.equal(f.clock.reads,4,'GPU readback does not sample the callback clock');
 for(const gpu of f.profiler.gpuHistory){const same=cpu.find(c=>c.frame===gpu.frame);assert.equal(gpu.cpuStartedAtMs,same.cpuStartedAtMs);assert.equal(gpu.cpuSubmittedAtMs,same.cpuSubmittedAtMs);}
 assert.equal(f.profiler.inspect().worstGpu[0].cpuStartedAtMs,100.25,'GPU worst duration retains its own CPU submission interval');
 f.clock.now=10000;f.frame(1.5,5,{drawCalls:30});await f.complete();const latest=f.profiler.latest();
 assert.equal(latest.gpu.cpuStartedAtMs,10000);assert.equal(latest.gpu.cpuSubmittedAtMs,10001.5);assert.equal(cpu[0].cpuStartedAtMs,100.25,'reusing a slot cannot mutate prior records');
 f.profiler.reset();f.clock.now=11000;f.frame(3,6);await f.complete();assert.equal(f.profiler.latest().gpu.frame,1);assert.equal(f.profiler.latest().gpu.cpuSubmittedAtMs,11003);
});

test('trace GPU readbacks retain the original capture and never invent GPU execution positions',async t=>{
 const f=fixture(t),first=new EngineTrace({originMs:0}),second=new EngineTrace({originMs:0});f.profiler.setTrace(first);
 f.frame(2,5,{uploadBytes:100});f.profiler.setTrace(second);f.frame(3,7,{uploadBytes:200});await f.complete(true);
 for(const [trace,frame,cpu,gpu,bytes] of [[first,1,2,5,100],[second,2,3,7,200]]){
  const events=trace.snapshot().events,measurement=events.find(e=>e.name==='render.gpu.ms');
  assert.equal(measurement.args.frame,frame);assert.equal(measurement.args.value,gpu);assert.equal(measurement.phase,'C');assert.equal(measurement.args.gpuExecutionPosition,'unavailable');
  assert.equal(events.find(e=>e.name==='render.cpu.ms').args.value,cpu);assert.equal(events.find(e=>e.name==='render.upload.bytes').args.value,bytes);
 }
 f.profiler.reset();f.profiler.setTrace(second);f.frame(1,100);f.profiler.reset();await f.complete();
 assert.equal(second.snapshot().events.filter(e=>e.name==='render.gpu.ms').length,1,'stale reset-generation cannot leak into trace');
});

test('CPU capture works without enabling GPU profiler resources',async t=>{
 const f=fixture(t,{enabled:false,timestampQueries:false}),trace=new EngineTrace({originMs:0});f.profiler.setTrace(trace);
 f.profiler.beginFrame();f.profiler.measure('projection',()=>{f.clock.now+=2;});f.profiler.addUpload(32);f.clock.now+=1;f.profiler.submitted();
 const events=trace.snapshot().events;assert.equal(events.find(e=>e.name==='projection').durationMs,2);assert.equal(events.find(e=>e.name==='render.cpu.ms').args.value,3);assert.equal(events.find(e=>e.name==='render.upload.bytes').args.value,32);
 assert.equal(events.some(e=>e.name==='render.gpu.ms'),false);assert.equal(f.profiler.inspect().cpuFrames,0);
});
