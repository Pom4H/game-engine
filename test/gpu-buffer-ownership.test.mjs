import test from 'node:test';
import assert from 'node:assert/strict';
import {WebGPURenderer} from '../dist/render/webgpu.js';
import {primitiveMesh,meshVertexAttributes} from '../dist/procedural/mesh.js';

function fixture({step,failAt=1,destroyFailures=[]}={}){
 const failure=new Error('injected '+step),created=[],events=[],destroyOrder=[],copies=[];let attempts=0;
 const fail=(stage,id=1)=>{if(stage===step&&id===failAt)throw failure;};
 const device={
  createBuffer(descriptor){const id=++attempts;fail('create',id);let state=descriptor.mappedAtCreation?'mapped':'unmapped';const data=new ArrayBuffer(descriptor.size),cleanupError=new Error('destroy '+id);
   const buffer={id,descriptor,data,cleanupError,destroys:0,unmaps:0,
    get state(){return state;},
    getMappedRange(){events.push(['range',id]);fail('range',id);if(step==='short'&&id===failAt)return new ArrayBuffer(1);return data;},
    async mapAsync(mode){events.push(['map',id,mode]);state='pending';fail('map',id);state='mapped';},
    unmap(){events.push(['unmap',id]);this.unmaps++;fail('unmap',id);state='unmapped';},
    destroy(){events.push(['destroy',id]);destroyOrder.push(id);this.destroys++;state='destroyed';if(destroyFailures.includes(id))throw cleanupError;},
   };created.push(buffer);events.push(['create',id]);return buffer;
  },
  createCommandEncoder(){fail('encoder');return{
   copyTextureToBuffer(source,destination,size){fail('copy');copies.push({source,destination,size});},
   finish(){fail('finish');return{};},
  };},
  queue:{submit(){fail('submit');for(const {destination}of copies){const view=new DataView(destination.buffer.data);for(const [channel,bits]of [0x3c00,0x3800,0x4000,0x3c00].entries())view.setUint16(destination.offset+channel*2,bits,true);}}},
 };
 const renderer=Object.create(WebGPURenderer.prototype);Object.assign(renderer,{device,meshes:new Map(),meshByPrimitive:new WeakMap(),hdr:{width:4,height:4},reflection:{width:2,height:2},depthW:4,depthH:4,pipelinePlan:{features:{planarReflections:true}}});
 return{renderer,device,created,events,destroyOrder,copies,failure,get attempts(){return attempts;}};
}
const bytes=value=>new Uint8Array(value.buffer,value.byteOffset,value.byteLength);

test('cold mesh ownership transfers complete exact buffers to both caches and cache hits keep them alive',()=>{
 const f=fixture(),primitive={kind:'box',size:[1,2,3]},mesh=f.renderer.mesh(primitive),data=primitiveMesh(primitive),expected=[data.vertices,meshVertexAttributes(data),data.indices];
 assert.equal(f.attempts,3);assert.equal(f.renderer.meshes.get(mesh.key),mesh);assert.equal(f.renderer.meshByPrimitive.get(primitive),mesh);
 for(let i=0;i<3;i++){const buffer=f.created[i];assert.equal(buffer.descriptor.mappedAtCreation,true);assert.equal(buffer.descriptor.usage,i===2?0x18:0x28);assert.deepEqual(new Uint8Array(buffer.data).subarray(0,expected[i].byteLength),bytes(expected[i]));assert.equal(buffer.unmaps,1);assert.equal(buffer.destroys,0);}
 assert.equal(f.renderer.mesh(primitive),mesh);assert.equal(f.renderer.mesh({kind:'box',size:[1,2,3]}),mesh);assert.equal(f.attempts,3);
 assert.deepEqual(f.destroyOrder,[]);for(const buffer of [mesh.vertex,mesh.color,mesh.index])buffer.destroy();assert.deepEqual(f.created.map(b=>b.destroys),[1,1,1]);
});

test('every partial cold-mesh allocation is destroyed on create/map-range/copy/unmap failure',async t=>{
 for(const step of ['create','range','short','unmap'])for(const failAt of [1,2,3])await t.test(step+' '+failAt,()=>{
  const f=fixture({step,failAt}),primitive={kind:'box'};
  assert.throws(()=>f.renderer.mesh(primitive),step==='short'?RangeError:error=>error===f.failure);
  assert.equal(f.renderer.meshes.size,0);assert.equal(f.renderer.meshByPrimitive.has(primitive),false);
  assert.deepEqual(f.destroyOrder,f.created.map(b=>b.id).reverse());for(const buffer of f.created){assert.equal(buffer.destroys,1);assert.equal(buffer.state,'destroyed');}
 });
});

