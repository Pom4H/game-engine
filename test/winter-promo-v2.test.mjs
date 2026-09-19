import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Scene,SnowSurface,SnowFootprints,batchStaticScenery,primitiveMesh,renderAmbience,renderFootsteps,validateScene} from '../dist/index.js';
import {compose} from '../dist/math.js';
import {pedestrianPose,WALK} from '../tools/promo/actors.mjs';

test('foot contacts create one bounded immutable stamp per planting, never in air or on bare ground',()=>{
 const invalid=new SnowFootprints();assert.throws(()=>invalid.update(10,[{id:'a',position:[0,0,0],grounded:true},{id:'a',position:[0,0,0],grounded:true}],()=>({height:0,snowDepth:.1})));assert.equal(invalid.snapshot().length,0);assert.equal(invalid.update(0,[{id:'a',position:[0,0,0],grounded:true}],()=>({height:0,snowDepth:.1})).length,1);
 const f=new SnowFootprints(2),surface=()=>({height:.183,snowDepth:.052}),foot={id:'left',position:[0,.163,0],grounded:true};
 assert.equal(f.update(0,[foot],surface).length,1);assert.equal(f.update(.1,[foot],surface).length,0);
 f.update(.2,[{...foot,grounded:false}],surface);assert.equal(f.update(.3,[{...foot,position:[1,.4,0]}],surface).length,0);
 assert.equal(f.update(.4,[{...foot,position:[1,.163,0]}],()=>({height:.183,snowDepth:0})).length,0);
 f.update(.5,[{...foot,position:[1,.163,0]}],surface);f.update(.6,[],surface);f.update(.7,[{...foot,position:[2,.163,0]}],surface);
 assert.equal(f.snapshot().length,2);assert.deepEqual(f.snapshot().map(s=>s.sequence),[1,2]);assert.throws(()=>f.snapshot()[0].position[0]=9);assert.throws(()=>f.update(.1,[],surface));
});

test('walk holds each planted foot in world space and deforms only contacted snow',()=>{
 const tracker=new SnowFootprints(),skin=new SnowSurface({id:'test-snow',center:[10,5.25],size:[180,2.6],height:.183,snowDepth:.052}),scene=new Scene({version:1,entities:[]});let previous;
 for(let tick=0;tick<240;tick++){
  const pose=pedestrianPose(tick/60);
  for(const foot of pose.feet){const old=previous?.feet.find(f=>f.id===foot.id);if(old?.grounded&&foot.grounded)assert.deepEqual(foot.position,old.position);}
  const created=tracker.update(tick/60,pose.feet,()=>({height:.183,snowDepth:.052}));for(const stamp of created)skin.stamp(stamp);for(const e of skin.drainMeshes()){scene.remove(e.id);scene.add(e);}previous=pose;
 }
 const prints=tracker.snapshot();assert.ok(prints.length>=6);const p=prints[2];assert.ok(skin.height(p.position[0]+.034,p.position[2],prints)<.166);assert.ok(skin.height(p.position[0]+.034,p.position[2]+.4,prints)>.18);
 const count=scene.entities.size;skin.stamp({...prints[0],position:[200,.163,WALK.z]});assert.equal(scene.entities.size,count);
 const snapshot=JSON.stringify(prints);assert.equal(snapshot,JSON.stringify(tracker.snapshot()));assert.ok([...scene.entities.values()].every(e=>e.mesh.positions.every(Number.isFinite)));
});

