import test from 'node:test';
import assert from 'node:assert/strict';
import {GpuVisibility,InstanceStream,INSTANCE_FLOATS,INSTANCE_BYTES,CURRENT_INSTANCE_FLOATS,instanceIntersectsClip} from '../dist/render/gpu-visibility.js';
import {meshBounds,intersectsClip} from '../dist/render/visibility.js';
import {compose,multiply4,perspective,lookAt} from '../dist/math.js';
import {WebGPURenderer} from '../dist/render/webgpu.js';
import {instancedMaterialShader,instancedReflectionShader,instancedShadowShader,ShadowInstanceIndices} from '../dist/render/instancing.js';
import {Scene} from '../dist/scene/scene.js';
import {RenderFrameCache} from '../dist/render/frame.js';

const bounds={center:[0,0,0],half:[.5,.5,.5]},identity=compose([0,0,0],[0,0,0],[1,1,1]);
test('current-only streams preserve attributes and culling at the compact stride without uploading history',()=>{
 const {device,writes,encoder}=deviceFixture(),stream=new InstanceStream(4,CURRENT_INSTANCE_FLOATS),buffer=device.createBuffer({size:4*96}),gpu=new GpuVisibility(device,CURRENT_INSTANCE_FLOATS),batch=gpu.createBatch(buffer,4),color=[.1,.2,.3,1],weather=[.2,.3,.4,2],moved=compose([10,0,0],[0,0,0],[1,1,1]);
 for(let n=0;n<4;n++)stream.set(n,n===2?moved:identity,identity,color,weather);
 assert.equal(stream.upload(device.queue,buffer,4),384);assert.equal(stream.data.length,96);assert.deepEqual([...new Float32Array(buffer.data).slice(16,24)],[...color,...weather].map(Math.fround));
 writes.length=0;stream.set(2,moved,moved,color,weather);assert.equal(stream.upload(device.queue,buffer,4),0);assert.equal(writes.length,0);
 const request={batch,count:4,indexCount:36,bounds,viewProjection:identity,instances:stream.data};assert.equal(gpu.encode(encoder,[request],'cpu-batched'),3);assert.deepEqual([...batch.cpuIndices.slice(0,3)],[0,1,3]);
 gpu.encode(encoder,[request],'gpu');assert.equal(new Uint32Array(batch.uniforms.data)[25],24);assert.throws(()=>new InstanceStream(4,32),/stride/);assert.throws(()=>new GpuVisibility(device,32),/stride/);
});

test('live compact batches consume only changed poses and rebuild safely after membership/material changes',()=>{
 const {device,writes}=deviceFixture(),scene=new Scene({version:1,entities:Array.from({length:8},(_,n)=>({id:'cube'+n,mesh:{kind:'box'},material:{kind:'steel'}}))}),gpu=new GpuVisibility(device,24),cache=new RenderFrameCache(),renderer=Object.create(WebGPURenderer.prototype),mesh={key:'box',bounds,triangles:12,count:36};
 Object.assign(renderer,{gpu:{visibility:gpu,instanceLayout:{}},device,lastScene:scene,cameraBatches:new Map(),cameraBatchMembers:new Set(),materialBatchKeys:new WeakMap(),instanceMetadata:new WeakMap(),previousModels:new Map(),profiler:{addUpload(){}},mesh(){return mesh;}});
 let lookups=0,frame;const modelFor=entity=>{lookups++;return frame.objectsById.get(entity.id).model;};
 const prepare=()=>{frame=cache.build(scene,scene.camera);return renderer.prepareCameraBatches([...scene.entities.values()],modelFor,cache.changedObjects());};
 const batch=prepare()[0];assert.equal(lookups,8);assert.equal(batch.buffer.size,batch.stream.capacity*96);writes.length=0;lookups=0;
 prepare();assert.equal(lookups,0);assert.equal(writes.length,0);
 scene.entities.get('cube3').position[0]=2;prepare();assert.equal(lookups,0);assert.deepEqual(writes.map(write=>[write.offset,write.bytes.length]),[[3*96,96]]);assert.equal(new Float32Array(batch.buffer.data)[3*24+12],2);
 writes.length=0;prepare();assert.equal(writes.length,0,'stopping motion does not upload a previous model without TAA');
 scene.patchAppearance({materials:[{id:'cube0',set:{roughness:.12}}]});prepare();assert.equal(batch.items.length,7);assert.equal(new Float32Array(batch.buffer.data)[2*24+12],2,'compacted slots receive the right source');
 scene.remove('cube3');scene.add({id:'cube3',mesh:{kind:'box'},position:[5,0,0],material:{kind:'steel'}});prepare();assert.equal(new Float32Array(batch.buffer.data)[6*24+12],5);
});

