import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene} from '../dist/scene/scene.js';
import {WebGPURenderer} from '../dist/render/webgpu.js';
import {GpuVisibility} from '../dist/render/gpu-visibility.js';
import {freezePrimitive,primitiveKey} from '../dist/procedural/mesh.js';
import {compose} from '../dist/math.js';

const identity=compose([0,0,0],[0,0,0],[1,1,1]);
const triangle=()=>({kind:'triangle-mesh',positions:[0,0,0,1,0,0,0,1,0],normals:[0,0,1,0,0,1,0,0,1],indices:[0,1,2]});
function rendererFor(scene){
 const buffers=[],device={limits:{maxComputeWorkgroupsPerDimension:65535},queue:{writeBuffer(buffer,offset,source,start=0,count=source.length){const bytes=new Uint8Array(source.buffer,source.byteOffset+start*source.BYTES_PER_ELEMENT,count*source.BYTES_PER_ELEMENT);new Uint8Array(buffer.data,offset,bytes.length).set(bytes);}},createBuffer(spec){const buffer={...spec,data:new ArrayBuffer(spec.size),destroys:0,destroy(){this.destroys++;},getMappedRange(){return this.data;},unmap(){}};buffers.push(buffer);return buffer;},createBindGroupLayout:d=>d,createBindGroup:d=>d,createPipelineLayout:d=>d,createComputePipeline:d=>d,createShaderModule:d=>d};
 const renderer=Object.create(WebGPURenderer.prototype);Object.assign(renderer,{device,lastScene:scene,gpu:{visibility:new GpuVisibility(device),instanceLayout:{}},meshes:new Map(),meshByPrimitive:new WeakMap(),cameraBatches:new Map(),cameraBatchMembers:new Set(),materialBatchKeys:new WeakMap(),instanceMetadata:new WeakMap(),previousModels:new Map(),profiler:{addUpload(){}}});
 return{renderer,buffers,prepare:()=>renderer.prepareCameraBatches([...scene.entities.values()],()=>identity)};
}

test('batch tokens preserve content-deduplicated GPU meshes and exact shared-material equality',()=>{
 const a=freezePrimitive(triangle()),b=freezePrimitive(triangle()),scene=new Scene({version:1,entities:[]});assert.notEqual(a,b);assert.equal(primitiveKey(a),primitiveKey(b));
 for(let n=0;n<8;n++)scene.add({id:'part'+n,renderOnly:true,mesh:n<4?a:b,material:{kind:'steel',roughness:.45,color:[n/10,.2,.3,1],variationSeed:n/9}});
 const f=rendererFor(scene),first=f.prepare()[0],buffer=first.buffer;assert.equal(first.items.length,8);assert.equal(f.renderer.mesh(a),f.renderer.mesh(b));assert.equal(f.renderer.cameraBatchMaterialIds.size,1);
 const keys=[...f.renderer.cameraBatches.keys()];assert.ok(keys.every(key=>key.length<40),'hash keys contain compact tokens rather than normalized material or geometry JSON');
 scene.patchAppearance({materials:[{id:'part0',set:{roughness:.1}}]});const split=f.prepare();assert.equal(split.length,1);assert.equal(split[0].items.length,7);assert.equal(split[0].buffer,buffer);assert.equal(f.renderer.cameraBatchMaterialIds.size,2);
 scene.patchAppearance({materials:[{id:'part0',set:{roughness:.45}}]});assert.equal(f.prepare()[0].buffer,buffer);assert.equal(first.items.length,8);assert.equal(f.renderer.cameraBatchMaterialIds.size,1,'obsolete material value is pruned');
 for(let frame=0;frame<24;frame++){scene.patchAppearance({materials:[...scene.entities.keys()].map(id=>({id,set:{roughness:.2+frame*.01}}))});const plans=f.prepare();assert.equal(plans.length,1);assert.equal(plans[0].items.length,8);assert.equal(f.renderer.cameraBatchMaterialIds.size,1,'historical material keys are not retained');}
 for(const id of [...scene.entities.keys()])scene.remove(id);assert.equal(f.prepare().length,0);assert.equal(f.renderer.cameraBatches.size,0);assert.equal(f.renderer.cameraBatchMaterialIds.size,0);
});

test('GPU mesh recreation receives a fresh token and cannot retain dead mesh or instance generations',()=>{
 const mesh=freezePrimitive(triangle()),scene=new Scene({version:1,entities:[]});for(let n=0;n<4;n++)scene.add({id:'part'+n,renderOnly:true,mesh,material:{kind:'steel'}});
 const f=rendererFor(scene),before=f.prepare()[0],oldMesh=before.mesh,oldKey=[...f.renderer.cameraBatches.keys()][0];f.renderer.meshes.delete(oldMesh.key);for(const buffer of [oldMesh.vertex,oldMesh.color,oldMesh.index])buffer.destroy();
 // The real mesh() path must reject its stale primitive-identity fast cache.
 f.renderer.cameraBatchScene=null;const after=f.prepare()[0];assert.notEqual(after.mesh,oldMesh);assert.equal(after.mesh.key,oldMesh.key);assert.notEqual([...f.renderer.cameraBatches.keys()][0],oldKey);assert.notEqual(after.buffer,before.buffer);assert.equal(before.buffer.destroys,1);assert.equal(before.visibility.indirect.destroys,1);assert.equal(before.reflection.visibility.indirect.destroys,1);
 for(const buffer of [after.mesh.vertex,after.mesh.color,after.mesh.index,after.buffer])assert.equal(buffer.destroys,0);
});

test('distinct transient meshes retain separate GPU groups even when their geometry bytes match',()=>{
 const a=freezePrimitive(triangle(),true),b=freezePrimitive(triangle(),true),scene=new Scene({version:1,entities:[]});assert.notEqual(primitiveKey(a),primitiveKey(b));for(let n=0;n<8;n++)scene.add({id:'part'+n,renderOnly:true,mesh:n<4?a:b,material:{kind:'steel'}});
 const f=rendererFor(scene),plans=f.prepare();assert.equal(plans.length,2);assert.deepEqual(plans.map(plan=>plan.items.map(entity=>entity.id)),[['part0','part1','part2','part3'],['part4','part5','part6','part7']]);assert.notEqual(plans[0].mesh,plans[1].mesh);assert.equal(f.renderer.cameraBatchMaterialIds.size,1);
 f.renderer.clearPreparationCaches();assert.equal(f.renderer.cameraBatchMaterialIds.size,0);
});