test('static batching preserves transformed positions/normals and leaves active identities intact',()=>{
 const eligible={id:'wall',position:[2,3,4],rotation:[.3,.8,-.2],scale:[2,3,.5],mesh:{kind:'box',size:[1,2,3]},material:{color:[.5,.6,.7,1]}},active=[{id:'body',mesh:{kind:'box'},body:{mass:1}},{id:'label',mesh:{kind:'box'},material:{label:'Store'}},{id:'road',mesh:{kind:'box'},environmental:{surfaceUse:'road'}}];
 const batched=batchStaticScenery([eligible,...active],()=>true),b=batched.find(e=>e.id==='batch:wall');assert.equal(batched.length,4);for(const e of active)assert.ok(batched.includes(e));
 const source=primitiveMesh(eligible.mesh),m=compose(eligible.position,eligible.rotation,[2,6,1.5]);
 for(let i=0;i<source.vertices.length;i+=6){const p=source.vertices.slice(i,i+3),j=i/2;for(let axis=0;axis<3;axis++){const expected=m[axis]*p[0]+m[axis+4]*p[1]+m[axis+8]*p[2]+m[axis+12];assert.ok(Math.abs(b.mesh.positions[j+axis]+b.position[axis]-expected)<1e-5);}assert.ok(Math.abs(Math.hypot(...b.mesh.normals.slice(j,j+3))-1)<1e-6);}
 const collision=batchStaticScenery([eligible,{id:'batch:wall',mesh:{kind:'box'},body:{mass:0}}],()=>true);assert.equal(new Set(collision.map(e=>e.id)).size,2);
 const expectedIndices=source.indices.length;assert.equal(b.mesh.indices.length,expectedIndices);assert.throws(()=>batchStaticScenery([],()=>true,0));
});

test('initial puddle water is finite and polygon road fields span the authored width',()=>{
 const spec={version:1,environment:{temperatureC:-2,snowfall:'none'},entities:[{id:'puddle',mesh:{kind:'polygon-prism',axis:1,points:[[-2,-1],[2,-1],[2,1],[-2,1]],thickness:.002},material:{kind:'asphalt'},environmental:{surfaceUse:'road',waterDepthM:.004}}]};
 const scene=new Scene(spec);scene.step();assert.ok(scene.surfaces.sample('puddle',1.5,.8).waterDepthM>.0039);assert.equal(scene.surfaces.sample('puddle',2.1,0),undefined);assert.throws(()=>validateScene({...spec,entities:[{...spec.entities[0],environmental:{surfaceUse:'road',waterDepthM:NaN}}]}));
});

test('wet tyre audio suppresses hiss and footstep audio starts at the recorded contact',()=>{
 const frames=[{time:0,listener:[0,1,0],target:[0,1,5],vehicle:[0,0,3],speedMps:3,puddle:1},{time:1,listener:[0,1,0],target:[0,1,5],vehicle:[0,0,3],speedMps:3,puddle:1}];
 const a=renderAmbience(frames,1,{sampleRate:16000,windSpeedMps:0}),dry=renderAmbience(frames.map(f=>({...f,puddle:0})),1,{sampleRate:16000,windSpeedMps:0});let diff=0,power=0,total=0;for(let i=1;i<a.left.length;i++){const wet=a.left[i]-dry.left[i],prev=a.left[i-1]-dry.left[i-1];diff+=(wet-prev)**2;power+=wet**2;total+=a.left[i]**2;}assert.ok(power>1e-5);assert.ok(diff/power<.13,`HF derivative ratio ${diff/power}`);assert.ok(total>0);
 const events=[{time:.25,position:[0,0,2],sequence:1,depth:.022}],steps=renderFootsteps(events,frames,1,16000);assert.equal(steps.left.slice(0,4000).every(x=>x===0),true);assert.ok(steps.left.slice(4001,9000).some(x=>Math.abs(x)>.001));assert.deepEqual(steps.left,renderFootsteps(events,frames,1,16000).left);
});

test('M3 asset has separate wheels, normalized corner normals and traceable local source',async()=>{
 const asset=JSON.parse(await readFile(new URL('../tools/promo/assets/m3.json',import.meta.url)));assert.equal(asset.provenance.triangles,9798);assert.equal(asset.provenance.sha256,'9c03464b3407ff1ab45cf4b3b913ee108ed454e4d7e5a82da438667af8cc2d67');assert.equal(new Set(asset.parts.filter(p=>p.wheel).map(p=>p.name.split('-')[0])).size,4);
 for(const part of asset.parts){const m=part.mesh;assert.equal(m.positions.length,m.normals.length);assert.ok(m.indices.every(i=>i>=0&&i<m.positions.length/3));for(let i=0;i<m.normals.length;i+=3)assert.ok(Math.abs(Math.hypot(...m.normals.slice(i,i+3))-1)<2e-6);}
});
