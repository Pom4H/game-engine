import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene} from '../dist/scene/scene.js';
import {RenderFrameCache} from '../dist/render/frame.js';
import {RenderVisibilityPlan} from '../dist/render/visibility-plan.js';
import {RenderVisibilityPlan as FrozenPlan} from './fixtures/render-visibility-plan-before-identity.mjs';
import {freezePrimitive,primitiveMesh} from '../dist/procedural/mesh.js';
import {meshBounds} from '../dist/render/visibility.js';
import {lookAt,multiply4,perspective} from '../dist/math.js';

const box=freezePrimitive({kind:'box'}),bounds=meshBounds(primitiveMesh(box).vertices);
const view=multiply4(perspective(Math.PI/3,16/9,.05,10000),lookAt([6,5,10],[0,1,0]));
const views={camera:view,reflection:view,light:view},passes=['cameraOpaque','cameraTransparent','reflectedObjects','staticShadowDrawables','dynamicShadowDrawables'];
const walls=(count=128)=>Array.from({length:count},(_,n)=>({id:'wall-'+n,renderOnly:true,mesh:box,position:[(n%16)-8,1,Math.floor(n/16)-4]}));
const grass=(id='grass')=>({id,renderOnly:true,mesh:box,material:{groundCover:'grass-blade'}});
function fixture(entities){
 const scene=new Scene({version:1,entities}),frames=new RenderFrameCache(),plan=new RenderVisibilityPlan(),frozen=new FrozenPlan();
 function observe(batches=new Set(),customViews=views){
  const frame=frames.build(scene,scene.camera),entities=frame.objects.map(o=>o.entity),models=e=>frame.objectsById.get(e.id).model,movers=scene.renderMoverIds(),before=JSON.stringify(scene.snapshot());
  for(const current of [plan,frozen])current.prepare(scene,entities,movers,batches,models,frames.changedObjects());
  const result=plan.project(customViews,[6,5,10],()=>bounds),old=frozen.project(customViews,[6,5,10],()=>bounds);
  for(const pass of passes)assert.deepEqual(result[pass],old[pass],pass+' must retain the frozen exact candidate order and source identities');
  assert.equal(JSON.stringify(scene.snapshot()),before,'culling must leave physical replay unchanged');
  return {result,old,frame};
 }
 return {scene,frames,plan,frozen,observe};
}

test('retiring a posed non-caster never rebuilds 128 unchanged static casters',()=>{
 const f=fixture([grass(),...walls()]);f.scene.setVisualTransform('grass',[0,0,0]);
 const before=f.observe(),stats=f.plan.inspect().passes.staticShadow;
 f.scene.remove('grass');const after=f.observe(),next=f.plan.inspect().passes.staticShadow;
 assert.equal(after.result.staticShadowDrawables,before.result.staticShadowDrawables);
 assert.equal(after.result.shadowRevision,before.result.shadowRevision);
 assert.equal(next.sourceBuilds,stats.sourceBuilds);assert.equal(next.staticBuilds,stats.staticBuilds);assert.equal(next.tests,stats.tests);assert.equal(next.lastTests,0);
 assert.equal(f.frozen.inspect().passes.staticShadow.staticBuilds,2,'frozen original reproduces the defect independently');
 assert.equal(f.frozen.inspect().passes.staticShadow.lastTests,128);
});

test('adding, retiring and reordering non-casters preserves each unrelated ordered pass',()=>{
 const f=fixture([grass(),...walls(32),{id:'glass',mesh:box,material:{color:[1,1,1,.4]}}]);f.scene.setVisualTransform('grass',[0,0,0]);
 const before=f.observe(),stats=f.plan.inspect().passes.staticShadow;
 for(let n=0;n<20;n++){
  const moved=f.scene.entities.get('grass');f.scene.entities.delete('grass');
  const entries=[...f.scene.entities];f.scene.entities.clear();
  if(n%2)f.scene.entities.set('grass',moved);
  for(const [id,e]of entries)f.scene.entities.set(id,e);
  if(!(n%2))f.scene.entities.set('grass',moved);
  f.scene.add(grass('temporary'));f.scene.setVisualTransform('temporary',[n*.1,0,0]);
  const added=f.observe();assert.equal(added.result.staticShadowDrawables,before.result.staticShadowDrawables);
  f.scene.remove('temporary');f.observe();
 }
 const next=f.plan.inspect().passes.staticShadow;
 assert.equal(next.sourceBuilds,stats.sourceBuilds);assert.equal(next.staticBuilds,stats.staticBuilds);assert.equal(next.tests,stats.tests);
 assert.equal(f.plan.inspect().entries,34);
});

