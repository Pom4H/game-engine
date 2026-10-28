import test from 'node:test';
import assert from 'node:assert/strict';
import {compactTriangleMesh,prepareCopiedTriangleMesh,primitiveMesh,primitiveKey,meshVertexAttributes,isOwnedValidatedTriangleMesh,ownedTriangleMeshBounds} from '../dist/procedural/mesh.js';
import {WebGPURenderer} from '../dist/render/webgpu.js';
import {Scene} from '../dist/scene/scene.js';
import {meshBounds} from '../dist/render/visibility.js';
import {initializationDevice} from './helpers/render-initialization-device.mjs';

const fields=['positions','normals','indices','colors','uvs','variationSeeds'];
const triangle=()=>({positions:[-0,1e12+.125,-3.25,1.25,2.5,-3.125,-1.5,2.75,-3],normals:[0,0,-1,0,0,-1,0,0,-1],indices:[0,1,2],colors:[.5,.125,1,1,0,.75,1,.5,1,.25,0,1],uvs:[1e-20,-0,1e5+.125,.5,0,1],variationSeeds:[-0,3.25,77.125]});
const bytes=x=>Buffer.from(x.buffer,x.byteOffset,x.byteLength);
function finish(ticket,budget=13){let n=0;while(!ticket.step(budget)){assert.equal(ticket.mesh,undefined);assert.ok(++n<1000000);}return ticket.mesh;}
function equalData(a,b){assert.equal(a.indexFormat,b.indexFormat);for(const field of ['vertices','colors','indices','uvs','variationSeeds']){assert.equal(a[field]===undefined,b[field]===undefined,field);if(a[field])assert.deepEqual(bytes(a[field]),bytes(b[field]),field);}}
function fixture(fail={}){
 const events=[],buffers=[],writes=[];let creates=0;
 const failure=new Error('injected GPU failure');
 const device={limits:{maxBufferSize:268435456},createBuffer(spec){events.push(['create',spec.size]);if(++creates===fail.create)throw failure;const buffer={spec,data:new Uint8Array(spec.size),destroys:0,destroy(){this.destroys++;events.push(['destroy',buffers.indexOf(this)]);if(fail.destroy===buffers.indexOf(this))throw failure;}};buffers.push(buffer);return buffer;},queue:{writeBuffer(buffer,offset,data){events.push(['write',data.byteLength]);if(writes.length===fail.write)throw failure;buffer.data.set(new Uint8Array(data.buffer,data.byteOffset,data.byteLength),offset);writes.push({buffer,offset,bytes:data.byteLength});}}};
 const renderer=Object.create(WebGPURenderer.prototype);Object.assign(renderer,{device,meshes:new Map(),meshByPrimitive:new WeakMap(),objects:new Map(),labels:new Map(),modelCache:new Map()});
 return{renderer,device,buffers,writes,events,failure};
}
function upload(lease,budget=64){let n=0;while(!lease.step(budget))assert.ok(++n<100000);return lease;}
function equalGPU(resource,expected){assert.deepEqual(resource.vertex.data.subarray(0,expected.vertices.byteLength),new Uint8Array(expected.vertices.buffer));assert.deepEqual(resource.color.data,meshVertexAttributes(expected));assert.deepEqual(resource.index.data.subarray(0,expected.indices.byteLength),new Uint8Array(expected.indices.buffer));assert.deepEqual(resource.index.data.subarray(expected.indices.byteLength),new Uint8Array(resource.index.data.length-expected.indices.byteLength));assert.deepEqual(resource.bounds,meshBounds(expected.vertices));assert.equal(resource.format,expected.indexFormat);assert.equal(resource.count,expected.indices.length);}

