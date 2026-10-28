import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene} from '../dist/scene/scene.js';
import {WebGPURenderer} from '../dist/render/webgpu.js';
import {initializationDevice} from './helpers/render-initialization-device.mjs';

test('same-ID offscreen replacement releases old scene-owned CPU data and preserves reusable GPU resources',()=>{
 const scene=new Scene({version:1,entities:[]});scene.add({id:'subject',mesh:{kind:'box'}});
 const renderer=Object.create(WebGPURenderer.prototype),old=scene.entities.get('subject');
 Object.assign(renderer,{objects:new Map(),meshes:new Map(),labels:new Map(),modelCache:new Map()});renderer.collect(scene);
 const resource={destroy(){assert.fail('same-ID replacement may reuse its GPU allocation');}},object={source:old,material:old.material,uniformReady:true,uniform:resource,texture:resource,deformationTexture:resource};
 renderer.objects.set('subject',object);
 scene.remove('subject');scene.add({id:'subject',mesh:{kind:'sphere'},position:[10000,0,0]});
 assert.equal(renderer.collect(scene),true);assert.equal(renderer.objects.get('subject'),object);
 assert.equal(object.uniformReady,false);assert.equal(Object.hasOwn(object,'source'),false);assert.equal(Object.hasOwn(object,'material'),false);
 assert.equal(renderer.needsPrepare(scene.entities.get('subject'),new Float32Array(16)),true,'the replacement must prepare before any later draw');
 assert.equal(renderer.collect(scene),false);assert.equal(Object.hasOwn(object,'source'),false);
});

test('unchanged objects retain material and source identity across unrelated structural edits',()=>{
 const scene=new Scene({version:1,entities:[{id:'subject',mesh:{kind:'box'}}]}),renderer=Object.create(WebGPURenderer.prototype),entity=scene.entities.get('subject');
 Object.assign(renderer,{objects:new Map(),meshes:new Map(),labels:new Map(),modelCache:new Map()});renderer.collect(scene);
 const object={source:entity,material:entity.material,uniformReady:true};renderer.objects.set('subject',object);
 scene.add({id:'elsewhere',mesh:{kind:'box'},position:[10000,0,0]});renderer.collect(scene);
 assert.equal(object.source,entity);assert.equal(object.material,entity.material);assert.equal(object.uniformReady,true);
});

test('dispose releases scene and measured-radiance roots and destroys both owned field textures exactly once',async t=>{
 const env=initializationDevice(t),renderer=await WebGPURenderer.create(env.canvas),scene=new Scene({version:1,entities:[{id:'subject',mesh:{kind:'box'}}]}),entity=scene.entities.get('subject');
 Object.assign(renderer,{lastScene:scene,collectedScene:scene,appearanceScene:scene,environmentScene:scene,collectedVisible:[entity],collectedOpaque:[entity],collectedTransparent:[entity],lastLights:[entity],spotShadows:[{entity}],measuredRadianceSpec:{rgb16fBase64:'previous-source'},measuredRadiance:new Float32Array(1024)});
 renderer.frameCache.build(scene,scene.camera);renderer.visibilityPlan.project({camera:new Float32Array(16),reflection:null,light:null},[0,0,0],()=>({min:[-.5,-.5,-.5],max:[.5,.5,.5]}));
 const resource=()=>({destroys:0,destroy(){this.destroys++;}}),uniform=resource(),texture=resource(),deformationTexture=resource(),sharedTexture=resource(),sharedDeformation=resource(),sharedUniform=resource();
 renderer.objects.set('owned',{source:entity,material:entity.material,uniform,texture,deformationTexture,owned:true});
 renderer.objects.set('shared',{source:entity,material:entity.material,uniform:sharedUniform,texture:sharedTexture,deformationTexture:sharedDeformation,owned:false});
 renderer.dispose();renderer.dispose();
 for(const name of ['lastScene','collectedScene','appearanceScene','environmentScene','cameraBatchScene','renderFrame','measuredRadianceSpec','measuredRadiance'])assert.equal(renderer[name],null,name);
 for(const name of ['collectedVisible','collectedOpaque','collectedTransparent','lastLights','spotShadows'])assert.equal(renderer[name].length,0,name);
 assert.equal(renderer.objects.size,0);assert.equal(renderer.frameCache.inspect().entries,0);assert.equal(renderer.visibilityPlan.inspect().entries,0);
 assert.equal(uniform.destroys,1);assert.equal(texture.destroys,1);assert.equal(deformationTexture.destroys,1);assert.equal(sharedUniform.destroys,1);assert.equal(sharedTexture.destroys,0);assert.equal(sharedDeformation.destroys,0);
});

test('synthetic environment releases a previous decoded measured image even on an unchanged synthetic cause',()=>{
 const renderer=Object.create(WebGPURenderer.prototype),scene=new Scene({version:1,entities:[]});
 Object.assign(renderer,{environmentIrradiance:new Float32Array(36),environmentUpdates:0,environmentKey:'',device:{queue:{writeTexture(){}}},gpu:{environmentMap:{}},profiler:{enabled:false,addUpload(){}}});
 renderer.updateEnvironmentMap(scene,[0,1,0]);const key=renderer.environmentKey,updates=renderer.environmentUpdates;
 renderer.measuredRadianceSpec={rgb16fBase64:'previous-source'};renderer.measuredRadiance=new Float32Array(1024);
 renderer.updateEnvironmentMap(scene,[0,1,0]);assert.equal(renderer.measuredRadianceSpec,null);assert.equal(renderer.measuredRadiance,null);
 assert.equal(renderer.environmentKey,key);assert.equal(renderer.environmentUpdates,updates);
});
