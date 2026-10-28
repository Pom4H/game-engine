import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene} from '../dist/scene/scene.js';
import {primitiveMesh,meshVertexAttributes} from '../dist/procedural/mesh.js';
import {encodePackedMesh,decodePackedMesh} from '../dist/assets/packed-mesh.js';
import {distantRadianceKey,buildSceneRadianceProbe} from '../dist/render/radiance.js';

const mesh=()=>({kind:'triangle-mesh',positions:[-1,0,0,1,0,0,0,1,0],normals:[0,0,1,0,0,1,0,0,1],indices:[0,1,2],uvs:[-3.5,8,7.25,-2,0,16],colors:[1,0,.5,1,0,1,0,1,.2,.3,.4,1]});
test('signed authored UVs reach the GPU stream and packed asset without changing geometry or vertex colours',()=>{
 const source=mesh(),data=primitiveMesh(source),bytes=meshVertexAttributes(data),view=new DataView(bytes.buffer);
 assert.equal(bytes.length,48);for(let i=0;i<3;i++){assert.deepEqual([...bytes.slice(i*16,i*16+4)],[...data.colors.slice(i*4,i*4+4)]);assert.equal(view.getFloat32(i*16+4,true),source.uvs[i*2]);assert.equal(view.getFloat32(i*16+8,true),source.uvs[i*2+1]);}
 const roundtrip=decodePackedMesh(encodePackedMesh(source));assert.deepEqual(roundtrip.uvs,source.uvs);assert.deepEqual(roundtrip.indices,source.indices);
});
test('unauthored meshes retain the existing front/back face UV projection',()=>{
 const source=mesh();delete source.uvs;source.normals[2]=-1;const data=primitiveMesh(source),view=new DataView(meshVertexAttributes(data).buffer);
 assert.equal(view.getFloat32(4,true),1.5);assert.equal(view.getFloat32(8,true),.5);assert.equal(view.getFloat32(20,true),1.5);assert.equal(view.getFloat32(40,true),-.5);
});
test('scene and packed assets reject malformed UVs and coating parameters and own their material data',()=>{
 for(const uvs of [[0,1],[0,0,0,0,NaN,0]]){assert.throws(()=>new Scene({version:1,entities:[{id:'bad',mesh:{...mesh(),uvs},renderOnly:true}]}));assert.throws(()=>encodePackedMesh({...mesh(),uvs}));}
 assert.throws(()=>encodePackedMesh({...mesh(),uvs:[1e100,0,0,0,0,0]}));
 const packed=encodePackedMesh(mesh());assert.throws(()=>decodePackedMesh({...packed,uvsF32Base64:'AAAAAA=='}));
 assert.throws(()=>decodePackedMesh({...packed,uvsF32Base64:''}));
 for(const decal of [{kind:'coating-loss',seed:1,severity:2},{kind:'coating-loss',seed:1024,severity:.5},{kind:'coating-loss',seed:.2,severity:.5}])assert.throws(()=>new Scene({version:1,entities:[{id:'bad',mesh:mesh(),material:{decal},renderOnly:true}]}));
 const decal={kind:'coating-loss',seed:101,severity:.65},scene=new Scene({version:1,entities:[{id:'scar',mesh:mesh(),material:{decal},renderOnly:true}]});
 const stored=scene.entities.get('scar').material.decal;decal.severity=0;assert.equal(stored.severity,.65);assert.ok(Object.isFrozen(stored));assert.equal(scene.physics.bodies.size,0);
});
test('a masked coating overlay cannot become an opaque distant radiance proxy or invalidate its supporting surface',()=>{
 const scene=new Scene({version:1,entities:[{id:'support',position:[8,1,0],mesh:{kind:'box'},material:{color:[.2,.4,.6,1]},renderOnly:true}]}),key=distantRadianceKey(scene),before=buildSceneRadianceProbe(scene,[0,1,0]);
 scene.add({id:'scar',position:[8,1,0],mesh:mesh(),material:{color:[1,0,1,1],decal:{kind:'coating-loss',severity:.7,seed:72}},renderOnly:true});
 assert.equal(distantRadianceKey(scene),key);assert.deepEqual(buildSceneRadianceProbe(scene,[0,1,0]),before);
});
