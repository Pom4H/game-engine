import test from 'node:test';
import assert from 'node:assert/strict';
import {WebGPURenderer} from '../dist/render/webgpu.js';
import {primitiveMesh} from '../dist/procedural/mesh.js';
import {meshBounds} from '../dist/render/visibility.js';

function fixture(capacity=20000){
 const buffers=[],writes=[],fault={write:false,callback:undefined};
 const device={limits:{maxBufferSize:268435456},createBuffer(spec){const buffer={bytes:new Uint8Array(spec.size),destroyed:0,destroy(){this.destroyed++;}};buffers.push(buffer);return buffer;},queue:{writeBuffer(buffer,offset,source,sourceOffset=0,size){if(fault.write)throw Error('upload failure');const bytes=new Uint8Array(source,sourceOffset,size);buffer.bytes.set(bytes,offset);writes.push({buffer,offset,size});fault.callback?.();}}};
 const renderer=Object.create(WebGPURenderer.prototype);Object.assign(renderer,{device,meshes:new Map(),meshByPrimitive:new WeakMap(),preparedMeshPins:new Map(),disposed:false});
 const cold=renderer.prepareTriangleStream({capacityTriangles:capacity,color:[46,71,82,255]});let n=0;while(!cold.step(65536))assert.ok(++n<1000);const stream=cold.commit();writes.length=0;
 return{stream,renderer,device,buffers,writes,fault};
}
const triangle=x=>new Float32Array([x,-0,0,0,0,1,x+1,0,0,0,0,1,x,1,0,0,0,1]);
const packed=triangles=>{const out=new Float32Array(triangles*18);for(let i=0;i<triangles;i++)out.set(triangle(i/10),i*18);return out;};
const finish=(ticket,bytes=65536)=>{let n=0;while(!ticket.step(bytes))assert.ok(++n<100000);return n;};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const binary=view=>Buffer.from(view.buffer,view.byteOffset,view.byteLength);

test('incremental hot update copies then uploads separate bounded blocks and retains exact F32 bounds/bytes without allocation',()=>{
 const f=fixture(),input=packed(20000),allocationCount=f.buffers.length,resource=f.renderer.mesh(f.stream.primitive),oldVertex=resource.vertex,revision=f.stream.revision;
 const ticket=f.stream.prepareUpdate(input,60000);assert.deepEqual(Object.getOwnPropertyNames(ticket),[]);assert.equal(ticket.ready,false);assert.equal(f.writes.length,0);assert.throws(()=>ticket.commit(),/incomplete/);
 // Whole validation/copy completes before the first GPU call, even when the
 // caller supplies more than the API's maximum per-step credit.
 const blocks=Math.ceil(input.byteLength/65536);
 for(let i=0;i<blocks;i++){assert.equal(ticket.step(999999),false);assert.equal(f.writes.length,0);assert.equal(resource.vertex,oldVertex);assert.equal(f.stream.revision,revision);}
 const original=input.slice();input.fill(99); // Private copy no longer borrows the caller's bank.
 for(let i=0;i<blocks;i++){const before=f.writes.length;ticket.step(999999);assert.equal(f.writes.length,before+1);assert.ok(f.writes.at(-1).size<=65536);assert.equal(resource.vertex,oldVertex);}
 assert.equal(ticket.ready,true);const writes=f.writes.length;f.fault.write=true;ticket.commit();f.fault.write=false;ticket.dispose();assert.equal(f.writes.length,writes);assert.equal(f.buffers.length,allocationCount);
 const result=primitiveMesh(f.stream.primitive);assert.deepEqual(binary(result.vertices),binary(original));assert.deepEqual(resource.bounds,meshBounds(original));assert.equal(result.indices[59999],59999);assert.deepEqual(resource.vertex.bytes.subarray(0,original.byteLength),new Uint8Array(original.buffer));f.stream.dispose();
});

