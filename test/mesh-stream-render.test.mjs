import test from 'node:test';
import assert from 'node:assert/strict';
import {WebGPURenderer} from '../dist/render/webgpu.js';
import {MeshStream} from '../dist/procedural/mesh-stream.js';
import {Scene} from '../dist/scene/scene.js';
const triangle={kind:'triangle-mesh',positions:[0,0,0,1,0,0,0,1,0],normals:[0,0,1,0,0,1,0,0,1],indices:[0,1,2]};
function mock(){
 const created=[],writes=[],renderer=Object.create(WebGPURenderer.prototype);
 const device={createBuffer({size}){const data=new ArrayBuffer(size);const b={data,destroyed:false,getMappedRange:()=>data,unmap(){},destroy(){this.destroyed=true;}};created.push(b);return b;},queue:{writeBuffer(buffer,offset,data){assert.ok(!buffer.destroyed,'write to destroyed buffer');const bytes=new Uint8Array(data.buffer,data.byteOffset,data.byteLength);new Uint8Array(buffer.data,offset,bytes.length).set(bytes);writes.push({buffer,bytes:bytes.slice()});}}};
 Object.assign(renderer,{device,meshes:new Map(),meshByPrimitive:new WeakMap(),meshFrame:0,objects:new Map(),labels:new Map(),modelCache:new Map(),cullCache:new Map(),profiler:{addUpload(){}}});
 return{renderer,created,writes};
}
const floats=b=>new Float32Array(b.data).slice();
test('stream uploads reuse buffers, preserve the previous presented deformation and leave static geometry alone',()=>{
 const {renderer:r,created,writes}=mock();const staticMesh=r.mesh(triangle);assert.equal(created.length,3);assert.equal(r.mesh(triangle),staticMesh);assert.equal(writes.length,0);
 const stream=new MeshStream(triangle),m=r.mesh(stream.primitive),old=floats(m.vertex);assert.equal(created.length,7);assert.equal(m.previousVertex.data.byteLength,m.vertex.data.byteLength);
 for(let i=0;i<20;i++)r.mesh(stream.primitive);assert.equal(writes.length,0);
 r.meshFrame++;
 const p=[...triangle.positions];p[3]=2;stream.publish(p,triangle.normals);
 assert.equal(r.mesh(stream.primitive),m);assert.equal(created.length,7);assert.deepEqual(floats(m.previousVertex),old);assert.equal(floats(m.vertex)[6],2);
 const count=writes.length;r.mesh(stream.primitive);assert.equal(writes.length,count,'shadow/reflection passes must not repeat writes');
 const presented=floats(m.vertex);r.meshFrame++;r.mesh(stream.primitive);assert.deepEqual(floats(m.previousVertex),presented,'a paused deform has zero local velocity');
 const p2=[...p];p2[3]=3;stream.publish(p2,triangle.normals);r.mesh(stream.primitive);assert.deepEqual(floats(m.previousVertex),presented);assert.equal(floats(m.vertex)[6],3);
 assert.equal(r.meshes.size,2);assert.equal(created.length,7);stream.dispose();
});
test('removing a scene releases every stream buffer and cannot revive a destroyed identity-cache entry',()=>{
 const {renderer:r,created}=mock(),stream=new MeshStream(triangle);const first=r.mesh(stream.primitive),buffers=[first.vertex,first.previousVertex,first.color,first.index];
 r.collect(new Scene({version:1,entities:[]}));assert.ok(buffers.every(b=>b.destroyed));assert.equal(r.meshes.size,0);
 const second=r.mesh(stream.primitive);assert.notEqual(second,first);assert.ok(!second.vertex.destroyed);assert.equal(created.length,8);stream.dispose();
});
