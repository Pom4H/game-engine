import test from 'node:test';
import assert from 'node:assert/strict';
import {WebGPURenderer} from '../dist/render/webgpu.js';
import {Scene} from '../dist/scene/scene.js';
import {initializationDevice} from './helpers/render-initialization-device.mjs';
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('runtime post controls keep device/geometry targets and bind bloom-free radiance instead of a stale bloom',async t=>{
 const fixture=initializationDevice(t),renderer=await WebGPURenderer.create(fixture.canvas,{features:{motionBlur:true}});
 const oldRatio=globalThis.devicePixelRatio;globalThis.devicePixelRatio=1;t.after(()=>{if(oldRatio===undefined)delete globalThis.devicePixelRatio;else globalThis.devicePixelRatio=oldRatio;});
 renderer.setResolution(320,180);const targets=[...fixture.textures],count=targets.length;
 assert.equal(renderer.effectsBindNoBloom.entries.find(e=>e.binding===6).resource.texture,renderer.blackBloom);
 assert.notEqual(renderer.blackBloom,renderer.bloomA);assert.equal(renderer.presentBindDirect.entries[0].resource.texture,renderer.effectsHdr);
 assert.equal(renderer.motionBindDirect.entries[0].resource.texture,renderer.effectsHdr);assert.equal(renderer.motionBindA.entries[0].resource.texture,renderer.taaA);
 renderer.historyValid=true;renderer.previousVp=new Float32Array(16);assert.deepEqual(renderer.configurePostProcessing({temporalAA:false,bloom:false,motionBlur:.25}),{temporalAA:false,bloom:false,motionBlur:.25});assert.equal(renderer.historyValid,false);assert.equal(renderer.previousVp,null);
 assert.equal(fixture.textures.length,count,'toggling never rebuilds the device or textures');assert.ok(targets.every(t=>t.destroys===0));
 const before=renderer.inspect(false).postProcessing;assert.throws(()=>renderer.configurePostProcessing({motionBlur:NaN,bloom:true}),/motionBlur/);assert.deepEqual(renderer.inspect(false).postProcessing,before,'invalid options are atomic');
 renderer.configurePostProcessing({temporalAA:true,bloom:true,motionBlur:0});renderer.dispose();assert.ok(fixture.textures.every(t=>t.destroys===1),JSON.stringify(fixture.textures.filter(t=>t.destroys!==1).map(t=>({label:t.descriptor.label,destroys:t.destroys}))));
});