test('late invalid scalars and detached borrowed sources fail before every GPU write and preserve the complete previous frame',()=>{
 const f=fixture(1000);f.stream.update(triangle(1),3);f.writes.length=0;const before=primitiveMesh(f.stream.primitive),revision=f.stream.revision;
 const invalid=packed(1000);invalid[invalid.length-1]=NaN;const ticket=f.stream.prepareUpdate(invalid,3000);
 assert.equal(ticket.step(65536),false);assert.throws(()=>ticket.step(65536),/nonfinite/);assert.equal(f.writes.length,0);assert.equal(ticket.ready,false);assert.throws(()=>ticket.commit(),/stale/);ticket.dispose();
 const detached=triangle(2),next=f.stream.prepareUpdate(detached,3);structuredClone(detached,{transfer:[detached.buffer]});assert.throws(()=>next.step(64),/detached/);next.dispose();assert.equal(f.writes.length,0);assert.equal(f.stream.revision,revision);assert.deepEqual(primitiveMesh(f.stream.primitive),before);
 const retry=f.stream.prepareUpdate(triangle(3),3);finish(retry,4);retry.commit();assert.equal(primitiveMesh(f.stream.primitive).vertices[0],3);f.stream.dispose();
});

test('GPU validation/OOM ACKs gate ready and commit without completion waits or repeated uploads',async()=>{
 const f=fixture(1),checks=[];f.device.pushErrorScope=()=>{};f.device.popErrorScope=()=>new Promise(resolve=>checks.push(resolve));
 const ticket=f.stream.prepareUpdate(triangle(4),3);assert.equal(ticket.step(65536),false);assert.equal(f.writes.length,0);assert.equal(ticket.step(65536),false);assert.equal(checks.length,2);assert.equal(ticket.ready,false);assert.throws(()=>ticket.commit(),/incomplete/);
 for(let i=0;i<10;i++)assert.equal(ticket.step(65536),false);assert.equal(f.writes.length,1);checks[0](null);await turn();assert.equal(ticket.ready,false);checks[1](null);await turn();assert.equal(ticket.ready,true);ticket.commit();assert.equal(primitiveMesh(f.stream.primitive).vertices[0],4);f.stream.dispose();
});

test('pending GPU error-scope credits bound further uploads until an acknowledgment releases a slot',async()=>{
 const f=fixture(),checks=[];f.device.pushErrorScope=()=>{};f.device.popErrorScope=()=>new Promise(resolve=>checks.push(resolve));
 const input=packed(20000),ticket=f.stream.prepareUpdate(input,60000),blocks=Math.ceil(input.byteLength/65536);
 for(let i=0;i<blocks;i++)ticket.step();for(let i=0;i<100;i++)ticket.step();assert.equal(f.writes.length,8);assert.equal(checks.length,16);assert.equal(ticket.ready,false);
 for(const resolve of checks.splice(0))resolve(null);await turn();ticket.step();assert.equal(f.writes.length,9);ticket.dispose();for(const resolve of checks.splice(0))resolve(Error('late cancelled ACK'));await turn();assert.equal(f.stream.triangleCount,0);f.stream.dispose();
});

for(const rejected of [false,true])test(`a ${rejected?'rejected':'reported'} GPU error preserves the prior bank and a later ticket is independent`,async()=>{
 const f=fixture(1);f.stream.update(triangle(1),3);const before=primitiveMesh(f.stream.primitive),revision=f.stream.revision,checks=[];f.device.pushErrorScope=()=>{};f.device.popErrorScope=()=>new Promise((resolve,reject)=>checks.push({resolve,reject}));
 const ticket=f.stream.prepareUpdate(triangle(2),3);ticket.step(65536);ticket.step(65536);const cause=Error('GPU validation rejected');if(rejected)checks[0].reject(cause);else checks[0].resolve(cause);checks[1].resolve(null);await turn();
 assert.equal(ticket.ready,false);assert.throws(()=>ticket.step(),error=>error.cause===cause);assert.equal(f.stream.revision,revision);assert.deepEqual(primitiveMesh(f.stream.primitive),before);ticket.dispose();
 delete f.device.pushErrorScope;delete f.device.popErrorScope;const retry=f.stream.prepareUpdate(triangle(3),3);finish(retry);retry.commit();assert.equal(primitiveMesh(f.stream.primitive).vertices[0],3);f.stream.dispose();
});