test('compact material, reflection and shadow shaders use the same 96-byte record layout',()=>{
 const source='struct VOut {}\n@vertex fn vs(@location(0) position: vec3<f32>, @location(1) normal: vec3<f32>, @location(6) vertexColor:vec4<f32>, @location(13) authoredUV:vec2<f32>, @location(14) authoredSeed:f32) -> VOut {var out: VOut;out.reflected=0u;u.model;u.prevModel;return out;}\n@fragment fn fs(input: VOut) -> GOut {u.color;}',reflection='struct O {}\n@vertex fn reflectionVS(@location(0) position:vec3<f32>,@location(1) normal:vec3<f32>,@location(6) vertexColor:vec4<f32>,@location(13) authoredUV:vec2f)->O{var out:O;u.model;}\n@fragment fn fs(in:O)->@location(0) vec4<f32>{u.color;}',shadow='@vertex fn shadowVS(@location(0) position:vec3<f32>)->@builtin(position) vec4<f32>{return f.lightVP*displaceWorld(u.model*vec4<f32>(position,1));}';
 for(const shader of [instancedMaterialShader(source,false),instancedReflectionShader(reflection,false),instancedShadowShader(shadow,false)]){assert.match(shader,/model:mat4x4<f32>,color:vec4<f32>,weather:vec4<f32>/);assert.doesNotMatch(shader,/previous:|instance\.previous/);}
 assert.match(instancedMaterialShader(source),/previous:mat4x4<f32>/);
});
function deviceFixture(){
 const writes=[],dispatches=[],resources=[];
 const device={limits:{maxComputeWorkgroupsPerDimension:65535},queue:{writeBuffer(buffer,offset,data,start=0,length=data.length){const bytes=new Uint8Array(data.buffer,data.byteOffset+start*data.BYTES_PER_ELEMENT,length*data.BYTES_PER_ELEMENT);new Uint8Array(buffer.data,offset,bytes.length).set(bytes);writes.push({buffer,offset,bytes:bytes.slice()});}},
  createBuffer(descriptor){const buffer={...descriptor,data:new ArrayBuffer(descriptor.size),destroys:0,destroy(){this.destroys++;},async mapAsync(){},getMappedRange(start=0,size=this.data.byteLength){return this.data.slice(start,start+size);},unmap(){}};resources.push(buffer);return buffer;},
  createBindGroupLayout:d=>d,createBindGroup:d=>d,createPipelineLayout:d=>d,createComputePipeline:d=>d,createShaderModule:d=>d,
 };
 const encoder={beginComputePass(){return{setPipeline(){},setBindGroup(){},dispatchWorkgroups:n=>dispatches.push(n),end(){}};},copyBufferToBuffer(source,start,target,offset,size){new Uint8Array(target.data,offset,size).set(new Uint8Array(source.data,start,size));}};
 return{device,encoder,writes,dispatches,resources};
}
function requestFor(gpu,device,count=4){
 const source=device.createBuffer({size:Math.max(count,1)*INSTANCE_BYTES,usage:0x80|0x08}),batch=gpu.createBatch(source,Math.max(count,1)),instances=new Float32Array(Math.max(count,1)*INSTANCE_FLOATS);
 for(let n=0;n<count;n++)instances.set(identity,n*INSTANCE_FLOATS);
 return{batch,count,indexCount:36,bounds,viewProjection:identity,instances};
}
test('40-float visibility matches local-box CPU culling at all clip planes and transformed bounds',()=>{
 const vp=multiply4(perspective(Math.PI/3,16/9,.1,80),lookAt([8,5,12],[0,0,0])),local=meshBounds(new Float32Array([-1,-2,-3,0,1,0,2,1,4,0,1,0]));
 for(let n=0;n<600;n++){
  const model=compose([Math.sin(n*.91)*95,Math.cos(n*.31)*25,Math.cos(n*.53)*95],[n*.12,n*.71,n*.93],[(n%2?-1:1)*(.2+n%7),.3+n%3,.5+n%5]);
  assert.equal(instanceIntersectsClip(local,vp,model),intersectsClip(local,multiply4(vp,model)),`transform ${n}`);
 }
 for(const [position,expected] of [[[0,0,-.6],false],[[0,0,.2],true],[[0,0,1.6],false],[[1.5,0,.5],true],[[1.5001,0,.5],false]])assert.equal(instanceIntersectsClip(bounds,identity,compose(position,[0,0,0],[1,1,1])),expected);
});
test('persistent stream preserves previous pose and uploads only dirty record runs',()=>{
 const {device,writes}=deviceFixture(),stream=new InstanceStream(32),buffer=device.createBuffer({size:32*INSTANCE_BYTES}),color=[.1,.2,.3,1],weather=[.2,.3,.4,2];
 for(let n=0;n<32;n++)stream.set(n,identity,identity,color,weather);
 assert.equal(stream.upload(device.queue,buffer,32),32*160);writes.length=0;
 for(let n=0;n<32;n++)stream.set(n,identity,identity,color,weather);
 assert.equal(stream.upload(device.queue,buffer,32),0);assert.equal(writes.length,0);
 const moved=compose([3,4,5],[0,0,0],[1,1,1]);stream.set(1,moved,identity,color,weather);stream.set(2,moved,identity,color,weather);stream.set(25,moved,identity,color,weather);
 assert.equal(stream.upload(device.queue,buffer,32),3*160);assert.deepEqual(writes.map(w=>[w.offset,w.bytes.length]),[[160,320],[4000,160]]);
 const record=new Float32Array(buffer.data,160,40);assert.deepEqual([...record.slice(0,16)],[...moved]);assert.deepEqual([...record.slice(16,32)],[...identity]);assert.equal(record[38],Math.fround(.4));
});
test('indexed indirect args reset when a batch becomes hidden or empty; camera and light remain independent',()=>{
 const {device,encoder,writes}=deviceFixture(),gpu=new GpuVisibility(device),request=requestFor(gpu,device);
 const moved=compose([10,0,0],[0,0,0],[1,1,1]);request.instances.set(moved,40);
 assert.equal(gpu.encode(encoder,[request],'cpu-batched'),3);assert.deepEqual([...new Uint32Array(request.batch.indirect.data)],[36,3,0,0,0]);assert.deepEqual([...request.batch.cpuIndices.slice(0,3)],[0,2,3]);
 const camera=request.batch,light={...request,batch:gpu.createBatch(request.batch.source,4),viewProjection:compose([-10,0,0],[0,0,0],[1,1,1])};
 gpu.encode(encoder,[request,light],'cpu-batched');assert.equal(new Uint32Array(camera.indirect.data)[1],3);assert.equal(new Uint32Array(light.batch.indirect.data)[1],1);
 for(let n=0;n<4;n++)request.instances.set(moved,n*40);
 assert.equal(gpu.encode(encoder,[request],'cpu-batched'),0);assert.equal(new Uint32Array(camera.indirect.data)[1],0);
 gpu.encode(encoder,[{...request,count:0}],'gpu');assert.deepEqual([...new Uint32Array(camera.indirect.data)],[36,0,0,0,0]);
 assert.equal(writes.at(-1).bytes.length,20);camera.destroy();camera.destroy();assert.equal(camera.indirect.destroys,1);gpu.destroy();
});
test('GPU path dispatches without visible-count readback and validates capacity and view reuse',()=>{
 const {device,encoder,dispatches}=deviceFixture(),gpu=new GpuVisibility(device),request=requestFor(gpu,device,129);
 gpu.encode(encoder,[request],'gpu');assert.deepEqual(dispatches,[3]);assert.equal(gpu.bufferUploadBytes,132);assert.equal(new Uint32Array(request.batch.indirect.data)[1],0);
 assert.throws(()=>gpu.encode(encoder,[request,request],'gpu'),/distinct/);
 assert.throws(()=>gpu.encode(encoder,[{...request,count:130}],'gpu'),/count/);
 assert.throws(()=>gpu.createBatch(request.batch.source,130),/capacity/);assert.equal(gpu.snapshot().samples,0);
});
test('diagnostics skip ring pressure, ignore earlier reset generations and preserve actual indexed counts',async()=>{
 const {device,encoder,resources}=deviceFixture(),gpu=new GpuVisibility(device),request=requestFor(gpu,device);gpu.encode(encoder,[request],'cpu-batched');
 gpu.captureStats(encoder,[request],1);gpu.afterSubmit();await gpu.flush();assert.equal(gpu.snapshot().visibleInstances,4);assert.equal(gpu.snapshot().triangles,48);
 const reads=resources.filter(resource=>resource.label?.startsWith('visibility diagnostics')),resolveMaps=[];
 for(const read of reads)read.mapAsync=()=>new Promise(resolve=>resolveMaps.push(resolve));
 for(let n=2;n<=4;n++){gpu.captureStats(encoder,[request],n);gpu.afterSubmit();}
 gpu.captureStats(encoder,[request],5);gpu.afterSubmit();assert.equal(gpu.snapshot().pending,3);assert.equal(gpu.snapshot().droppedSamples,1);
 gpu.resetStats();resolveMaps.forEach(resolve=>resolve());await gpu.flush();assert.equal(gpu.snapshot().frame,null);assert.equal(gpu.snapshot().samples,0);
 for(const read of reads)read.mapAsync=async()=>{};
 gpu.captureStats(encoder,[request],1);gpu.afterSubmit();await gpu.flush();assert.equal(gpu.snapshot().frame,1);assert.equal(gpu.snapshot().visibleInstances,4);
 gpu.destroy();gpu.destroy();assert.ok(reads.every(read=>read.destroys===1));
});
test('shrinking streams retain updates to temporarily hidden records',()=>{
 const {device}=deviceFixture(),stream=new InstanceStream(4),buffer=device.createBuffer({size:4*INSTANCE_BYTES});
 stream.set(0,identity,identity,[1,1,1,1],[0,0,0,0]);stream.upload(device.queue,buffer,1);
 const moved=compose([3,4,5],[0,0,0],[1,1,1]);stream.set(3,moved,identity,[1,1,1,1],[0,0,0,0]);stream.upload(device.queue,buffer,1);stream.upload(device.queue,buffer,4);
 assert.equal(new Float32Array(buffer.data)[3*40+12],3);
 stream.set(3,identity,identity,[1,1,1,1],[0,0,0,0]);stream.upload(device.queue,buffer,1);stream.upload(device.queue,buffer,4);assert.equal(new Float32Array(buffer.data)[3*40+12],0);
});
test('camera batching retains shader-specific material boundaries and removes dead generations',()=>{
 const {device}=deviceFixture(),scene=new Scene({version:1,entities:Array.from({length:5},(_,n)=>({id:'cube'+n,mesh:{kind:'box'},material:{kind:'steel',color:[n/8,.2,.3,1]}}))}),gpu=new GpuVisibility(device);
 const renderer=Object.create(WebGPURenderer.prototype),mesh={key:'box',bounds,triangles:12,count:36};
 Object.assign(renderer,{gpu:{visibility:gpu,instanceLayout:{}},device,lastScene:scene,cameraBatches:new Map(),cameraBatchMembers:new Set(),materialBatchKeys:new WeakMap(),instanceMetadata:new WeakMap(),previousModels:new Map(),cullCache:new Map(),profiler:{addUpload(){}},mesh(){return mesh;}});
 const plans=renderer.prepareCameraBatches([...scene.entities.values()],()=>identity);assert.equal(plans.length,1);assert.equal(renderer.cameraBatchMembers.size,5);const buffer=plans[0].buffer;
 scene.remove('cube4');assert.equal(renderer.prepareCameraBatches([...scene.entities.values()],()=>identity)[0].buffer,buffer);
 scene.patchAppearance({materials:[{id:'cube0',set:{roughness:.12}}]});
 assert.equal(renderer.prepareCameraBatches([...scene.entities.values()],()=>identity).length,0);assert.equal(buffer.destroys,1);assert.equal(renderer.cameraBatchMembers.size,0);
});
test('instanced shader retains uniform material controls and passes the per-object seed to fragments',()=>{
 const source='struct VOut {\n}\n@vertex fn vs(@location(0) position: vec3<f32>, @location(1) normal: vec3<f32>, @location(6) vertexColor:vec4<f32>, @location(13) authoredUV:vec2<f32>, @location(14) authoredSeed:f32) -> VOut {\nvar out: VOut;out.reflected=0u;u.model;u.prevModel;u.color;u.weather.z;u.weather.w;u.pbr;return out;}\n@fragment fn fs(input: VOut) -> GOut {u.color;u.texture;}';
 const shader=instancedMaterialShader(source);assert.match(shader,/instanceSource\[input.sourceIndex\]/);assert.match(shader,/u\.weather\.w/);assert.match(shader,/u\.texture/);assert.match(shader,/instance\.previous/);assert.match(shader,/instance\.weather\.z/);assert.throws(()=>instancedMaterialShader(''),/entry points/);
});

