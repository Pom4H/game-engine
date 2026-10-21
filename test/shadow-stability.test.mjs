import test from 'node:test';
import assert from 'node:assert/strict';
import {sunShadowProjection} from '../dist/render/shadow-projection.js';
import {V3,lookAt,compose,multiply4} from '../dist/math.js';
import {Scene} from '../dist/scene/scene.js';
import {RenderFrameCache} from '../dist/render/frame.js';
import {RenderVisibilityPlan} from '../dist/render/visibility-plan.js';
import {intersectsClip,meshBounds} from '../dist/render/visibility.js';
import {primitiveMesh} from '../dist/procedural/mesh.js';
import {MAX_SURFACE_DISPLACEMENT_M} from '../dist/environment/deformable-surface.js';
import {WebGPURenderer} from '../dist/render/webgpu.js';

const identity=compose([0,0,0],[0,0,0],[1,1,1]);
const ids=entities=>entities.map(entity=>entity.id).sort();

test('sub-texel camera movement leaves the complete sun projection and static shadow plan resident',()=>{
  const sun=V3.normalize([-.55,.48,-.35]),extent=65,size=1024,texel=2*extent/size;
  const first=sunShadowProjection([0,0,0],sun,extent,size),scene=new Scene({version:1,entities:[{id:'wall',mesh:{kind:'box'}}]}),plan=new RenderVisibilityPlan();
  const entity=scene.entities.get('wall'),bounds=meshBounds(primitiveMesh(entity.mesh).vertices);
  plan.prepare(scene,[entity],scene.renderMoverIds(),new Set(),()=>identity);
  const project=light=>plan.project({camera:identity,reflection:null,light},[0,0,-2],()=>bounds);
  const original=project(first);
  for(let frame=1;frame<=120;frame++){
    const displacement=texel*.2*frame/120;
    const next=sunShadowProjection([displacement,displacement*.3,-displacement*.4],sun,extent,size);
    assert.deepEqual(next,first,'small motion must not perturb rotation, XY sampling or depth');
    const result=project(next);assert.equal(result.shadowRevision,original.shadowRevision);assert.equal(result.staticShadowDrawables,original.staticShadowDrawables);
  }
  assert.equal(plan.inspect().passes.staticShadow.staticBuilds,1);
});

test('sun projection advances by whole texels in both shadow maps and keeps its basis at large coordinates',()=>{
  const sun=V3.normalize([-.55,.48,-.35]),extent=65,coarseSize=1024,texel=2*extent/coarseSize;
  const origin=sunShadowProjection([0,0,0],sun,extent,coarseSize),view=lookAt(sun,[0,0,0]);
  for(const row of [0,1]){
    const direction=[view[row],view[4+row],view[8+row]];
    const shifted=sunShadowProjection(V3.scale(direction,texel*1.1),sun,extent,coarseSize);
    for(const size of [1024,2048]){
      const pixelShift=(shifted[12+row]-origin[12+row])*.5*size;
      assert.equal(pixelShift,-size/coarseSize);
    }
  }
  const distant=sunShadowProjection([100000.123,4,-100000.456],sun,extent,coarseSize);
  assert.deepEqual(distant.slice(0,12),origin.slice(0,12));
  for(const direction of [[0,1,0],[0,-1,0]])assert.ok([...sunShadowProjection([0,4,0],direction,extent,coarseSize)].every(Number.isFinite));
});

function surfaceFixture(position=[0,0,.5]){
  const scene=new Scene({version:1,gravity:[0,0,0],entities:[
    {id:'surface',mesh:{kind:'box',size:[1,.1,1]},position,environmental:{surfaceUse:'generic',fieldCellSizeM:.1}},
    {id:'wall',mesh:{kind:'box',size:[.2,.2,.2]},position:[0,0,.5]},
  ]}),cache=new RenderFrameCache(),plan=new RenderVisibilityPlan();
  const project=()=>{
    const frame=cache.build(scene,scene.camera);
    plan.prepare(scene,frame.objects.map(object=>object.entity),scene.renderMoverIds(),new Set(),entity=>frame.objectsById.get(entity.id).model,cache.changedObjects());
    return plan.project({camera:identity,reflection:identity,light:identity},[0,0,-2],primitive=>meshBounds(primitiveMesh(primitive).vertices));
  };
  return{scene,plan,project,field:scene.surfaces.field('surface')};
}

test('the first physical surface stamp retires its stale static shadow; subsequent stamps keep other statics resident',()=>{
  const f=surfaceFixture(),first=f.project();
  assert.deepEqual(ids(first.staticShadowDrawables),['surface','wall']);assert.deepEqual(first.dynamicShadowDrawables,[]);
  assert.equal(f.field.deformation.stamp({x:0,z:.5,radiusM:.2,depthM:.06}),true);
  const stamped=f.project();assert.deepEqual(ids(stamped.staticShadowDrawables),['wall']);assert.deepEqual(ids(stamped.dynamicShadowDrawables),['surface']);assert.ok(stamped.shadowRevision>first.shadowRevision);
  f.field.deformation.stamp({x:.1,z:.5,radiusM:.2,depthM:.08});f.field.deformation.relax(1,.5);
  const changed=f.project();assert.equal(changed.shadowRevision,stamped.shadowRevision);assert.equal(changed.staticShadowDrawables,stamped.staticShadowDrawables);assert.deepEqual(ids(changed.dynamicShadowDrawables),['surface']);
  assert.equal(f.plan.inspect().passes.staticShadow.lastTests,0);
});

