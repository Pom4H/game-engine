import test from 'node:test';
import assert from 'node:assert/strict';
import {primitiveMesh} from '../dist/procedural/mesh.js';

// WebGPU culls back faces on closed primitives. The triangle winding must
// agree with vertex normals or a road is drawn from its underside: deposited
// snow and upward lighting disappear even though physical state is correct.
for(const primitive of [
  {kind:'box'},
  {kind:'plane'},
  {kind:'sphere',segments:20},
  {kind:'cylinder',radius:1,height:1,segments:24},
]){
  test(`${primitive.kind} triangles face their vertex normals`,()=>{
    const {vertices:v,indices}=primitiveMesh(primitive);
    let nondegenerate=0;
    for(let i=0;i<indices.length;i+=3){
      const a=indices[i]*6,b=indices[i+1]*6,c=indices[i+2]*6;
      const ux=v[b]-v[a],uy=v[b+1]-v[a+1],uz=v[b+2]-v[a+2];
      const wx=v[c]-v[a],wy=v[c+1]-v[a+1],wz=v[c+2]-v[a+2];
      const nx=uy*wz-uz*wy,ny=uz*wx-ux*wz,nz=ux*wy-uy*wx;
      if(Math.hypot(nx,ny,nz)<1e-7)continue;
      nondegenerate++;
      assert.ok(nx*v[a+3]+ny*v[a+4]+nz*v[a+5]>0,`triangle ${i/3} faces inward`);
    }
    assert.ok(nondegenerate>0);
  });
}