test('stable batch plans skip geometry regrouping while moving and previous poses upload only changed records',()=>{
 const {device,writes}=deviceFixture(),scene=new Scene({version:1,entities:Array.from({length:8},(_,n)=>({id:'cube'+n,mesh:{kind:'box'},material:{kind:'steel'}}))}),gpu=new GpuVisibility(device);
 const renderer=Object.create(WebGPURenderer.prototype),mesh={key:'box',bounds,triangles:12,count:36},models=new Map([...scene.entities.keys()].map(id=>[id,identity]));let meshLookups=0;
 Object.assign(renderer,{gpu:{visibility:gpu,instanceLayout:{}},device,lastScene:scene,cameraBatches:new Map(),cameraBatchMembers:new Set(),materialBatchKeys:new WeakMap(),instanceMetadata:new WeakMap(),previousModels:new Map(models),cullCache:new Map(),profiler:{addUpload(){}},mesh(){meshLookups++;return mesh;}});
 const entities=[...scene.entities.values()],modelFor=entity=>models.get(entity.id),plans=renderer.prepareCameraBatches(entities,modelFor),buffer=plans[0].buffer;
 writes.length=0;assert.equal(renderer.prepareCameraBatches(entities,modelFor),plans);assert.equal(meshLookups,8);assert.equal(renderer.cameraBatchPlanBuilds,1);assert.equal(writes.length,0);
 const moved=compose([3,0,0],[0,0,0],[1,1,1]);models.set('cube3',moved);renderer.prepareCameraBatches(entities,modelFor);
 assert.deepEqual(writes.filter(write=>write.buffer===buffer).map(write=>[write.offset,write.bytes.length]),[[3*160,160]]);
 assert.equal(new Float32Array(buffer.data)[3*40+28],0,'previous model must retain the old translation');
 renderer.previousModels.set('cube3',moved);writes.length=0;renderer.prepareCameraBatches(entities,modelFor);assert.equal(writes[0].bytes.length,160);assert.equal(new Float32Array(buffer.data)[3*40+28],3);
 writes.length=0;renderer.prepareCameraBatches(entities,modelFor);assert.equal(writes.length,0);assert.equal(meshLookups,8);
 scene.patchAppearance({materials:[{id:'cube0',set:{roughness:.12}}]});assert.equal(renderer.prepareCameraBatches(entities,modelFor)[0].items.length,7);assert.equal(renderer.cameraBatchPlanBuilds,2);assert.equal(renderer.cameraBatchMembers.has('cube0'),false);
});

