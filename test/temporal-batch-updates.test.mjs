import test from 'node:test';
import assert from 'node:assert/strict';
import {WebGPURenderer} from '../dist/render/webgpu.js';
import {Scene} from '../dist/scene/scene.js';
import {RenderFrameCache,buildRenderFrame,renderPrimitive} from '../dist/render/frame.js';
import {RenderModelHistory} from '../dist/render/model-history.js';
import {GpuVisibility,INSTANCE_FLOATS,CURRENT_INSTANCE_FLOATS} from '../dist/render/gpu-visibility.js';
import {primitiveKey} from '../dist/procedural/mesh.js';
import {prepareCameraBatchesReference} from './fixtures/temporal-batch-reference.mjs';

function fixture(method,floats){
 const writes=[],device={limits:{maxComputeWorkgroupsPerDimension:65535},queue:{writeBuffer(buffer,offset,data,start=0,length=data.length){const bytes=new Uint8Array(data.buffer,data.byteOffset+start*data.BYTES_PER_ELEMENT,length*data.BYTES_PER_ELEMENT);new Uint8Array(buffer.data,offset,bytes.length).set(bytes);writes.push({label:buffer.label,offset,bytes:[...bytes]});}},createBuffer(spec){return{...spec,data:new ArrayBuffer(spec.size),destroy(){}};},createBindGroupLayout:spec=>spec,createBindGroup:spec=>spec,createPipelineLayout:spec=>spec,createComputePipeline:spec=>spec,createShaderModule:spec=>spec};
 const renderer=Object.create(WebGPURenderer.prototype),history=new RenderModelHistory(),gpu=new GpuVisibility(device,floats),meshes=new Map();
 Object.assign(renderer,{gpu:{visibility:gpu,instanceLayout:{}},device,cameraBatches:new Map(),cameraBatchMembers:new Set(),materialBatchKeys:new WeakMap(),instanceMetadata:new WeakMap(),previousModels:history,profiler:{addUpload(){}},mesh(primitive){const key=primitiveKey(primitive);let mesh=meshes.get(key);if(!mesh){mesh={key,bounds:{center:[0,0,0],half:[.5,.5,.5]},triangles:12,count:36};meshes.set(key,mesh);}return mesh;},lookups:0});
 return{renderer,history,writes,run(scene,frame,changes){renderer.lastScene=scene;history.beginFrame();writes.length=0;return method.call(renderer,[...scene.entities.values()].filter(entity=>renderPrimitive(entity)&&entity.material.color[3]>=.98),entity=>{renderer.lookups++;return frame.objectsById.get(entity.id).model;},changes);},commit(plans,frame){for(const plan of plans)for(const entity of plan.items)history.set(entity.id,frame.objectsById.get(entity.id).model,entity);}};
}
const spec=(count=64)=>({version:1,entities:Array.from({length:count},(_,n)=>({id:'cube'+n,renderOnly:true,mesh:{kind:'box'},position:[n*.05,0,0],material:{kind:'steel',color:[n/200,.2,.3,1]}}))});
for(const floats of [INSTANCE_FLOATS,CURRENT_INSTANCE_FLOATS])test(`certified ${floats}-float batching matches the frozen full-scan oracle through temporal and lifetime boundaries`,t=>{
 const old=fixture(prepareCameraBatchesReference,floats),next=fixture(WebGPURenderer.prototype.prepareCameraBatches,floats),cache=new RenderFrameCache();let scene=new Scene(spec()),frames=0;
 const step=(label,mode='live')=>{
  const frame=cache.build(scene,scene.camera,mode==='custom'?(s,c)=>buildRenderFrame(s,c):buildRenderFrame),changes=cache.changedObjects(),before=next.renderer.lookups;
  const a=old.run(scene,frame,changes),b=next.run(scene,frame,changes);assert.equal(a.length,b.length,label);
  for(let i=0;i<a.length;i++){assert.deepEqual(a[i].items.map(e=>e.id),b[i].items.map(e=>e.id),label);assert.deepEqual(new Uint8Array(a[i].buffer.data,0,a[i].items.length*floats*4),new Uint8Array(b[i].buffer.data,0,b[i].items.length*floats*4),label+' current/previous/color/weather bytes');}
  assert.deepEqual(old.writes,next.writes,label+' upload ranges and bytes');old.commit(a,frame);next.commit(b,frame);frames++;
  if(floats===INSTANCE_FLOATS){for(const entity of next.renderer.cameraBatchTemporalPending){const location=next.renderer.cameraBatchLocations.get(entity.id);assert.equal(location?.batch.items[location.index],entity,label+' pending generation');}assert.equal(next.renderer.cameraBatchTemporalNext.size,0);assert.equal(next.renderer.cameraBatchTemporalSeen.size,0);}
  if(label==='stable'){assert.equal(next.renderer.lookups-before,0);assert.equal(old.writes.length,0);}
 };
 step('initial');step('stable');scene.entities.get('cube3').position[0]+=2;step('one moving');
 scene.entities.get('cube4').rotation[1]=.3;step('one stopping, another moving');step('rotation stops');step('stable after settle');
 scene.entities.get('cube3').position[0]+=1;scene.entities.get('cube4').position[1]=2;scene.entities.get('cube1').position[0]+=1e-10;step('simultaneous motion and Float32-equal cause');
 old.renderer.resetTemporalHistory();next.renderer.resetTemporalHistory();step('history reset with pending motion');step('stable after reset');
 scene.entities.get('cube2').position[0]=1000;step('outside camera');step('settle outside camera');scene.entities.get('cube2').position[0]=0;step('camera reentry');
 scene.setRenderCameraVisible('cube5',false);step('camera-mask membership removal');scene.entities.get('cube5').position[2]=8;step('unbatched changed source');scene.setRenderCameraVisible('cube5',true);step('camera-mask membership reentry');
 scene.entities.get('cube3').position[2]=1;step('old same-id generation moves');scene.remove('cube3');scene.add({id:'cube3',renderOnly:true,mesh:{kind:'box'},position:[9,0,0],material:{kind:'steel'}});step('same-id new entity generation');
 scene.patchAppearance({materials:[{id:'cube6',set:{roughness:.1}}]});step('material split');scene.entities.get('cube6').position[1]=3;step('unbatched material singleton moves');
 scene.entities.get('cube7').renderMesh=Object.freeze({kind:'sphere',radius:2});step('geometry group changes');
 for(let n=64;n<140;n++)scene.add({id:'cube'+n,renderOnly:true,mesh:{kind:'box'},position:[n*.05,0,0],material:{kind:'steel'}});step('capacity generation grows');
 scene.entities.get('cube8').rotation[1]=.4;step('custom builder fallback','custom');step('custom builder next frame','custom');step('return to certified live frame');step('settle live frame');cache.clear();step('frame cache reset');
 scene=new Scene(spec(8));old.history.clear();next.history.clear();step('scene swap same IDs');for(const id of [...scene.entities.keys()])scene.remove(id);step('empty scene');
 for(const entity of spec(6).entities)scene.add(entity);step('repopulate reused IDs');step('stable repopulation');
 assert.equal(frames,30);if(floats===INSTANCE_FLOATS)assert.ok(next.renderer.lookups<old.renderer.lookups,'temporal stable frames skip model lookups');
 t.diagnostic(JSON.stringify({stride:floats,states:frames,referenceModelLookups:old.renderer.lookups,optimizedModelLookups:next.renderer.lookups}));
 next.renderer.clearPreparationCaches();assert.equal(next.renderer.cameraBatchTemporalPending?.size??0,0);assert.equal(next.renderer.cameraBatchTemporalNext?.size??0,0);assert.equal(next.renderer.cameraBatchTemporalSeen?.size??0,0);
});

