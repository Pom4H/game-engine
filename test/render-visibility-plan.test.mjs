import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene} from '../dist/scene/scene.js';
import {RenderFrameCache} from '../dist/render/frame.js';
import {RenderVisibilityPlan} from '../dist/render/visibility-plan.js';
import {freezePrimitive,primitiveMesh} from '../dist/procedural/mesh.js';
import {meshBounds} from '../dist/render/visibility.js';
import {lookAt,multiply4,perspective} from '../dist/math.js';

const ids=items=>items.map(entity=>entity.id);
const box=freezePrimitive({kind:'box'});
const snapshot=scene=>JSON.stringify(scene.snapshot());
const orthographic=(extent,near,far)=>new Float32Array([1/extent,0,0,0,0,1/extent,0,0,0,0,1/(near-far),0,0,0,near/(near-far),1]);
function views(position=[6,5,10],target=[0,1,0]){
 const projection=perspective(65*Math.PI/180,16/9,.05,10000);
 return{camera:multiply4(projection,lookAt(position,target)),reflection:multiply4(projection,lookAt([position[0],.03-position[1],position[2]],[target[0],.03-target[1],target[2]],[0,-1,0])),light:multiply4(orthographic(40,1,400),lookAt([20,30,20],[0,0,0]))};
}
function fixture(entities){
 const scene=new Scene({version:1,gravity:[0,0,0],entities}),frameCache=new RenderFrameCache(),plan=new RenderVisibilityPlan(),bounds=new WeakMap();
 const boundsFor=primitive=>{let value=bounds.get(primitive);if(!value){value=meshBounds(primitiveMesh(primitive).vertices);bounds.set(primitive,value);}return value;};
 function project(view=views(),position=[6,5,10],batches=new Set(),observeChanges=true){
  const frame=frameCache.build(scene,{...scene.camera,position}),before=snapshot(scene);
  let modelLookups=0;
  plan.prepare(scene,frame.objects.map(object=>object.entity),scene.renderMoverIds(),batches,entity=>{modelLookups++;return frame.objectsById.get(entity.id).model;},observeChanges?frameCache.changedObjects():undefined);
  const result=plan.project(view,position,boundsFor);
  assert.equal(snapshot(scene),before,'presentation cannot mutate the physical replay');
  return{result,frame,view,position,batches,modelLookups};
 }
 return{scene,plan,project,boundsFor,frameCache};
}
test('coating overlays receive light and reflections without casting the supporting triangle as a separate shadow',()=>{
 const {project}=fixture([{id:'support',mesh:{kind:'box'},position:[0,1,0],renderOnly:true},{id:'scar',mesh:{kind:'box'},position:[0,1,0],material:{decal:{kind:'coating-loss',severity:.6,seed:41}},renderOnly:true}]);
 const {result}=project();assert.ok(result.cameraOpaque.some(e=>e.id==='scar'));assert.ok(result.reflectedObjects.some(e=>e.id==='scar'));
 const casters=[...result.staticShadowDrawables,...result.dynamicShadowDrawables];assert.ok(casters.some(e=>e.id==='support'));assert.ok(!casters.some(e=>e.id==='scar'));
});
// Independent corner/plane oracle: reject only when all eight transformed
// corners lie outside a clip plane. No production AABB/plane support formula.
function cornerVisible(object,matrix,boundsFor){
 const bounds=boundsFor(object.primitive),m=multiply4(matrix,object.model),corners=[];
 for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1]){
  const p=[bounds.center[0]+x*bounds.half[0],bounds.center[1]+y*bounds.half[1],bounds.center[2]+z*bounds.half[2],1];
  corners.push([0,1,2,3].map(row=>p.reduce((sum,value,column)=>sum+value*m[column*4+row],0)));
 }
 const planes=p=>[p[3]+p[0],p[3]-p[0],p[3]+p[1],p[3]-p[1],p[2],p[3]-p[2]];
 return[0,1,2,3,4,5].every(plane=>corners.some(p=>planes(p)[plane]>=-1e-5));
}
function assertOracle(f,state){
 const {frame,view,position,batches,result}=state,movers=f.scene.renderMoverIds(),ordered=[...frame.objects.filter(o=>!movers.has(o.entity.id)),...[...movers].map(id=>frame.objectsById.get(id)).filter(Boolean)];
 const distance=e=>e.position.reduce((sum,value,axis)=>sum+(value-position[axis])**2,0),opaque=e=>e.material.color[3]>=.98;
 const camera=ordered.filter(o=>!batches.has(o.entity.id)&&cornerVisible(o,view.camera,f.boundsFor)).map(o=>o.entity);
 assert.deepEqual(ids(result.cameraOpaque),ids(camera.filter(opaque).sort((a,b)=>distance(a)-distance(b))));
 assert.deepEqual(ids(result.cameraTransparent),ids(camera.filter(e=>!opaque(e)).sort((a,b)=>distance(b)-distance(a))));
 const reflected=ordered.filter(o=>!batches.has(o.entity.id)&&opaque(o.entity)&&!['snow','asphalt'].includes(o.entity.material.kind)&&cornerVisible(o,view.reflection,f.boundsFor));
 assert.deepEqual(ids(result.reflectedObjects),reflected.map(o=>o.entity.id));
 const shadow=ordered.filter(o=>opaque(o.entity)&&!(o.entity.material.emissive&&Math.max(...o.entity.material.emissive)>1)&&cornerVisible(o,view.light,f.boundsFor));
 const isStatic=e=>!movers.has(e.id)&&(!e.body||(!e.body.kinematic&&e.body.invMass===0));
 assert.deepEqual(ids(result.staticShadowDrawables),shadow.filter(o=>isStatic(o.entity)).map(o=>o.entity.id));
 assert.deepEqual(ids(result.dynamicShadowDrawables),shadow.filter(o=>!isStatic(o.entity)).map(o=>o.entity.id));
}
function grid(count=192){return Array.from({length:count},(_,i)=>({id:'cube-'+i,mesh:box,position:[(i%16-8)*2,.5+(i%4), (Math.floor(i/16)-6)*2],rotation:[.07*(i%3),.11*(i%7),0],scale:[1,.5+(i%5)*.3,1],material:{kind:'steel'}}));}

