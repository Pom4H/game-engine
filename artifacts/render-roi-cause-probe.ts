// Read-only, CPU-only cause audit. Imports the production source; no renderer,
// service, physical step, GPU adapter, or persisted world is created.
import assert from 'node:assert/strict';
import {Scene} from '../src/scene/scene.js';
import {RenderFrameCache} from '../src/render/frame.js';
import {RenderVisibilityPlan} from '../src/render/visibility-plan.js';
import {RenderVisibilityPlan as FrozenPlan} from '../test/fixtures/render-visibility-plan-before-identity.mjs';
import {RenderRadianceProjection,distantRadianceKey,buildSceneRadianceProbe} from '../src/render/radiance.js';
import {freezePrimitive,primitiveMesh} from '../src/procedural/mesh.js';
import {meshBounds} from '../src/render/visibility.js';
import {lookAt,multiply4,perspective} from '../src/math.js';

const box=freezePrimitive({kind:'box'});
const scene=new Scene({version:1,entities:[
 {id:'visual-grass',renderOnly:true,mesh:box,position:[0,0,0],material:{groundCover:'grass-blade'}},
 ...Array.from({length:128},(_,n)=>({id:'wall-'+n,renderOnly:true,mesh:box,position:[(n%16)-8,1,Math.floor(n/16)-4] as [number,number,number]})),
]});
scene.setVisualTransform('visual-grass',[0,0,0]);
const frames=new RenderFrameCache(),visibility=new RenderVisibilityPlan(),frozen=new FrozenPlan(),radiance=new RenderRadianceProjection();
const projection=perspective(Math.PI/3,16/9,.05,10000),matrix=multiply4(projection,lookAt([6,5,10],[0,1,0]));
const bounds=meshBounds(primitiveMesh(box).vertices);
function observe(){
 const frame=frames.build(scene,scene.camera,undefined,radiance);
 for(const plan of [visibility,frozen])plan.prepare(scene,frame.objects.map(o=>o.entity),scene.renderMoverIds(),new Set(),e=>frame.objectsById.get(e.id)!.model,frames.changedObjects());
 const result=visibility.project({camera:matrix,reflection:matrix,light:matrix},[6,5,10],()=>bounds);
 const old=frozen.project({camera:matrix,reflection:matrix,light:matrix},[6,5,10],()=>bounds);
 for(const pass of ['cameraOpaque','cameraTransparent','reflectedObjects','staticShadowDrawables','dynamicShadowDrawables'] as const)assert.deepEqual(result[pass],old[pass]);
 return {key:radiance.value(scene),casters:result.staticShadowDrawables.map(e=>e.id),visibility:visibility.inspect(),frozen:frozen.inspect(),radiance:radiance.inspect(),shadowRevision:result.shadowRevision};
}
const before=observe(),probeBefore=buildSceneRadianceProbe(scene,[0,3,-6],128,true);
scene.remove('visual-grass');
const after=observe(),probeAfter=buildSceneRadianceProbe(scene,[0,3,-6],128,true);
assert.deepEqual(after.casters,before.casters);
assert.equal(after.key,before.key);
assert.deepEqual(probeAfter,probeBefore);
assert.equal(distantRadianceKey(scene),after.key);
assert.equal(after.visibility.passes.staticShadow.staticBuilds,before.visibility.passes.staticShadow.staticBuilds);
assert.equal(after.frozen.passes.staticShadow.staticBuilds,before.frozen.passes.staticShadow.staticBuilds+1);
console.log(JSON.stringify({
 contract:'Remove only a posed, non-shadow-casting visual before 128 unchanged static walls; camera and light matrices do not change.',
 result:{staticRadianceKeyUnchanged:true,staticRadianceProbeBitExact:true,staticCasterOrderUnchanged:true,
  before:before.visibility.passes.staticShadow,after:after.visibility.passes.staticShadow,
  unrelatedStaticTests:after.visibility.passes.staticShadow.tests-before.visibility.passes.staticShadow.tests,
  shadowRevisionBefore:before.shadowRevision,shadowRevisionAfter:after.shadowRevision,
  frozenBefore:before.frozen.passes.staticShadow,frozenAfter:after.frozen.passes.staticShadow,
  frozenUnrelatedStaticTests:after.frozen.passes.staticShadow.tests-before.frozen.passes.staticShadow.tests},
},null,2));
