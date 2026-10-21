import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene} from '../dist/scene/scene.js';
import {freezePrimitive} from '../dist/procedural/mesh.js';
import {RenderFrameCache,buildRenderFrame,buildProxyRenderFrame,buildDormantRenderFrame} from '../dist/render/frame.js';
import {distantRadianceKey,distantRadianceCacheStats} from '../dist/render/radiance.js';

test('translation updates retain exact rotated/scaled matrices and immutable history; linear changes still recompose',()=>{
 const scene=new Scene({version:1,entities:Array.from({length:12},(_,i)=>({id:'cube'+i,mesh:{kind:'box',size:[1+i*.1,2,3]},position:[i,.5,0],rotation:[.17*i,.13*i,.07*i],scale:[.5+i*.1,1.2,2.3]}))}),cache=new RenderFrameCache();
 cache.build(scene,scene.camera);const saved=cache.build(scene,scene.camera).objects.map(object=>({model:object.model,values:[...object.model]}));
 for(let frame=0;frame<16;frame++){
  for(const entity of scene.entities.values()){entity.position[0]+=Math.sin(frame*.13);entity.position[1]-=.05;entity.position[2]+=1e-10;}
  const before=cache.inspect().translationUpdates,current=cache.build(scene,scene.camera);assert.equal(cache.inspect().translationUpdates,before+12);
  assert.deepEqual(current.objects.map(object=>[...object.model]),buildRenderFrame(scene).objects.map(object=>[...object.model]));
 }
 for(const old of saved)assert.deepEqual([...old.model],old.values);
 for(const mutate of [()=>scene.entities.get('cube0').rotation[1]+=.3,()=>scene.entities.get('cube1').scale[0]+=.2,()=>scene.entities.get('cube2').renderMesh=freezePrimitive({kind:'sphere',radius:2})]){
  mutate();const before=cache.inspect().translationUpdates,current=cache.build(scene,scene.camera);assert.equal(cache.inspect().translationUpdates,before);
  assert.deepEqual(current.objects.map(object=>[...object.model]),buildRenderFrame(scene).objects.map(object=>[...object.model]));
 }
});

test('pose observations certify only completed live projections and retain direct/API motion and replacement changes',()=>{
 const scene=new Scene({version:1,entities:[{id:'cube',mesh:{kind:'box'}}]}),cache=new RenderFrameCache();assert.equal(cache.changedObjects(),undefined);
 cache.build(scene,scene.camera);assert.equal(cache.changedObjects().length,1);cache.build(scene,scene.camera);assert.equal(cache.changedObjects().length,0);
 scene.entities.get('cube').position[0]=1e-10;cache.build(scene,scene.camera);assert.equal(cache.changedObjects().length,1);
 scene.setVisualTransform('cube',[2,3,4]);cache.build(scene,scene.camera);assert.equal(cache.changedObjects()[0].model[12],2);
 scene.entities.get('cube').renderMesh=freezePrimitive({kind:'sphere',radius:2});cache.build(scene,scene.camera);assert.equal(cache.changedObjects()[0].model[0],4);
 cache.build(scene,scene.camera,(scene,camera)=>buildRenderFrame(scene,camera));assert.equal(cache.changedObjects(),undefined);
 cache.build(scene,scene.camera);assert.equal(cache.changedObjects().length,1);
 assert.throws(()=>cache.build(scene,scene.camera,buildRenderFrame,{begin(){},observe(){throw new Error('abort');},abort(){},end(){}}),/abort/);assert.equal(cache.changedObjects(),undefined);
 cache.clear();assert.equal(cache.changedObjects(),undefined);
});

test('visual pose publication keeps vector identities and validates all inputs before writing',()=>{
 const scene=new Scene({version:1,entities:[{id:'cube',mesh:{kind:'box'}}]}),entity=scene.entities.get('cube'),position=entity.position,rotation=entity.rotation,scale=entity.scale;
 scene.setVisualTransform('cube',[1,2,3],[.1,.2,.3],[2,3,4]);assert.equal(entity.position,position);assert.equal(entity.rotation,rotation);assert.equal(entity.scale,scale);
 assert.deepEqual(position,[1,2,3]);assert.deepEqual(rotation,[.1,.2,.3]);assert.deepEqual(scale,[2,3,4]);assert.ok(scene.renderMoverIds().has('cube'));
 for(const [p,r,s] of [[[5,6,7],[NaN,0,0],[1,1,1]],[[5,6,7],[0,0,0],[1,0,1]],[[5,6],[0,0,0],undefined]])assert.throws(()=>scene.setVisualTransform('cube',p,r,s));
 assert.deepEqual(position,[1,2,3]);assert.deepEqual(rotation,[.1,.2,.3]);assert.deepEqual(scale,[2,3,4]);
 scene.setVisualTransform('cube',position,rotation,scale);assert.deepEqual(position,[1,2,3]);assert.deepEqual(rotation,[.1,.2,.3]);assert.deepEqual(scale,[2,3,4]);
 scene.setVisualTransform('cube',[7,8,9]);assert.deepEqual(rotation,[0,0,0]);assert.deepEqual(scale,[2,3,4]);
});