test('certified visibility consumes pose changes while standalone callers retain full model observation',()=>{
 const f=fixture(grid(32));assert.equal(f.project().modelLookups,32);assert.equal(f.project().modelLookups,0);
 f.scene.entities.get('cube-3').position[0]=200;const changed=f.project();assert.equal(changed.modelLookups,0);assertOracle(f,changed);
 const fallback=f.project(views(),[6,5,10],new Set(),false);assert.equal(fallback.modelLookups,32);assertOracle(f,fallback);
});

test('moving cameras retain the static light plan and skip GPU-owned camera candidates',()=>{
 const cubes=grid(),f=fixture([...cubes,{id:'actor',mesh:box,position:[0,1,0],body:{mass:1}},{id:'road',mesh:box,position:[0,-1,0],material:{kind:'asphalt'}},{id:'glass',mesh:box,position:[1,2,1],material:{color:[.4,.7,.9,.3]}}]);
 const batches=new Set(cubes.map(e=>e.id)),first=f.project(views(),[6,5,10],batches);assertOracle(f,first);
 const lightTests=f.plan.inspect().passes.staticShadow.tests,shadow=first.result.staticShadowDrawables;
 for(let n=1;n<=12;n++){
  const position=[Math.sin(n*.3)*15,5,Math.cos(n*.3)*15],state=f.project(views(position),position,batches);assertOracle(f,state);
  assert.equal(state.result.staticShadowDrawables,shadow);assert.equal(state.result.shadowRevision,first.result.shadowRevision);
  assert.equal(f.plan.inspect().passes.staticShadow.lastTests,0);
 }
 const inspect=f.plan.inspect();assert.equal(inspect.passes.staticShadow.tests,lightTests);assert.equal(inspect.passes.staticShadow.staticBuilds,1);
 assert.equal(inspect.passes.cameraOpaque.staticCandidates,1);assert.equal(inspect.passes.reflection.staticCandidates,0);
 assert.equal(inspect.sourceBuilds,1);assert.equal(inspect.entries,195);
});

