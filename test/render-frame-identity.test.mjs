import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene} from '../dist/scene/scene.js';
import {freezePrimitive} from '../dist/procedural/mesh.js';
import {RenderFrameCache,buildRenderFrame,buildProxyRenderFrame,buildDormantRenderFrame} from '../dist/render/frame.js';

const entity=(id,n=0)=>({id,mesh:{kind:'box',size:[1+n*.01,2,3]},position:[n,.5,-n],rotation:[.13*n,.17*n,.07*n],scale:[.7,1.2,2.3]});
function oracle(scene,cache,builder=buildRenderFrame,observer){
 const result=cache.build(scene,scene.camera,builder,observer),pure=builder(scene,scene.camera);
 assert.deepEqual(result.objects.map(o=>o.entity),pure.objects.map(o=>o.entity),'source ordering is exact');
 assert.deepEqual([...result.objectsById.keys()],[...pure.objectsById.keys()]);
 for(let i=0;i<result.objects.length;i++){
  const actual=result.objects[i],expected=pure.objects[i];
  assert.equal(actual.primitive,expected.primitive);assert.equal(actual.physicalPrimitive,expected.physicalPrimitive);
  assert.deepEqual(new Uint8Array(actual.model.buffer,actual.model.byteOffset,actual.model.byteLength),new Uint8Array(expected.model.buffer,expected.model.byteOffset,expected.model.byteLength),'matrix bytes match pure projection');
 }
 assert.deepEqual(result.lights,pure.lights);return result;
}

test('removing the first entity preserves every surviving object and matrix without reporting motion',()=>{
 const scene=new Scene({version:1,entities:Array.from({length:3000},(_,i)=>entity('cube'+i,i))}),cache=new RenderFrameCache();
 const first=oracle(scene,cache),saved=new Map(first.objects.map(o=>[o.entity,o])),updates=cache.inspect().modelUpdates;
 scene.remove('cube0');const current=oracle(scene,cache);
 assert.equal(current.objects.length,2999);assert.equal(cache.changedObjects().length,0);assert.equal(cache.inspect().modelUpdates,updates);
 for(const object of current.objects){assert.equal(object,saved.get(object.entity));assert.equal(object.model,saved.get(object.entity).model);}
});

test('reordering entities preserves matrix identities and exact coplanar source order',()=>{
 const scene=new Scene({version:1,entities:[entity('first'),entity('second'),entity('third')]}),cache=new RenderFrameCache();
 const saved=new Map(oracle(scene,cache).objects.map(o=>[o.entity,o])),first=scene.entities.get('first');
 scene.entities.delete('first');scene.entities.set('first',first);
 const frame=oracle(scene,cache);assert.deepEqual(frame.objects.map(o=>o.entity.id),['second','third','first']);
 for(const object of frame.objects)assert.equal(object,saved.get(object.entity));assert.equal(cache.changedObjects().length,0);
});

test('slot recycling is bounded across replacement generations, visibility and sparse removals',()=>{
 const scene=new Scene({version:1,entities:Array.from({length:40},(_,i)=>entity('cube'+i,i))}),cache=new RenderFrameCache();
 let old=oracle(scene,cache).objects.map(o=>({object:o,bytes:new Uint8Array(o.model.buffer).slice()}));
 for(let step=0;step<80;step++){
  for(let i=0;i<40;i+=2){scene.remove('cube'+i);scene.add(entity('cube'+i,i+step*.01));}
  scene.setRenderVisible('cube1',step%2===0);oracle(scene,cache);
  assert.equal(cache.entriesByEntity.size,cache.inspect().entries,'no removed RuntimeEntity remains strongly retained');
  assert.ok(cache.poseSlots<=80,'slot demand is bounded by old and current live sets');
  assert.ok(cache.poses.length<=160*9,'numeric arena cannot grow with cumulative generations');
  assert.equal(cache.freePoseSlots.length+cache.entriesByEntity.size,cache.poseSlots);
 }
 for(const saved of old)assert.deepEqual(new Uint8Array(saved.object.model.buffer),saved.bytes,'old matrices remain immutable after slot reuse');
 for(const id of [...scene.entities.keys()])scene.remove(id);oracle(scene,cache);assert.equal(cache.entriesByEntity.size,0);
 cache.clear();assert.equal(cache.poseSlots,0);assert.equal(cache.freePoseSlots.length,0);assert.equal(cache.poses.length,0);
});