test('live render projection reuses stationary matrices and preserves pure snapshots and previous poses',()=>{
 const scene=new Scene({version:1,entities:[{id:'still',mesh:{kind:'box',size:[2,3,4]}},{id:'moving',mesh:{kind:'sphere',radius:.7},body:{mass:1}}]}),cache=new RenderFrameCache();
 const replay=JSON.stringify(scene.snapshot()),snapshot=buildRenderFrame(scene),first=cache.build(scene,scene.camera),still=first.objectsById.get('still'),moving=first.objectsById.get('moving');
 const second=cache.build(scene,{...scene.camera,position:[4,5,6]});
 assert.equal(second.objects,first.objects);assert.equal(second.objectsById,first.objectsById);assert.equal(second.objectsById.get('still'),still);assert.equal(second.objectsById.get('moving'),moving);
 assert.equal(cache.inspect().builds,1);assert.equal(cache.inspect().modelUpdates,2);assert.equal(JSON.stringify(scene.snapshot()),replay);
 scene.entities.get('moving').position[0]=3;
 const third=cache.build(scene,scene.camera),changed=third.objectsById.get('moving');
 assert.notEqual(changed.model,moving.model);assert.equal(changed.model[12],3);assert.equal(moving.model[12],0,'previous matrix must not be mutated');
 assert.equal(third.objectsById.get('still'),still);assert.equal(snapshot.objectsById.get('moving').model[12],0);assert.equal(cache.inspect().builds,1);assert.equal(cache.inspect().modelUpdates,3);
 assert.deepEqual(third.objects.map(object=>[...object.model]),buildRenderFrame(scene).objects.map(object=>[...object.model]));
});

test('cached frames retain surface identity and the current physical primitive independently of visual geometry',()=>{
 const scene=new Scene({version:1,entities:[{id:'subject',mesh:{kind:'box'},renderMesh:{kind:'sphere',radius:2}}]}),cache=new RenderFrameCache(),entity=scene.entities.get('subject');
 const first=cache.build(scene,scene.camera).objectsById.get('subject'),model=first.model;
 assert.equal(first.surfaceId,'subject');assert.equal(first.physicalPrimitive,entity.mesh);assert.equal(first.primitive,entity.renderMesh);
 entity.mesh=freezePrimitive({kind:'box',size:[3,1,2]});
 const updated=cache.build(scene,scene.camera).objectsById.get('subject');
 assert.equal(updated.surfaceId,'subject');assert.equal(updated.physicalPrimitive,entity.mesh);assert.equal(updated.primitive,entity.renderMesh);assert.equal(updated.model,model);assert.equal(cache.changedObjects().length,0);
 assert.notEqual(first.physicalPrimitive,updated.physicalPrimitive);
 scene.setVisualTransform('subject',[1,2,3]);const moved=cache.build(scene,scene.camera).objectsById.get('subject');
 assert.equal(moved.surfaceId,'subject');assert.equal(moved.physicalPrimitive,entity.mesh);
});

test('projection observes geometry replacement, same-id generations, light membership and shrinking scenes',()=>{
 const scene=new Scene({version:1,entities:[{id:'subject',mesh:{kind:'box'}}]}),cache=new RenderFrameCache();
 cache.build(scene,scene.camera);scene.entities.get('subject').renderMesh=freezePrimitive({kind:'sphere',radius:3});
 assert.equal(cache.build(scene,scene.camera).objectsById.get('subject').model[0],6);
 scene.add({id:'lamp',light:{kind:'point',intensity:5,color:[1,1,1],range:10}});assert.equal(cache.build(scene,scene.camera).lights.length,1);
 const previous=scene.entities.get('subject');scene.remove('subject');scene.add({id:'subject',mesh:{kind:'box',size:[4,1,1]},position:[2,0,0]});
 const replacement=cache.build(scene,scene.camera).objectsById.get('subject');assert.notEqual(replacement.entity,previous);assert.equal(replacement.model[12],2);assert.equal(replacement.model[0],4);
 scene.remove('subject');scene.remove('lamp');assert.equal(cache.build(scene,scene.camera).objectsById.size,0);assert.equal(cache.inspect().entries,0);assert.equal(cache.inspect().lights,0);
 const next=new Scene({version:1,entities:[{id:'next',mesh:{kind:'box'}}]});assert.equal(cache.build(next,next.camera).objectsById.has('subject'),false);assert.equal(cache.inspect().entries,1);
 cache.clear();assert.equal(cache.inspect().entries,0);
});