test('copied ticket spends scalar credits, issues no early brand, and preserves full original-double/public MeshData semantics',()=>{
 const input=triangle(),trace=[];
 const source={};for(const field of fields)Object.defineProperty(source,field,{get(){trace.push(field);return new Proxy(input[field],{get(target,key,receiver){if(/^\d+$/.test(String(key)))trace.push(field+'.'+key);return Reflect.get(target,key,receiver);}});}});
 const ticket=prepareCopiedTriangleMesh(source);assert.deepEqual(trace,[]);assert.equal(ticket.done,false);assert.equal(ticket.mesh,undefined);
 let previous=0,iterations=0;while(!ticket.step(1)){const indexed=trace.filter(x=>x.includes('.')).length;assert.ok(indexed-previous<=1);previous=indexed;assert.equal(ticket.mesh,undefined);assert.ok(++iterations<1000);}
 const mesh=ticket.mesh;assert.equal(ticket.done,true);assert.equal(isOwnedValidatedTriangleMesh(mesh),true);assert.equal(isOwnedValidatedTriangleMesh(new Proxy(mesh,{})),false);assert.equal(Object.isFrozen(mesh),true);
 for(const field of fields){assert.equal(Object.getOwnPropertyDescriptor(mesh,field).enumerable,true);assert.equal(Object.isFrozen(mesh[field]),true);assert.equal(mesh[field],mesh[field]);assert.deepEqual(mesh[field],input[field]);}
 const expected=primitiveMesh(compactTriangleMesh(input)),packed=primitiveMesh(mesh),again=primitiveMesh(mesh);equalData(packed,expected);
 for(const field of ['vertices','colors','indices','uvs','variationSeeds']){assert.notEqual(packed[field].buffer,again[field].buffer);packed[field].fill(0);}equalData(primitiveMesh(mesh),expected);
 const bounds=ownedTriangleMeshBounds(mesh);assert.equal(Object.isFrozen(bounds),true);assert.deepEqual(bounds,ownedTriangleMeshBounds(compactTriangleMesh(input)));
 input.positions.fill(500);assert.notEqual(mesh.positions[0],500);
 const scene=new Scene({version:1,entities:[]});scene.add({id:'staged',mesh,renderOnly:true});assert.equal(scene.entities.get('staged').mesh,mesh);assert.equal(primitiveKey(mesh).startsWith('dynamic:'),true);
});

test('full validation/error order matches the synchronous factory; invalid/cancelled tickets consume no dynamic key',()=>{
 const invalids=[s=>{delete s.positions[1];},s=>s.normals.pop(),s=>s.indices[1]=.5,s=>s.indices[2]=-1,s=>s.indices[2]=3,s=>s.colors[0]=2,s=>s.uvs[0]=NaN,s=>s.variationSeeds[0]=1e300,s=>s.indices.length=0];
 for(const change of invalids){const source=triangle();change(source);let expected;try{compactTriangleMesh(source);}catch(error){expected=error;}assert.ok(expected);const ticket=prepareCopiedTriangleMesh(source);assert.throws(()=>finish(ticket),error=>error.constructor===expected.constructor&&error.message===expected.message);assert.equal(ticket.mesh,undefined);assert.equal(ticket.done,false);}
 const a=compactTriangleMesh(triangle()),ticket=prepareCopiedTriangleMesh(triangle());ticket.step(2);ticket.cancel();ticket.cancel();assert.throws(()=>ticket.step(1),/cancelled/);const b=compactTriangleMesh(triangle());assert.equal(Number(primitiveKey(b).slice(8)),Number(primitiveKey(a).slice(8))+1);
 let reentered;const source=triangle();Object.defineProperty(source.positions,0,{get(){reentered=assert.throws(()=>pending.step(1),/reenter/);return 0;}});const pending=prepareCopiedTriangleMesh(source);assert.ok(finish(pending));
 const cancelled=triangle();Object.defineProperty(cancelled.positions,0,{get(){cancelling.cancel();return 0;}});const cancelling=prepareCopiedTriangleMesh(cancelled);assert.equal(cancelling.step(5),false);assert.equal(cancelling.mesh,undefined);
});

test('segmented factory keeps private numeric blocks away from replaceable builtins and prototype setters',()=>{
 const source=triangle(),saveSet=WeakMap.prototype.set,saveGet=WeakMap.prototype.get,saveFrom=Array.from,saveIterator=Float64Array.prototype[Symbol.iterator],apply=Reflect.apply,escaped=[];
 const pending=prepareCopiedTriangleMesh(source);let mesh;
 try{
  WeakMap.prototype.set=function(key,value){if(value?.positions?.blocks)escaped.push(value);return apply(saveSet,this,[key,value]);};
  WeakMap.prototype.get=function(key){const value=apply(saveGet,this,[key]);if(value?.positions?.blocks)escaped.push(value);return value;};
  Array.from=function(value,...rest){if(ArrayBuffer.isView(value))escaped.push(value);return apply(saveFrom,this,[value,...rest]);};
  Float64Array.prototype[Symbol.iterator]=function(){escaped.push(this);return apply(saveIterator,this,[]);};
  Object.defineProperty(Array.prototype,0,{configurable:true,get(){return undefined;},set(value){if(ArrayBuffer.isView(value))escaped.push(value);}});
  // A prototype setter can interfere with unrelated test helpers; the factory
  // itself uses captured defineProperty for private block/public array slots.
  while(!pending.step(7)){}mesh=pending.mesh;void mesh.positions;
 }finally{WeakMap.prototype.set=saveSet;WeakMap.prototype.get=saveGet;Array.from=saveFrom;Float64Array.prototype[Symbol.iterator]=saveIterator;delete Array.prototype[0];}
 assert.equal(escaped.length,0);assert.deepEqual(mesh.positions,source.positions);
});