test('failed cache admission rolls back both indices before disposing buffers, then permits a clean retry',async t=>{
 for(const target of ['meshes','meshByPrimitive'])await t.test(target,()=>{
  const f=fixture(),primitive={kind:'box'},cache=f.renderer[target],set=cache.set,publicationError=new Error('publish '+target);
  cache.set=function(key,value){Reflect.apply(set,this,[key,value]);throw publicationError;};
  assert.throws(()=>f.renderer.mesh(primitive),error=>error===publicationError);assert.equal(f.renderer.meshes.size,0);assert.equal(f.renderer.meshByPrimitive.has(primitive),false);assert.deepEqual(f.destroyOrder,[3,2,1]);
  cache.set=set;const mesh=f.renderer.mesh(primitive);assert.equal(f.attempts,6);assert.equal(f.renderer.meshes.get(mesh.key),mesh);assert.equal(f.renderer.meshByPrimitive.get(primitive),mesh);assert.deepEqual(f.created.map(b=>b.destroys),[1,1,1,0,0,0]);
 });
});

test('rollback attempts every destroy and using retains the primary failure when cleanup also fails',()=>{
 const f=fixture({step:'range',failAt:3,destroyFailures:[2,3]});let failure;
 try{f.renderer.mesh({kind:'box'});}catch(error){failure=error;}
 assert.equal(failure?.name,'SuppressedError');assert.equal(failure.suppressed,f.failure);assert.equal(failure.error instanceof AggregateError,true);assert.deepEqual(failure.error.errors,[f.created[2].cleanupError,f.created[1].cleanupError]);
 assert.deepEqual(f.destroyOrder,[3,2,1]);assert.deepEqual(f.created.map(b=>b.destroys),[1,1,1]);assert.equal(f.renderer.meshes.size,0);
});

test('linear readback keeps exact half-float samples/copy coordinates and releases after unmap',async()=>{
 const f=fixture(),result=await f.renderer.sampleLinearPixels([[1,2],[3,0]]);
 assert.deepEqual(result,[{x:1,y:2,rgba:[1,.5,2,1]},{x:3,y:0,rgba:[1,.5,2,1]}]);assert.equal(f.attempts,1);assert.equal(f.created[0].unmaps,1);assert.equal(f.created[0].destroys,1);
 assert.deepEqual(f.copies.map(c=>[c.source.origin,c.destination.offset,c.destination.bytesPerRow,c.size]),[[[1,2,0],0,256,[1,1,1]],[[3,0,0],256,256,[1,1,1]]]);assert.deepEqual(f.events.slice(-2),[['unmap',1],['destroy',1]]);
 const reflection=fixture();await reflection.renderer.sampleLinearPixels([[3,3]],'reflection');assert.deepEqual(reflection.copies[0].source.origin,[1,1,0]);assert.equal(reflection.created[0].destroys,1);
});

test('readback releases its buffer on all encoder/submission/mapping/decode/unmap failures',async t=>{
 for(const step of ['create','encoder','copy','finish','submit','map','range','short','unmap'])await t.test(step,async()=>{
  const f=fixture({step});await assert.rejects(f.renderer.sampleLinearPixels([[1,1]]),step==='short'?RangeError:error=>error===f.failure);
  for(const buffer of f.created){assert.equal(buffer.destroys,1);assert.equal(buffer.state,'destroyed');}assert.deepEqual(f.destroyOrder,step==='create'?[]:[1]);
 });
});

test('bounds rejection disposes exactly once while empty/unavailable readbacks never allocate',async()=>{
 const invalid=fixture();await assert.rejects(invalid.renderer.sampleLinearPixels([[4,0]]),/outside/);assert.equal(invalid.created[0].destroys,1);assert.equal(invalid.created[0].unmaps,0);
 const empty=fixture();assert.deepEqual(await empty.renderer.sampleLinearPixels([]),[]);assert.equal(empty.attempts,0);
 const missing=fixture();delete missing.renderer.hdr;await assert.rejects(missing.renderer.sampleLinearPixels([[0,0]]),/unavailable/);assert.equal(missing.attempts,0);
 const disabled=fixture();disabled.renderer.pipelinePlan.features.planarReflections=false;await assert.rejects(disabled.renderer.sampleLinearPixels([[0,0]],'reflection'),/disabled/);assert.equal(disabled.attempts,0);
});

test('readback scope holds ownership until an asynchronous rejection, including cleanup failure suppression',async()=>{
 const f=fixture({destroyFailures:[1]}),primary=new Error('late map abort');let reject;
 f.device.createBuffer=(create=>descriptor=>{const buffer=create(descriptor);buffer.mapAsync=()=>new Promise((resolve,failure)=>{reject=failure;});return buffer;})(f.device.createBuffer);
 const result=f.renderer.sampleLinearPixels([[0,0]]);assert.equal(f.created[0].destroys,0);reject(primary);
 await assert.rejects(result,error=>error.name==='SuppressedError'&&error.suppressed===primary&&error.error===f.created[0].cleanupError);assert.equal(f.created[0].destroys,1);
});
