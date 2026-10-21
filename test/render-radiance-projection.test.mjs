import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene} from '../dist/scene/scene.js';
import {freezePrimitive} from '../dist/procedural/mesh.js';
import {RenderFrameCache,buildRenderFrame,buildProxyRenderFrame,buildDormantRenderFrame} from '../dist/render/frame.js';
import {RenderRadianceProjection,distantRadianceKey,distantRadianceCacheStats} from '../dist/render/radiance.js';

const makeScene=()=>new Scene({version:1,entities:[
 {id:'wall',position:[4,2,-3],mesh:{kind:'box',size:[2,3,1]},material:{color:[.2,.3,.4,1]}},
 {id:'actor',mesh:{kind:'sphere'},body:{mass:1}},
 {id:'glass',mesh:{kind:'box'},material:{color:[.4,.5,.6,.5]}},
 {id:'light',light:{kind:'point',intensity:5,color:[1,1,1],range:10}},
]});
function project(scene,frames,radiance,builder=buildRenderFrame){frames.build(scene,scene.camera,builder,radiance);return radiance.value(scene);}
function authoritative(scene,key){assert.equal(key,distantRadianceKey(scene),'fused causes must equal an independent authoritative Scene scan');}

test('stationary radiance reuses observed poses without changing physical state or pure Render IR snapshots',()=>{
 const scene=makeScene(),frames=new RenderFrameCache(),radiance=new RenderRadianceProjection(),physical=JSON.stringify(scene.snapshot()),snapshot=buildRenderFrame(scene);
 const key=project(scene,frames,radiance);
 for(let n=0;n<8;n++){scene.camera.position[0]+=1;assert.equal(project(scene,frames,radiance),key);}
 assert.deepEqual(radiance.inspect(),{fusedFrames:9,observations:9,reusedPoses:8,checkedPoses:1,fallbackFrames:0});
 assert.deepEqual(distantRadianceCacheStats(scene),{entries:1,rebuilds:1});
 assert.equal(JSON.stringify(scene.snapshot()),physical);assert.deepEqual(snapshot.objects.map(o=>[...o.model]),buildRenderFrame(scene).objects.map(o=>[...o.model]));
 authoritative(scene,key);
});

test('all direct full-precision pose and numeric material causes update fused radiance',()=>{
 const scene=makeScene(),frames=new RenderFrameCache(),radiance=new RenderRadianceProjection(),wall=scene.entities.get('wall');
 let key=project(scene,frames,radiance);const initial=buildRenderFrame(scene).objectsById.get('wall').model;
 wall.position[0]+=1e-10;const next=project(scene,frames,radiance);
 assert.deepEqual(frames.build(scene,scene.camera).objectsById.get('wall').model,initial,'this raw change deliberately rounds to the same Float32 matrix');
 assert.notEqual(next,key,'radiance cannot use rounded GPU matrices as its authority');authoritative(scene,next);key=next;
 const mutations=[];
 for(const field of ['position','rotation','scale'])for(let i=0;i<3;i++)mutations.push(()=>wall[field][i]+=.125);
 for(let i=0;i<3;i++)mutations.push(()=>wall.material.color[i]+=.05);
 mutations.push(()=>wall.material.color[3]=.99,
  ()=>wall.material={...wall.material,metalness:.73},
  ()=>wall.material={...wall.material,roughness:.63},
  ()=>wall.material={...wall.material,surface:{...wall.material.surface,wetness:.7}},
  ()=>wall.material={...wall.material,emissive:[0,0,0]},
  ()=>wall.material.emissive[1]=.02,
  ()=>{const {emissive,...material}=wall.material;wall.material=material;},
  ()=>{const {metalness,roughness,...material}=wall.material;wall.material=material;});
 for(const mutate of mutations){mutate();const current=project(scene,frames,radiance);assert.notEqual(current,key);authoritative(scene,current);assert.equal(project(scene,frames,radiance),current);key=current;}
});

