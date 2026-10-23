import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene} from '../dist/scene/scene.js';
import {buildRenderFrame,RenderFrameCache} from '../dist/render/frame.js';
import {RenderVisibilityPlan} from '../dist/render/visibility-plan.js';
import {CpuRenderer} from '../dist/render/cpu.js';
import {primitiveMesh} from '../dist/procedural/mesh.js';
import {meshBounds} from '../dist/render/visibility.js';

const identity=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
const ids=entries=>entries.map(e=>e.id).sort();
function fixture(){
 const scene=new Scene({version:1,gravity:[0,0,0],entities:[
  {id:'static-subject',mesh:{kind:'box'},position:[-.35,0,.5],scale:[.2,.2,.2],renderOnly:true},
  {id:'moving-subject',mesh:{kind:'box'},position:[.35,0,.5],scale:[.2,.2,.2],renderOnly:true},
  {id:'other',mesh:{kind:'box'},position:[0,.35,.5],scale:[.2,.2,.2],renderOnly:true},
  {id:'glass',mesh:{kind:'box'},position:[0,-.35,.5],scale:[.2,.2,.2],material:{color:[.3,.6,.8,.3]},renderOnly:true},
 ]});
 scene.setVisualTransform('moving-subject',[.35,0,.5],[0,0,0]);
 const cache=new RenderFrameCache(),plan=new RenderVisibilityPlan(),bounds=new WeakMap();
 function project(){
  const frame=cache.build(scene,scene.camera);
  plan.prepare(scene,frame.objects.map(o=>o.entity),scene.renderMoverIds(),new Set(),e=>frame.objectsById.get(e.id).model,cache.changedObjects());
  return plan.project({camera:identity,reflection:identity,light:identity},[0,0,-2],primitive=>{let b=bounds.get(primitive);if(!b){b=meshBounds(primitiveMesh(primitive).vertices);bounds.set(primitive,b);}return b;});
 }
 return{scene,plan,cache,project};
}
test('primary-camera masks preserve the same source objects, reflected geometry and static/dynamic shadows',()=>{
 const f=fixture(),first=f.project(),physical=JSON.stringify(f.scene.snapshot()),topology=[...f.scene.entities],staticRevision=first.shadowRevision;
 f.scene.setRenderCameraVisible('static-subject',false);f.scene.setRenderCameraVisible('moving-subject',false);f.scene.setRenderCameraVisible('glass',false);
 const masked=f.project();assert.deepEqual(ids(masked.cameraOpaque),['other']);assert.deepEqual(masked.cameraTransparent,[]);
 assert.deepEqual(ids(masked.reflectedObjects),ids(first.reflectedObjects));
 assert.deepEqual(ids(masked.staticShadowDrawables),ids(first.staticShadowDrawables));
 assert.deepEqual(ids(masked.dynamicShadowDrawables),['moving-subject']);
 assert.equal(masked.shadowRevision,staticRevision);assert.equal(masked.staticShadowDrawables,first.staticShadowDrawables);
 assert.deepEqual([...f.scene.entities],topology);assert.equal(JSON.stringify(f.scene.snapshot()),physical);
 assert.equal(buildRenderFrame(f.scene).objects.length,4);assert.equal(f.scene.physics.bodies.size,0);assert.equal(f.scene.tick,0);
 for(const id of ['static-subject','moving-subject','glass'])f.scene.setRenderCameraVisible(id,true);
 const restored=f.project();assert.deepEqual(ids(restored.cameraOpaque),ids(first.cameraOpaque));assert.deepEqual(ids(restored.cameraTransparent),['glass']);
});
test('global hiding still removes every contribution and is independent of camera-mask changes',()=>{
 const f=fixture();f.project();f.scene.setRenderVisible('moving-subject',false);f.scene.setRenderCameraVisible('moving-subject',false);f.scene.setRenderCameraVisible('moving-subject',true);
 const hidden=f.project();for(const entries of [hidden.cameraOpaque,hidden.reflectedObjects,hidden.dynamicShadowDrawables])assert.ok(!ids(entries).includes('moving-subject'));
 f.scene.setRenderVisible('moving-subject',true);assert.ok(ids(f.project().dynamicShadowDrawables).includes('moving-subject'));
});
test('masking accepts only boolean visual state and cannot touch a physical body or velocity',()=>{
 assert.throws(()=>new Scene({version:1,entities:[{id:'invalid',renderCameraVisible:1}]}),/renderCameraVisible/);
 const scene=new Scene({version:1,entities:[{id:'body',mesh:{kind:'box'},body:{mass:1,velocity:[1,2,3]},renderCameraVisible:false}]});
 const entity=scene.entities.get('body'),body=entity.body,snapshot=JSON.stringify(scene.snapshot());
 assert.equal(entity.renderCameraVisible,false);assert.throws(()=>scene.setRenderCameraVisible('body',null),/boolean/);assert.throws(()=>scene.setRenderCameraVisible('unknown',false),/Unknown/);
 scene.setRenderCameraVisible('body',true);const revision=scene.renderStructureRevision;scene.setRenderCameraVisible('body',true);assert.equal(scene.renderStructureRevision,revision);
 assert.equal(entity.body,body);assert.equal(JSON.stringify(scene.snapshot()),snapshot);
});
test('the CPU fallback observes the same primary-camera mask',()=>{
 const scene=new Scene({version:1,entities:[{id:'subject',mesh:{kind:'box'},renderOnly:true}],camera:{position:[0,0,-3],target:[0,0,0]}}),renderer=new CpuRenderer({width:32,height:32});
 renderer.render(scene);assert.equal(renderer.inspect().drawCalls,1);
 scene.setRenderCameraVisible('subject',false);renderer.render(scene);assert.equal(renderer.inspect().drawCalls,0);
 assert.equal(buildRenderFrame(scene).objects.length,1);scene.setRenderCameraVisible('subject',true);renderer.render(scene);assert.equal(renderer.inspect().drawCalls,1);
});
