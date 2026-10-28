import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene} from '../dist/scene/scene.js';
import {WebGPURenderer} from '../dist/render/webgpu.js';
import {initializationDevice} from './helpers/render-initialization-device.mjs';

const LABEL_BYTES=1024*128*4;
async function fixture(t){
 const previous=Object.getOwnPropertyDescriptor(globalThis,'document'),painted=[];
 Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>({getContext:()=>({clearRect(){},fillText(text){painted.push({text,color:this.fillStyle});}})})}});
 t.after(()=>{if(previous)Object.defineProperty(globalThis,'document',previous);else delete globalThis.document;});
 const env=initializationDevice(t),renderer=await WebGPURenderer.create(env.canvas),buffers=[];
 const createBuffer=env.device.createBuffer;env.device.createBuffer=descriptor=>{const buffer=createBuffer(descriptor);buffer.destroys=0;buffer.destroy=()=>buffer.destroys++;buffers.push(buffer);return buffer;};
 env.device.queue.copyExternalImageToTexture=()=>{};
 const scene=new Scene({version:1,entities:[{id:'sign',mesh:{kind:'box'},material:{label:'original'}}]});renderer.collect(scene);
 const bind=(id='sign',width=0,height=0)=>{const entity=scene.entities.get(id);return renderer.object(id,width,height,entity.material.label??'',entity.material.texture,entity.material.labelColor);};
 const labels=()=>env.textures.filter(texture=>texture.descriptor.size[0]===1024&&texture.descriptor.size[1]===128&&texture.format==='rgba8unorm');
 const retainedBytes=()=>labels().filter(texture=>texture.destroys===0).length*LABEL_BYTES;
 t.after(()=>renderer.dispose());
 return {env,renderer,scene,bind,labels,retainedBytes,painted,buffers};
}

test('appearance-only label changes retain exactly one live glyph allocation per bound object',async t=>{
 const f=await fixture(t),structure=f.scene.renderStructureRevision;let last,peakRetainedBytes=0;
 for(let index=0;index<48;index++){
  f.scene.patchAppearance({materials:[{id:'sign',set:{label:'live label '+index}}]});
  assert.equal(f.scene.renderStructureRevision,structure);assert.equal(f.renderer.collect(f.scene),false);
  last=f.bind();peakRetainedBytes=Math.max(peakRetainedBytes,f.retainedBytes());assert.equal(last.bind.entries.find(entry=>entry.binding===2).resource.texture,last.labelTexture);
 }
 assert.equal(f.labels().length,48,'every unique appearance was actually rasterized');
 assert.equal(f.retainedBytes(),LABEL_BYTES,'old unreferenced 512 KiB glyphs must be released without a structural scene edit');
 assert.equal(peakRetainedBytes,LABEL_BYTES,'retained glyph bytes remain bounded after every committed binding');
 assert.equal(f.renderer.labels.size,1);assert.equal(last.labelTexture.destroys,0);
 for(const texture of f.labels().slice(0,-1))assert.equal(texture.destroys,1);
});