test('frozen materials preserve mutable colors, nested optics and immutable replacement causes',()=>{
 const scene=makeScene(),frames=new RenderFrameCache(),radiance=new RenderRadianceProjection(),wall=scene.entities.get('wall');
 wall.material=Object.freeze({...wall.material,emissive:Object.freeze([.1,0,0])});let key=project(scene,frames,radiance);
 const changed=mutate=>{mutate();const next=project(scene,frames,radiance);assert.notEqual(next,key);assert.equal(project(scene,frames,radiance),next);key=next;};
 changed(()=>wall.material.color[0]+=.1);
 changed(()=>wall.material=Object.freeze({...wall.material,surface:Object.freeze({...wall.material.surface,wetness:.65})}));
 changed(()=>wall.material=Object.freeze({...wall.material,surface:{...wall.material.surface,wetness:.25},emissive:[.2,0,0]}));
 changed(()=>wall.material.surface.wetness=.8);
 changed(()=>wall.material.emissive[1]=.3);
 changed(()=>wall.material=Object.freeze({...wall.material,profile:Object.freeze({...wall.material.profile,optical:{...wall.material.profile.optical,metalness:.15}}),metalness:undefined}));
 changed(()=>wall.material.profile.optical.metalness=.8);
 authoritative(scene,key);
});

test('radiance membership observes mover edits, aborted streams and entity replacement',()=>{
 const scene=new Scene({version:1,entities:[{id:'wall',mesh:{kind:'box'},position:[4,2,-3]}]}),frames=new RenderFrameCache(),radiance=new RenderRadianceProjection();
 let moving=new Set();scene.renderMoverIds=()=>moving;
 const key=project(scene,frames,radiance);
 for(let n=0;n<8;n++)assert.equal(project(scene,frames,radiance),key);
 moving=new Set(['wall']);assert.equal(project(scene,frames,radiance),2166136261);
 moving=new Set();assert.equal(project(scene,frames,radiance),key);
 frames.build(scene,scene.camera,buildRenderFrame,radiance);radiance.abort();assert.equal(project(scene,frames,radiance),key);
 scene.remove('wall');scene.add({id:'wall',mesh:{kind:'box'},position:[4,2,-3]});authoritative(scene,project(scene,frames,radiance));
 moving.add('wall');assert.equal(project(scene,frames,radiance),2166136261,'same-reference Set edits must change static membership');
 moving.delete('wall');assert.notEqual(project(scene,frames,radiance),2166136261);
 const other=new Scene({version:1,entities:[{id:'one',mesh:{kind:'box'},position:[4,2,-3]},{id:'two',mesh:{kind:'box'},position:[8,2,-3]},{id:'light',light:{kind:'point',intensity:1,color:[1,1,1],range:4}}]}),otherFrames=new RenderFrameCache(),otherRadiance=new RenderRadianceProjection(),sameSize=new Set(['light']);
 other.renderMoverIds=()=>sameSize;const otherKey=project(other,otherFrames,otherRadiance);
 sameSize.delete('light');sameSize.add('one');const changed=project(other,otherFrames,otherRadiance);assert.notEqual(changed,otherKey,'same-cardinality content edits must change static membership');authoritative(other,changed);
});

test('frozen accessors still observe radiance values instead of certifying object identity',()=>{
 const scene=makeScene(),frames=new RenderFrameCache(),radiance=new RenderRadianceProjection(),wall=scene.entities.get('wall');let wet=.1,rough=.2,red=.15;
 const emission=[0,0,0];Object.defineProperty(emission,'0',{get:()=>red,enumerable:true,configurable:true});Object.freeze(emission);
 wall.material=Object.freeze({...wall.material,get roughness(){return rough;},emissive:emission,surface:Object.freeze({...wall.material.surface,get wetness(){return wet;}})});
 let key=project(scene,frames,radiance);
 for(const mutate of [()=>wet=.7,()=>rough=.6,()=>red=.4]){mutate();const next=project(scene,frames,radiance);assert.notEqual(next,key);assert.equal(project(scene,frames,radiance),next);key=next;}
 authoritative(scene,key);
});

