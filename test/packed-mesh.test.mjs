import test from 'node:test';
import assert from 'node:assert/strict';
import {decodePackedMesh,encodePackedMesh} from '../dist/index.js';

const mesh={
  kind:'triangle-mesh',
  positions:[-1,0,-2, 2,.25,-2, 2,1,3, -1,.5,3],
  normals:[0,1,0, 0,1,0, 0,1,0, 0,1,0],
  indices:[0,1,2,0,2,3],
};

test('packed mesh codec round-trips render geometry within quantization bounds',()=>{
  const packed=encodePackedMesh(mesh),decoded=decodePackedMesh(packed);
  assert.equal(packed.vertices,4);
  assert.equal(packed.triangles,2);
  assert.ok(packed.indicesU16Base64);
  assert.equal(packed.indicesU32Base64,undefined);
  assert.deepEqual(decoded.indices,mesh.indices);
  const span=[3,1,5];
  for(let i=0;i<mesh.positions.length;i++)assert.ok(Math.abs(decoded.positions[i]-mesh.positions[i])<=span[i%3]/65535+.000001);
  for(let i=0;i<decoded.normals.length;i+=3)assert.ok(decoded.normals[i+1]>.999,'oct8 should preserve an up normal');
});

test('packed mesh decoder supports uint32 index streams for large visual assets',()=>{
  const vertices=65536,positions=new Array(vertices*3).fill(0),normals=new Array(vertices*3).fill(0);
  for(let i=0;i<vertices;i++){positions[i*3]=i/65535;normals[i*3+1]=1;}
  const input={kind:'triangle-mesh',positions,normals,indices:[0,65535,65534]};
  const packed=encodePackedMesh(input);
  assert.equal(packed.indicesU16Base64,undefined);
  assert.ok(packed.indicesU32Base64);
  assert.deepEqual(decodePackedMesh(packed).indices,input.indices);
});

test('packed mesh rejects ambiguous or inconsistent payloads',()=>{
  const packed=encodePackedMesh(mesh);
  assert.throws(()=>decodePackedMesh({...packed,indicesU32Base64:packed.indicesU16Base64}),/exactly one index payload/);
  assert.throws(()=>decodePackedMesh({...packed,vertices:5}),/count mismatch/);
  assert.throws(()=>encodePackedMesh({...mesh,indices:[0,1,99]}),/index out of range/);
});
