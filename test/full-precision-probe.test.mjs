import test from 'node:test';
import assert from 'node:assert/strict';
import {colorCopyPlan,decodeColorCopy} from '../tools/gpu-visibility/color-copy.mjs';
import {FullPrecisionProbe,promoteProbeTarget,installProbePipelines,installProbeDeviceLimit} from '../tools/gpu-visibility/full-precision-probe.mjs';
import {worldInputIndexAgreement} from '../tools/gpu-visibility/world-input-check.mjs';
import {lightingProbe} from '../tools/gpu-visibility/lighting-probe.mjs';
import {ColorReadbackCheck} from '../tools/gpu-visibility/color-readback-check.mjs';

test('native floating copies preserve full precision and signed zero across padded rows',()=>{
 for(const format of ['rgba16float','rgba32float']){
  const plan=colorCopyPlan(format,3,2),values=format==='rgba32float'?new Uint32Array([0x80000000,0,0x3f800001,0xbf800001]):new Uint16Array([0x8000,0,0x3c01,0xbc01]),mapped=new Uint8Array(plan.bytes).fill(255);
  for(let y=0;y<2;y++)for(let x=0;x<3;x++)mapped.set(new Uint8Array(values.buffer),y*plan.row+x*plan.pixelBytes);
  const result=decodeColorCopy(mapped,plan);assert.equal(result.encoding,format+' raw words');assert.deepEqual([...result.pixels],[...values,...values,...values,...values,...values,...values]);
  assert.throws(()=>decodeColorCopy(mapped.subarray(0,plan.bytes-1),plan),/Incomplete/);
  new DataView(mapped.buffer).setUint32(0,format==='rgba32float'?0x7f800000:0x00007c00,true);assert.throws(()=>decodeColorCopy(mapped,plan),/Non-finite/);
 }
 assert.throws(()=>colorCopyPlan('rgba8unorm',1,1),/format/);assert.throws(()=>colorCopyPlan('rgba32float',0,1),/extent/);
});

test('full-precision target promotion is confined to the normal MRT slot and restores native pipeline creation',()=>{
 const descriptor={label:'material instances 2 back',fragment:{targets:['rgba16float','rgba16float','rgba8unorm','rg16float'].map(format=>({format}))}},promoted=promoteProbeTarget(descriptor);
 assert.equal(promoted.fragment.targets[1].format,'rgba32float');assert.equal(descriptor.fragment.targets[1].format,'rgba16float');for(const index of [0,2,3])assert.equal(promoted.fragment.targets[index],descriptor.fragment.targets[index]);
 const reflected={fragment:{targets:[{format:'rgba16float'}]}};assert.equal(promoteProbeTarget(reflected),reflected);
 const invalid=structuredClone(descriptor);invalid.fragment.targets[1].blend={};assert.throws(()=>promoteProbeTarget(invalid),/MRT contract/);
 const prototype={createRenderPipeline:value=>value},native=prototype.createRenderPipeline,hook=installProbePipelines(prototype);assert.equal(prototype.createRenderPipeline(descriptor).fragment.targets[1].format,'rgba32float');assert.equal(hook.state.promoted,1);hook.restore();assert.equal(prototype.createRenderPipeline,native);
});

test('full-precision attachment hook observes one opaque pass, preserves descriptors and restores the encoder',()=>{
 const seen=[],device={limits:{maxColorAttachmentBytesPerSample:36},createTexture:descriptor=>({...descriptor,createView(){return{texture:this};},destroy(){this.destroyed=true;}}),createCommandEncoder(){return{beginRenderPass(descriptor){seen.push(descriptor);return{};}};}},original=device.createCommandEncoder,probe=new FullPrecisionProbe({device},2,1);
 const attachment={view:{original:true},loadOp:'clear',storeOp:'store'},descriptor={label:'render.main.opaque',colorAttachments:[attachment,attachment,attachment,attachment]};
 probe.beginFrame();device.createCommandEncoder().beginRenderPass(descriptor);assert.equal(descriptor.colorAttachments[1],attachment);assert.equal(seen[0].colorAttachments[1].view.texture,probe.texture);for(const index of [0,2,3])assert.equal(seen[0].colorAttachments[index],attachment);
 assert.equal(probe.finishFrame().opaquePasses,1);assert.throws(()=>probe.finishFrame(),/Incomplete/);probe.beginFrame();assert.throws(()=>probe.finishFrame(),/Incomplete/);probe.destroy();assert.equal(device.createCommandEncoder,original);assert.equal(probe.texture.destroyed,true);
});