test('proxy projection observes detailed radiance geometry and membership across generations and scenes',()=>{
 const scene=makeScene(),frames=new RenderFrameCache(),radiance=new RenderRadianceProjection(),wall=scene.entities.get('wall');
 let key=project(scene,frames,radiance,buildProxyRenderFrame);
 wall.renderMesh=freezePrimitive({kind:'sphere',radius:3});let next=project(scene,frames,radiance,buildProxyRenderFrame);assert.notEqual(next,key);authoritative(scene,next);
 assert.equal(frames.build(scene,scene.camera,buildProxyRenderFrame).objectsById.get('wall').primitive,wall.mesh);key=next;
 for(const mutate of [()=>wall.material.color[3]=.5,()=>wall.material.color[3]=1,()=>scene.setVisualTransform('wall',[2,1,3])]){
  mutate();next=project(scene,frames,radiance);assert.notEqual(next,key);authoritative(scene,next);key=next;
 }
 assert.equal(distantRadianceCacheStats(scene).entries,0);
 scene.remove('wall');scene.add({id:'wall',position:[4,2,-3],mesh:{kind:'box'},material:{color:[.2,.3,.4,1]}});
 next=project(scene,frames,radiance);assert.notEqual(next,key);authoritative(scene,next);assert.equal(distantRadianceCacheStats(scene).entries,1);
 scene.remove('wall');assert.equal(project(scene,frames,radiance),2166136261);
 const other=new Scene({version:1,entities:[{id:'new',mesh:{kind:'box'},position:[10,0,0]}]});authoritative(other,project(other,frames,radiance));
 radiance.clear();frames.clear();other.entities.get('new').scale[0]=2;authoritative(other,project(other,frames,radiance));
});

test('custom and dormant projections fall back to Scene even when their frames contain no objects',()=>{
 const scene=makeScene(),frames=new RenderFrameCache(),radiance=new RenderRadianceProjection(),wall=scene.entities.get('wall');
 const custom=(s,c)=>buildDormantRenderFrame(s,c);let key=project(scene,frames,radiance);
 for(const builder of [custom,buildDormantRenderFrame]){wall.position[0]+=2;const next=project(scene,frames,radiance,builder);assert.notEqual(next,key);authoritative(scene,next);key=next;}
 assert.equal(radiance.inspect().fallbackFrames,2);assert.equal(radiance.inspect().fusedFrames,1);
 frames.build(scene,scene.camera,custom,radiance);wall.material.color[0]+=.1;
 const updated=distantRadianceKey(scene);assert.notEqual(updated,key);assert.equal(radiance.value(scene),updated,'a shared Scene scan also supersedes a pending fallback key');
});

test('shared radiance scans and multiple renderers cannot retain a stale pose certificate',()=>{
 const scene=makeScene(),frames=new RenderFrameCache(),otherFrames=new RenderFrameCache(),radiance=new RenderRadianceProjection(),otherRadiance=new RenderRadianceProjection(),wall=scene.entities.get('wall');
 const key=project(scene,frames,radiance);
 wall.position[0]+=1;const external=distantRadianceKey(scene);assert.notEqual(external,key);assert.equal(project(scene,frames,radiance),external);
 assert.equal(project(scene,otherFrames,otherRadiance),external);wall.scale[2]+=1;authoritative(scene,project(scene,frames,radiance));
 frames.build(scene,scene.camera,buildRenderFrame,radiance);wall.rotation[0]+=.3;const changed=distantRadianceKey(scene);assert.equal(radiance.value(scene),changed,'a shared commit supersedes the pending observation');
 frames.build(scene,scene.camera,buildRenderFrame,radiance);assert.equal(radiance.value(scene),changed);wall.rotation[0]+=.2;
 assert.notEqual(radiance.value(scene),changed,'a second read must observe standalone edits');
 const other=makeScene();assert.equal(radiance.value(other),distantRadianceKey(other));
});

test('aborted projection recovers changes already written to cause sensors',()=>{
 const scene=makeScene(),frames=new RenderFrameCache(),radiance=new RenderRadianceProjection(),wall=scene.entities.get('wall');
 const key=project(scene,frames,radiance);wall.rotation[1]+=.4;
 const throwing={begin:(...args)=>radiance.begin(...args),observe:(...args)=>{radiance.observe(...args);throw new Error('interrupted projection');},end:()=>radiance.end(),abort:()=>radiance.abort()};
 assert.throws(()=>frames.build(scene,scene.camera,buildRenderFrame,throwing),/interrupted projection/);
 const recovered=project(scene,frames,radiance);assert.notEqual(recovered,key);authoritative(scene,recovered);
 wall.material.color[2]+=.1;
 assert.throws(()=>frames.build(scene,scene.camera,buildRenderFrame,throwing),/interrupted projection/);
 const scanned=radiance.value(scene);assert.notEqual(scanned,recovered);authoritative(scene,scanned);
 assert.equal(project(scene,frames,radiance),scanned);
});