test('GPU preparation uploads exact packed bytes with one allocation or one bounded write per step, then live mesh is a pure cache hit',()=>{
 for(const source of [triangle(),{positions:[0,0,0,1,0,0,0,1,0],normals:[0,0,-1,0,0,-1,0,0,-1],indices:[0,1,2]}]){
  const mesh=finish(prepareCopiedTriangleMesh(source)),expected=primitiveMesh(compactTriangleMesh(source)),f=fixture(),lease=f.renderer.prepareMesh(mesh);
  assert.throws(()=>lease.commit(),/incomplete/);let iterations=0;
  while(!lease.ready){const before=f.events.length;lease.step(20);const work=f.events.slice(before);assert.ok(work.length<=1);if(work[0]?.[0]==='write')assert.ok(work[0][1]<=20);assert.ok(++iterations<100);}
  assert.equal(f.renderer.meshes.size,0);lease.commit();lease.commit();const resource=f.renderer.meshes.get(primitiveKey(mesh));equalGPU(resource,expected);
  const before=f.events.length;assert.equal(f.renderer.mesh(mesh),resource);assert.equal(f.events.length,before);
  lease.dispose();lease.dispose();assert.equal(f.buffers.reduce((n,b)=>n+b.destroys,0),0,'committed ownership belongs to cache, not lease');
 }
});

test('committed positive/mirror pins survive collection until explicitly released, with duplicate/cache leases sharing one residency',()=>{
 const mesh=finish(prepareCopiedTriangleMesh(triangle())),f=fixture(),a=upload(f.renderer.prepareMesh(mesh)),b=upload(f.renderer.prepareMesh(mesh));
 a.commit();b.commit();assert.equal(f.renderer.meshes.size,1);assert.deepEqual(f.buffers.map(x=>x.destroys),[0,0,0,1,1,1]);
 const scene=new Scene({version:1,entities:[]});f.renderer.collect(scene);assert.equal(f.renderer.meshes.size,1);
 const cached=f.renderer.prepareMesh(mesh);assert.equal(cached.ready,true);a.dispose();b.dispose();f.renderer.collect(scene);assert.equal(f.renderer.meshes.size,1);
 cached.dispose();f.renderer.collect(scene);assert.equal(f.renderer.meshes.size,0);assert.equal(f.buffers.every(x=>x.destroys===1),true);
});

test('partial upload, cancellation and cache-admission failures release all owned buffers and cannot publish a partial mesh',()=>{
 const mesh=finish(prepareCopiedTriangleMesh(triangle()));
 for(const fail of [{create:1},{create:2},{create:3},{write:0},{write:2}]){const f=fixture(fail),lease=f.renderer.prepareMesh(mesh);assert.throws(()=>upload(lease,8),error=>error===f.failure);assert.equal(f.renderer.meshes.size,0);assert.equal(f.buffers.every(x=>x.destroys===1),true);lease.dispose();}
 for(const steps of [0,1,2,3,7]){const f=fixture(),lease=f.renderer.prepareMesh(mesh);for(let i=0;i<steps;i++)lease.step(4);lease.dispose();lease.dispose();assert.equal(f.buffers.every(x=>x.destroys===1),true);assert.equal(f.renderer.meshPreparationLeases.size,0);assert.throws(()=>lease.step(),/disposed/);}
 const f=fixture(),lease=upload(f.renderer.prepareMesh(mesh));f.renderer.meshByPrimitive={set(){throw f.failure;},delete(){}};assert.throws(()=>lease.commit(),error=>error===f.failure);assert.equal(f.renderer.meshes.size,0);assert.equal(f.buffers.every(x=>x.destroys===1),true);
 const pin=fixture(),pinLease=upload(pin.renderer.prepareMesh(mesh));pin.renderer.preparedMeshPins.set=()=>{throw pin.failure;};assert.throws(()=>pinLease.commit(),error=>error===pin.failure);assert.equal(pin.renderer.meshes.size,0);assert.equal(pin.buffers.every(x=>x.destroys===1),true);
 const broken=fixture({create:3,destroy:0}),brokenLease=broken.renderer.prepareMesh(mesh);assert.throws(()=>upload(brokenLease),AggregateError);assert.equal(broken.buffers.every(x=>x.destroys===1),true);
});