test('local reflections publish sharp faces, filtered mips and their capture origin in one completed sweep',async t=>{
 const ratio=globalThis.devicePixelRatio;globalThis.devicePixelRatio=1;t.after(()=>{if(ratio===undefined)delete globalThis.devicePixelRatio;else globalThis.devicePixelRatio=ratio;});
 const fixture=initializationDevice(t),passes=[],copies=[],frames=[],taaHistory=[];
 fixture.device.queue.writeBuffer=(buffer,_offset,data)=>{if(buffer===renderer.gpu.frame&&data.length>140)frames.push(data.slice());if(buffer===renderer.gpu.taaParams)taaHistory.push(data[0]);};
 fixture.device.queue.submit=()=>{};
 fixture.device.createCommandEncoder=()=>({
  beginRenderPass(descriptor){passes.push(descriptor);return{setPipeline(){},setBindGroup(){},draw(){},end(){}};},
  copyTextureToTexture(source,target,size){copies.push({source,target,size});},finish(){return{};},
 });
 const renderer=await WebGPURenderer.create(fixture.canvas,{features:{screenSpace:false,bloom:false,temporalAA:true,planarReflections:false}});
 renderer.setResolution(64,64);
 const scene=new Scene({version:1,entities:[{id:'anchor'}],rendering:{reflectionProbe:{entity:'anchor',facesPerFrame:4}}});
 renderer.render(scene);assert.equal(copies.length,0);assert.equal(renderer.inspect(false).reflectionProbe.complete,false);
 const capture=renderer.gpu.localProbeCapture,published=renderer.gpu.localProbeMap;
 assert.notEqual(capture,published);assert.ok(capture.descriptor.usage&1);assert.ok(published.descriptor.usage&2);
 assert.ok(passes.filter(pass=>/^render\.probe\.\d$/.test(pass.label)).every(pass=>pass.colorAttachments[0].view.texture===capture));
 assert.ok(renderer.gpu.probeFilterPasses.every(pass=>pass.bind.entries[0].resource.texture===capture&&pass.view.texture===published));
 scene.setVisualTransform('anchor',[2,0,0]);renderer.render(scene);
 assert.equal(copies.length,1);assert.equal(copies[0].source.texture,capture);assert.equal(copies[0].target.texture,published);assert.deepEqual(copies[0].size,[192,192,6]);
 assert.deepEqual(passes.filter(pass=>/^render\.probe\.\d$/.test(pass.label)).map(pass=>Number(pass.label.at(-1))),[0,1,2,3,4,5]);
 assert.equal(passes.filter(pass=>pass.label==='render.probe.filter').length,42);
 assert.deepEqual(renderer.inspect(false).reflectionProbe.position,[0,0,0]);assert.equal(frames.at(-1)[45],1);assert.equal(frames.at(-1)[140],0);
 scene.setVisualTransform('anchor',[3,0,0]);renderer.render(scene);assert.equal(copies.length,1);assert.equal(frames.at(-1)[140],0);
 scene.setVisualTransform('anchor',[4,0,0]);renderer.render(scene);assert.equal(copies.length,2);assert.equal(frames.at(-1)[140],3);
 assert.equal(taaHistory.at(-1),1);
 // A full six-face replacement after a teleport must reset history even when
 // both the preceding and replacement images are complete in their own frame.
 scene.spec.rendering.reflectionProbe.facesPerFrame=6;scene.setVisualTransform('anchor',[20,0,0]);renderer.render(scene);
 assert.equal(copies.length,3);assert.equal(frames.at(-1)[140],20);assert.equal(taaHistory.at(-1),0);
 renderer.dispose();assert.equal(capture.destroys,1);assert.equal(published.destroys,1);
});

test('appearance-only image replacements load on the next frame and release obsolete texture residency',async t=>{
 const ratio=globalThis.devicePixelRatio;globalThis.devicePixelRatio=1;t.after(()=>{if(ratio===undefined)delete globalThis.devicePixelRatio;else globalThis.devicePixelRatio=ratio;});
 const fixture=initializationDevice(t),loaded=new Map(),requests=[];
 fixture.device.queue.writeBuffer=()=>{};fixture.device.queue.submit=()=>{};
 fixture.device.createCommandEncoder=()=>({beginRenderPass(){return{setPipeline(){},setBindGroup(){},draw(){},end(){}};},copyTextureToTexture(){},finish(){return{};}});
 const renderer=await WebGPURenderer.create(fixture.canvas,{features:{screenSpace:false,bloom:false,temporalAA:false,planarReflections:false}});
 t.after(()=>renderer.dispose());renderer.setResolution(64,64);
 renderer.surfaceTextures={get:url=>loaded.get(url),retain:urls=>{for(const url of loaded.keys())if(!urls.has(url))loaded.delete(url);},load:url=>new Promise(resolve=>requests.push({url,resolve:()=>{loaded.set(url,{});resolve();}})),dispose(){},get size(){return loaded.size;}};
 const scene=new Scene({version:1,entities:[{id:'anchor'}]});renderer.render(scene);const structure=scene.renderStructureRevision;
 scene.patchAppearance({materials:[{id:'anchor',set:{texture:{url:'/first.png',sizeM:1}}}]});renderer.render(scene);renderer.render(scene);
 assert.equal(scene.renderStructureRevision,structure);assert.deepEqual(requests.map(r=>r.url),['/first.png']);
 requests[0].resolve();await settle();assert.equal(loaded.size,1);
 scene.patchAppearance({materials:[{id:'anchor',set:{texture:{url:'/second.png',sizeM:1}}}]});renderer.render(scene);
 assert.equal(loaded.has('/first.png'),false);assert.deepEqual(requests.map(r=>r.url),['/first.png','/second.png']);
 requests[1].resolve();await settle();renderer.render(scene);assert.equal(loaded.size,1);assert.equal(requests.length,2);
});