test('shared glyph survives optical and field-size rebindings until its last object changes',async t=>{
 const f=await fixture(t);f.scene.add({id:'second',mesh:{kind:'box'},material:{label:'original'}});f.renderer.collect(f.scene);
 const first=f.bind(),second=f.bind('second'),shared=first.labelTexture;
 assert.equal(second.labelTexture,shared);assert.equal(f.renderer.labelUsers.get(shared),2);
 const larger=f.bind('sign',4,3);assert.equal(larger.labelTexture,shared);assert.equal(shared.destroys,0);assert.equal(first.uniform.destroys,1);assert.equal(f.renderer.labelUsers.get(shared),2);
 const resized=f.bind('sign',8,6);assert.equal(resized.labelTexture,shared);assert.equal(shared.destroys,0);assert.equal(larger.texture.destroys,1);assert.equal(larger.deformationTexture.destroys,1);
 f.scene.patchAppearance({materials:[{id:'sign',set:{label:'changed',labelColor:[.1,.2,.3]}}]});assert.equal(f.renderer.collect(f.scene),false);const changed=f.bind();
 assert.notEqual(changed.labelTexture,shared);assert.equal(shared.destroys,0);assert.equal(f.renderer.labelUsers.get(shared),1);assert.equal(f.retainedBytes(),2*LABEL_BYTES);
 assert.equal(f.bind('second'),second,'unchanged binding remains resident');
 f.scene.patchAppearance({materials:[{id:'second',set:{label:'changed',labelColor:[.1,.2,.3]}}]});f.bind('second');
 assert.equal(shared.destroys,1);assert.equal(f.renderer.labelUsers.has(shared),false);assert.equal(f.retainedBytes(),LABEL_BYTES);assert.equal(f.renderer.labels.size,1);
 assert.deepEqual(f.painted,[{text:'original',color:'#e2d9bc'},{text:'changed',color:'rgb(26,51,77)'}]);
});

test('structural offscreen replacement keeps the old bound glyph alive until its binding is replaced',async t=>{
 const f=await fixture(t),old=f.bind(),texture=old.labelTexture;
 f.scene.remove('sign');f.scene.add({id:'sign',mesh:{kind:'sphere'},position:[10000,0,0],material:{label:'new generation'}});
 assert.equal(f.renderer.collect(f.scene),true);assert.equal(f.renderer.objects.get('sign'),old);assert.equal(texture.destroys,0,'offscreen GPU binding still owns the old texture');
 assert.equal(f.renderer.labels.get(old.label),texture);const next=f.bind();assert.notEqual(next.labelTexture,texture);assert.equal(texture.destroys,1);assert.equal(next.labelTexture.destroys,0);
 f.scene.remove('sign');f.renderer.collect(f.scene);assert.equal(next.labelTexture.destroys,1);assert.equal(f.retainedBytes(),0);assert.equal(f.renderer.labelUsers.size,0);
});

test('same-key texture generation replacement never destroys the new glyph or destroys the old one twice',async t=>{
 const f=await fixture(t),old=f.bind(),texture=old.labelTexture;
 // Exercise the existing residency invalidation contract: a cached image can
 // already have been evicted before an offscreen object's next preparation.
 texture.destroy();f.renderer.labels.delete(old.label);
 const next=f.bind();assert.notEqual(next.labelTexture,texture);assert.equal(next.label,old.label);assert.equal(texture.destroys,1);assert.equal(next.labelTexture.destroys,0);assert.equal(f.renderer.labels.get(next.label),next.labelTexture);
 assert.equal(f.renderer.labelUsers.size,1);assert.equal(f.renderer.labelUsers.get(next.labelTexture),1);
 f.scene.remove('sign');f.renderer.collect(f.scene);assert.equal(texture.destroys,1);assert.equal(next.labelTexture.destroys,1);assert.equal(f.renderer.labels.size,0);
});

