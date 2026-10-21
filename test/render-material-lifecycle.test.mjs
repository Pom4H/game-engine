import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene} from '../dist/scene/scene.js';
import {WebGPURenderer} from '../dist/render/webgpu.js';
import {RenderFrameCache} from '../dist/render/frame.js';

function collectionRenderer(){
 const renderer=Object.create(WebGPURenderer.prototype);
 Object.assign(renderer,{objects:new Map(),meshes:new Map(),labels:new Map(),modelCache:new Map()});
 return renderer;
}

test('material alpha changes leave cached GPU opaque membership and reach the transparent pass',()=>{
 const scene=new Scene({version:1,entities:Array.from({length:6},(_,i)=>({id:'cube-'+i,mesh:{kind:'box'},material:{kind:'steel'}}))}),renderer=collectionRenderer();
 assert.equal(renderer.collect(scene),true);
 const revision=scene.renderStructureRevision,entity=scene.entities.get('cube-0'),visible=renderer.collectedVisible,opaque=renderer.collectedOpaque;
 assert.equal(renderer.collect(scene),false);assert.equal(renderer.collectedOpaque,opaque);
 entity.material={...entity.material,color:[.2,.4,.8,.4]};
 renderer.collect(scene);
 assert.equal(scene.renderStructureRevision,revision);assert.equal(renderer.collectedVisible,visible);
 assert.equal(renderer.collectedOpaque.includes(entity),false);assert.deepEqual(renderer.collectedTransparent,[entity]);
 const transparent=renderer.collectedTransparent;renderer.collect(scene);assert.equal(renderer.collectedTransparent,transparent);
 entity.material.color[3]=1;renderer.collect(scene);
 assert.equal(renderer.collectedOpaque.length,6);assert.equal(renderer.collectedTransparent.length,0);
 assert.equal(renderer.collectedVisible,visible);
});

test('continuous daylight retains geometry projection and temporal revision while updating radiance',()=>{
 const scene=new Scene({version:1,rendering:{exposure:1,fogDensity:.002,fogColor:[.1,.2,.3],shadowExtent:140},entities:[{id:'wall',mesh:{kind:'box'}}]}),renderer=collectionRenderer(),cache=new RenderFrameCache();
 renderer.collect(scene);cache.build(scene,scene.camera);
 const revision=scene.renderStructureRevision,appearance=scene.appearanceRevision,visible=renderer.collectedVisible;
 for(let n=0;n<24;n++){
  scene.patchAppearance({rendering:{sunDirection:[-.5,.5+n*.001,-.4],sunIntensity:1+n*.01,sunColor:[1,.9,.8],skyColor:[.2,.3,.4+n*.001],ambientIrradiance:[.1,.2,.3],exposure:1,fogDensity:.002,fogColor:[.1,.2,.3],shadowExtent:140}});
  cache.build(scene,scene.camera);assert.equal(renderer.collect(scene),false);
 }
 assert.equal(scene.renderStructureRevision,revision);assert.equal(scene.appearanceRevision,appearance);
 assert.equal(cache.inspect().builds,1);assert.equal(renderer.collectedVisible,visible);
 let uploads=0;
 Object.assign(renderer,{environmentIrradiance:new Float32Array(36),environmentUpdates:0,environmentKey:'',device:{queue:{writeTexture(){uploads++;}}},gpu:{environmentMap:{}},profiler:{enabled:false,addUpload(){}}});
 renderer.updateEnvironmentMap(scene,[0,1,0]);const old=renderer.environmentIrradiance.slice(),key=renderer.environmentKey;
 scene.patchAppearance({rendering:{skyColor:[.7,.2,.1],sunIntensity:2}});
 renderer.updateEnvironmentMap(scene,[0,1,0]);assert.notEqual(renderer.environmentKey,key);assert.notDeepEqual(renderer.environmentIrradiance,old);assert.equal(uploads,18);
 scene.patchAppearance({rendering:{exposure:1.2,sunIntensity:2.1}});assert.equal(scene.appearanceRevision,appearance+1);assert.equal(scene.renderStructureRevision,revision);
});
