import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene} from '../dist/scene/scene.js';
import {WebGPURenderer} from '../dist/render/webgpu.js';
import {freezePrimitive} from '../dist/procedural/mesh.js';

test('returning immutable geometry cannot reuse GPU buffers destroyed during residency eviction',()=>{
 const primitive=freezePrimitive({kind:'box',size:[2,1,1]}),renderer=Object.create(WebGPURenderer.prototype);
 const createBuffer=({size})=>({destroyed:false,getMappedRange(){return new ArrayBuffer(size);},unmap(){},destroy(){this.destroyed=true;}});
 Object.assign(renderer,{meshes:new Map(),meshByPrimitive:new WeakMap(),objects:new Map(),modelCache:new Map(),cullCache:new Map(),device:{createBuffer},surfaceTextures:{retain(){}}});
 const first=renderer.mesh(primitive);renderer.collect(new Scene({version:1,entities:[]}));
 assert(first.vertex.destroyed&&first.color.destroyed&&first.index.destroyed);
 const returned=renderer.mesh(primitive);assert.notEqual(returned,first);assert.equal(returned.vertex.destroyed,false);
 assert.equal(renderer.mesh(primitive),returned);
});

test('moving cameras reuse the distant radiance grid and rebuild on crossing its boundary',()=>{
 const scene=new Scene({version:1,entities:[],rendering:{environmentProbeGridM:32}});
 let uploads=0;
 const renderer=Object.create(WebGPURenderer.prototype);
 Object.assign(renderer,{environmentIrradiance:new Float32Array(36),environmentUpdates:0,environmentKey:'',device:{queue:{writeTexture(){uploads++;}}},gpu:{environmentMap:{}},profiler:{enabled:false,addUpload(){}}});
 renderer.updateEnvironmentMap(scene,[1,1,1]);assert.equal(uploads,9);
 const key=renderer.environmentKey,irradiance=renderer.environmentIrradiance.slice(),firstMap=renderer.environmentMapCache.get(key);
 renderer.updateEnvironmentMap(scene,[8,2,8]);assert.equal(uploads,9);assert.equal(renderer.environmentKey,key);assert.deepEqual(renderer.environmentIrradiance,irradiance,'a cache hit must preserve diffuse lighting');
 scene.add({id:'moving-snow',position:[2,1,0],mesh:{kind:'sphere',radius:.1},body:{mass:1}});
 renderer.updateEnvironmentMap(scene,[8,2,8]);assert.equal(uploads,9,'a snowball cannot invalidate the distant cubemap');
 scene.remove('moving-snow');renderer.updateEnvironmentMap(scene,[8,2,8]);assert.equal(uploads,9);
 renderer.updateEnvironmentMap(scene,[33,2,8]);assert.equal(uploads,18);assert.notEqual(renderer.environmentKey,key);
 assert.equal(renderer.environmentUpdates,2);renderer.updateEnvironmentMap(scene,[1,1,1]);assert.equal(uploads,27);assert.equal(renderer.environmentMapCache.get(key),firstMap);assert.deepEqual(renderer.environmentIrradiance,irradiance);for(let n=2;n<7;n++)renderer.updateEnvironmentMap(scene,[n*32,2,8]);assert.equal(renderer.environmentMapCache.size,4);
 assert.throws(()=>new Scene({version:1,entities:[],rendering:{environmentProbeGridM:0}}),/environmentProbeGridM/);
});

test('a new dynamic object keeps static uniforms and temporal history resident',()=>{
 const scene=new Scene({version:1,entities:[{id:'wall',mesh:{kind:'box'}}]}),renderer=Object.create(WebGPURenderer.prototype);
 const object={source:scene.entities.get('wall'),uniformReady:true};
 Object.assign(renderer,{collectedScene:scene,collectedRevision:scene.renderStructureRevision,objects:new Map([['wall',object]]),meshes:new Map(),modelCache:new Map(),cullCache:new Map(),surfaceTextures:{retain(){}},historyValid:true});
 scene.add({id:'ball',mesh:{kind:'sphere'},body:{mass:1}});renderer.collect(scene);
 assert.equal(object.uniformReady,true);assert.equal(renderer.historyValid,true);
 // Replacing an identity still refreshes its material even at the same pose.
 scene.remove('wall');scene.add({id:'wall',mesh:{kind:'box'},material:{color:[1,0,0,1]}});renderer.collect(scene);assert.equal(object.uniformReady,false);
});

test('static radiance refreshes for geometry and optical cause changes',async()=>{
 const {distantRadianceKey}=await import('../dist/render/radiance.js');
 const scene=new Scene({version:1,entities:[{id:'wall',mesh:{kind:'box'}}]}),wall=scene.entities.get('wall');
 let key=distantRadianceKey(scene);wall.renderMesh=freezePrimitive({kind:'box',size:[3,2,1]});assert.notEqual(distantRadianceKey(scene),key);
 key=distantRadianceKey(scene);wall.material={...wall.material,metalness:.8};assert.notEqual(distantRadianceKey(scene),key);
 key=distantRadianceKey(scene);wall.rotation[1]=1;assert.notEqual(distantRadianceKey(scene),key);
});