test('reflected view retains instances outside the main view and uses independent indirect arguments',()=>{
 const {device,encoder}=deviceFixture(),gpu=new GpuVisibility(device),request=requestFor(gpu,device,4);
 // The mirror is across y=.015, as in the production reflection camera.
 const camera=multiply4(perspective(Math.PI/3,16/9,.05,10000),lookAt([0,3,8],[0,1,0]));
 const reflected=multiply4(perspective(Math.PI/3,16/9,.05,10000),lookAt([0,.03-3,8],[0,.03-1,0],[0,-1,0]));
 const positions=[[0,1,0],[0,12,-12],[0,1,-12],[0,-5,0]];
 positions.forEach((position,index)=>request.instances.set(compose(position,[0,0,0],[1,1,1]),index*40));
 const mirror={...request,batch:gpu.createBatch(request.batch.source,4,'reflection'),viewProjection:reflected};request.viewProjection=camera;
 gpu.encode(encoder,[request,mirror],'cpu-batched');
 const visible=clip=>positions.map((position,index)=>intersectsClip(bounds,multiply4(clip,compose(position,[0,0,0],[1,1,1])))?index:-1).filter(index=>index>=0);
 const main=visible(camera),reflection=visible(reflected);
 assert.notDeepEqual(main,reflection,'the two cameras must see different object sets');
 assert.equal(main.includes(1),false);assert.equal(reflection.includes(1),true,'a high object outside the main frustum remains in the reflection');
 assert.deepEqual([...request.batch.cpuIndices.slice(0,main.length)],main);assert.deepEqual([...mirror.batch.cpuIndices.slice(0,reflection.length)],reflection);
 assert.equal(mirror.batch.source,request.batch.source);assert.notEqual(mirror.batch.indirect,request.batch.indirect);assert.notEqual(mirror.batch.visibleIndices,request.batch.visibleIndices);
 assert.equal(new Uint32Array(mirror.batch.indirect.data)[1],reflection.length);
});

