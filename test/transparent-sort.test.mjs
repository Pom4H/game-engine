import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene} from '../dist/scene/scene.js';
import {compactTriangleMesh,primitiveMesh} from '../dist/procedural/mesh.js';
import {RenderFrameCache,buildRenderFrame} from '../dist/render/frame.js';
import {RenderVisibilityPlan} from '../dist/render/visibility-plan.js';
import {meshBounds} from '../dist/render/visibility.js';

const mesh=(x=0)=>compactTriangleMesh({positions:[x,0,0,x+.5,0,0,x,.5,0],normals:[0,0,1,0,0,1,0,0,1],indices:[0,1,2]});
const sort=ordinal=>({anchor:[0,0,0],phase:'static-tail',ordinal});
const spec=(id,m=mesh())=>({id,mesh:m,renderOnly:true,material:{kind:'glass'}});
const make=()=>new Scene({version:1,entities:[]});
function projection(scene){
 const cache=new RenderFrameCache(),plan=new RenderVisibilityPlan(),bounds=new WeakMap(),matrix=new Float32Array([.01,0,0,0,0,.01,0,0,0,0,.1,0,0,0,.5,1]);
 return()=>{const frame=cache.build(scene,scene.camera);plan.prepare(scene,frame.objects.map(object=>object.entity),scene.renderMoverIds(),new Set(),entity=>frame.objectsById.get(entity.id).model,cache.changedObjects());return{frame,...plan.project({camera:matrix,reflection:matrix,light:matrix},[0,0,10],primitive=>{let b=bounds.get(primitive);if(!b){b=meshBounds(primitiveMesh(primitive).vertices);bounds.set(primitive,b);}return b;})};};
}
const ids=result=>result.cameraTransparent.map(entity=>entity.id);

test('explicit static tails preserve old static/raw-glass/mover blend ties despite changed Scene insertion and held-origin transforms',()=>{
 const old=make();for(const id of ['static-a','mover','static-b','glass-0','glass-1'])old.add(spec(id));old.setVisualTransform('mover',[0,0,0]);const oldProject=projection(old);assert.deepEqual(ids(oldProject()),['static-a','static-b','glass-0','glass-1','mover']);
 const next=make();next.add({...spec('glass-1',mesh(-10)),transparentSort:sort(1)});next.add(spec('static-a'));next.add(spec('mover'));next.add({...spec('glass-0',mesh(-10)),transparentSort:sort(0)});next.add(spec('static-b'));
 next.setVisualTransform('mover',[0,0,0]);next.setVisualTransform('glass-1',[10,0,0]);next.setVisualTransform('glass-0',[10,0,0]);const project=projection(next);
 assert.deepEqual(ids(project()),ids(oldProject()));assert.equal(next.renderMoverIds().has('glass-0'),true,'sort metadata must not misclassify the actual moving model');
 next.setVisualTransform('glass-0',[20,0,0]);assert.deepEqual(ids(project()),ids(oldProject()),'sort anchor stays at old raw local origin under a held-frame rebase');
 next.setVisualTransform('mover',[0,0,-2]);assert.deepEqual(ids(project()),['mover','static-a','static-b','glass-0','glass-1'],'distance remains primary; phase only resolves ties');
 next.setVisualTransform('mover',[0,0,0]);next.setVisualTransform('glass-0',[1000,0,0]);assert.deepEqual(ids(project()),['static-a','static-b','glass-1','mover'],'visibility uses actual geometry/model, never the sort anchor');
});

test('ordinal/phase/anchor changes are observed without corrupting cached order or immutable earlier frame metadata',()=>{
 const s=make();for(const id of ['static','mover'])s.add(spec(id));s.setVisualTransform('mover',[0,0,0]);s.add({...spec('page-0'),transparentSort:sort(0)});s.add({...spec('page-1'),transparentSort:sort(1)});s.setVisualTransform('page-0',[0,0,0]);s.setVisualTransform('page-1',[0,0,0]);const project=projection(s),initial=project(),saved=initial.frame.objectsById.get('page-0'),model=saved.model;
 assert.deepEqual(ids(initial),['static','page-0','page-1','mover']);s.entities.get('page-0').transparentSort=sort(5);const changed=project();assert.deepEqual(ids(changed),['static','page-1','page-0','mover']);assert.equal(changed.frame.objectsById.get('page-0').model,model);assert.equal(saved.transparentSort.ordinal,0);assert.equal(Object.isFrozen(saved.transparentSort.anchor),true);
 delete s.entities.get('page-0').transparentSort;assert.deepEqual(ids(project()),['static','page-1','mover','page-0']);s.entities.get('page-1').transparentSort={anchor:[0,0,-3],phase:'static-tail',ordinal:1};assert.deepEqual(ids(project()),['page-1','static','mover','page-0']);
 const pure=buildRenderFrame(s),metadata=pure.objectsById.get('page-1').transparentSort;s.entities.get('page-1').transparentSort.anchor[2]=-4;assert.equal(metadata.anchor[2],-3);assert.equal(project().frame.objectsById.get('page-1').transparentSort.anchor[2],-4);
});

test('Scene and detached prewarm snapshot validated sort metadata; refresh preserves its fixed ordering contract',()=>{
 const s=make(),input={...spec('prepared'),transparentSort:sort(3)},ticket=s.prepareRenderEntity(input);input.transparentSort.anchor[0]=99;input.transparentSort.ordinal=99;assert.deepEqual(ticket.entity.transparentSort,sort(3));assert.equal(Object.isFrozen(ticket.entity.transparentSort),true);ticket.refresh({position:[20,0,0],material:{kind:'glass'}});assert.deepEqual(ticket.entity.transparentSort,sort(3));const entity=ticket.adopt();assert.equal(s.entities.get('prepared'),entity);ticket.dispose();
 const ordinary={...spec('ordinary'),transparentSort:sort(2)},added=s.add(ordinary);ordinary.transparentSort.anchor[1]=55;assert.deepEqual(added.transparentSort,sort(2));const snapshot=buildRenderFrame(s).objectsById.get('ordinary').transparentSort;assert.notEqual(snapshot,added.transparentSort);assert.deepEqual(snapshot,sort(2));
 for(const value of [null,[],{...sort(0),phase:'other'},{...sort(0),ordinal:-1},{...sort(0),ordinal:.5},{...sort(0),ordinal:Infinity},{...sort(0),anchor:[0,,0]},{...sort(0),anchor:[0,NaN,0]},{...sort(0),anchor:[0,0,0,0]}])assert.throws(()=>s.add({...spec('invalid'),transparentSort:value}));
 assert.throws(()=>s.add({...spec('physical'),renderOnly:false,transparentSort:sort(0)}),/renderOnly/);
 let reads=0;const changing={...spec('changing')};Object.defineProperty(changing,'transparentSort',{enumerable:true,get(){return ++reads<3?sort(0):{...sort(0),anchor:[0,NaN,0]};}});assert.throws(()=>s.add(changing),/finite vec3/);assert.equal(s.entities.has('changing'),false,'the actual owned copy is checked even if a public metadata getter changes during Scene.add');
});
