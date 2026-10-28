import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene} from '../dist/scene/scene.js';
import {RenderFrameCache,buildRenderFrame} from '../dist/render/frame.js';
import {freezePrimitive} from '../dist/procedural/mesh.js';

test('stable ordered entities reuse their indexed cache entries without any Map lookup; edits/reorder/replacement retain exact pure frames',()=>{
 const s=new Scene({version:1,entities:Array.from({length:128},(_,index)=>({id:'e'+index,mesh:{kind:'box'},renderOnly:true,position:[index,0,0]}))}),cache=new RenderFrameCache();cache.build(s,s.camera);const map=cache.entriesByEntity,get=map.get;let lookups=0;map.get=function(key){lookups++;return get.call(this,key);};
 const check=()=>{const cached=cache.build(s,s.camera),pure=buildRenderFrame(s);assert.deepEqual(cached.objects.map(o=>o.entity),pure.objects.map(o=>o.entity));for(let i=0;i<pure.objects.length;i++){assert.equal(cached.objects[i].primitive,pure.objects[i].primitive);assert.deepEqual(cached.objects[i].model,pure.objects[i].model);}return cached;};
 check();assert.equal(lookups,0);s.entities.get('e15').position[0]+=.125;const moved=check().objectsById.get('e15');assert.equal(lookups,0);s.entities.get('e15').rotation[1]=.2;check();assert.equal(lookups,0);assert.notEqual(cache.objectsById.get('e15').model,moved.model);
 const saved=s.entities.get('e0');s.entities.delete('e0');s.entities.set('e0',saved);check();assert.equal(lookups,128);lookups=0;check();assert.equal(lookups,0);s.remove('e7');s.add({id:'e7',renderOnly:true,mesh:{kind:'sphere'}});check();assert.ok(lookups>0);lookups=0;check();assert.equal(lookups,0);
 const before=cache.objectsById.get('e15').model;s.entities.get('e15').renderMesh=freezePrimitive({kind:'sphere',radius:2});check();assert.equal(lookups,0);assert.notEqual(cache.objectsById.get('e15').model,before);assert.equal(cache.entriesByEntity.size,s.entities.size);
});

test('ordinary mesh identities do not perform stream-brand WeakMap reads again after admission',()=>{
 const s=new Scene({version:1,entities:[{id:'plain',renderOnly:true,mesh:{kind:'box'}}]}),cache=new RenderFrameCache();cache.build(s,s.camera);const entity=s.entities.get('plain'),get=WeakMap.prototype.get;let lookups=0;
 try{WeakMap.prototype.get=function(value){lookups++;return get.call(this,value);};for(let i=0;i<8;i++){entity.position[0]=i/10;cache.build(s,s.camera);}}finally{WeakMap.prototype.get=get;}
 assert.equal(lookups,0,'stream ownership is fixed by primitive identity, while direct pose values still update');assert.equal(cache.inspect().entries,1);
});