test('GPU batching retains coating overlays on their cutout path while ordinary repeated geometry still batches',()=>{
 const {device}=deviceFixture(),scene=new Scene({version:1,entities:[...Array.from({length:6},(_,n)=>({id:'solid'+n,mesh:{kind:'box'},renderOnly:true})),...Array.from({length:6},(_,n)=>({id:'scar'+n,mesh:{kind:'box'},material:{decal:{kind:'coating-loss',severity:.7,seed:31}},renderOnly:true}))]}),gpu=new GpuVisibility(device);
 const renderer=Object.create(WebGPURenderer.prototype),mesh={key:'box',bounds,triangles:12,count:36};
 Object.assign(renderer,{gpu:{visibility:gpu,instanceLayout:{}},device,lastScene:scene,cameraBatches:new Map(),cameraBatchMembers:new Set(),materialBatchKeys:new WeakMap(),instanceMetadata:new WeakMap(),previousModels:new Map(),cullCache:new Map(),profiler:{addUpload(){}},mesh(){return mesh;}});
 const plans=renderer.prepareCameraBatches([...scene.entities.values()],()=>identity);assert.ok(plans.some(p=>p.items.some(e=>e.id==='solid0')));assert.ok(plans.every(p=>p.items.every(e=>!e.material.decal)));
});

