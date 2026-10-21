import test from 'node:test';
import assert from 'node:assert/strict';
import {WebGPURenderer} from '../dist/render/webgpu.js';
import {Scene} from '../dist/scene/scene.js';
import {primitiveMesh,primitiveKey,meshVertexAttributes,freezePrimitive} from '../dist/procedural/mesh.js';
import {buildRenderFrame,RenderFrameCache} from '../dist/render/frame.js';
import {RenderVisibilityPlan} from '../dist/render/visibility-plan.js';
import {triangleStreamState} from '../dist/procedural/triangle-stream.js';
import {distantRadianceKey} from '../dist/render/radiance.js';
import {meshBounds} from '../dist/render/visibility.js';
import {RenderMeshQuery} from '../dist/render/mesh-ray.js';

function fixture(){
 const buffers=[],writes=[],fault={create:0,write:false,callback:undefined},device={limits:{maxBufferSize:268435456},createBuffer(spec){if(++fault.create===fault.failCreate)throw Error('allocation failure');const buffer={bytes:new Uint8Array(spec.size),destroyed:0,destroy(){this.destroyed++;}};buffers.push(buffer);fault.callback?.();return buffer;},queue:{writeBuffer(buffer,offset,source,sourceOffset=0,size){if(fault.write)throw Error('write failure');const bytes=source instanceof ArrayBuffer?new Uint8Array(source,sourceOffset,size):new Uint8Array(source.buffer,source.byteOffset+sourceOffset,size??source.byteLength);buffer.bytes.set(bytes,offset);writes.push({buffer,offset,length:bytes.byteLength});fault.callback?.();}}};
 const renderer=Object.create(WebGPURenderer.prototype);Object.assign(renderer,{device,meshes:new Map(),meshByPrimitive:new WeakMap(),preparedMeshPins:new Map(),disposed:false});
 return{renderer,device,buffers,writes,fault};
}
function finish(lease,budget=64){let n=0;while(!lease.step(budget))assert.ok(++n<100000);return lease.commit();}
const triangle=(x=0)=>new Float32Array([x,0,0,0,0,1,x+1,0,0,0,0,1,x,1,0,0,0,1]);
const scene=()=>new Scene({version:1,entities:[]});
const bytes=view=>Buffer.from(view.buffer,view.byteOffset,view.byteLength);

test('cold page uses bounded steps; active updates preserve the exact expanded attributes/order without GPU allocation or source retention',()=>{
 const f=fixture(),lease=f.renderer.prepareTriangleStream({capacityTriangles:4,color:[46,71,82,255]});
 assert.deepEqual(Object.getOwnPropertyNames(lease),[],'public cold owner cannot expose private typed banks through TypeScript-only private fields');
 assert.equal(f.buffers.length,0);assert.equal(lease.ready,false);assert.throws(()=>lease.commit(),/incomplete/);
 const stream=finish(lease,32),resource=f.renderer.mesh(stream.primitive),key=primitiveKey(stream.primitive),allocations=f.buffers.length;
 assert.equal(allocations,4);assert.ok(f.writes.every(write=>write.length<=32));assert.equal(resource.count,0);
 const input=new Float32Array([...triangle(0),...triangle(3)]);stream.update(input,6);input.fill(99);
 const data=primitiveMesh(stream.primitive);assert.deepEqual(data.vertices,new Float32Array([...triangle(0),...triangle(3)]));assert.deepEqual([...data.indices],[0,1,2,3,4,5]);
 assert.deepEqual([...data.uvs],[0,0,1,0,0,1,0,0,1,0,0,1]);assert.deepEqual([...data.variationSeeds],[0,0,0,0,0,0]);assert.deepEqual([...data.colors],Array(6).fill([46,71,82,255]).flat());
 assert.deepEqual(resource.vertex.bytes.subarray(0,data.vertices.byteLength),new Uint8Array(data.vertices.buffer));assert.deepEqual(resource.color.bytes.subarray(0,data.vertices.length/6*16),meshVertexAttributes(data));assert.deepEqual(resource.bounds,meshBounds(data.vertices));
 for(let i=0;i<50;i++)stream.update(triangle(i/10),3);
 assert.equal(f.buffers.length,allocations);assert.equal(f.renderer.mesh(stream.primitive),resource);assert.equal(primitiveKey(stream.primitive),key);assert.ok(f.writes.every(write=>write.length<=65536));assert.equal(resource.count,3);assert.equal(stream.triangleCount,1);assert.equal(stream.revision,51);
 lease.dispose();assert.ok(f.buffers.every(buffer=>buffer.destroyed===0));stream.dispose();stream.dispose();assert.throws(()=>lease.commit(),/disposed/);assert.ok(f.buffers.every(buffer=>buffer.destroyed===1));assert.equal(f.renderer.meshes.size,0);assert.equal(f.renderer.preparedMeshPins.size,0);
});