test('appearance edits refresh only changed materials and retain unrelated physical surface uploads',async t=>{
 const ratio=globalThis.devicePixelRatio;globalThis.devicePixelRatio=1;t.after(()=>{if(ratio===undefined)delete globalThis.devicePixelRatio;else globalThis.devicePixelRatio=ratio;});
 const fixture=initializationDevice(t),buffers=[],textures=[],history=[];
 fixture.device.queue.writeBuffer=(buffer,_offset,data)=>{buffers.push(buffer);if(buffer===renderer.gpu.taaParams)history.push(data[0]);};
 fixture.device.queue.writeTexture=(destination)=>textures.push(destination.texture);fixture.device.queue.submit=()=>{};
 fixture.device.createCommandEncoder=()=>({beginRenderPass(){return{setPipeline(){},setBindGroup(){},setVertexBuffer(){},setIndexBuffer(){},draw(){},drawIndexed(){},end(){}};},copyTextureToTexture(){},finish(){return{};}});
 const renderer=await WebGPURenderer.create(fixture.canvas,{features:{screenSpace:false,bloom:false,temporalAA:true,planarReflections:false}});
 t.after(()=>renderer.dispose());renderer.setResolution(64,64);
 const scene=new Scene({version:1,entities:[
  {id:'patched',mesh:{kind:'box'},position:[-1,1,0]},
  {id:'unrelated',mesh:{kind:'box'},position:[1,1,0]},
  {id:'surface',mesh:{kind:'plane',size:[4,4]},environmental:{surfaceUse:'generic',fieldCellSizeM:1}},
 ]});
 renderer.render(scene);renderer.render(scene);
 const patched=renderer.objects.get('patched'),unrelated=renderer.objects.get('unrelated'),surface=renderer.objects.get('surface'),surfaceRevision=surface.lastSurfaceRevision;
 assert.ok(patched&&unrelated&&surface);assert.equal(surfaceRevision,scene.surfaces.field('surface').revision);
 const clear=()=>{buffers.length=0;textures.length=0;history.length=0;};
 clear();scene.patchAppearance({rendering:{exposure:1.1,fogDensity:.003}});renderer.render(scene);
 assert.equal(buffers.includes(patched.uniform),false);assert.equal(buffers.includes(unrelated.uniform),false);assert.deepEqual(textures,[]);assert.equal(surface.lastSurfaceRevision,surfaceRevision);assert.equal(history.at(-1),0);
 clear();scene.patchAppearance({materials:[{id:'patched',set:{roughness:.17,color:[.7,.2,.3,1]}}]});renderer.render(scene);
 assert.equal(buffers.filter(buffer=>buffer===patched.uniform).length,1);assert.equal(buffers.includes(unrelated.uniform),false);
 assert.deepEqual(textures,new Array(9).fill(renderer.gpu.environmentMap),'the changed material refreshes distant radiance; unrelated physical textures retain their authority revision');assert.equal(surface.lastSurfaceRevision,surfaceRevision);assert.equal(history.at(-1),0);
 clear();renderer.render(scene);
 assert.equal(buffers.includes(patched.uniform),false);assert.equal(buffers.includes(unrelated.uniform),false);assert.deepEqual(textures,[]);assert.equal(history.at(-1),1);
});

