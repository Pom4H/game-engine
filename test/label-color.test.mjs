import test from 'node:test';
import assert from 'node:assert/strict';
import {validateScene} from '../dist/scene/validate.js';
import {WebGPURenderer} from '../dist/render/webgpu.js';
import {referenceEntities} from '../tools/arcade/reference.scene.mjs';
import {Scene} from '../dist/scene/scene.js';

test('painted label colors validate and distinct colors do not reuse the wrong glyph texture',()=>{
 const spec=color=>({version:1,entities:[{id:'sign',material:{label:'МАГАЗИНЪ',labelColor:color}}]});
 validateScene(spec([.1,.08,.06]));
 for(const color of [[-1,0,0],[0,NaN,0],[1,0],[2,0,0]])assert.throws(()=>validateScene(spec(color)),TypeError);
 const previous=globalThis.document,paints=[];
 globalThis.document={createElement:()=>({getContext:()=>({clearRect(){},fillText(){paints.push(this.fillStyle);}})})};
 const renderer={labels:new Map(),gpu:{emptyLabel:{}},device:{createTexture:()=>({}),queue:{copyExternalImageToTexture(){}}}};
 try{
  const label=(color)=>WebGPURenderer.prototype.label.call(renderer,'МАГАЗИНЪ',color);
  const dark=label([.1,.08,.06]),pale=label();
  assert.notEqual(dark,pale);
  assert.equal(dark,label([.1,.08,.06]));
  assert.equal(pale,label([226/255,217/255,188/255]));
  assert.deepEqual(paints,['rgb(26,20,15)','#e2d9bc']);
 }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});

test('live depth-fog changes are uniform updates and keep geometry caches intact',()=>{
 const scene=new Scene({version:1,entities:[],rendering:{fogDensity:.2}});
 const structure=scene.renderStructureRevision,appearance=scene.appearanceRevision;
 scene.patchAppearance({rendering:{fogHeightFalloff:.42,fogStartDistance:2,fogRampDistance:16,fogColor:[.095,.112,.13]}});
 assert.equal(scene.renderStructureRevision,structure);assert.equal(scene.appearanceRevision,appearance+1);
 assert.equal(scene.spec.rendering.fogRampDistance,16);
 scene.patchAppearance({rendering:{skyColor:[.02,.022,.025]}});
 assert.equal(scene.renderStructureRevision,structure+1);
});

test('mansard exterior faces point upward and the sign band has no covering inset panels',()=>{
 for(const id of ['hero-front-roof','hero-rear-roof']){
  const {mesh}=referenceEntities.find(e=>e.id===id);
  for(let i=0;i<mesh.indices.length;i+=3){
   const [a,b,c]=mesh.indices.slice(i,i+3).map(n=>mesh.positions.slice(n*3,n*3+3)),u=b.map((v,k)=>v-a[k]),v=c.map((x,k)=>x-a[k]);
   const cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],normal=mesh.normals.slice(mesh.indices[i]*3,mesh.indices[i]*3+3);
   assert.ok(normal[1]>0&&cross.reduce((s,n,k)=>s+n*normal[k],0)>0);
  }
 }
 assert.ok(!referenceEntities.some(e=>/^hero-panel|^hero-relief/.test(e.id)));
});