test('wet and dry projections of identical geometry retain separate GPU and CPU material groups',()=>{
 const {device}=deviceFixture(),scene=new Scene({version:1,entities:[0,.9].flatMap(wetness=>Array.from({length:6},(_,n)=>({id:'state'+wetness+':'+n,mesh:{kind:'box'},material:{roughness:.5,surfaceAppearance:{wetness,darkening:wetness*.42}},renderOnly:true})))}),gpu=new GpuVisibility(device),renderer=Object.create(WebGPURenderer.prototype),mesh={key:'box',bounds,triangles:12,count:36};
 Object.assign(renderer,{gpu:{visibility:gpu,instanceLayout:{}},device,lastScene:scene,cameraBatches:new Map(),cameraBatchMembers:new Set(),materialBatchKeys:new WeakMap(),instanceMetadata:new WeakMap(),instanceIdentity:new WeakMap(),previousModels:new Map(),cullCache:new Map(),profiler:{addUpload(){}},mesh(){return mesh;}});
 const plans=renderer.prepareCameraBatches([...scene.entities.values()],()=>identity);assert.equal(plans.length,2);assert.ok(plans.every(p=>p.items.length===6&&p.items.every(e=>e.material.surfaceAppearance.wetness===p.items[0].material.surfaceAppearance.wetness)));
 const first=scene.entities.get('state0:0'),second=scene.entities.get('state0.9:0');assert.notEqual(renderer.instanceIdentityFor(first).key,renderer.instanceIdentityFor(second).key);
});

test('reflection batches share dirty source records, exclude ground kinds and release every view generation',()=>{
 const {device,resources,writes}=deviceFixture(),scene=new Scene({version:1,entities:['steel','snow','asphalt'].flatMap(kind=>Array.from({length:4},(_,n)=>({id:kind+n,mesh:{kind:'box'},material:{kind,color:[.1+n*.1,.2,.3,1]}})))}),gpu=new GpuVisibility(device);
 const renderer=Object.create(WebGPURenderer.prototype),mesh={key:'box',bounds,triangles:12,count:36};
 Object.assign(renderer,{gpu:{visibility:gpu,instanceLayout:{}},device,lastScene:scene,cameraBatches:new Map(),cameraBatchMembers:new Set(),materialBatchKeys:new WeakMap(),instanceMetadata:new WeakMap(),previousModels:new Map(),cullCache:new Map(),profiler:{addUpload(){}},mesh(){return mesh;}});
 const plans=renderer.prepareCameraBatches([...scene.entities.values()],()=>identity),steel=plans.find(batch=>batch.items[0].material.kind==='steel');
 assert.equal(plans.length,3);assert.ok(steel.reflection);assert.equal(steel.reflection.visibility.source,steel.buffer);
 assert.equal(plans.find(batch=>batch.items[0].material.kind==='snow').reflection,undefined);assert.equal(plans.find(batch=>batch.items[0].material.kind==='asphalt').reflection,undefined);
 const moved=compose([2,3,4],[0,0,0],[1,1,1]);writes.length=0;
 renderer.prepareCameraBatches([...scene.entities.values()],entity=>entity.id==='steel2'?moved:identity);
 assert.deepEqual(writes.filter(write=>write.buffer===steel.buffer).map(write=>[write.offset,write.bytes.length]),[[2*160,160]],'one source upload feeds both views');
 const oldResources=resources.slice();scene.remove('steel3');renderer.prepareCameraBatches([...scene.entities.values()],()=>identity);
 assert.equal(steel.buffer.destroys,1);assert.equal(steel.visibility.visibleIndices.destroys,1);assert.equal(steel.reflection.visibility.visibleIndices.destroys,1);assert.equal(steel.reflection.visibility.indirect.destroys,1);assert.equal(steel.reflection.visibility.uniforms.destroys,1);
 renderer.prepareCameraBatches([],()=>identity);assert.ok(oldResources.every(resource=>resource.destroys===1),'dead view generations retain no GPU buffers');
});

test('reflection instance shader uses instance albedo, shared emission and unchanged plane/vertex colors',()=>{
 const source='struct O {@builtin(position) position:vec4<f32>,@location(2) vertexColor:vec3<f32>}\n@vertex fn reflectionVS(@location(0) position:vec3<f32>,@location(1) normal:vec3<f32>,@location(6) vertexColor:vec4<f32>,@location(13) authoredUV:vec2f)->O{\nlet world=u.model*vec4<f32>(position,1);var out:O;out.vertexColor=vertexColor.rgb;return out;}\n@fragment fn fs(in:O)->@location(0) vec4<f32>{\nif(in.worldPos.y<.04){discard;}return vec4<f32>(u.color.rgb*in.vertexColor+u.emission.rgb,1);}';
 const shader=instancedReflectionShader(source);
 assert.match(shader,/instanceSource\[in.sourceIndex\]/);assert.match(shader,/@interpolate\(flat\) sourceIndex/);assert.match(shader,/instance\.color\.rgb\*in.vertexColor\+u\.emission\.rgb/);assert.match(shader,/if\(in.worldPos.y<\.04\)\{discard;\}/);assert.match(shader,/instance\.model\*vec4/);
 assert.throws(()=>instancedReflectionShader(''),/entry points/);
});

