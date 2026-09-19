import test from 'node:test';
import assert from 'node:assert/strict';
import {WebGPURenderer} from '../dist/render/webgpu.js';
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('quarter-resolution bloom targets and bind groups resize together and release all generations exactly once',t=>{
 const previous=globalThis.devicePixelRatio;globalThis.devicePixelRatio=1;t.after(()=>{if(previous===undefined)delete globalThis.devicePixelRatio;else globalThis.devicePixelRatio=previous;});
 const resources=[],resource=(descriptor={})=>{const result={descriptor,destroys:0,createView(){return{texture:this};},destroy(){this.destroys++;}};resources.push(result);return result;};
 const renderer=Object.create(WebGPURenderer.prototype);Object.assign(renderer,{
  canvas:{clientWidth:320,clientHeight:180,width:0,height:0},depthW:0,depthH:0,materialLoads:new Map(),failedMaterials:new Set(),objects:new Map(),meshes:new Map(),labels:new Map(),surfaceTextures:{dispose(){}},
  device:{createTexture:resource,createBindGroup:descriptor=>descriptor},gpu:{lightLayout:{},bloomLayout:{},comparison:{},sampler:{},post:{getBindGroupLayout(){return{};}},shadow:resource(),frame:resource(),lightBuffer:resource(),cellBuffer:resource(),snowUniform:resource(),emptyField:resource(),emptyLabel:resource()},
 });
 const before=resources.length;renderer.resize();const first=resources.slice(before);assert.equal(first.length,11);assert.deepEqual(renderer.bloomA.descriptor.size,[80,45]);assert.deepEqual(renderer.bloomB.descriptor.size,[80,45]);
 assert.equal(renderer.postBind.entries.find(e=>e.binding===6).resource.texture,renderer.bloomA);assert.equal(renderer.bloomHorizontalBind.entries[0].resource.texture,renderer.bloomA);assert.equal(renderer.bloomVerticalBind.entries[0].resource.texture,renderer.bloomB);
 renderer.resize();assert.equal(resources.length,before+11);assert.ok(first.every(r=>r.destroys===0));
 renderer.canvas.clientWidth=640;renderer.canvas.clientHeight=360;renderer.resize();assert.ok(first.every(r=>r.destroys===1));assert.deepEqual(renderer.bloomA.descriptor.size,[160,90]);assert.equal(renderer.postBind.entries.find(e=>e.binding===6).resource.texture,renderer.bloomA);
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
