import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene} from '../dist/scene/scene.js';
import {RenderFrameCache,buildRenderFrame,buildProxyRenderFrame} from '../dist/render/frame.js';
import {buildSceneRadianceProbe} from '../dist/render/radiance.js';

test('hiding an entity removes it from every render projection without moving it or deleting physical state',()=>{
 const scene=new Scene({version:1,entities:[{id:'body',position:[2,1,0],mesh:{kind:'box',size:[1,1,1]},body:{mass:10},light:{kind:'point',intensity:5}},{id:'visual',renderOnly:true,renderVisible:false,position:[0,1,0],mesh:{kind:'box'}}]});
 const cache=new RenderFrameCache(),body=scene.entities.get('body'),physical=body.body,mesh=body.mesh,position=[...body.position];
 assert.deepEqual(cache.build(scene,scene.camera).objects.map(o=>o.entity.id),['body']);
 const revision=scene.renderStructureRevision;scene.setRenderVisible('body',false);assert.equal(scene.renderStructureRevision,revision+1);
 for(const builder of [buildRenderFrame,buildProxyRenderFrame]){assert.equal(builder(scene).objects.length,0);assert.equal(builder(scene).lights.length,0);assert.equal(cache.build(scene,scene.camera,builder).objectsById.size,0);}
 assert.deepEqual(body.position,position);assert.equal(body.body,physical);assert.equal(body.mesh,mesh);assert.equal(scene.entities.size,2);
 assert.equal(buildSceneRadianceProbe(scene).proxies.length,0);
 scene.setRenderVisible('body',false);assert.equal(scene.renderStructureRevision,revision+1);
 scene.setRenderVisible('body',true);scene.setRenderVisible('visual',true);
 const shown=cache.build(scene,scene.camera);assert.deepEqual(shown.objects.map(o=>o.entity.id),['body','visual']);assert.equal(shown.lights.length,1);
 assert.throws(()=>scene.setRenderVisible('body','yes'),TypeError);
});