test('offscreen A to B to A material reloads rebind current image and label generations before drawing',async t=>{
 const ratio=globalThis.devicePixelRatio;globalThis.devicePixelRatio=1;t.after(()=>{if(ratio===undefined)delete globalThis.devicePixelRatio;else globalThis.devicePixelRatio=ratio;});
 const fixture=initializationDevice(t),loaded=new Map();
 fixture.device.queue.writeBuffer=()=>{};fixture.device.queue.submit=()=>{};
 fixture.device.createCommandEncoder=()=>({beginRenderPass(){return{setPipeline(){},setBindGroup(_index,bind){for(const entry of bind.entries??[])if(entry.resource.texture)assert.equal(entry.resource.texture.destroys,0,'a draw cannot bind an evicted image or label');},setVertexBuffer(){},setIndexBuffer(){},draw(){},drawIndexed(){},end(){}};},copyTextureToTexture(){},finish(){return{};}});
 const renderer=await WebGPURenderer.create(fixture.canvas,{features:{screenSpace:false,bloom:false,temporalAA:false,planarReflections:false}});
 t.after(()=>renderer.dispose());renderer.setResolution(64,64);
 const texture=label=>fixture.device.createTexture({label,size:[2,2],format:'rgba8unorm',usage:0x04});
 renderer.surfaceTextures={get:url=>loaded.get(url),retain:urls=>{for(const [url,image]of loaded)if(!urls.has(url)){image.destroy();loaded.delete(url);}},async load(url){if(!loaded.has(url))loaded.set(url,texture(url));},dispose(){for(const image of loaded.values())image.destroy();loaded.clear();},get size(){return loaded.size;}};
 // Keep the production label cache/collection lifetime; only canvas lettering
 // is replaced with a deterministic fake image for this renderer regression.
 renderer.label=(text,color)=>{if(!text)return renderer.gpu.emptyLabel;const key=JSON.stringify([text,color??[226/255,217/255,188/255]]);let image=renderer.labels.get(key);if(!image){image=texture(text);renderer.labels.set(key,image);}return image;};
 const material=generation=>({label:generation,texture:{url:`/${generation}-color.png`,normalUrl:`/${generation}-normal.png`,ormUrl:`/${generation}-orm.png`,heightUrl:`/${generation}-height.png`,sizeM:1,heightScaleM:.02}});
 const scene=new Scene({version:1,entities:[{id:'panel',position:[0,1,0],mesh:{kind:'box'},renderOnly:true,material:material('A')}]});
 await renderer.prepareMaterials(scene);renderer.render(scene);const first=renderer.objects.get('panel'),oldImages=[first.materialTexture,first.normalTexture,first.ormTexture,first.heightTexture],oldLabel=first.labelTexture;
 scene.setVisualTransform('panel',[10000,1,10000]);scene.patchAppearance({materials:[{id:'panel',set:material('B')}]});scene.add({id:'collection-trigger'});renderer.render(scene);await settle();
 assert.equal(renderer.objects.get('panel'),first,'an object outside every view retains its old binding until needed');assert.ok(oldImages.every(image=>image.destroys===1));assert.equal(first.labelTexture,oldLabel);assert.equal(renderer.labelUsers.get(oldLabel),1);assert.equal(oldLabel.destroys,0,'a still-bound offscreen glyph retains its object owner');
 scene.patchAppearance({materials:[{id:'panel',set:material('A')}]});renderer.render(scene);await settle();
 assert.equal(renderer.objects.get('panel'),first);scene.setVisualTransform('panel',[0,1,0]);renderer.render(scene);
 const current=renderer.objects.get('panel');assert.notEqual(current,first);assert.equal(current.labelTexture,oldLabel,'A to B to A reuses the glyph retained by its offscreen binding');assert.equal(renderer.labelUsers.get(oldLabel),1);assert.equal(current.labelTexture.destroys,0);
 for(const [property,binding,url]of [['materialTexture',4,'/A-color.png'],['normalTexture',6,'/A-normal.png'],['ormTexture',7,'/A-orm.png'],['heightTexture',9,'/A-height.png']]){
  assert.equal(current[property],loaded.get(url));assert.equal(current.bind.entries.find(entry=>entry.binding===binding).resource.texture,loaded.get(url));
  // URL, material identity and pose can all stay unchanged while residency
  // supplies a new physical image. The preparation check must still observe it.
  const previous=renderer.objects.get('panel');loaded.get(url).destroy();loaded.set(url,texture(url));renderer.render(scene);assert.notEqual(renderer.objects.get('panel'),previous);assert.equal(renderer.objects.get('panel')[property],loaded.get(url));
 }
 const previous=renderer.objects.get('panel');previous.labelTexture.destroy();renderer.labels.delete(previous.label);renderer.render(scene);const replacement=renderer.objects.get('panel');assert.notEqual(replacement,previous);assert.equal(previous.labelTexture.destroys,1,'releasing an already evicted generation must not destroy it twice');assert.equal(replacement.labelTexture.destroys,0);assert.equal(renderer.labelUsers.has(previous.labelTexture),false);assert.equal(renderer.labelUsers.get(replacement.labelTexture),1);
 scene.remove('panel');renderer.collect(scene);assert.equal(replacement.labelTexture.destroys,1);assert.equal(oldLabel.destroys,1);assert.equal(renderer.labelUsers.size,0);assert.equal(renderer.labels.size,0);
});

