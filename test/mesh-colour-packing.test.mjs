import test from 'node:test';
import assert from 'node:assert/strict';
import {freezePrimitive,primitiveMesh,meshVertexAttributes} from '../dist/procedural/mesh.js';

const source=colors=>({kind:'triangle-mesh',positions:[-0,0,0,1,0,0,0,1,0],normals:[0,0,1,0,0,1,0,0,1],indices:[0,1,2],uvs:[-.5,0,2.5,1,0,1],...(colors===undefined?{}:{colors})});
test('implicit and authored neutral colours produce identical owned GPU streams',()=>{
 const implicit=primitiveMesh(source()),authored=primitiveMesh(freezePrimitive(source(Array(12).fill(1)),true));
 assert.deepEqual(authored,implicit);assert.deepEqual([...authored.colors],Array(12).fill(255));
 assert.deepEqual(meshVertexAttributes(authored),meshVertexAttributes(implicit));
 authored.vertices[0]=100;authored.colors[0]=0;authored.indices[0]=2;
 const fresh=primitiveMesh(source(Array(12).fill(1)));assert.ok(Object.is(fresh.vertices[0],-0));assert.equal(fresh.colors[0],255);assert.equal(fresh.indices[0],0);
});
test('mixed colours retain clamp, half-step rounding, alpha and default missing channels',()=>{
 const authored=[0,.5,1,1,1/510,3/510,5/510,.25,-1,2,NaN];
 const mesh=primitiveMesh(source(authored));
 assert.deepEqual([...mesh.colors],[0,128,255,255,1,2,3,64,0,255,0,255]);
 const sparse=Array(12).fill(1);delete sparse[8];assert.deepEqual([...primitiveMesh(source(sparse)).colors],Array(12).fill(255));
 const last=Array(12).fill(1);last[11]=.5;assert.deepEqual([...primitiveMesh(source(last)).colors],[255,255,255,255,255,255,255,255,255,255,255,128]);
});
test('large neutral meshes keep index widths and every position/normal unchanged',()=>{
 for(const count of [65535,65536]){
  const positions=Array.from({length:count*3},(_,i)=>(i%19-9)/7),normals=Array.from({length:count*3},(_,i)=>i%3===1?1:0),indices=[0,count-2,count-1];
  const mesh=primitiveMesh(freezePrimitive({kind:'triangle-mesh',positions,normals,indices},true));
  assert.equal(mesh.indexFormat,count>65535?'uint32':'uint16');assert.deepEqual([...mesh.indices],indices);
  assert.ok(mesh.colors.every(c=>c===255));
  for(const i of [0,13,count-1])for(let j=0;j<3;j++){assert.equal(mesh.vertices[i*6+j],Math.fround(positions[i*3+j]));assert.equal(mesh.vertices[i*6+3+j],normals[i*3+j]);}
 }
});

test('neutral and coloured runs across block boundaries retain every RGBA byte',()=>{
 const count=150,colors=Array(count*4).fill(1);
 for(const i of [0,63,64,65,127,128,255,256,599])colors[i]=(i%13)/13;
 const mesh=primitiveMesh(freezePrimitive({kind:'triangle-mesh',positions:Array(count*3).fill(0),normals:Array(count*3).fill(0),indices:[0,1,2],colors},true));
 assert.deepEqual([...mesh.colors],colors.map(v=>Math.round(v*255)));
});