test('light-owned shadow lists share transforms, cache uploads and handle empty/reentered views',()=>{
 const {device,writes}=deviceFixture(),source=device.createBuffer({size:8*INSTANCE_BYTES}),light=new ShadowInstanceIndices(device,{},source,8),dynamic=new ShadowInstanceIndices(device,{},source,8);
 assert.equal(light.bind.entries[0].resource.buffer,source);assert.equal(dynamic.bind.entries[0].resource.buffer,source);assert.notEqual(light.buffer,dynamic.buffer);
 assert.equal(light.update(device.queue,[2,6]),8);assert.equal(dynamic.update(device.queue,[1]),4);writes.length=0;
 assert.equal(light.update(device.queue,[2,6]),0);assert.equal(writes.length,0);assert.equal(light.update(device.queue,[]),0);assert.equal(light.count,0);
 assert.equal(light.update(device.queue,[6]),4);assert.deepEqual([...new Uint32Array(light.buffer.data).slice(0,light.count)],[6]);
 assert.throws(()=>light.update(device.queue,[8]),/Invalid shadow/);assert.equal(light.count,1);
 light.destroy();light.destroy();dynamic.destroy();assert.equal(light.buffer.destroys,1);assert.equal(source.destroys,0);assert.throws(()=>light.update(device.queue,[]),/destroyed/);
});

test('ground, paint and mirrored paint rain responses cannot share one material uniform',()=>{
 const states=[undefined,{kind:'ground'},{kind:'paint'},{kind:'paint',mirrorX:true}],{device}=deviceFixture(),scene=new Scene({version:1,entities:states.flatMap((rainResponse,i)=>Array.from({length:6},(_,n)=>({id:'rain'+i+':'+n,mesh:{kind:'box'},material:{roughness:.5,rainResponse},renderOnly:true})))}),gpu=new GpuVisibility(device),renderer=Object.create(WebGPURenderer.prototype),mesh={key:'box',bounds,triangles:12,count:36};
 Object.assign(renderer,{gpu:{visibility:gpu,instanceLayout:{}},device,lastScene:scene,cameraBatches:new Map(),cameraBatchMembers:new Set(),materialBatchKeys:new WeakMap(),instanceMetadata:new WeakMap(),instanceIdentity:new WeakMap(),previousModels:new Map(),cullCache:new Map(),profiler:{addUpload(){}},mesh(){return mesh;}});
 const plans=renderer.prepareCameraBatches([...scene.entities.values()],()=>identity);assert.equal(plans.length,4);assert.ok(plans.every(p=>p.items.length===6&&p.items.every(e=>JSON.stringify(e.material.rainResponse)===JSON.stringify(p.items[0].material.rainResponse))));
 const keys=states.map((_,i)=>renderer.instanceIdentityFor(scene.entities.get('rain'+i+':0')).key);assert.equal(new Set(keys).size,4,'CPU fallback groups retain the same distinction');
});

test('shadow batching uses light candidates independently of camera visibility and releases dead views',()=>{
 const {device,writes}=deviceFixture(),scene=new Scene({version:1,entities:Array.from({length:8},(_,n)=>({id:'cube'+n,mesh:{kind:'box'},material:{kind:'steel'}}))}),gpu=new GpuVisibility(device),mesh={key:'box',bounds,triangles:12,count:36};
 const renderer=Object.create(WebGPURenderer.prototype);Object.assign(renderer,{gpu:{visibility:gpu,instanceLayout:{},shadowSharedCulled:'shared'},device,lastScene:scene,cameraBatches:new Map(),cameraBatchMembers:new Set(),materialBatchKeys:new WeakMap(),instanceMetadata:new WeakMap(),previousModels:new Map(),objects:new Map(),profiler:{addUpload(){}},mesh(){return mesh;}});
 const entities=[...scene.entities.values()],plans=renderer.prepareCameraBatches(entities,()=>identity),batch=plans[0];
 batch.visibility.cpuVisibleCount=0;
 const staticPlan=renderer.prepareSharedShadows([entities[2],entities[6]],'static'),dynamicPlan=renderer.prepareSharedShadows([entities[1]],'dynamic');
 assert.equal(staticPlan.instances,2);assert.deepEqual([...staticPlan.batches[0].view.indices.slice(0,2)],[2,6]);assert.equal(staticPlan.batches[0].view.bind.entries[0].resource.buffer,batch.buffer);
 assert.equal(dynamicPlan.batches[0].view.count,1);const light=staticPlan.batches[0].view,dynamic=dynamicPlan.batches[0].view;writes.length=0;
 renderer.prepareSharedShadows([entities[1]],'dynamic');assert.equal(writes.length,0);assert.equal(renderer.prepareSharedShadows([],'dynamic').batches.length,0);
 const external={id:'external'};assert.deepEqual(renderer.prepareSharedShadows([external],'dynamic').singles,[external]);
 const draws=[];renderer.objects.set(entities[0].id,{bind:{}});renderer.drawSharedShadows({setPipeline(){},setBindGroup(){},setVertexBuffer(){},setIndexBuffer(){},drawIndexed:(...args)=>draws.push(args)},staticPlan.batches);assert.deepEqual(draws,[[36,2]],'off-camera shadow casters still draw');
 renderer.prepareCameraBatches(entities.slice(0,3),()=>identity);assert.equal(batch.buffer.destroys,1);assert.equal(light.buffer.destroys,1);assert.equal(dynamic.buffer.destroys,1);
});

