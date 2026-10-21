import test from 'node:test';
import assert from 'node:assert/strict';
import {UniformUploadLedger,MaterialUniformObserver} from '../tools/gpu-visibility/material-uniforms.mjs';

test('uniform host reference preserves partial typed-array and byte-view writes and requires complete coverage',()=>{
 const ledger=new UniformUploadLedger(),buffer={size:400,usage:72},source=Uint32Array.from({length:104},(_,n)=>n+10);
 ledger.capture(buffer,0,source.subarray(2),1,16);assert.throws(()=>ledger.snapshot(buffer),/complete/);
 ledger.capture(buffer,64,new DataView(source.buffer),80,336);const words=ledger.snapshot(buffer);
 assert.deepEqual([...words.slice(0,16)],[...source.slice(3,19)]);assert.deepEqual([...words.slice(16)],[...source.slice(20,104)]);
 source.fill(0);assert.equal(ledger.snapshot(buffer)[0],13);assert.equal(words[91],105);
 ledger.capture(buffer,8,new Uint8Array([1,2,3,4]).buffer);assert.equal(ledger.snapshot(buffer)[2],0x04030201);
 assert.equal(ledger.capture({size:400,usage:128},0,new Uint8Array(400)),false);
 for(const [offset,dataOffset,size] of [[1,0,4],[0,-1,4],[400,0,4],[0,0,401]])assert.throws(()=>ledger.capture(buffer,offset,new Uint8Array(400),dataOffset,size),/Invalid/);
});

function fakeRenderer(){
 const events=[],device={
  queue:{writeBuffer(buffer,offset,data){buffer.data.set(new Uint8Array(data.buffer,data.byteOffset,data.byteLength),offset);}},
  createShaderModule:descriptor=>descriptor,createComputePipeline:()=>({getBindGroupLayout:()=>({})}),createBindGroup:descriptor=>descriptor,
  createBuffer:descriptor=>({...descriptor,data:new Uint8Array(descriptor.size),async mapAsync(){},getMappedRange(){return this.data.buffer;},unmap(){},destroy(){this.destroyed=true;}}),
  createCommandEncoder(){return{
   beginRenderPass(){return{setPipeline(){},setBindGroup(){},draw(){},drawIndexed(){},drawIndirect(){},drawIndexedIndirect(){},end(){events.push('render.end');}};},
   beginComputePass(){let bind;return{setPipeline(){},setBindGroup(_index,value){bind=value;},dispatchWorkgroups(){},end(){events.push('compute.read');bind.entries[1].resource.buffer.data.set(bind.entries[0].resource.buffer.data);}};},
   copyBufferToBuffer(from,sourceOffset,to,targetOffset,size){events.push('copy');to.data.set(from.data.subarray(sourceOffset,sourceOffset+size),targetOffset);}
  };}
 };return{device,objects:new Map(),drawCalls:3,events};
}
test('material observer captures actual opaque bindings, every draw reference, pass-end reads and exact GPU disagreements',async()=>{
 const renderer=fakeRenderer(),device=renderer.device,original={encoder:device.createCommandEncoder,bind:device.createBindGroup,write:device.queue.writeBuffer},observer=new MaterialUniformObserver(renderer);
 const a=device.createBuffer({size:400,usage:72}),b=device.createBuffer({size:400,usage:72});renderer.objects.set('a',{uniform:a});renderer.objects.set('b',{uniform:b});
 const source=Uint32Array.from({length:100},(_,n)=>n+1);device.queue.writeBuffer(a,0,source);device.queue.writeBuffer(b,0,source);source.fill(0);
 const ga=device.createBindGroup({entries:[{binding:0,resource:{buffer:a}}]}),gb=device.createBindGroup({entries:[{binding:0,resource:{buffer:b}}]});
 const run=async()=>{observer.beginFrame();const encoder=device.createCommandEncoder(),pass=encoder.beginRenderPass({label:'render.main.opaque'});pass.setPipeline({label:'sky'});pass.draw(3);pass.setPipeline({label:'material 2 opaque back'});pass.setBindGroup(0,ga);pass.drawIndexed(12);pass.setBindGroup(0,gb);pass.drawIndexed(12);pass.setBindGroup(0,ga);pass.drawIndexedIndirect({},0);pass.end();return observer.read();};
 const first=await run();assert.equal(first.checks.uniqueBindings,2);assert.equal(first.checks.checkedWords,300);assert.deepEqual(first.checks.draws.map(draw=>draw.objectId),['a','b','a']);assert.ok(first.checks.draws.every(draw=>draw.changedChannels===0));assert.deepEqual(renderer.events,['render.end','compute.read','copy','compute.read','copy']);assert.equal(first.stages['materialUniform:a'].pixels[91],92);
 a.data[0]^=1;const second=await run();assert.deepEqual(second.checks.draws.map(draw=>draw.changedChannels),[1,0,1]);assert.equal(second.stages['materialUniformHost:a:0'].pixels[0],1);
 observer.destroy();assert.equal(device.createCommandEncoder,original.encoder);assert.equal(device.createBindGroup,original.bind);assert.equal(device.queue.writeBuffer,original.write);assert.ok([...observer.targets.values()].every(target=>target.output.destroyed&&target.readback.destroyed));
});

test('material observer rejects missing host uploads and unobserved material bindings',()=>{
 const renderer=fakeRenderer(),device=renderer.device,observer=new MaterialUniformObserver(renderer),buffer=device.createBuffer({size:400,usage:72});renderer.objects.set('a',{uniform:buffer});
 const group=device.createBindGroup({entries:[{binding:0,resource:{buffer}}]});observer.beginFrame();const pass=device.createCommandEncoder().beginRenderPass({label:'render.main.opaque'});pass.setPipeline({label:'material 2 opaque back'});
 pass.setBindGroup(0,{});assert.throws(()=>pass.drawIndexed(12),/binding/);pass.setBindGroup(0,group);assert.throws(()=>pass.drawIndexed(12),/host uploads/);observer.destroy();
});