test('light and reflection changes invalidate only their own projections, including reused matrix memory',()=>{
 const f=fixture(grid(32)),view=views(),first=f.project(view),before=f.plan.inspect();
 view.reflection.set(views([-8,2,-12]).reflection);const mirrored=f.project(view);assertOracle(f,mirrored);
 const middle=f.plan.inspect();assert.equal(middle.passes.cameraOpaque.staticBuilds,before.passes.cameraOpaque.staticBuilds);assert.equal(middle.passes.staticShadow.staticBuilds,1);
 assert.equal(mirrored.result.shadowRevision,first.result.shadowRevision);assert.equal(middle.passes.reflection.staticBuilds,2);
 view.light.set(multiply4(orthographic(9,1,400),lookAt([-20,30,20],[0,0,0])));const lit=f.project(view);assertOracle(f,lit);
 assert.ok(lit.result.shadowRevision>first.result.shadowRevision);assert.equal(f.plan.inspect().passes.cameraOpaque.staticBuilds,1);assert.equal(f.plan.inspect().passes.reflection.staticBuilds,2);
});

test('near dynamic shadow culling and its disabled state are independent of the resident city map',()=>{
 const f=fixture([{id:'near',mesh:box,position:[0,0,-2],body:{mass:1}},{id:'far',mesh:box,position:[20,0,-2],body:{mass:1}},{id:'wall',mesh:box,position:[20,0,-2]}]);
 const view=views();view.light=orthographic(40,1,400);view.dynamicLight=orthographic(9,1,400);
 const first=f.project(view).result;
 assert.deepEqual(ids(first.dynamicShadowDrawables),['near']);assert.deepEqual(ids(first.staticShadowDrawables),['wall']);
 view.dynamicLight=orthographic(30,1,400);const widened=f.project(view).result;
 assert.deepEqual(ids(widened.dynamicShadowDrawables),['near','far']);assert.equal(widened.shadowRevision,first.shadowRevision);
 assert.equal(widened.staticShadowDrawables,first.staticShadowDrawables);assert.equal(f.plan.inspect().passes.staticShadow.lastTests,0);
 view.dynamicLight=null;const disabled=f.project(view).result;assert.deepEqual(disabled.dynamicShadowDrawables,[]);assert.equal(disabled.staticShadowDrawables,first.staticShadowDrawables);
});

test('moving bodies leave static projections resident; direct static pose edits and visual mover publication stay current',()=>{
 const f=fixture([...grid(32),{id:'actor',mesh:box,position:[0,1,0],body:{mass:1}}]),first=f.project();
 f.scene.entities.get('actor').position[0]=200;const moving=f.project();assertOracle(f,moving);
 assert.equal(moving.result.shadowRevision,first.result.shadowRevision);assert.equal(f.plan.inspect().passes.cameraOpaque.staticBuilds,1);
 const wall=f.scene.entities.get('cube-0');wall.position.splice(0,3,0,1,0);const edited=f.project();assertOracle(f,edited);
 assert.ok(edited.result.shadowRevision>first.result.shadowRevision);
 const structure=f.scene.renderStructureRevision;f.scene.setVisualTransform('cube-0',[1,2,3]);assert.equal(f.scene.renderStructureRevision,structure);
 const published=f.project();assertOracle(f,published);assert.equal(ids(published.result.staticShadowDrawables).includes('cube-0'),false);
 assert.equal(published.result.dynamicShadowDrawables.filter(e=>e.id==='cube-0').length,1);
 const settled=f.project();assert.equal(settled.result.shadowRevision,published.result.shadowRevision);
});

