import test from 'node:test';
import assert from 'node:assert/strict';
import scene,{referenceEntities,authoredEntityCount} from '../tools/arcade/reference.scene.mjs';
import {quality} from '../tools/arcade/scene.mjs';
import {canopySnow} from '../tools/arcade/snow-canopy.mjs';
import {snowfallUniform} from '../dist/render/snowfall.js';
import {WebGPURenderer} from '../dist/render/webgpu.js';

test('arcade has one snow shell per canopy and one road snowpack',()=>{
 const ids=referenceEntities.map(e=>e.id);
 assert.equal(new Set(ids).size,ids.length);
 assert.equal(ids.filter(id=>/^awning-snow-shell-/.test(id)).length,9);
 assert.equal(ids.filter(id=>/^awning-snow-rim-|^shop-\d+-canopy-snow$|^street-snow-|^road-scatter-/.test(id)).length,0);
 assert.equal(ids.filter(id=>id==='snow-covered-street').length,1);
 assert.equal(authoredEntityCount,referenceEntities.length);
 assert.deepEqual(quality.internal,[1920,1080]);
 assert.equal(scene.environment.snowfall,'light');
});

test('canopy deposition thins at steep sides and has finite unit normals and outward triangles',()=>{
 const mesh=canopySnow(0,1.8,1.12,3);
 assert.equal(mesh.positions.length,mesh.normals.length);
 assert.deepEqual(mesh,canopySnow(0,1.8,1.12,3));
 assert.notDeepEqual(mesh.positions,canopySnow(0,1.8,1.12,4).positions);
 for(let i=0;i<mesh.normals.length;i+=3)assert.ok(Math.abs(Math.hypot(...mesh.normals.slice(i,i+3))-1)<1e-8);
 for(let i=0;i<mesh.indices.length;i+=3){
  const [a,b,c]=mesh.indices.slice(i,i+3).map(index=>mesh.positions.slice(index*3,index*3+3));
  const u=b.map((v,k)=>v-a[k]),v=c.map((n,k)=>n-a[k]);
  const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
  const normal=mesh.normals.slice(mesh.indices[i]*3,mesh.indices[i]*3+3);
  assert.ok(n.reduce((sum,x,k)=>sum+x*normal[k],0)>0);
 }
 const edge=mesh.positions[0]-1.8,crown=mesh.positions[26*3+1]-(3.19+1.12);
 assert.ok(edge<.012&&crown>.05&&crown<.15);
 assert.ok(mesh.positions.every(Number.isFinite));
});

test('snow motion uses prior simulation time and camera; a cold segment starts with zero movement',()=>{
 const vp=new Float32Array(16);const current={camera:[1,2,3],right:[1,0,0],up:[0,1,0],time:20};
 const cold=snowfallUniform(vp,current,.2,[.3,0,.1],20260930);
 assert.deepEqual([...cold.slice(32,35)],current.camera);assert.equal(cold[35],20);
 const previous={...current,camera:[.8,2,3],time:20-1/60};
 const moving=snowfallUniform(vp,current,.2,[.3,0,.1],20260930,previous);
 assert.equal(moving.byteLength,176);assert.ok(Math.abs(moving[35]-(20-1/60))<1e-6);
 assert.ok(moving.every(Number.isFinite));assert.notDeepEqual(moving,cold);
 const renderer=Object.create(WebGPURenderer.prototype);
 Object.assign(renderer,{historyValid:true,previousVp:vp,previousCamera:[1,2,3],previousTarget:[0,0,0],previousModels:new Map([['snow',vp]])});
 renderer.setTimelineFrame(120);assert.equal(renderer.timelineFrame,120);
 assert.throws(()=>renderer.setTimelineFrame(-1),RangeError);
 renderer.resetTemporalHistory();assert.equal(renderer.historyValid,false);assert.equal(renderer.previousCamera,null);assert.equal(renderer.previousModels.size,0);
});