test('all quality combinations route production textures correctly and release each resize generation once',async t=>{
 const ratio=globalThis.devicePixelRatio;globalThis.devicePixelRatio=1;t.after(()=>{if(ratio===undefined)delete globalThis.devicePixelRatio;else globalThis.devicePixelRatio=ratio;});
 const fixture=initializationDevice(t);
 for(let bits=0;bits<32;bits++){
  const features={screenSpace:!!(bits&1),bloom:!!(bits&2),temporalAA:!!(bits&4),planarReflections:!!(bits&8),motionBlur:!!(bits&16)},start=fixture.textures.length;
  const renderer=await WebGPURenderer.create(fixture.canvas,{features});renderer.setResolution(320,180);
  assert.deepEqual(renderer.inspect(false).pipeline.features,features);
  const effects=features.screenSpace||features.bloom;
  assert.equal(!!renderer.normal,features.screenSpace);assert.equal(!!renderer.specular,features.screenSpace);assert.equal(!!renderer.velocity,features.temporalAA||features.motionBlur);
  const materialPipeline=fixture.pipelines.findLast(p=>p.label==='material 2 opaque back');
  assert.deepEqual(materialPipeline.fragment.targets.map(target=>target?.format??null),['rgba16float',features.screenSpace?'rgba16float':null,features.screenSpace?'rgba8unorm':null,features.temporalAA||features.motionBlur?'rg16float':null]);
  assert.equal(!!renderer.effectsHdr,effects);assert.equal(!!renderer.taaA,features.temporalAA);assert.equal(!!renderer.taaB,features.temporalAA);assert.equal(!!renderer.bloomB,features.bloom);assert.equal(!!renderer.reflectionDepth,features.planarReflections);
  if(features.temporalAA)assert.equal(renderer.taaBindAB.entries.find(e=>e.binding===0).resource.texture,effects?renderer.effectsHdr:renderer.hdr);
  else assert.equal(renderer.presentBindDirect.entries.find(e=>e.binding===0).resource.texture,effects?renderer.effectsHdr:renderer.hdr);
  if(effects&&!features.bloom)assert.deepEqual(renderer.bloomA.descriptor.size,[1,1]);
  const old=[renderer.hdr,renderer.effectsHdr,renderer.taaA,renderer.taaB,renderer.reflection,renderer.reflectionDepth,renderer.bloomA,renderer.bloomB].filter(Boolean);
  renderer.setResolution(640,360);assert.ok(old.every(texture=>texture.destroys===1));renderer.dispose();renderer.dispose();
  assert.ok(fixture.textures.slice(start).every(texture=>texture.destroys===1));
 }
});

test('renderer initializes when reflection specialization constants are rejected',async t=>{
 const fixture=initializationDevice(t);
 const renderer=await WebGPURenderer.create(fixture.canvas);
 assert.deepEqual(renderer.inspect().errors,[]);
 assert.equal(fixture.scopes.length,0);assert.equal(fixture.destroyed,0);
 assert.ok(fixture.pipelines.some(p=>p.label.startsWith('material')&&p.fragment.constants));
 assert.equal(renderer.gpu.frame.size,736);
 assert.equal(renderer.gpu.taaParams.size,32,'TAA needs current and previous jitter beside history validity');
 assert.equal(fixture.pipelines.filter(p=>p.vertex.entryPoint==='vsInstanced').length,22);
 assert.equal(fixture.pipelines.filter(p=>p.vertex.entryPoint==='shadowVSInstanced').length,2);
});