test('renderer disposal cancels unfinished leases and committed pins; staged preparation never probes unbranded channel getters',async t=>{
 const fake=fixture();let reads=0;const unbranded={kind:'triangle-mesh',get positions(){reads++;return[];}};assert.throws(()=>fake.renderer.prepareMesh(unbranded),/owned validated/);assert.equal(reads,0);
 const env=initializationDevice(t),renderer=await WebGPURenderer.create(env.canvas),mesh=finish(prepareCopiedTriangleMesh(triangle()));renderer.device.queue.writeBuffer=()=>{};
 const pending=renderer.prepareMesh(mesh);pending.step();const committed=renderer.prepareMesh(mesh);for(let i=0;!committed.ready;i++){committed.step();await Promise.resolve();assert.ok(i<100);}committed.commit();
 assert.equal(renderer.meshPreparationLeases.size,2);renderer.dispose();renderer.dispose();assert.equal(renderer.meshPreparationLeases.size,0);assert.equal(renderer.preparedMeshPins.size,0);assert.equal(renderer.meshes.size,0);assert.throws(()=>pending.step(),/disposed/);assert.throws(()=>committed.commit(),/disposed/);assert.throws(()=>renderer.prepareMesh(mesh),/disposed/);
});

test('GPU error-scope acknowledgements fence ready/commit; rejection keeps previous mesh and late cancelled acknowledgements are harmless',async()=>{
 const f=fixture(),oldMesh=finish(prepareCopiedTriangleMesh(triangle())),old=upload(f.renderer.prepareMesh(oldMesh));old.commit();const oldResource=f.renderer.meshes.get(primitiveKey(oldMesh));
 let stack=0;const checks=[];f.device.pushErrorScope=()=>{stack++;};f.device.popErrorScope=()=>{stack--;return new Promise((resolve,reject)=>checks.push({resolve,reject}));};
 const mesh=finish(prepareCopiedTriangleMesh(triangle())),lease=f.renderer.prepareMesh(mesh);for(let i=0;i<20;i++)lease.step(65536);
 assert.equal(stack,0,'no error scope spans a frame or a preparation step');assert.equal(lease.ready,false);assert.throws(()=>lease.commit(),/incomplete/);const events=f.events.length;assert.equal(lease.step(4),false);assert.equal(f.events.length,events,'pending acknowledgements cannot reallocate/repack');
 checks[0].resolve({message:'injected out-of-memory'});for(const check of checks.slice(1))check.resolve(null);await new Promise(resolve=>setImmediate(resolve));assert.equal(lease.ready,false);assert.throws(()=>lease.commit(),/injected out-of-memory/);assert.equal(f.renderer.meshes.size,1);assert.equal(f.renderer.meshes.get(primitiveKey(oldMesh)),oldResource);assert.ok(f.buffers.slice(3).every(b=>b.destroys===1));assert.ok(f.buffers.slice(0,3).every(b=>b.destroys===0));
 const cancelled=f.renderer.prepareMesh(mesh);cancelled.step();cancelled.dispose();for(const check of checks)check.reject(new Error('late scope rejection'));await new Promise(resolve=>setImmediate(resolve));assert.equal(cancelled.ready,false);assert.equal(f.renderer.meshes.size,1);old.dispose();
});

test('slow error-scope acknowledgements have a fixed outstanding bound and cannot grow a hidden promise/upload queue',async()=>{
 const f=fixture(),checks=[];let stack=0;
 f.device.pushErrorScope=()=>{stack++;};f.device.popErrorScope=()=>{stack--;return new Promise(resolve=>checks.push(resolve));};
 const source={positions:new Float64Array(3000),normals:new Float64Array(3000),indices:new Float64Array([0,1,2])},mesh=finish(prepareCopiedTriangleMesh(source),2048),lease=f.renderer.prepareMesh(mesh);
 for(let n=0;n<1000;n++)lease.step(4);
 assert.equal(checks.length,16);assert.equal(stack,0);assert.equal(f.events.length,8);assert.equal(lease.ready,false);
 lease.dispose();for(const resolve of checks)resolve({message:'late cancelled error'});await new Promise(resolve=>setImmediate(resolve));assert.equal(lease.ready,false);assert.ok(f.buffers.every(b=>b.destroys===1));
});