test('shared material uniforms skip pose uploads and refresh on single-pass use and material replacement',()=>{
 const {device,writes}=deviceFixture(),scene=new Scene({version:1,entities:[{id:'cube',mesh:{kind:'box'},material:{kind:'steel'}}]}),entity=scene.entities.get('cube'),renderer=Object.create(WebGPURenderer.prototype);
 const emptyLabel={},object={uniform:device.createBuffer({size:400}),width:0,height:0,label:JSON.stringify(['',[226/255,217/255,188/255]]),labelTexture:emptyLabel};
 Object.assign(renderer,{device,gpu:{emptyLabel},lastScene:scene,objects:new Map([['cube',object]]),previousModels:new Map(),surfaceTextures:new Map(),profiler:{addUpload(){}},object(){return object;},mesh(){return{};}});
 renderer.prepare(entity,identity,true);assert.equal(writes.length,1);assert.equal(renderer.needsPrepare(entity,identity,true),false);
 const moved=compose([3,2,1],[0,.2,0],[2,1,1]);renderer.previousModels.set('cube',moved);assert.equal(renderer.needsPrepare(entity,moved,true),false);renderer.prepare(entity,moved,true);assert.equal(writes.length,1);
 assert.equal(renderer.needsPrepare(entity,moved,false),true);renderer.prepare(entity,moved,false);assert.equal(writes.length,2);assert.deepEqual([...new Float32Array(object.uniform.data).slice(0,16)],[...moved]);
 renderer.prepare(entity,moved,true);assert.equal(writes.length,3);entity.material={...entity.material,roughness:.1};assert.equal(renderer.needsPrepare(entity,moved,true),true);renderer.prepare(entity,moved,true);assert.equal(writes.length,4);assert.equal(new Float32Array(object.uniform.data)[68],Math.fround(.1));
});

test('shared shadow shader retains the production light projection and deformation expression',()=>{
 const source='@vertex fn shadowVS(@location(0) position:vec3<f32>)->@builtin(position) vec4<f32>{return f.lightVP*displaceWorld(u.model*vec4<f32>(position,1));}';
 const shader=instancedShadowShader(source);assert.match(shader,/shadowSource\[shadowVisible\[index\]\]\.model/);assert.match(shader,/f\.lightVP\*displaceWorld\(model\*vec4<f32>\(position,1\)\)/);assert.match(shader,/previous:mat4x4<f32>,color:vec4<f32>,weather:vec4<f32>/);assert.throws(()=>instancedShadowShader(''),/entry point/);
});

test('authored instance seeds share one GPU and CPU geometry/material batch',()=>{
 const {device}=deviceFixture(),seeds=Array.from({length:12},(_,i)=>i*.25-1),scene=new Scene({version:1,entities:seeds.map((variationSeed,i)=>({id:'litter'+i,mesh:{kind:'box'},renderOnly:true,material:{groundLitter:{kind:'paving',baseRoughness:.89},variationSeed}}))}),gpu=new GpuVisibility(device),renderer=Object.create(WebGPURenderer.prototype),mesh={key:'box',bounds,triangles:12,count:36};
 Object.assign(renderer,{gpu:{visibility:gpu,instanceLayout:{}},device,lastScene:scene,cameraBatches:new Map(),cameraBatchMembers:new Set(),materialBatchKeys:new WeakMap(),instanceMetadata:new WeakMap(),instanceIdentity:new WeakMap(),previousModels:new Map(),cullCache:new Map(),profiler:{addUpload(){}},mesh(){return mesh;}});
 const entities=[...scene.entities.values()],plans=renderer.prepareCameraBatches(entities,()=>identity);assert.equal(plans.length,1);assert.equal(plans[0].items.length,12);const stride=plans[0].stream.floats;assert.deepEqual(seeds.map((_,i)=>plans[0].stream.data[(i+1)*stride-2]),seeds);assert.equal(new Set(entities.map(e=>renderer.instanceIdentityFor(e).key)).size,1);assert.deepEqual(entities.map(e=>renderer.instanceIdentityFor(e).seed),seeds);
});