test('diagnostic device limit checks adapter support and preserves existing device requirements',()=>{
 const prototype={requestDevice:descriptor=>descriptor},native=prototype.requestDevice,hook=installProbeDeviceLimit(prototype),adapter=Object.assign(Object.create(prototype),{limits:{maxColorAttachmentBytesPerSample:128}}),descriptor={label:'debug',requiredFeatures:['timestamp-query'],requiredLimits:{maxStorageBuffersPerShaderStage:8}},result=adapter.requestDevice(descriptor);
 assert.equal(result.requiredLimits.maxColorAttachmentBytesPerSample,36);assert.equal(result.requiredLimits.maxStorageBuffersPerShaderStage,8);assert.equal(result.requiredFeatures,descriptor.requiredFeatures);assert.equal(descriptor.requiredLimits.maxColorAttachmentBytesPerSample,undefined);assert.equal(hook.state.adapterLimit,128);
 adapter.limits.maxColorAttachmentBytesPerSample=32;assert.throws(()=>adapter.requestDevice(),/Adapter/);hook.restore();assert.equal(prototype.requestDevice,native);
});

test('full-precision world observations validate every covered source index without quantizing XYZ',()=>{
 const extent={width:4,height:1},values=new Float32Array([1.0000001192092896,-0,7,1,4,5,6,-1,9,9,9,0,0,0,0,0]),probe={...extent,channels:4,encoding:'rgba32float raw words',pixels:new Uint32Array(values.buffer)},depth={...extent,channels:1,encoding:'depth32float raw words',pixels:new Uint32Array(new Float32Array([.7,.8,.9,1]).buffer)};
 const first=worldInputIndexAgreement(probe,depth,2,new Uint32Array([0,1]));assert.equal(first.checkedChannels,12);assert.equal(first.invalidIndexPixels,0);assert.equal(first.nonInstancedPixels,1);assert.equal(probe.pixels[0],0x3f800001);assert.equal(probe.pixels[1],0x80000000);
 values[3]=.5;assert.equal(worldInputIndexAgreement(probe,depth,2,new Uint32Array([0,1])).invalidIndexPixels,1);values[3]=1;assert.equal(worldInputIndexAgreement(probe,depth,2,new Uint32Array([0])).invalidIndexPixels,1);
 values[0]=Infinity;assert.throws(()=>worldInputIndexAgreement(probe,depth,2,new Uint32Array([0,1])),/Non-finite/);assert.throws(()=>worldInputIndexAgreement({...probe,encoding:'rgba16float raw words'},depth,2,new Uint32Array([0,1])),/format/);
});

test('world probe uses the actual instanced source index and the regular sentinel',()=>{
 const output='out.normal=vec4<f32>(n*.5+.5,roughness);';assert.equal(lightingProbe(output,'world-input'),'out.normal=vec4<f32>(in.worldPos,-1.0);');assert.ok(lightingProbe('var<private> instance:PackedInstance;'+output,'world-input').includes('in.worldPos,f32(input.sourceIndex)'));
});

test('independent color check preserves full binary32 words and catches compute or copy disagreement',async()=>{
 const checker=Object.create(ColorReadbackCheck.prototype);Object.assign(checker,{width:1,height:1});
 const target={format:'rgba32float'},first={width:1,height:1,channels:4,encoding:'rgba32float raw words',pixels:new Uint32Array([0x80000000,0,0x3f800001,0xbf800001])};checker.readWords=async()=>first.pixels.slice();const reader={readColor:async()=>({...first,pixels:first.pixels.slice()})};
 assert.equal((await checker.check(target,first,reader)).compute.changedChannels,0);checker.readWords=async()=>new Uint32Array([0,0,0x3f800001,0xbf800001]);assert.equal((await checker.check(target,first,reader)).compute.changedChannels,1);
 reader.readColor=async()=>({...first,pixels:new Uint32Array(4)});assert.equal((await checker.check(target,first,reader)).repeatedCopy.changedChannels,3);
});