test('synchronous device reentry cannot duplicate allocations and cancellation during create/upload destroys every returned buffer',()=>{
 const mesh=finish(prepareCopiedTriangleMesh(triangle()));
 for(const cancelAt of ['create','upload','scope']){
  const f=fixture(),lease=f.renderer.prepareMesh(mesh),create=f.device.createBuffer,write=f.device.queue.writeBuffer;let entered=false;
  if(cancelAt==='create')f.device.createBuffer=spec=>{assert.throws(()=>lease.step(),/reenter/);const buffer=create(spec);lease.dispose();return buffer;};
  if(cancelAt==='upload')f.device.queue.writeBuffer=(...args)=>{assert.throws(()=>lease.step(),/reenter/);write(...args);lease.dispose();};
  if(cancelAt==='scope'){f.device.pushErrorScope=()=>{};f.device.popErrorScope=()=>{if(!entered){entered=true;lease.dispose();}return Promise.resolve(null);};}
  assert.throws(()=>upload(lease),/disposed/);assert.ok(f.buffers.every(b=>b.destroys===1),cancelAt);assert.equal(f.renderer.meshes.size,0);assert.equal(f.renderer.meshPreparationLeases.size,0);
 }
});

test('cache-publication cancellation rolls back both indices and renderer reentry cannot retain or double-destroy a late lease',async t=>{
 const mesh=finish(prepareCopiedTriangleMesh(triangle())),f=fixture(),lease=upload(f.renderer.prepareMesh(mesh)),set=f.renderer.meshByPrimitive.set.bind(f.renderer.meshByPrimitive);
 f.renderer.meshByPrimitive.set=(...args)=>{set(...args);assert.throws(()=>lease.commit(),/reenter/);lease.dispose();};
 assert.throws(()=>lease.commit(),/disposed during cache/);assert.equal(f.renderer.meshes.size,0);assert.equal(f.renderer.meshByPrimitive.has(mesh),false);assert.ok(f.buffers.every(b=>b.destroys===1));assert.equal(f.renderer.preparedMeshPins.size,0);
 for(const when of ['publication','cached-pin']){
  const env=initializationDevice(t),renderer=await WebGPURenderer.create(env.canvas),owned=fixture();renderer.device.createBuffer=owned.device.createBuffer;renderer.device.queue.writeBuffer=owned.device.queue.writeBuffer;
  const pending=renderer.prepareMesh(mesh);for(let i=0;!pending.ready;i++){pending.step();await Promise.resolve();assert.ok(i<100);}
  if(when==='publication'){
   const nativeSet=renderer.meshByPrimitive.set.bind(renderer.meshByPrimitive);renderer.meshByPrimitive.set=(...args)=>{nativeSet(...args);renderer.dispose();};assert.throws(()=>pending.commit(),/disposed during cache/);
  }else{
   pending.commit();const pins=renderer.preparedMeshPins,nativeSet=pins.set.bind(pins);pins.set=(...args)=>{nativeSet(...args);renderer.dispose();return pins;};assert.throws(()=>renderer.prepareMesh(mesh),/disposed during mesh/);
  }
  assert.ok(owned.buffers.every(buffer=>buffer.destroys===1),when);assert.equal(renderer.meshes.size,0);assert.equal(renderer.meshPreparationLeases.size,0);assert.equal(renderer.preparedMeshPins.size,0);
 }
});

test('supported largest original part and index-width boundary preserve bytes while no upload block exceeds 64 KiB',()=>{
 for(const count of [60000,65535,65536]){
  const source={positions:new Float64Array(count*3),normals:new Float64Array(count*3),indices:count===60000?Float64Array.from({length:60000},(_,i)=>i):new Float64Array([0,count-2,count-1])};
  for(let i=0;i<count;i++){source.positions[i*3]=i*.125;source.positions[i*3+1]=i%3;source.normals[i*3+2]=-1;}
  const mesh=finish(prepareCopiedTriangleMesh(source),2048),f=fixture(),lease=upload(f.renderer.prepareMesh(mesh),1024*1024);lease.commit();equalGPU(f.renderer.meshes.get(primitiveKey(mesh)),primitiveMesh(compactTriangleMesh(source)));assert.ok(f.writes.every(x=>x.bytes<=65536));lease.dispose();
 }
});