test('logarithmic camera depth is opt-in and covers material, instanced, relief, reflection and snowfall pipelines',async t=>{
 const fixture=initializationDevice(t),ordinary=await WebGPURenderer.create(fixture.canvas);
 assert.deepEqual(ordinary.inspect(false).cameraDepth,{encoding:'perspective',near:.05,far:10000,logarithmicDenominator:0});
 const material=fixture.pipelines.find(p=>p.label.startsWith('material')&&p.vertex.entryPoint==='vs');
 assert.doesNotMatch(material.fragment.module.code,/struct GOut\{@builtin\(frag_depth\)/,'ordinary materials retain their early depth path');
 ordinary.dispose();const start=fixture.pipelines.length;
 const renderer=await WebGPURenderer.create(fixture.canvas,{logarithmicDepthFar:2000,visibility:'gpu',features:{motionBlur:true}});
 assert.equal(renderer.inspect(false).cameraDepth.far,2000);assert.equal(renderer.inspect(false).cameraDepth.encoding,'logarithmic');
 assert.equal(renderer.gpu.frame.size,736);assert.equal(renderer.gpu.motionParams.size,48);assert.equal(renderer.gpu.taaParams.size,32);
 const pipelines=fixture.pipelines.slice(start),camera=pipelines.filter(p=>/^(material |surface relief |coating overlay |reflection |glass$|snow$)/.test(p.label)&&p.fragment);
 assert.ok(camera.length>20);
 for(const p of camera){
  assert.match(p.fragment.module.code,/@builtin\(frag_depth\) depth:f32/,p.label);
  assert.match(p.fragment.module.code,/out\.depth=logarithmicCameraDepth\(/,p.label);
  assert.equal(p.depthStencil.depthCompare,'less');
 }
 for(const group of ['material ','surface relief ','coating overlay ','reflection ','glass','snow'])assert.ok(camera.some(p=>p.label.startsWith(group)),group);
 for(const p of pipelines.filter(p=>/^probe (back|none)$/.test(p.label)))assert.doesNotMatch(p.fragment.module.code,/@builtin\(frag_depth\)/,'local probes keep their independent perspective depth');
 const shared=pipelines.find(p=>p.label.startsWith('reflection instances'));assert.ok(shared);
 assert.match(shared.vertex.module.code,/@location\(3\) @interpolate\(flat\) sourceIndex:u32/);
 assert.match(shared.vertex.module.code,/@location\(6\) cameraDepth:f32/,'depth does not collide with the reflected instance index');
 const instanced=pipelines.find(p=>p.label.startsWith('material instances'));assert.ok(instanced);
 assert.match(instanced.vertex.module.code,/@location\(9\) @interpolate\(flat\) sourceIndex:u32/);
 assert.match(instanced.vertex.module.code,/@location\(11\) cameraDepth:f32/,'depth does not collide with the material instance index');
 renderer.dispose();
});

test('invalid logarithmic depth ranges are rejected before GPU allocation',async()=>{
 for(const far of [0,-1,.05,NaN,Infinity])await assert.rejects(WebGPURenderer.create({}, {logarithmicDepthFar:far}),/logarithmicDepthFar/);
});

test('temporal resets discard both jitter and camera history',()=>{
 const renderer=Object.create(WebGPURenderer.prototype);
 Object.assign(renderer,{historyValid:true,previousVp:new Float32Array(16),previousJitter:[.25/1920,-.125/1080],previousCamera:[1,2,3],previousTarget:[0,0,0],previousModels:new Map([['box',new Float32Array(16)]])});
 renderer.resetTemporalHistory();
 assert.equal(renderer.historyValid,false);assert.equal(renderer.previousVp,null);assert.equal(renderer.previousJitter,null);
 assert.equal(renderer.previousCamera,null);assert.equal(renderer.previousTarget,null);assert.equal(renderer.previousModels.size,0);
});

test('instanced reflection pipelines retain the one-target LOD pass and no unused specialization',async t=>{
 const fixture=initializationDevice(t),renderer=await WebGPURenderer.create(fixture.canvas,{visibility:'gpu',profiling:false});
 assert.deepEqual(renderer.inspect(false).errors,[]);
 const reflections=fixture.pipelines.filter(p=>p.label.startsWith('reflection instances'));
 assert.equal(reflections.length,2);
 for(const pipeline of reflections){assert.equal(pipeline.vertex.entryPoint,'reflectionVS');assert.equal(pipeline.fragment.constants,undefined);assert.deepEqual(pipeline.fragment.targets,[{format:'rgba16float'}]);assert.equal(pipeline.depthStencil.depthCompare,'less');}
 const source=fixture.pipelines.find(p=>p.label==='material instances 2 back').vertex.module.code;
 const varyings=source.match(/struct VOut \{([\s\S]*?)\}/)[1],locations=[...varyings.matchAll(/@location\((\d+)\)/g)].map(match=>Number(match[1]));
 assert.equal(new Set(locations).size,locations.length,'instance index, tint and seed need separate shader locations');
 assert.match(source,/out\.tint=instance\.color/);
 assert.match(source,/instanceSource\[input\.sourceIndex\]/);
});

test('pipeline initialization reports its original failure and releases the failed device',async t=>{
 const fixture=initializationDevice(t,'glass');
 await assert.rejects(WebGPURenderer.create(fixture.canvas),/WebGPU initialization: glass: Fragment library could not be created/);
 assert.equal(fixture.destroyed,1);assert.equal(fixture.scopes.length,0);
});

test('reflection pixel probes use the actual 62.5 percent texture extent',async()=>{
 const copies=[],texture={width:1200,height:675},renderer=Object.create(WebGPURenderer.prototype);
 Object.assign(renderer,{depthW:1920,depthH:1080,reflection:texture,device:{
  createBuffer:({size})=>({async mapAsync(){},getMappedRange(){return new ArrayBuffer(size);},unmap(){},destroy(){}}),
  createCommandEncoder:()=>({copyTextureToBuffer:(source)=>copies.push(source),finish:()=>({})}),queue:{submit(){}}
 }});
 await renderer.sampleLinearPixels([[960,540],[1919,1079]],'reflection');
 assert.deepEqual(copies.map(copy=>copy.origin),[[600,337,0],[1199,674,0]]);assert.ok(copies.every(copy=>copy.texture===texture));
});

test('half-resolution bloom targets and bind groups resize together and release all generations exactly once',t=>{
 const previous=globalThis.devicePixelRatio;globalThis.devicePixelRatio=1;t.after(()=>{if(previous===undefined)delete globalThis.devicePixelRatio;else globalThis.devicePixelRatio=previous;});
 const resources=[],resource=(descriptor={})=>{const result={descriptor,destroys:0,createView(){return{texture:this};},destroy(){this.destroys++;}};resources.push(result);return result;};
 const renderer=Object.create(WebGPURenderer.prototype);Object.assign(renderer,{
  canvas:{clientWidth:320,clientHeight:180,width:0,height:0},depthW:0,depthH:0,materialLoads:new Map(),failedMaterials:new Set(),objects:new Map(),meshes:new Map(),instanceBatches:new Map(),shadowBatches:new Map(),labels:new Map(),surfaceTextures:{dispose(){}},
  device:{createTexture:resource,createBindGroup:descriptor=>descriptor},gpu:{lightLayout:{},bloomLayout:{},comparison:{},sampler:{},blit:{getBindGroupLayout(){return{};}},effects:{getBindGroupLayout(){return{};}},taa:{getBindGroupLayout(){return{};}},taaParams:resource(),present:{getBindGroupLayout(){return{};}},noiseVolume:resource(),noiseSampler:{},shadow:resource(),dynamicShadow:resource(),spotShadowMap:resource(),spotShadowParams:resource(),spotFrames:[],environmentView:{},localProbeView:{},probeFrames:[],probeFilterPasses:[],frame:resource(),lightBuffer:resource(),cellBuffer:resource(),snowUniform:resource(),emptyField:resource(),emptyLabel:resource()},
 });
 const before=resources.length;renderer.resize();const first=resources.slice(before);assert.equal(first.length,14);assert.deepEqual(renderer.bloomA.descriptor.size,[160,90]);assert.deepEqual(renderer.bloomB.descriptor.size,[160,90]);
 assert.equal(renderer.effectsBind.entries.find(e=>e.binding===6).resource.texture,renderer.bloomA);assert.equal(renderer.taaBindAB.entries.find(e=>e.binding===0).resource.texture,renderer.effectsHdr);assert.equal(renderer.taaBindBA.entries.find(e=>e.binding===0).resource.texture,renderer.effectsHdr);assert.equal(renderer.taaBindAB.entries.find(e=>e.binding===1).resource.texture,renderer.taaA);assert.equal(renderer.taaBindBA.entries.find(e=>e.binding===1).resource.texture,renderer.taaB);assert.equal(renderer.presentBindA.entries.find(e=>e.binding===0).resource.texture,renderer.taaA);assert.equal(renderer.presentBindB.entries.find(e=>e.binding===0).resource.texture,renderer.taaB);assert.equal(renderer.bloomHorizontalBind.entries[0].resource.texture,renderer.bloomA);assert.equal(renderer.bloomVerticalBind.entries[0].resource.texture,renderer.bloomB);
 renderer.resize();assert.equal(resources.length,before+14);assert.ok(first.every(r=>r.destroys===0));
 renderer.canvas.clientWidth=640;renderer.canvas.clientHeight=360;renderer.resize();assert.ok(first.every(r=>r.destroys===1));assert.deepEqual(renderer.bloomA.descriptor.size,[320,180]);assert.equal(renderer.effectsBind.entries.find(e=>e.binding===6).resource.texture,renderer.bloomA);assert.equal(renderer.presentBindA.entries.find(e=>e.binding===0).resource.texture,renderer.taaA);assert.equal(renderer.presentBindB.entries.find(e=>e.binding===0).resource.texture,renderer.taaB);
 renderer.dispose();renderer.dispose();assert.ok(resources.every(r=>r.destroys===1));
});

test('newly spawned image materials enqueue once, report failures once and do not render on completion',async()=>{
 const renderer=Object.create(WebGPURenderer.prototype),loaded=new Map(),requests=[];
 Object.assign(renderer,{materialLoads:new Map(),failedMaterials:new Set(),errors:[],disposed:false,surfaceTextures:{get:url=>loaded.get(url),load:url=>new Promise((resolve,reject)=>requests.push({url,resolve:()=>{loaded.set(url,{});resolve();},reject}))},render(){throw new Error('Async loading must not recursively render');}});
 const scene={entities:new Map([['initial',{material:{texture:{url:'/initial.png'}}}]])};renderer.lastScene=scene;renderer.queueMaterialLoads(scene);renderer.queueMaterialLoads(scene);assert.equal(requests.length,1);requests[0].resolve();await settle();renderer.queueMaterialLoads(scene);assert.equal(requests.length,1);
 scene.entities.set('spawned',{material:{texture:{url:'/spawned.png'}}});renderer.queueMaterialLoads(scene);renderer.queueMaterialLoads(scene);assert.equal(requests.length,2);requests[1].resolve();await settle();assert.ok(loaded.has('/spawned.png'));assert.equal(renderer.materialLoads.size,0);
 scene.entities.set('bad',{material:{texture:{url:'/missing.png'}}});renderer.queueMaterialLoads(scene);requests[2].reject(new Error('HTTP 404'));await settle();for(let i=0;i<5;i++)renderer.queueMaterialLoads(scene);assert.equal(requests.length,3);assert.deepEqual(renderer.errors,['HTTP 404']);
 scene.entities.delete('bad');renderer.queueMaterialLoads(scene);assert.equal(renderer.failedMaterials.has('/missing.png'),false);
 scene.entities.set('late',{material:{texture:{url:'/late.png'}}});renderer.queueMaterialLoads(scene);renderer.disposed=true;requests[3].reject(new Error('Disposed request'));await settle();renderer.queueMaterialLoads(scene);assert.deepEqual(renderer.errors,['HTTP 404']);assert.equal(requests.length,4);
});
