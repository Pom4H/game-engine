import test from 'node:test';
import assert from 'node:assert/strict';
import {RenderCpuPhaseObserver} from '../tools/engine-compare/cpu-phases.mjs';

test('CPU phases preserve calls and errors, account nested work once and restore the disabled profiler',()=>{
  let now=0;const profiler={enabled:false,timestampQueries:false,measure(name,run){assert.equal(this,profiler);return run();}},original=profiler.measure,observer=new RenderCpuPhaseObserver(profiler,()=>now);
  assert.equal(profiler.measure('outside',()=>{now+=3;return 9;}),9);
  observer.beginFrame(4);const failure=new Error('phase failure');
  assert.throws(()=>profiler.measure('outer',()=>{now+=2;assert.equal(profiler.measure('inner',()=>{now+=5;return 11;}),11);now+=1;throw failure;}),error=>error===failure);
  const frame=observer.endFrame(10);
  assert.deepEqual(frame,{frame:4,coveredMs:8,remainingMs:2,phases:{inner:{calls:1,inclusiveMs:5,exclusiveMs:5},outer:{calls:1,inclusiveMs:8,exclusiveMs:3}}});
  observer.beginFrame(5);profiler.measure('next',()=>{now+=2;});assert.equal(observer.endFrame(2).coveredMs,2);
  observer.dispose();assert.equal(profiler.measure,original);assert.equal(profiler.enabled,false);assert.equal(profiler.timestampQueries,false);
});

test('CPU phase observation rejects ambiguous GPU profiling and invalid frame intervals',()=>{
  for(const options of [{enabled:true,timestampQueries:false},{enabled:false,timestampQueries:true}])assert.throws(()=>new RenderCpuPhaseObserver({...options,measure(_name,run){return run();}}),/disabled renderer profiler/);
  let now=0;const profiler={enabled:false,timestampQueries:false,measure(_name,run){return run();}},observer=new RenderCpuPhaseObserver(profiler,()=>now);
  assert.throws(()=>observer.beginFrame(-1),/Invalid/);assert.throws(()=>observer.endFrame(1),/not complete/);
  observer.beginFrame(0);assert.throws(()=>observer.beginFrame(1),/already active/);profiler.measure('work',()=>{now+=4;});assert.throws(()=>observer.endFrame(3),/exceed/);
  observer.beginFrame(1);assert.equal(observer.endFrame(0).coveredMs,0);observer.dispose();
});
