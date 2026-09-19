import test from 'node:test';
import assert from 'node:assert/strict';
import {RenderProfiler,RENDER_GPU_QUANTA} from '../dist/index.js';

class FakeBuffer {
  constructor(size){this.data=new ArrayBuffer(size);this.destroyed=false;}
  async mapAsync(){return undefined;}
  getMappedRange(){return this.data;}
  unmap(){}
  destroy(){this.destroyed=true;}
}
const fakeDevice={
  createQuerySet:({count,type})=>({count,type,destroyed:false,destroy(){this.destroyed=true;}}),
  createBuffer:({size})=>new FakeBuffer(size),
};
test('render profiler records CPU quanta and resets benchmark window',()=>{
 const profiler=new RenderProfiler(fakeDevice,{enabled:true,timestampQueries:false,capacity:16});profiler.beginFrame();
 const value=profiler.measure('frame',()=>42);assert.equal(value,42);profiler.setWork({visible:7,drawCalls:3});profiler.submitted();
 let profile=profiler.inspect();assert.equal(profile.enabled,true);assert.equal(profile.cpuFrames,1);assert.equal(profile.gpuFrames,0);assert.equal(profile.timestampQueries,false);assert.equal(profile.latestCpu.work.visible,7);assert.ok(profile.cpu.frame.meanMs>=0);
 profiler.reset();profile=profiler.inspect();assert.equal(profile.cpuFrames,0);assert.equal(profile.gpuFrames,0);
});
test('render profiler resolves named GPU pass timestamps asynchronously',async()=>{
 const profiler=new RenderProfiler(fakeDevice,{enabled:true,timestampQueries:true,capacity:16});profiler.beginFrame();
 const shadow=profiler.timestampWrites('shadow');assert.equal(shadow.beginningOfPassWriteIndex,0);assert.equal(shadow.endOfPassWriteIndex,1);
 assert.equal(profiler.timestampWrites('present').endOfPassWriteIndex,RENDER_GPU_QUANTA.length*2-1);
 const encoder={
  resolveQuerySet(query,_first,count,buffer){const raw=new BigUint64Array(buffer.data);if(query.type==='occlusion'){for(let i=0;i<count;i++)raw[i]=BigInt(i+1);}else for(let i=0;i<count/2;i++){raw[i*2]=BigInt(i)*2_000_000n;raw[i*2+1]=raw[i*2]+1_000_000n;}},
  copyBufferToBuffer(source,sourceOffset,target,targetOffset,size){new Uint8Array(target.data,targetOffset,size).set(new Uint8Array(source.data,sourceOffset,size));},
 };
 profiler.setWork({shadowCasters:12});profiler.resolve(encoder);profiler.submitted();await Promise.resolve();await Promise.resolve();
 const profile=profiler.inspect();assert.equal(profile.gpuFrames,1);assert.equal(profile.latestGpu.work.shadowCasters,12);assert.equal(profile.rasterSamples.shadow,1);assert.equal(profile.gpuTotal.meanMs,RENDER_GPU_QUANTA.length);
 for(const name of RENDER_GPU_QUANTA)assert.equal(profile.gpu[name].meanMs,1);
 profiler.dispose();
});

test('disabled profiler is transparent to production rendering',()=>{
 const profiler=new RenderProfiler({},{enabled:false,timestampQueries:true,capacity:16});
 profiler.beginFrame();const value=profiler.measure('prepare',()=>17);assert.equal(value,17);profiler.setWork({visible:99});profiler.submitted();
 const profile=profiler.inspect();assert.equal(profile.enabled,false);assert.equal(profile.timestampQueries,false);assert.equal(profile.cpuFrames,0);assert.equal(profile.gpuFrames,0);assert.equal(profile.latestCpu,undefined);
 profiler.dispose();
});
