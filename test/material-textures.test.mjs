import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene,validateScene,batchStaticScenery} from '../dist/index.js';
import {validateEntity} from '../dist/scene/validate.js';
const entity=texture=>({id:'surface',mesh:{kind:'box',size:[1,1,1]},material:{kind:'concrete',texture}});

test('surface texture descriptors accept relative and HTTP assets and own the nested authoring data',()=>{
 for(const url of ['/assets/snow.png','./textures/brick.webp','../shared/grain.jpg','textures/cloth.png?v=2','https://example.org/material.png','http://localhost:8080/assets/snow.png','//cdn.example.org/snow.png']){
  const source={version:1,entities:[entity({url,sizeM:2,bumpStrength:.8,albedoStrength:.7})]},validated=validateScene(source);
  assert.deepEqual(validated.entities[0].material.texture,source.entities[0].material.texture);
  source.entities[0].material.texture.url='/changed.png';source.entities[0].material.texture.sizeM=99;
  assert.equal(validated.entities[0].material.texture.url,url);assert.equal(validated.entities[0].material.texture.sizeM,2);
 }
 const original=entity({url:'/assets/stone.png'}),validated=validateEntity(original);original.material.texture.url='/modified.png';assert.equal(validated.material.texture.url,'/assets/stone.png');
 for(const texture of [{url:'plain.png',sizeM:.01,bumpStrength:0,albedoStrength:0},{url:'plain.png',sizeM:1000,bumpStrength:2,albedoStrength:1}])assert.doesNotThrow(()=>validateEntity(entity(texture)));
});

test('invalid texture data fails before Scene.add mutates the world',()=>{
 const invalid=[null,[],{}, {url:''},{url:42},{url:'javascript:alert(1)'},{url:'data:image/png;base64,a'},{url:'blob:https://example.org/123'},{url:'file:///tmp/texture.png'}, {url:'http://'},{url:'https:example.org/x.png'},{url:'https://a.example/x\ny.png'},{url:' /assets/x.png'},{url:'/assets/\0snow.png'},{url:'\\\\server\\x.png'}, {url:'/x.png',sizeM:0},{url:'/x.png',sizeM:.009},{url:'/x.png',sizeM:1001},{url:'/x.png',sizeM:Infinity},{url:'/x.png',bumpStrength:NaN},{url:'/x.png',bumpStrength:-1},{url:'/x.png',bumpStrength:2.01},{url:'/x.png',albedoStrength:-.01},{url:'/x.png',albedoStrength:1.01}];
 for(const texture of invalid){
  assert.throws(()=>validateScene({version:1,entities:[entity(texture)]}),/surface\.material\.texture/);
  const scene=new Scene({version:1,entities:[]});assert.throws(()=>scene.add(entity(texture)),/surface\.material\.texture/);assert.equal(scene.entities.size,0);
 }
});

test('static batching preserves world-space texture identity and sampling parameters',()=>{
 const specs=[{...entity({url:'/a.png',sizeM:1}),id:'a',position:[1,1,1]},{...entity({url:'/a.png',sizeM:1}),id:'b',position:[2,1,1]},{...entity({url:'/b.png',sizeM:1}),id:'other-image',position:[3,1,1]},{...entity({url:'/a.png',sizeM:2}),id:'other-scale',position:[4,1,1]}];
 const batches=batchStaticScenery(specs,()=>true);assert.equal(batches.length,3);
 const shared=batches.find(e=>e.material.texture.url==='/a.png'&&e.material.texture.sizeM===1);assert.equal(shared.mesh.indices.length,72);
 assert.deepEqual(batches.map(e=>[e.material.texture.url,e.material.texture.sizeM]).sort(),[['/a.png',1],['/a.png',2],['/b.png',1]]);
});

test('snow appearance belongs to environmental authoring without overriding the base surface',()=>{
 const source={version:1,entities:[{id:'path',mesh:{kind:'box'},material:{kind:'concrete',texture:{url:'/stone.png',sizeM:2}},environmental:{surfaceUse:'sidewalk',snowDepthM:.1,snowMaterial:{color:[.91,.94,.96,1],roughness:.97,texture:{url:'/snow.png',sizeM:3,bumpStrength:1.2}}}}]};
 const validated=validateScene(source);source.entities[0].environmental.snowMaterial.texture.url='/changed.png';source.entities[0].environmental.snowMaterial.color[0]=0;
 assert.equal(validated.entities[0].material.texture.url,'/stone.png');
 assert.equal(validated.entities[0].environmental.snowMaterial.texture.url,'/snow.png');
 assert.equal(validated.entities[0].environmental.snowMaterial.color[0],.91);
 for(const snowMaterial of [null,[],{texture:{url:'javascript:bad'}},{roughness:1.1},{color:[1,1,1,2]},{kind:'unknown'},{emissive:[1,NaN,1]}]){
  const spec={id:'invalid-snow',environmental:{snowMaterial}};
  assert.throws(()=>validateEntity(spec),/invalid-snow\.environmental\.snowMaterial/);
  assert.throws(()=>new Scene({version:1,entities:[spec]}),/invalid-snow\.environmental\.snowMaterial/);
 }
});