test('invalid, oversized, reentrant and failed uploads preserve the exact previous visible bank/count/bounds/revision',()=>{
 const f=fixture(),stream=finish(f.renderer.prepareTriangleStream({capacityTriangles:2,color:[46,71,82,255]}));stream.update(triangle(),3);
 const mesh=f.renderer.mesh(stream.primitive),front=mesh.vertex,previous=primitiveMesh(stream.primitive),revision=stream.revision,bounds=structuredClone(mesh.bounds);
 for(const [input,count]of [[new Float32Array(36),7],[triangle(),6],[triangle(),1]])assert.throws(()=>stream.update(input,count),/page/);
 const invalid=triangle(3);invalid[17]=NaN;assert.throws(()=>stream.update(invalid,3),/nonfinite/);
 f.fault.write=true;assert.throws(()=>stream.update(triangle(8),3),/write failure/);f.fault.write=false;
 assert.equal(mesh.vertex,front);assert.equal(stream.revision,revision);assert.deepEqual(mesh.bounds,bounds);assert.deepEqual(primitiveMesh(stream.primitive),previous);
 f.fault.callback=()=>assert.throws(()=>stream.update(triangle(),3),/reenter/);stream.update(triangle(5),3);f.fault.callback=undefined;
 stream.update(new Float32Array(),0);assert.equal(stream.triangleCount,0);assert.equal(mesh.count,0);assert.deepEqual(mesh.bounds,{center:[0,0,0],half:[0,0,0]});stream.update(triangle(),3);assert.equal(stream.triangleCount,1);stream.dispose();
});

test('multi-page staging is all-or-previous on upload failure; commit tails do no I/O and stale tickets cannot commit later stages',()=>{
 const f=fixture(),a=finish(f.renderer.prepareTriangleStream({capacityTriangles:2,color:[46,71,82,255]})),b=finish(f.renderer.prepareTriangleStream({capacityTriangles:2,color:[46,71,82,255]}));a.update(triangle(1),3);b.update(triangle(2),3);
 const beforeA=primitiveMesh(a.primitive),beforeB=primitiveMesh(b.primitive),revisionA=a.revision,revisionB=b.revision;
 const stagedA=a.stage(triangle(11),3);assert.deepEqual(Object.getOwnPropertyNames(stagedA),[]);assert.throws(()=>a.stage(triangle(12),3),/pending/);assert.deepEqual(primitiveMesh(a.primitive),beforeA);f.fault.write=true;assert.throws(()=>b.stage(triangle(22),3),/write failure/);f.fault.write=false;stagedA.dispose();stagedA.dispose();assert.equal(a.revision,revisionA);assert.equal(b.revision,revisionB);assert.deepEqual(primitiveMesh(a.primitive),beforeA);assert.deepEqual(primitiveMesh(b.primitive),beforeB);
 const nextA=a.stage(triangle(33),3),nextB=b.stage(triangle(44),3),writes=f.writes.length;assert.throws(()=>stagedA.commit(),/settled/);f.fault.write=true;nextA.commit();nextB.commit();f.fault.write=false;assert.equal(f.writes.length,writes);assert.equal(primitiveMesh(a.primitive).vertices[0],33);assert.equal(primitiveMesh(b.primitive).vertices[0],44);assert.equal(a.revision,revisionA+1);assert.equal(b.revision,revisionB+1);assert.throws(()=>nextA.commit(),/settled/);
 const cancel=a.stage(triangle(55),3);a.dispose();assert.throws(()=>cancel.commit(),/disposed/);cancel.dispose();b.dispose();assert.ok(f.buffers.every(buffer=>buffer.destroyed===1));
});