test('numeric shadow eligibility, transparency, reflection kinds and geometry generations are observed without a structural revision',()=>{
 const f=fixture([{id:'object',mesh:box,position:[0,1,0],material:{kind:'steel'}}]),first=f.project(),entity=f.scene.entities.get('object'),revision=f.scene.renderStructureRevision;
 f.scene.patchAppearance({materials:[{id:'object',set:{emissive:[2,0,0]}}]});const emissive=f.project();assertOracle(f,emissive);
 assert.equal(emissive.result.staticShadowDrawables.length,0);assert.ok(emissive.result.shadowRevision>first.result.shadowRevision);assert.equal(f.scene.renderStructureRevision,revision);
 entity.material={...entity.material,emissive:[0,0,0],color:[1,1,1,.4]};const transparent=f.project();assertOracle(f,transparent);
 assert.equal(transparent.result.cameraTransparent.length,1);assert.equal(transparent.result.reflectedObjects.length,0);
 entity.material={...entity.material,color:[1,1,1,1],kind:'snow'};const snow=f.project();assertOracle(f,snow);assert.equal(snow.result.reflectedObjects.length,0);
 entity.material={...entity.material,kind:'steel'};entity.renderMesh=freezePrimitive({kind:'box',size:[3,2,1]});const geometry=f.project();assertOracle(f,geometry);
 assert.ok(geometry.result.shadowRevision>snow.result.shadowRevision);assert.equal(f.plan.inspect().entries,1);
});

test('batch membership affects camera and reflection plans without rebuilding shadow eligibility',()=>{
 const f=fixture(grid(32)),first=f.project(),batches=new Set(grid(32).map(e=>e.id)),batched=f.project(views(),[6,5,10],batches);assertOracle(f,batched);
 assert.equal(batched.result.cameraOpaque.length,0);assert.equal(batched.result.reflectedObjects.length,0);assert.equal(batched.result.staticShadowDrawables,first.result.staticShadowDrawables);
 assert.equal(batched.result.shadowRevision,first.result.shadowRevision);
 const restored=f.project();assertOracle(f,restored);assert.deepEqual(ids(restored.result.cameraOpaque),ids(first.result.cameraOpaque));assert.equal(f.plan.inspect().passes.staticShadow.sourceBuilds,1);
});

test('plans release removed identities, handle scene replacement and stay bounded to current candidates',()=>{
 const f=fixture(grid(8));f.project();
 for(let n=0;n<20;n++){
  const old=f.scene.entities.get('cube-0');f.scene.remove('cube-0');f.scene.add({id:'cube-0',mesh:{kind:'sphere',radius:.4+n*.01},position:[0,1,0]});
  const current=f.project();assertOracle(f,current);assert.ok(!current.result.cameraOpaque.includes(old));assert.equal(f.plan.inspect().entries,8);
 }
 for(const id of [...f.scene.entities.keys()])f.scene.remove(id);f.project();const empty=f.plan.inspect();assert.equal(empty.entries,0);
 assert.ok(Object.values(empty.passes).every(pass=>pass.staticCandidates+pass.movingCandidates===0));
 const next=new Scene({version:1,entities:[{id:'next',mesh:box}]}),frame=f.frameCache.build(next,next.camera);
 f.plan.prepare(next,frame.objects.map(o=>o.entity),next.renderMoverIds(),new Set(),e=>frame.objectsById.get(e.id).model);const result=f.plan.project(views(),[6,5,10],f.boundsFor);
 assert.deepEqual(ids(result.cameraOpaque),['next']);assert.equal(f.plan.inspect().entries,1);
 f.plan.clear();assert.equal(f.plan.inspect().entries,0);assert.ok(Object.values(f.plan.inspect().passes).every(pass=>pass.staticCandidates+pass.movingCandidates===0));
});