test('failed new object allocation releases only new resources and preserves the previous committed binding',async t=>{
 const f=await fixture(t),old=f.bind('sign',4,3),oldLabel=old.labelTexture,createBindGroup=f.env.device.createBindGroup,createTexture=f.env.device.createTexture,createBuffer=f.env.device.createBuffer;
 for(const phase of ['uniform','deformation','bind']){
  const failure=Error('synthetic '+phase+' allocation failure'),beforeTextures=f.env.textures.length,beforeBuffers=f.buffers.length;let fields=0;
  f.scene.patchAppearance({materials:[{id:'sign',set:{label:'failed '+phase}}]});
  f.env.device.createBuffer=descriptor=>{if(phase==='uniform')throw failure;return createBuffer(descriptor);};
  f.env.device.createTexture=descriptor=>{if(descriptor.format==='rgba32float'&&++fields===2&&phase==='deformation')throw failure;return createTexture(descriptor);};
  f.env.device.createBindGroup=descriptor=>{if(phase==='bind')throw failure;return createBindGroup(descriptor);};
  try{assert.throws(()=>f.bind('sign',8,6),error=>error===failure);}finally{f.env.device.createBuffer=createBuffer;f.env.device.createTexture=createTexture;f.env.device.createBindGroup=createBindGroup;}
  assert.equal(f.renderer.objects.get('sign'),old);assert.equal(old.uniform.destroys,0);assert.equal(old.texture.destroys,0);assert.equal(old.deformationTexture.destroys,0);assert.equal(oldLabel.destroys,0);assert.equal(f.renderer.labelUsers.get(oldLabel),1);
  for(const texture of f.env.textures.slice(beforeTextures))assert.equal(texture.destroys,1,'a failed new glyph/field must not remain resident');
  for(const buffer of f.buffers.slice(beforeBuffers))assert.equal(buffer.destroys,1);
  assert.equal(f.retainedBytes(),LABEL_BYTES);assert.equal(f.renderer.labels.size,1);
 }
 const next=f.bind('sign',8,6);assert.equal(oldLabel.destroys,1);assert.equal(old.uniform.destroys,1);assert.equal(old.texture.destroys,1);assert.equal(old.deformationTexture.destroys,1);assert.equal(next.labelTexture.destroys,0);
});

test('failed shared-label rebind and failed glyph upload preserve live users; empty fallback is disposed only by the renderer',async t=>{
 const f=await fixture(t),old=f.bind(),shared=old.labelTexture,createBindGroup=f.env.device.createBindGroup,copy=f.env.device.queue.copyExternalImageToTexture,failure=Error('synthetic bind/upload failure');
 f.env.device.createBindGroup=()=>{throw failure;};
 assert.throws(()=>f.bind('sign',2,2),error=>error===failure);f.env.device.createBindGroup=createBindGroup;
 assert.equal(shared.destroys,0);assert.equal(f.renderer.labelUsers.get(shared),1);assert.equal(f.renderer.objects.get('sign'),old);
 f.scene.patchAppearance({materials:[{id:'sign',set:{label:'failed upload'}}]});const textureCount=f.env.textures.length;
 f.env.device.queue.copyExternalImageToTexture=()=>{throw failure;};assert.throws(()=>f.bind(),error=>error===failure);f.env.device.queue.copyExternalImageToTexture=copy;
 assert.equal(f.env.textures.length,textureCount+1);assert.equal(f.env.textures.at(-1).destroys,1);assert.equal(f.renderer.labels.size,1);assert.equal(shared.destroys,0);
 f.scene.patchAppearance({materials:[{id:'sign',set:{label:''}}]});const empty=f.bind();assert.equal(empty.labelTexture,f.renderer.gpu.emptyLabel);assert.equal(shared.destroys,1);assert.equal(f.renderer.labelUsers.size,0);
 f.scene.remove('sign');f.renderer.collect(f.scene);assert.equal(empty.labelTexture.destroys,0);assert.equal(f.renderer.labels.size,0);
 f.renderer.dispose();f.renderer.dispose();assert.equal(empty.labelTexture.destroys,1);for(const texture of f.labels())assert.equal(texture.destroys,1);
});

test('disposing shared live labels destroys each cached glyph once and releases reference bookkeeping',async t=>{
 const f=await fixture(t);f.scene.add({id:'second',mesh:{kind:'box'},material:{label:'original'}});f.renderer.collect(f.scene);const a=f.bind(),b=f.bind('second');assert.equal(a.labelTexture,b.labelTexture);
 f.renderer.dispose();f.renderer.dispose();assert.equal(a.labelTexture.destroys,1);assert.equal(f.renderer.labels.size,0);assert.equal(f.renderer.labelUsers.size,0);
});