test('pose storage growth and compacted slots retain full precision and independent old matrices',()=>{
 const scene=new Scene({version:1,entities:[{id:'first',mesh:{kind:'box'},position:[2,3,4]},{id:'second',mesh:{kind:'sphere'},position:[5,6,7]}]}),cache=new RenderFrameCache();
 const initial=cache.build(scene,scene.camera),oldFirst=initial.objectsById.get('first'),oldSecond=initial.objectsById.get('second');
 const firstModel=[...oldFirst.model];
 for(let index=0;index<40;index++)scene.add({id:'added-'+index,mesh:{kind:'box',size:[index+1,2,3]},position:[index,.5,-index]});
 const grown=cache.build(scene,scene.camera);assert.equal(grown.objectsById.get('first'),oldFirst);assert.equal(grown.objectsById.get('second'),oldSecond);
 assert.deepEqual(grown.objects.map(object=>[...object.model]),buildRenderFrame(scene).objects.map(object=>[...object.model]));
 scene.remove('first');for(let index=0;index<40;index+=2)scene.remove('added-'+index);
 scene.add({id:'first',mesh:{kind:'box',size:[4,5,6]},position:[0,0,0]});
 const compacted=cache.build(scene,scene.camera);assert.deepEqual(compacted.objects.map(object=>[...object.model]),buildRenderFrame(scene).objects.map(object=>[...object.model]));
 assert.deepEqual([...oldFirst.model],firstModel,'old matrices stay independent of reused numeric slots');
 const second=compacted.objectsById.get('second'),model=[...second.model];scene.entities.get('second').position[0]+=1e-10;
 const changed=cache.build(scene,scene.camera).objectsById.get('second');assert.notEqual(changed.model,second.model);assert.deepEqual([...changed.model],model,'a full-precision cause still changes matrix identity when Float32 values round equally');
 assert.deepEqual([...oldSecond.model],model);
 let appended=false;const observer={begin(){},observe(){if(!appended){appended=true;for(let index=0;index<80;index++)scene.add({id:'in-frame-'+index,mesh:{kind:'box'},position:[index,0,0]});}},end(){},abort(){}};
 const during=cache.build(scene,scene.camera,buildRenderFrame,observer);assert.deepEqual(during.objects.map(object=>[...object.model]),buildRenderFrame(scene).objects.map(object=>[...object.model]));
 cache.clear();assert.deepEqual(cache.build(scene,scene.camera).objects.map(object=>[...object.model]),buildRenderFrame(scene).objects.map(object=>[...object.model]));
});

test('projection cache respects depth-selected geometry and executes custom builders every frame',()=>{
 const scene=new Scene({version:1,entities:[{id:'subject',mesh:{kind:'box',size:[2,1,1]},renderMesh:{kind:'sphere',radius:3}}]}),cache=new RenderFrameCache();
 assert.equal(cache.build(scene,scene.camera,buildProxyRenderFrame).objects[0].model[0],2);
 assert.equal(cache.build(scene,scene.camera,buildRenderFrame).objects[0].model[0],6);
 assert.equal(cache.build(scene,scene.camera,buildDormantRenderFrame).objects.length,0);assert.equal(cache.inspect().entries,0);
 let calls=0;const custom=(scene,camera)=>{calls++;return buildRenderFrame(scene,camera,{includeMeshes:true});};
 assert.ok(cache.build(scene,scene.camera,custom).objects[0].mesh);cache.build(scene,scene.camera,custom);assert.equal(calls,2);assert.equal(cache.inspect().entries,0);
});

test('radiance cache retains its hash until numeric, geometry or membership causes change',()=>{
 const scene=new Scene({version:1,entities:[{id:'wall',mesh:{kind:'box'},material:{color:[.2,.3,.4,1]}},{id:'actor',mesh:{kind:'sphere'},body:{mass:1}}]}),wall=scene.entities.get('wall');
 let key=distantRadianceKey(scene);for(let n=0;n<8;n++)assert.equal(distantRadianceKey(scene),key);assert.deepEqual(distantRadianceCacheStats(scene),{entries:1,rebuilds:1});
 scene.entities.get('actor').position[0]=7;assert.equal(distantRadianceKey(scene),key);assert.equal(distantRadianceCacheStats(scene).rebuilds,1);
 for(const mutate of [()=>wall.rotation[1]=.5,()=>wall.scale[2]=2,()=>wall.renderMesh=freezePrimitive({kind:'box',size:[3,2,1]}),()=>wall.material.color[1]=.7,()=>wall.material={...wall.material,metalness:.9},()=>wall.material={...wall.material,surface:{...wall.material.surface,wetness:.7}},()=>wall.material={...wall.material,emissive:[0,0,0]}]){
  mutate();const next=distantRadianceKey(scene);assert.notEqual(next,key);key=next;assert.equal(distantRadianceKey(scene),key);
 }
 assert.equal(distantRadianceCacheStats(scene).rebuilds,8);
 scene.setVisualTransform('wall',[1,2,3]);assert.notEqual(distantRadianceKey(scene),key);assert.equal(distantRadianceCacheStats(scene).entries,0);
 scene.remove('wall');scene.remove('actor');const empty=distantRadianceKey(scene);assert.equal(empty,2166136261);assert.equal(distantRadianceCacheStats(scene).entries,0);
});