test('every allocation/partial-upload cancellation destroys all owned buffers, including cancellation during native callbacks',()=>{
 for(let allocation=1;allocation<=4;allocation++){const f=fixture();f.fault.failCreate=allocation;const lease=f.renderer.prepareTriangleStream({capacityTriangles:2,color:[46,71,82,255]});assert.throws(()=>finish(lease),/allocation failure/);lease.dispose();assert.ok(f.buffers.every(buffer=>buffer.destroyed===1));assert.equal(f.renderer.meshes.size,0);}
 const f=fixture(),lease=f.renderer.prepareTriangleStream({capacityTriangles:2,color:[46,71,82,255]});f.fault.callback=()=>lease.dispose();assert.throws(()=>finish(lease),/disposed|cancelled/);assert.ok(f.buffers.every(buffer=>buffer.destroyed===1));
 const a=fixture(),pending=a.renderer.prepareTriangleStream({capacityTriangles:2,color:[46,71,82,255]});pending.step(64);pending.step(64);pending.step(64);a.fault.write=true;assert.throws(()=>finish(pending),/write failure/);assert.ok(a.buffers.every(buffer=>buffer.destroyed===1));
});

test('GPU error ACKs prevent early publication and rejected cold pages clean up without fallback',async()=>{
 const f=fixture(),checks=[];f.device.pushErrorScope=()=>{};f.device.popErrorScope=()=>new Promise(resolve=>checks.push(resolve));
 const lease=f.renderer.prepareTriangleStream({capacityTriangles:1,color:[46,71,82,255]});let n=0;
 while(checks.length===0){lease.step(64);assert.ok(++n<100);}
 assert.equal(lease.ready,false);assert.throws(()=>lease.commit(),/incomplete/);checks.shift()(new Error('rejected'));for(const resolve of checks.splice(0))resolve(null);await new Promise(resolve=>setImmediate(resolve));assert.throws(()=>lease.step(64),/GPU error|GPU preparation/);assert.ok(f.buffers.every(buffer=>buffer.destroyed===1));assert.equal(f.renderer.meshes.size,0);
});

test('failed cache admission or live ownership transfer never leaves a cached dead buffer or resident pin',()=>{
 for(const phase of ['cache','owner']){const f=fixture(),lease=f.renderer.prepareTriangleStream({capacityTriangles:1,color:[46,71,82,255]});while(!lease.step(64)){}
  if(phase==='cache'){const set=f.renderer.meshes.set;f.renderer.meshes.set=function(key,value){set.call(this,key,value);throw Error('cache publication');};}
  else{const add=f.renderer.triangleStreams.add;f.renderer.triangleStreams.add=function(value){add.call(this,value);throw Error('ownership publication');};}
  assert.throws(()=>lease.commit(),/publication/);lease.dispose();assert.equal(f.renderer.meshes.size,0);assert.equal(f.renderer.preparedMeshPins.size,0);assert.equal(f.renderer.triangleStreams.size,0);assert.ok(f.buffers.every(buffer=>buffer.destroyed===1));
 }
});

test('reentrant preparation registration and final retirement cannot return a late disposed owner',()=>{
 for(const insertFirst of [false,true]){const f=fixture();f.renderer.triangleStreamPreparations=new Set();const set=f.renderer.triangleStreamPreparations,add=set.add;set.add=function(value){if(insertFirst)add.call(this,value);f.renderer.disposed=true;if(!insertFirst)add.call(this,value);return this;};assert.throws(()=>f.renderer.prepareTriangleStream({capacityTriangles:1,color:[46,71,82,255]}),/disposed/);assert.equal(set.size,0);assert.equal(f.buffers.length,0);}
 const f=fixture(),lease=f.renderer.prepareTriangleStream({capacityTriangles:1,color:[46,71,82,255]});while(!lease.step(64)){}const set=f.renderer.triangleStreamPreparations,remove=set.delete;let invoked=false;set.delete=function(value){const result=remove.call(this,value);if(!invoked){invoked=true;[...f.renderer.triangleStreams][0]?.dispose();}return result;};assert.throws(()=>lease.commit(),/disposed/);assert.equal(f.renderer.meshes.size,0);assert.equal(f.renderer.triangleStreams.size,0);assert.ok(f.buffers.every(buffer=>buffer.destroyed===1));
});