test('same-id replacement resets the cache while geometry and full precision motion remain authoritative',()=>{
 const scene=new Scene({version:1,entities:[entity('subject',3),entity('survivor',7)]}),cache=new RenderFrameCache();
 const initial=oracle(scene,cache),old=initial.objectsById.get('subject'),still=initial.objectsById.get('survivor');
 scene.remove('subject');scene.add(entity('subject',3));let current=oracle(scene,cache).objectsById.get('subject');
 assert.notEqual(current.entity,old.entity);assert.notEqual(current.model,old.model);assert.equal(cache.changedObjects().length,1);
 assert.equal(cache.objectsById.get('survivor'),still);
 for(const mutate of [()=>current.entity.position[0]+=1e-10,()=>current.entity.rotation[1]+=.1,()=>current.entity.scale[0]+=.2,()=>current.entity.renderMesh=freezePrimitive({kind:'sphere',radius:2})]){
  const previous=current,bytes=new Uint8Array(previous.model.buffer).slice();mutate();current=oracle(scene,cache).objectsById.get('subject');
  assert.notEqual(current.model,previous.model);assert.equal(cache.changedObjects().length,1);assert.deepEqual(new Uint8Array(previous.model.buffer),bytes);
 }
 const model=current.model;current.entity.mesh=freezePrimitive({kind:'box',size:[9,8,7]});current=oracle(scene,cache).objectsById.get('subject');
 assert.equal(current.model,model);assert.equal(cache.changedObjects().length,0);
});

test('observer append and aborted topology changes cannot retain deleted entities or corrupt grown pose rows',()=>{
 const scene=new Scene({version:1,entities:[entity('first'),entity('second',1)]}),cache=new RenderFrameCache();oracle(scene,cache);
 scene.remove('first');scene.add(entity('third',2));
 assert.throws(()=>cache.build(scene,scene.camera,buildRenderFrame,{begin(){},observe(){throw Error('interrupted');},end(){},abort(){}}),/interrupted/);
 assert.equal(cache.changedObjects(),undefined);oracle(scene,cache);assert.equal(cache.entriesByEntity.size,2);
 let appended=false;const observer={begin(){},observe(){if(!appended){appended=true;for(let i=0;i<150;i++)scene.add(entity('appended'+i,i));}},end(){},abort(){}};
 oracle(scene,cache,buildRenderFrame,observer);oracle(scene,cache);assert.equal(cache.changedObjects().length,0);
 scene.entities.get('second').position[0]+=1e-10;oracle(scene,cache);assert.deepEqual(cache.changedObjects().map(o=>o.entity.id),['second']);
});

test('builder and scene boundaries release identity rows and preserve custom builder execution',()=>{
 const scene=new Scene({version:1,entities:[{...entity('subject'),renderMesh:{kind:'sphere',radius:2}}]}),cache=new RenderFrameCache();
 oracle(scene,cache);oracle(scene,cache,buildProxyRenderFrame);assert.equal(cache.entriesByEntity.size,1);
 oracle(scene,cache,buildDormantRenderFrame);assert.equal(cache.entriesByEntity.size,0);assert.equal(cache.inspect().entries,0);
 let calls=0;const custom=(scene,camera)=>{calls++;return buildRenderFrame(scene,camera,{includeMeshes:true});};
 cache.build(scene,scene.camera,custom);cache.build(scene,scene.camera,custom);assert.equal(calls,2);assert.equal(cache.entriesByEntity.size,0);
 oracle(scene,cache);const next=new Scene({version:1,entities:[entity('next')]});oracle(next,cache);assert.equal(cache.entriesByEntity.size,1);assert.equal(cache.objectsById.has('subject'),false);
});
