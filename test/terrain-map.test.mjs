import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene} from '../dist/scene/scene.js';
import {WebGPURenderer} from '../dist/render/webgpu.js';
import {compose} from '../dist/math.js';

test('finite source maps are explicit, validated, immutable optical state; ordinary image rules remain strict',()=>{
 const entity=texture=>({id:'map',mesh:{kind:'plane',size:[4,4]},renderOnly:true,material:{texture}}),good={url:'blob:https://office.test/4ff6578a-734c-4579-8d66-958beb73cb0b',projection:'terrain-map',sizeM:1536};
 const scene=new Scene({version:1,entities:[entity(good)]}),part=scene.entities.get('map');assert.equal(part.material.texture.projection,'terrain-map');assert.ok(Object.isFrozen(part.material.texture));assert.equal(scene.physics.bodies.size,0);
 for(const texture of [{...good,projection:'unknown'},{...good,sizeM:NaN},{...good,sizeM:0},{...good,sizeM:1048577},{...good,normalUrl:'/normal.png'},{...good,url:'javascript:alert(1)'},{...good,projection:'triplanar'}])assert.throws(()=>new Scene({version:1,entities:[entity(texture)]}));
 const material=part.material,appearance=scene.appearanceRevision;assert.throws(()=>scene.patchAppearance({materials:[{id:'map',set:{texture:{...good,sizeM:-1}}}]}));assert.equal(part.material,material);assert.equal(scene.appearanceRevision,appearance);
 scene.patchAppearance({materials:[{id:'map',set:{texture:{...good,url:'/next.png'}}}]});assert.equal(part.material.texture.url,'/next.png');assert.ok(Object.isFrozen(part.material.texture));assert.equal(scene.physics.bodies.size,0);assert.equal(scene.time,0);
});

test('actual material upload distinguishes a ready terrain map, a pending map, and existing triplanar textures',()=>{
 const scene=new Scene({version:1,entities:[{id:'map',mesh:{kind:'plane'},renderOnly:true,material:{texture:{url:'/map.png',projection:'terrain-map',sizeM:1536}}}]}),part=scene.entities.get('map'),writes=[],model=compose([0,0,0],[0,0,0],[1,1,1]),object={uniform:{},width:0,height:0},renderer=Object.create(WebGPURenderer.prototype);let ready=false;
 Object.assign(renderer,{lastScene:scene,object:()=>object,mesh:()=>({}),previousModels:{get:()=>model},surfaceTextures:{get:()=>ready?{}:undefined},profiler:{addUpload(){}},device:{queue:{writeBuffer(_b,_o,data){writes.push(new Float32Array(data));}}}});
 renderer.prepare(part,model);assert.equal(writes.at(-1)[79],0);ready=true;object.uniformReady=false;renderer.prepare(part,model);assert.equal(writes.at(-1)[79],2);assert.equal(writes.at(-1)[76],1536);
 scene.patchAppearance({materials:[{id:'map',set:{texture:{url:'/map.png',sizeM:4}}}]});renderer.prepare(part,model);assert.equal(writes.at(-1)[79],1);assert.equal(writes.at(-1)[76],4);
});