test('owned live kind requires renderOnly, cannot forge/freeze/clone, and public mesh/frame snapshots remain independent after later updates',()=>{
 const f=fixture(),stream=finish(f.renderer.prepareTriangleStream({capacityTriangles:2,color:[46,71,82,255]})),s=scene();stream.update(triangle(),3);
 assert.throws(()=>s.add({id:'physical',mesh:stream.primitive}),/renderOnly/);assert.throws(()=>s.add({id:'fake',renderOnly:true,mesh:{kind:'triangle-stream',capacityTriangles:2,triangleCount:1,revision:1}}),/unknown/);assert.throws(()=>s.add({id:'proxy',renderOnly:true,mesh:new Proxy(stream.primitive,{})}),/unknown/);assert.throws(()=>freezePrimitive(stream.primitive),/immutable/);assert.throws(()=>new Scene({version:1,entities:[{id:'clone',renderOnly:true,mesh:stream.primitive}]}),/cannot be cloned/);
 const e=s.add({id:'glass',renderOnly:true,mesh:stream.primitive,material:{kind:'glass'}}),frame=buildRenderFrame(s,s.camera,{includeMeshes:true}),before=primitiveMesh(stream.primitive),state=triangleStreamState(stream.primitive),publicMesh=primitiveMesh(stream.primitive);
 publicMesh.vertices.fill(99);publicMesh.colors.fill(0);assert.deepEqual(primitiveMesh(stream.primitive),before);stream.update(triangle(10),3);
 assert.equal(frame.objects[0].primitive.kind,'triangle-mesh');assert.equal(Object.isFrozen(frame.objects[0].primitive.positions),true);assert.deepEqual(frame.objects[0].mesh,before);assert.notEqual(frame.objects[0].primitive,e.mesh);assert.equal(frame.objects[0].geometryRevision,1);
 assert.deepEqual(bytes(primitiveMesh(frame.objects[0].primitive).vertices),bytes(before.vertices));assert.notEqual(state.active.buffer,publicMesh.vertices.buffer);
 const alternate=s.add({id:'alternate',renderOnly:true,mesh:stream.primitive,renderMesh:{kind:'box'}}),physical=buildRenderFrame(s).objects.find(object=>object.entity===alternate).physicalPrimitive;stream.update(triangle(20),3);assert.equal(physical.kind,'triangle-mesh');assert.equal(physical.positions[0],10);
 s.remove(e.id);s.remove(alternate.id);stream.dispose();assert.equal(state.active,undefined);assert.equal(state.staging,undefined);
});

test('same-transform live revisions invalidate camera/shadow bounds and honest frame IR without rebuilding resource identity',()=>{
 const f=fixture(),stream=finish(f.renderer.prepareTriangleStream({capacityTriangles:2,color:[46,71,82,255]})),s=scene(),cache=new RenderFrameCache(),plan=new RenderVisibilityPlan();s.add({id:'glass',mesh:stream.primitive,renderOnly:true,material:{kind:'glass'}});
 const matrix=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]),views={camera:matrix,reflection:matrix,light:matrix},project=()=>{const frame=cache.build(s,s.camera);plan.prepare(s,frame.objects.map(o=>o.entity),s.renderMoverIds(),new Set(),e=>frame.objectsById.get(e.id).model,cache.changedObjects());return{frame,result:plan.project(views,[0,0,0],p=>f.renderer.mesh(p).bounds)};};
 stream.update(triangle(.1),3);const first=project();assert.equal(first.result.cameraTransparent.length,1);const model=first.frame.objects[0].model,firstObject=first.frame.objects[0];
 stream.update(triangle(10),3);let next;const F32=globalThis.Float32Array;try{globalThis.Float32Array=new Proxy(F32,{construct(){throw Error('No mesh snapshot/readback allocation allowed in live FrameCache');}});next=project();f.renderer.mesh(stream.primitive);}finally{globalThis.Float32Array=F32;}assert.equal(next.result.cameraTransparent.length,0);assert.equal(next.frame.objects[0].model,model);assert.equal(firstObject.geometryRevision,1);assert.equal(next.frame.objects[0].geometryRevision,2);
 stream.update(triangle(.1),3);assert.equal(project().result.cameraTransparent.length,1);stream.update(new Float32Array(),0);const empty=project();assert.equal(empty.result.cameraTransparent.length,0);assert.equal(empty.result.reflectedObjects.length,0);assert.equal(empty.result.staticShadowDrawables.length,0);assert.equal(f.renderer.meshes.size,1);stream.dispose();
});

