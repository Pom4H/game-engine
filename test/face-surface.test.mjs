import test from 'node:test';import assert from 'node:assert/strict';
import {FaceSurface,neutralFaceSurface} from '../dist/animation/face-surface.js';
import {WINTER_FACE_IDENTITIES,blendFaceActions} from '../dist/animation/expressive-face.js';
import {MeshStream,meshStream} from '../dist/procedural/mesh-stream.js';
import {primitiveKey,primitiveMesh} from '../dist/procedural/mesh.js';
const close=(a,b,t=1e-11)=>assert.ok(Math.abs(a-b)<t,JSON.stringify({a,b}));
const tri={kind:'triangle-mesh',positions:[0,0,0,0,1,0,0,0,1],normals:[1,0,0,1,0,0,1,0,0],indices:[0,1,2]};

test('runtime geometry has one identity/buffer, detached authoring input and transactional publication',()=>{
 const source=structuredClone(tri),stream=new MeshStream(source),key=primitiveKey(stream.primitive),vertices=stream.vertices;
 source.positions[0]=999;assert.equal(stream.primitive.positions[0],0);
 const snapshot=primitiveMesh(stream.primitive),p=[...tri.positions];p[0]=.02;stream.publish(p,tri.normals);
 assert.equal(primitiveKey(stream.primitive),key);assert.equal(stream.vertices,vertices);assert.equal(stream.revision,1);assert.equal(snapshot.vertices[0],0);assert.equal(stream.primitive.positions[0],.02);
 stream.publish(p,tri.normals);assert.equal(stream.revision,1);
 p[4]=NaN;assert.throws(()=>stream.publish(p,tri.normals));assert.equal(stream.revision,1);assert.equal(stream.primitive.positions[4],1);
 stream.dispose();assert.equal(meshStream(stream.primitive),undefined);assert.throws(()=>stream.publish(tri.positions,tri.normals));
});
test('skin is one connected manifold with mouth/eyes/neck boundaries and no intact skin covering the oral opening',()=>{
 const f=new FaceSurface(WINTER_FACE_IDENTITIES.anna),mesh=f.stream.primitive,edges=new Map(),adj=new Map();
 for(let i=0;i<mesh.indices.length;i+=3){const t=mesh.indices.slice(i,i+3);assert.equal(new Set(t).size,3);
  for(let k=0;k<3;k++){const a=t[k],b=t[(k+1)%3],key=[Math.min(a,b),Math.max(a,b)].join(':');if(!edges.has(key))edges.set(key,[]);edges.get(key).push([a,b]);if(!adj.has(a))adj.set(a,new Set());adj.get(a).add(b);}
 }
 for(const e of edges.values()){assert.ok(e.length<=2,'non-manifold edge');if(e.length===2)assert.notEqual(e[0][0],e[1][0],'inconsistent winding');}
 const visited=new Set(),todo=[mesh.indices[0]];while(todo.length){const v=todo.pop();if(visited.has(v))continue;visited.add(v);todo.push(...adj.get(v));}assert.equal(visited.size,adj.size,'detached face islands');
 for(const loop of [f.mouthBoundary,...f.eyeBoundaries])for(let i=0;i<loop.length;i++){const a=loop[i],b=loop[(i+1)%loop.length],e=edges.get([Math.min(a,b),Math.max(a,b)].join(':'));assert.equal(e?.length,1,'feature is not an actual opening');}
 f.stream.dispose();
});
test('actual lip vertices conserve the acoustic aperture through closing, rounding and asymmetric expression',()=>{
 for(const identity of Object.values(WINTER_FACE_IDENTITIES)){
  const f=new FaceSurface(identity),buffer=f.stream.vertices,key=primitiveKey(f.stream.primitive),size=f.inspect().typedArrayBytes;
  for(const width of [.027,.047,.052])for(const gap of [0,1e-7,.003,.022])for(const smileRight of [0,.7,1]){
   f.update({...neutralFaceSurface(),width,gap,smileRight,smileLeft:.25,jaw:.1,protrusion:.004});close(f.openingArea(),Math.PI/4*width*gap);
   assert.ok(f.stream.vertices.every(Number.isFinite));assert.equal(f.stream.vertices,buffer);assert.equal(primitiveKey(f.stream.primitive),key);assert.equal(f.inspect().typedArrayBytes,size);
  }f.stream.dispose();
 }
});
test('blink closes real eyelid loops; actor state, skin rest pose and neutral action layers remain independent',()=>{
 const a=new FaceSurface(WINTER_FACE_IDENTITIES.anna),b=new FaceSurface(WINTER_FACE_IDENTITIES.anna),neutral=neutralFaceSurface();a.update(neutral);b.update(neutral);const rest=a.stream.vertices.slice(),other=b.stream.vertices.slice();
 a.update({...neutral,smileRight:.7,browLeft:.8,cheekRight:.3});assert.notDeepEqual(a.stream.vertices,rest);assert.deepEqual(b.stream.vertices,other);
 a.update({...neutral,blink:1});for(const loop of a.eyeBoundaries)close(a.openingArea(loop),0);
 a.update(neutral);assert.deepEqual(a.stream.vertices,rest);const revision=a.stream.revision;
 assert.throws(()=>a.update({...neutral,gap:NaN}));assert.equal(a.stream.revision,revision);assert.deepEqual(a.stream.vertices,rest);
 assert.equal(blendFaceActions([]).browTiltLeft,.5);a.stream.dispose();b.stream.dispose();
});

test('face laboratory runs on the scene clock with two isolated skin streams and bounded topology',async()=>{
 const {createFaceLab}=await import('../tools/face-lab/scene.mjs');const lab=createFaceLab(),zero=lab.frame(0),counts=zero.actors.map(a=>a.face.skin.vertices+':'+a.face.skin.triangles+':'+a.face.skin.typedArrayBytes);
 for(const t of [1,3.4,6.72,7.5,11.5,14]){const frame=lab.frame(t);assert.ok(Math.abs(frame.timeS-lab.scene.time)<1e-9);assert.equal(frame.audio,'muted-diagnostic');assert.deepEqual(frame.actors.map(a=>a.face.skin.vertices+':'+a.face.skin.triangles+':'+a.face.skin.typedArrayBytes),counts);for(const actor of frame.actors){assert.ok(actor.face.lowerLipWorld.every(Number.isFinite));assert.ok(Math.abs(actor.face.apertureAreaM2-actor.face.acousticAreaM2)<1e-10);assert.ok(lab.scene.renderMoverIds().has(actor.id+'-face-skin'));}}
 assert.throws(()=>lab.frame(0),/replay/);lab.dispose();
});
