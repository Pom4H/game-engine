import test from 'node:test';
import assert from 'node:assert/strict';
import {WebGPURenderer} from '../dist/render/webgpu.js';
import {Scene} from '../dist/scene/scene.js';
import {initializationDevice} from './helpers/render-initialization-device.mjs';
import {STATIC_SHADOW_SAMPLES,DYNAMIC_SHADOW_SAMPLES} from '../dist/render/shadow-filter.js';

test('near shadows render and receive the same independent matrix without another texture or pass',async t=>{
 const ratio=globalThis.devicePixelRatio;globalThis.devicePixelRatio=1;t.after(()=>{if(ratio===undefined)delete globalThis.devicePixelRatio;else globalThis.devicePixelRatio=ratio;});
 const fixture=initializationDevice(t),passes=[],writes=new Map();let renderer;
 fixture.device.queue.writeBuffer=(buffer,offset,data)=>{if(offset===0)writes.set(buffer,data.slice());};fixture.device.queue.submit=()=>{};
 fixture.device.createCommandEncoder=()=>({beginRenderPass(descriptor){
  const pass={label:descriptor.label,binds:new Map(),setPipeline(){},setBindGroup(index,bind){this.binds.set(index,bind);},setVertexBuffer(){},setIndexBuffer(){},draw(){},drawIndexed(){},end(){}};
  passes.push(pass);return pass;
 },copyTextureToTexture(){},finish(){return{};}});
 renderer=await WebGPURenderer.create(fixture.canvas,{features:{screenSpace:false,bloom:false,temporalAA:false,planarReflections:false}});
 t.after(()=>renderer.dispose());renderer.setResolution(64,64);
 const scene=new Scene({version:1,camera:{position:[0,10,6],target:[0,9,0]},rendering:{sunIntensity:3,shadowExtent:140},entities:[
  {id:'wall',mesh:{kind:'box'},position:[0,9,-4]},
  {id:'moving',mesh:{kind:'box'},position:[0,9,0],body:{mass:1}},
 ]});
 const textureCount=fixture.textures.length;renderer.render(scene);
 const frame=writes.get(renderer.gpu.frame),dynamic=writes.get(renderer.gpu.dynamicFrame);
 assert.deepEqual([...dynamic.slice(0,16)],[...frame.slice(184,200)]);
 assert.notDeepEqual([...dynamic.slice(0,16)],[...frame.slice(0,16)]);
 assert.equal(passes.find(p=>p.label==='render.shadow.dynamic').binds.get(1),renderer.gpu.dynamicFrameBind);
 assert.equal(passes.find(p=>p.label==='render.shadow.static').binds.get(1),renderer.gpu.frameBind);
 assert.deepEqual(renderer.gpu.shadow.descriptor.size,[2048,2048]);assert.deepEqual(renderer.gpu.dynamicShadow.descriptor.size,[1024,1024]);
 assert.equal(STATIC_SHADOW_SAMPLES+DYNAMIC_SHADOW_SAMPLES,8);
 passes.length=0;scene.camera.position[0]+=.001;renderer.render(scene);
 assert.equal(fixture.textures.length,textureCount);assert.deepEqual(passes.filter(p=>p.label.startsWith('render.shadow.')).map(p=>p.label),['render.shadow.dynamic']);
 let destroys=0;renderer.gpu.dynamicFrame.destroy=()=>destroys++;renderer.dispose();renderer.dispose();assert.equal(destroys,1);
});