test('explicit CPU mesh queries see each current stream revision without caching stale triangles under its stable identity',()=>{
 const f=fixture(),stream=finish(f.renderer.prepareTriangleStream({capacityTriangles:1,color:[46,71,82,255]})),s=scene();stream.update(triangle(),3);s.add({id:'glass',mesh:stream.primitive,renderOnly:true,material:{kind:'glass'}});const q=new RenderMeshQuery(s);
 assert.equal(q.cast([.2,.2,1],[0,0,-1],2)?.entity.id,'glass');stream.update(triangle(10),3);assert.equal(q.cast([.2,.2,1],[0,0,-1],2),null);assert.equal(q.cast([10.2,.2,1],[0,0,-1],2)?.entity.id,'glass');stream.update(new Float32Array(),0);assert.equal(q.cast([10.2,.2,1],[0,0,-1],2),null);stream.dispose();
});

test('detached entity/GPU prewarm accepts a resident stream and its revisions never force new object buffers or invalidate adoption',()=>{
 const f=fixture(),stream=finish(f.renderer.prepareTriangleStream({capacityTriangles:2,color:[46,71,82,255]})),s=scene(),empty={createView(){return{};}};let binds=0;
 Object.assign(f.renderer,{objects:new Map(),labels:new Map(),labelUsers:new Map(),previousModels:{get(){}},lastScene:null,profiler:{addUpload(){}},surfaceTextures:{get(){}},gpu:{emptyField:empty,emptyLabel:empty,sampler:{},surfaceSampler:{},objectLayout:{}}});f.device.createBindGroup=()=>{binds++;return{};};
 const ticket=s.prepareRenderEntity({id:'aggregate',renderOnly:true,mesh:stream.primitive,material:{kind:'glass'}}),gpu=f.renderer.prepareEntity(ticket.entity);let n=0;while(!gpu.ready){stream.update(triangle(n),3);gpu.step();assert.ok(++n<10);}const count=f.buffers.length;stream.update(triangle(20),3);ticket.refresh({position:[1,0,0],material:{kind:'glass'}});gpu.commit();ticket.adopt();f.renderer.adoptPreparedEntity(s,ticket.entity);gpu.dispose();ticket.dispose();stream.update(triangle(30),3);assert.equal(f.buffers.length,count);assert.equal(binds,1);assert.equal(f.renderer.objects.get('aggregate').preparedAdopted,true);assert.equal(f.renderer.mesh(s.entities.get('aggregate').mesh).triangles,1);s.remove('aggregate');f.renderer.destroyObject(f.renderer.objects.get('aggregate'));stream.dispose();
});

test('opaque opt-in stream radiance changes follow explicit revisions while ordinary scene hashes stay stable',()=>{
 const f=fixture(),stream=finish(f.renderer.prepareTriangleStream({capacityTriangles:1,color:[255,255,255,255]})),s=scene();stream.update(triangle(),3);s.add({id:'opaque',mesh:stream.primitive,renderOnly:true,material:{kind:'default'}});const first=distantRadianceKey(s);assert.equal(distantRadianceKey(s),first);stream.update(triangle(3),3);assert.notEqual(distantRadianceKey(s),first);stream.dispose();
});

test('largest supported page has an explicit fixed memory/upload bound and exact 60000-vertex identity indices',()=>{
 const f=fixture(),stream=finish(f.renderer.prepareTriangleStream({capacityTriangles:20000,color:[46,71,82,255]}),65536),state=triangleStreamState(stream.primitive),packed=new Float32Array(20000*18);
 for(let i=0;i<20000;i++)packed.set(triangle(i/100),i*18);const allocationCount=f.buffers.length;f.writes.length=0;stream.update(packed,60000);
 assert.equal(f.buffers.length,allocationCount);assert.equal(f.writes.length,Math.ceil(packed.byteLength/65536));assert.ok(f.writes.every(write=>write.length<=65536));assert.equal(f.buffers.reduce((sum,b)=>sum+b.bytes.byteLength,0)+state.active.byteLength+state.staging.byteLength,6840000);
 const snapshot=primitiveMesh(stream.primitive);assert.equal(snapshot.indexFormat,'uint16');assert.equal(snapshot.indices.length,60000);assert.equal(snapshot.indices[59999],59999);assert.deepEqual(bytes(snapshot.vertices),bytes(packed));assert.throws(()=>f.renderer.prepareTriangleStream({capacityTriangles:20001,color:[46,71,82,255]}),/20000/);stream.dispose();
});