test('shader-displaced surfaces remain visible at camera, reflection and light frustum edges',()=>{
  const f=surfaceFixture([0,1.15,.5]),first=f.project();
  assert.ok(!ids(first.cameraOpaque).includes('surface'));assert.ok(!ids(first.staticShadowDrawables).includes('surface'));
  f.field.deformation.stamp({x:0,z:.5,radiusM:.2,depthM:.12});
  const displaced=f.project();
  for(const pass of ['cameraOpaque','reflectedObjects','dynamicShadowDrawables'])assert.ok(ids(displaced[pass]).includes('surface'),pass+' must conservatively include the displaced geometry');
});

test('world-Y displacement culling contains every translated corner with rotated, scaled and flattened models',()=>{
  const bounds={center:[0,0,0],half:[.5,.5,.5]},projection=multiply4(identity,lookAt([2,3,4],[0,0,0]));
  for(const scale of [[.2,4,.3],[2,.2,3],[1,0,1]])for(let i=0;i<60;i++){
    const model=compose([Math.sin(i)*3,Math.cos(i)*3,Math.sin(i*.3)*3],[i*.11,i*.03,i*.07],scale),matrix=multiply4(projection,model),corners=[];
    for(const x of [-.5,.5])for(const y of [-.5,.5])for(const z of [-.5,.5])for(const delta of [-MAX_SURFACE_DISPLACEMENT_M,MAX_SURFACE_DISPLACEMENT_M]){
      const p=[0,1,2,3].map(row=>matrix[row]*x+matrix[4+row]*y+matrix[8+row]*z+matrix[12+row]+projection[4+row]*delta);
      corners.push([p[3]+p[0],p[3]-p[0],p[3]+p[1],p[3]-p[1],p[2],p[3]-p[2]]);
    }
    const oracle=[0,1,2,3,4,5].every(plane=>corners.some(corner=>corner[plane]>=-1e-5));
    assert.equal(intersectsClip(bounds,matrix,{projection,worldY:MAX_SURFACE_DISPLACEMENT_M}),oracle);
  }
});

test('relief depth, height image and texture scale edits refresh static shadow depth without rebuilding camera visibility',()=>{
  const scene=new Scene({version:1,entities:[{id:'wall',mesh:{kind:'box'},material:{texture:{url:'/albedo.png',heightUrl:'/height.png',heightScaleM:.04,sizeM:1}}}]}),cache=new RenderFrameCache(),plan=new RenderVisibilityPlan(),entity=scene.entities.get('wall');
  const project=()=>{
    const frame=cache.build(scene,scene.camera);
    plan.prepare(scene,[entity],scene.renderMoverIds(),new Set(),()=>frame.objectsById.get('wall').model,cache.changedObjects());
    return plan.project({camera:identity,reflection:identity,light:identity},[0,0,-2],primitive=>meshBounds(primitiveMesh(primitive).vertices));
  };
  let previous=project();const cameraBuilds=plan.inspect().passes.cameraOpaque.staticBuilds,structure=scene.renderStructureRevision;
  for(const edit of [{heightScaleM:.08},{heightUrl:'/next-height.png'},{sizeM:2}]){
    entity.material={...entity.material,texture:{...entity.material.texture,...edit}};
    const next=project();assert.ok(next.shadowRevision>previous.shadowRevision);assert.equal(plan.inspect().passes.cameraOpaque.staticBuilds,cameraBuilds);assert.equal(scene.renderStructureRevision,structure);previous=next;
  }
  assert.equal(project().shadowRevision,previous.shadowRevision);
});

test('successful height texture publication invalidates cached shadow, temporal and local-probe projections',async()=>{
  const scene=new Scene({version:1,entities:[{id:'wall',mesh:{kind:'box'},material:{texture:{url:'/albedo.png',heightUrl:'/height.png',heightScaleM:.04}}}]}),renderer=Object.create(WebGPURenderer.prototype),loaded=new Map([['/albedo.png',{}]]);
  let finish,probeResets=0;
  Object.assign(renderer,{lastScene:scene,disposed:false,shadowValid:true,historyValid:true,errors:[],failedMaterials:new Set(),materialLoads:new Map(),probeCapture:{reset(){probeResets++;}},surfaceTextures:{get:url=>loaded.get(url),load:url=>loaded.has(url)?Promise.resolve():new Promise(resolve=>{finish=()=>{loaded.set(url,{});resolve();};})}});
  renderer.queueMaterialLoads(scene);assert.equal(renderer.shadowValid,true,'an unfinished upload cannot change the current geometry');
  finish();await Promise.all([...renderer.materialLoads.values()]);
  assert.equal(renderer.shadowValid,false);assert.equal(renderer.historyValid,false);assert.equal(probeResets,1);
  renderer.shadowValid=true;renderer.historyValid=true;
  await renderer.prepareMaterials(scene);assert.equal(renderer.shadowValid,true,'already resident images cannot invalidate every preload call');
  assert.equal(renderer.historyValid,true);assert.equal(probeResets,1);
  loaded.delete('/height.png');
  const prepared=renderer.prepareMaterials(scene);finish();await prepared;
  assert.equal(renderer.shadowValid,false);assert.equal(renderer.historyValid,false);assert.equal(probeResets,2);
});