test('a failed temporal upload forces the full history fallback before cached updates resume',()=>{
 const scene=new Scene(spec(8)),cache=new RenderFrameCache(),f=fixture(WebGPURenderer.prototype.prepareCameraBatches,INSTANCE_FLOATS);let frame=cache.build(scene,scene.camera);
 f.commit(f.run(scene,frame,cache.changedObjects()),frame);scene.entities.get('cube0').position[0]=2;frame=cache.build(scene,scene.camera);
 const queue=f.renderer.device.queue,write=queue.writeBuffer;queue.writeBuffer=()=>{throw new Error('injected upload failure');};assert.throws(()=>f.run(scene,frame,cache.changedObjects()),/injected upload failure/);assert.equal(f.renderer.cameraBatchTemporalReset,true);
 queue.writeBuffer=write;frame=cache.build(scene,scene.camera);assert.equal(cache.changedObjects().length,0);const lookups=f.renderer.lookups,plans=f.run(scene,frame,cache.changedObjects());assert.equal(f.renderer.lookups-lookups,8);
 const first=new Float32Array(plans[0].buffer.data,0,40);assert.equal(first[12],2);assert.equal(first[28],2,'an uncommitted frame cannot become stale previous velocity');assert.equal(f.renderer.cameraBatchTemporalReset,false);assert.equal(f.renderer.cameraBatchTemporalPending.size,0);
});

