import test from 'node:test';
import assert from 'node:assert/strict';
import {RenderModelHistory} from '../dist/render/model-history.js';
import {RenderFrameCache} from '../dist/render/frame.js';
import {WebGPURenderer} from '../dist/render/webgpu.js';
import {Scene} from '../dist/scene/scene.js';
import {compose} from '../dist/math.js';

const model=x=>compose([x,0,0],[0,0,0],[1,1,1]);
test('history observes the immediately preceding render and expires hidden poses without rebuilding records',()=>{
 const history=new RenderModelHistory(),source={},first=model(0),moved=model(3);
 history.beginFrame();assert.equal(history.get('actor',source),undefined);history.set('actor',first,source);
 history.beginFrame();assert.equal(history.get('actor',source),first);history.set('actor',moved,source);
 history.beginFrame();assert.equal(history.get('actor',source),moved);
 history.beginFrame();assert.equal(history.get('actor',source),undefined,'reentry cannot produce velocity from a skipped observation');
 history.set('actor',first,source);history.beginFrame();assert.equal(history.get('actor',source),first);
 assert.equal(history.inspect().allocations,1);assert.equal(history.size,1);assert.equal(first[12],0);assert.equal(moved[12],3);
});

test('static observations retain one record per live source across many camera frames',()=>{
 const history=new RenderModelHistory(),sources=new Map(Array.from({length:128},(_,n)=>['object'+n,{}])),models=new Map([...sources.keys()].map((id,n)=>[id,model(n)]));
 for(let frame=0;frame<96;frame++){
  history.beginFrame();for(const [id,source] of sources){assert.equal(history.get(id,source),frame?models.get(id):undefined);history.set(id,models.get(id),source);}
 }
 assert.deepEqual(history.inspect(),{entries:128,frame:96,allocations:128,commits:128*96,modelChanges:0});
 const replacement={};history.beginFrame();assert.equal(history.get('object0',replacement),undefined,'same ID does not establish source continuity');
 sources.set('object0',replacement);sources.delete('object1');history.retain(sources);assert.equal(history.size,126);
 history.set('object0',model(12),replacement);history.beginFrame();assert.equal(history.get('object0',replacement)[12],12);
 history.clear();assert.equal(history.size,0);history.beginFrame();assert.equal(history.get('object0',replacement),undefined);
});

test('render history uses immutable Render IR matrices and observes published/direct motion without changing physical state',()=>{
 const scene=new Scene({version:1,entities:[{id:'actor',mesh:{kind:'box',size:[2,3,4]}}]}),cache=new RenderFrameCache(),history=new RenderModelHistory(),entity=scene.entities.get('actor');
 const first=cache.build(scene,scene.camera).objectsById.get('actor').model;
 history.beginFrame();history.set(entity.id,first,entity);scene.setVisualTransform('actor',[4,2,1]);
 const snapshot=JSON.stringify(scene.snapshot()),next=cache.build(scene,scene.camera).objectsById.get('actor').model;
 history.beginFrame();assert.equal(history.get(entity.id,entity),first);assert.notEqual(next,first);assert.equal(first[12],0);assert.equal(next[12],4);history.set(entity.id,next,entity);
 assert.equal(JSON.stringify(scene.snapshot()),snapshot);
 entity.position[0]=7;const changed=cache.build(scene,scene.camera).objectsById.get('actor').model;
 history.beginFrame();assert.equal(history.get(entity.id,entity),next);history.set(entity.id,changed,entity);assert.equal(history.inspect().modelChanges,2);
});

test('scene swap and source removal release temporal records while retaining renderer resources',()=>{
 const renderer=Object.create(WebGPURenderer.prototype),history=new RenderModelHistory(),old=new Scene({version:1,entities:[{id:'subject',mesh:{kind:'box'}}]});
 Object.assign(renderer,{previousModels:history,objects:new Map(),meshes:new Map(),modelCache:new Map(),surfaceTextures:{retain(){}},frameCache:new RenderFrameCache(),visibilityPlan:{clear(){}}});
 renderer.collect(old);history.beginFrame();history.set('subject',model(9),old.entities.get('subject'));
 const next=new Scene({version:1,entities:[{id:'subject',mesh:{kind:'sphere'}}]});renderer.collect(next);assert.equal(history.size,0);history.beginFrame();assert.equal(history.get('subject',next.entities.get('subject')),undefined);
 history.set('subject',model(0),next.entities.get('subject'));next.remove('subject');renderer.collect(next);assert.equal(history.size,0);
 history.set('temporary',model(1),{});renderer.resetTemporalHistory();assert.equal(history.size,0);assert.equal(renderer.previousVp,null);
});