test('two-page incremental transaction cannot reveal a successful prefix when the second upload fails; publication does no I/O',()=>{
 const a=fixture(1),b=fixture(1);a.stream.update(triangle(1),3);b.stream.update(triangle(2),3);const beforeA=primitiveMesh(a.stream.primitive),beforeB=primitiveMesh(b.stream.primitive);
 const first=a.stream.prepareUpdate(triangle(11),3),second=b.stream.prepareUpdate(triangle(22),3);finish(first);second.step();b.fault.write=true;assert.throws(()=>second.step(),/upload failure/);b.fault.write=false;first.dispose();second.dispose();assert.deepEqual(primitiveMesh(a.stream.primitive),beforeA);assert.deepEqual(primitiveMesh(b.stream.primitive),beforeB);
 const nextA=a.stream.prepareUpdate(triangle(33),3),nextB=b.stream.prepareUpdate(triangle(44),3);finish(nextA);finish(nextB);a.fault.write=b.fault.write=true;nextA.commit();nextB.commit();a.fault.write=b.fault.write=false;assert.equal(primitiveMesh(a.stream.primitive).vertices[0],33);assert.equal(primitiveMesh(b.stream.primitive).vertices[0],44);a.stream.dispose();b.stream.dispose();
});

test('cancel, stale ACKs, invalid credits, reentry and synchronous disposal cannot publish or reserve an abandoned bank',async()=>{
 const f=fixture(1);f.stream.update(triangle(1),3);const revision=f.stream.revision,checks=[];f.device.pushErrorScope=()=>{};f.device.popErrorScope=()=>new Promise(resolve=>checks.push(resolve));
 const stale=f.stream.prepareUpdate(triangle(2),3);for(const credit of [0,3,NaN,Infinity])assert.throws(()=>stale.step(credit),/four bytes/);assert.throws(()=>f.stream.update(triangle(3),3),/pending/);stale.step();stale.step();stale.dispose();stale.dispose();assert.throws(()=>stale.step(),/settled/);assert.throws(()=>stale.commit(),/settled/);
 delete f.device.pushErrorScope;delete f.device.popErrorScope;let current=f.stream.prepareUpdate(triangle(4),3);finish(current);checks[0](Error('stale error'));checks[1](null);await turn();assert.equal(current.ready,true);current.commit();assert.equal(f.stream.revision,revision+1);
 current=f.stream.prepareUpdate(triangle(5),3);current.step();f.fault.callback=()=>{assert.throws(()=>current.step(),/reenter/);assert.throws(()=>f.stream.prepareUpdate(triangle(6),3),/reenter/);current.dispose();};assert.throws(()=>current.step(),/disposed during upload/);f.fault.callback=undefined;assert.equal(primitiveMesh(f.stream.primitive).vertices[0],4);
 const disposed=f.stream.prepareUpdate(triangle(7),3);disposed.step();f.fault.callback=()=>f.stream.dispose();assert.throws(()=>disposed.step(),/disposed during upload/);disposed.dispose();assert.ok(f.buffers.every(buffer=>buffer.destroyed===1));
});

test('empty incremental replacement is fixed work, keeps residency and never uploads or allocates',()=>{
 const f=fixture(1);f.stream.update(triangle(1),3);const allocations=f.buffers.length;f.writes.length=0;const ticket=f.stream.prepareUpdate(new Float32Array(),0);assert.equal(ticket.ready,true);assert.equal(ticket.step(4),true);ticket.commit();assert.equal(f.stream.triangleCount,0);assert.equal(f.renderer.mesh(f.stream.primitive).count,0);assert.deepEqual(f.renderer.mesh(f.stream.primitive).bounds,{center:[0,0,0],half:[0,0,0]});assert.equal(f.writes.length,0);assert.equal(f.buffers.length,allocations);f.stream.dispose();
});