test('source order remains meaningful for coplanar static ties and changed model certificates',()=>{
 const f=fixture(walls(8)),first=f.observe(),before=f.plan.inspect().passes.staticShadow;
 const a=f.scene.entities.get('wall-0');f.scene.entities.delete(a.id);f.scene.entities.set(a.id,a);
 const reordered=f.observe();assert.notDeepEqual(reordered.result.staticShadowDrawables,first.result.staticShadowDrawables);
 assert.ok(reordered.result.shadowRevision>first.result.shadowRevision);
 assert.equal(f.plan.inspect().passes.staticShadow.staticBuilds,before.staticBuilds+1);
 const revision=reordered.result.shadowRevision;
 f.scene.entities.get('wall-2').position[0]+=.125;const moved=f.observe();assert.ok(moved.result.shadowRevision>revision);
 assert.equal(f.observe().result.shadowRevision,moved.result.shadowRevision);
});

test('same-id replacements, caster eligibility and relief edits retain original invalidations',()=>{
 const f=fixture([grass(),...walls(8)]);f.scene.setVisualTransform('grass',[0,0,0]);f.observe();
 for(let n=0;n<12;n++){
  const old=f.scene.entities.get('wall-0');f.scene.remove(old.id);
  const e=f.scene.add({id:'wall-0',renderOnly:true,mesh:box,position:[0,1,0]});
  let revision=f.observe().result.shadowRevision;
  assert.ok(!f.observe().result.staticShadowDrawables.includes(old));assert.equal(f.plan.inspect().entries,9);
  // The original production observer must still see direct numeric edits.
  e.material={...e.material,emissive:[2,0,0]};assert.ok(f.observe().result.shadowRevision>revision);
  e.material={...e.material,emissive:[0,0,0],texture:{url:'/color.png',heightUrl:'/height.png',heightScaleM:.04,sizeM:1}};
  revision=f.observe().result.shadowRevision;
  for(const patch of [{heightScaleM:.08},{heightUrl:'/height-next.png'},{sizeM:2}]){
   e.material.texture={...e.material.texture,...patch};const changed=f.observe();assert.ok(changed.result.shadowRevision>revision);revision=changed.result.shadowRevision;
  }
  f.scene.setVisualTransform(e.id,[1,2,3]);const dynamic=f.observe();assert.ok(!dynamic.result.staticShadowDrawables.includes(e));assert.ok(dynamic.result.dynamicShadowDrawables.includes(e));
 }
});

test('retired observers cannot alter a surviving static certificate and scene swaps clear ownership',()=>{
 const f=fixture([grass(),...walls(8)]);f.scene.setVisualTransform('grass',[0,0,0]);
 const initial=f.observe(),retired=initial.frame.objectsById.get('grass');f.scene.remove('grass');const current=f.observe();
 f.plan.prepare(f.scene,current.frame.objects.map(o=>o.entity),f.scene.renderMoverIds(),new Set(),e=>current.frame.objectsById.get(e.id).model,[{...retired,model:new Float32Array(retired.model).fill(9)}]);
 assert.equal(f.plan.project(views,[6,5,10],()=>bounds).shadowRevision,current.result.shadowRevision);
 f.plan.clear();assert.equal(f.plan.inspect().entries,0);
 const other=new Scene({version:1,entities:[{id:'other',mesh:box}]}),frame=f.frames.build(other,other.camera);
 f.plan.prepare(other,[frame.objects[0].entity],other.renderMoverIds(),new Set(),()=>frame.objects[0].model,f.frames.changedObjects());
 assert.deepEqual(f.plan.project(views,[6,5,10],()=>bounds).staticShadowDrawables.map(e=>e.id),['other']);
});
