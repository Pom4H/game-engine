import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene} from '../dist/scene/scene.js';
import {compactTriangleMesh,primitiveKey} from '../dist/procedural/mesh.js';
import {WebGPURenderer} from '../dist/render/webgpu.js';
import {RenderModelHistory} from '../dist/render/model-history.js';
import {initializationDevice} from './helpers/render-initialization-device.mjs';
import {SurfaceTextures} from '../dist/render/surface-textures.js';

const mesh=()=>compactTriangleMesh({positions:[0,0,0,1,0,0,0,1,0],normals:[0,0,1,0,0,1,0,0,1],indices:[0,1,2]});
const scene=()=>new Scene({version:1,entities:[],environment:{humidity:.72,sunlight:.3,groundMoisture:.5,temperatureC:9,wind:[2,0,-1]}});
const texture=name=>({name,destroys:0,createView(){return {texture:this};},destroy(){this.destroys++;}});
function fixture(s=scene()){
 const buffers=[],binds=[],events=[],writes=[],textures=new Map(),empty=texture('empty');
 const device={createBuffer(spec){const b={spec,destroys:0,destroy(){this.destroys++;events.push(['destroy',this]);}};buffers.push(b);events.push(['allocate',spec.size]);return b;},createBindGroup(spec){const b={spec};binds.push(b);events.push(['bind']);return b;},queue:{writeBuffer(buffer,offset,value){const data=value.slice();writes.push({buffer,offset,data});events.push(['write',data.byteLength]);}}};
 const renderer=Object.create(WebGPURenderer.prototype);Object.assign(renderer,{device,meshes:new Map(),meshByPrimitive:new WeakMap(),objects:new Map(),labels:new Map(),labelUsers:new Map(),modelCache:new Map(),previousModels:new RenderModelHistory(),lastScene:s,renderFrame:null,gpu:{emptyField:empty,emptyLabel:empty,sampler:{},surfaceSampler:{},objectLayout:{}},surfaceTextures:{get:url=>textures.get(url),retain(urls){for(const [url,t] of textures)if(!urls.has(url)){t.destroy();textures.delete(url);}}},materialLoads:new Map(),failedMaterials:new Set(),errors:[],profiler:{addUpload(){}},collectedRevision:-1});
 function resident(m){const resource={key:primitiveKey(m),vertex:texture('v'),color:texture('c'),index:texture('i')};renderer.meshes.set(resource.key,resource);renderer.meshByPrimitive.set(m,resource);return resource;}
 return {renderer,device,s,buffers,binds,events,writes,textures,empty,resident};
}
function ready(lease){for(let i=0;!lease.ready;i++){lease.step();assert.ok(i<10);}return lease;}
const material=()=>({kind:'concrete',color:[.2,.4,.6,1],finish:'rough',ageYears:4,treatment:'sealed',roughness:.64,metalness:.02,clearcoat:.12,clearcoatRoughness:.2,emissive:[.1,.2,.3],variationSeed:42.125,groundLitter:{kind:'paving',baseRoughness:.83},facade:{kind:'masonry',night:.3},rainResponse:{kind:'ground'},surfaceAppearance:{wetness:.4,darkening:.2,snow:{snowDepthM:.1,waterDepthM:.002,iceDepthM:.003,slush:.2,freshness:.3,liquidFraction:.4,crust:.5,grainSizeMm:1.25}}});

test('detached Scene construction matches ordinary add, snapshots authored values, and does not publish until adoption',()=>{
 const a=scene(),b=scene(),m=mesh(),spec={id:'same-canonical-id',mesh:m,position:[-0,2,3],rotation:[.1,.2,.3],scale:[1,2,3],material:material(),renderOnly:true,renderVisible:true,renderCameraVisible:false};
 const expected=a.add(spec),ticket=b.prepareRenderEntity(spec);
 assert.equal(b.entities.size,0);assert.equal(b.renderStructureRevision,0);assert.deepEqual(ticket.entity,expected);assert.equal(ticket.entity.mesh,m);
 spec.position[1]=99;spec.material.color[0]=1;spec.material.facade.night=1;assert.equal(ticket.entity.position[1],2);assert.equal(ticket.entity.material.color[0],.2);assert.equal(ticket.entity.material.facade.night,.3);
 const object=ticket.entity;assert.equal(ticket.adopt(),object);assert.equal(ticket.adopt(),object);assert.equal(b.entities.get(spec.id),object);assert.equal(b.renderStructureRevision,1);
 ticket.dispose();ticket.dispose();assert.equal(b.entities.get(spec.id),object);assert.throws(()=>ticket.entity,/disposed/);
 const pending=b.prepareRenderEntity({...spec,id:'discarded'});pending.dispose();assert.throws(()=>pending.entity,/disposed/);assert.throws(()=>pending.refresh({position:[8,7,6]}),/disposed/);assert.throws(()=>pending.adopt(),/disposed/);assert.equal(b.entities.has('discarded'),false);
});

test('bounded preparation validates original values and owned geometry; refresh is atomic and uses final weather/material/pose',()=>{
 const s=scene(),m=mesh(),base={id:'prepared',mesh:m,renderOnly:true};
 for(const change of [x=>x.scale=[1,0,1],x=>x.position=[0,,0],x=>x.material={label:'x'.repeat(101)},x=>x.material={texture:{url:'a'.repeat(8193)}},x=>x.material={roughness:NaN},x=>x.body={mass:1},x=>x.environmental={},x=>x.light={kind:'point'},x=>x.renderOnly=false]){const spec={...base};change(spec);assert.throws(()=>s.prepareRenderEntity(spec));assert.equal(s.entities.size,0);}
 let reads=0;assert.throws(()=>s.prepareRenderEntity({...base,mesh:{kind:'triangle-mesh',get positions(){reads++;return[];}}}),/owned/);assert.equal(reads,0);
 const t=s.prepareRenderEntity({...base,material:material()}),before=t.entity.position.slice(),oldMaterial=t.entity.material;
 assert.throws(()=>t.refresh({position:[9,8,7],scale:[1,-1,1]}));assert.deepEqual(t.entity.position,before);assert.equal(t.entity.material,oldMaterial);
 s.environment={...s.environment,sunlight:.95,humidity:.1,wind:[4,0,1]};t.refresh({position:[4,-0,8],rotation:[.7,.4,-.2],scale:[2,3,4],material:material()});
 const oracle=new Scene({version:1,entities:[]});oracle.environment=s.environment;const expected=oracle.add({...base,position:[4,-0,8],rotation:[.7,.4,-.2],scale:[2,3,4],material:material()});assert.deepEqual(t.entity,expected);
 s.add({...base});assert.throws(()=>t.adopt(),/Duplicate/);assert.notEqual(s.entities.get(base.id),t.entity);s.remove(base.id);t.adopt();assert.throws(()=>t.refresh(),/adopted/);
});

test('GPU prewarm has exactly three fixed-work actions; complete uniform and bind entries match live preparation without a cold mesh fallback',()=>{
 const m=mesh(),old=fixture(),staged=fixture();old.resident(m);staged.resident(m);
 const spec={id:'exact-seed-id',mesh:m,renderOnly:true,position:[1,2,3],rotation:[.1,.2,.3],scale:[2,3,4],material:material()},ordinary=old.s.add(spec),ticket=staged.s.prepareRenderEntity(spec);
 old.renderer.prepare(ordinary);const lease=staged.renderer.prepareEntity(ticket.entity);assert.equal(staged.events.length,0);assert.throws(()=>lease.commit(),/incomplete/);
 assert.equal(lease.step(),false);assert.deepEqual(staged.events.map(e=>e.slice(0,2)),[['allocate',400]]);
 assert.equal(lease.step(),false);assert.equal(staged.events.at(-1)[0],'bind');assert.equal(lease.step(),true);assert.deepEqual(staged.events.at(-1),['write',400]);
 assert.deepEqual(staged.writes[0].data,old.writes[0].data);assert.deepEqual(staged.binds[0].spec.entries.map(e=>e.binding),old.binds[0].spec.entries.map(e=>e.binding));assert.equal(staged.renderer.objects.size,0);
 lease.commit();ticket.adopt();const work=staged.events.length;staged.renderer.prepare(ticket.entity);assert.equal(staged.events.length,work,'first use performs no GPU work for an unchanged prepared entity');lease.dispose();assert.equal(staged.buffers[0].destroys,0);
 const arbitrary={...ticket.entity};assert.throws(()=>staged.renderer.prepareEntity(arbitrary),/identity/);
 const missing=fixture();assert.throws(()=>missing.renderer.prepareEntity(ticket.entity),/resident mesh/);assert.equal(missing.events.length,0);
});

test('hidden staged entities prewarm resident geometry, retain their binding through collection, and reveal without new GPU work',()=>{
 const f=fixture();f.renderer.collect(f.s);const m=mesh(),resource=f.resident(m),ticket=f.s.prepareRenderEntity({id:'hidden-material-cohort',mesh:m,renderOnly:true,renderVisible:false});
 const lease=ready(f.renderer.prepareEntity(ticket.entity));lease.commit();const entity=ticket.adopt();f.renderer.adoptPreparedEntity(f.s,entity);lease.dispose();ticket.dispose();
 const object=f.renderer.objects.get(entity.id),events=f.events.length;assert.ok(object);assert.equal(object.preparedAdopted,true);
 f.renderer.collect(f.s);assert.equal(f.renderer.objects.get(entity.id),object);assert.equal(f.renderer.meshes.get(resource.key),resource);assert.deepEqual(f.renderer.collectedVisible,[]);assert.equal(object.uniform.destroys,0);assert.equal(f.events.length,events);
 f.s.setRenderVisible(entity.id,true);f.renderer.collect(f.s);f.renderer.prepare(entity);assert.equal(f.renderer.objects.get(entity.id),object);assert.equal(f.events.length,events,'revealing the prewarmed cohort allocates, binds and uploads nothing');
 f.s.remove(entity.id);f.renderer.collect(f.s);assert.equal(object.uniform.destroys,1);assert.equal(resource.vertex.destroys,1);assert.equal(resource.color.destroys,1);assert.equal(resource.index.destroys,1);
});

test('staged visibility changes do not invalidate the prepared primitive identity or relax missing-mesh fences',()=>{
 const f=fixture(),m=mesh();f.resident(m);const ticket=f.s.prepareRenderEntity({id:'visibility-fence',mesh:m,renderOnly:true}),lease=ready(f.renderer.prepareEntity(ticket.entity));
 ticket.entity.renderVisible=false;assert.equal(lease.ready,true);lease.commit();ticket.adopt();f.renderer.adoptPreparedEntity(f.s,ticket.entity);lease.dispose();ticket.dispose();
 const missing=f.s.prepareRenderEntity({id:'hidden-unresident',mesh:mesh(),renderOnly:true,renderVisible:false});assert.throws(()=>f.renderer.prepareEntity(missing.entity),/resident mesh/);missing.dispose();
 f.s.remove('visibility-fence');f.renderer.collect(f.s);assert.equal(f.renderer.entityPreparationLeases.size,0);assert.equal(f.buffers.every(b=>b.destroys===1),true);
});

test('ordinary hidden objects do not gain the explicit staged residency lease',()=>{
 const f=fixture(),m=mesh(),resource=f.resident(m),entity=f.s.add({id:'ordinary-hidden',mesh:m,renderOnly:true});f.renderer.prepare(entity);f.renderer.collect(f.s);const object=f.renderer.objects.get(entity.id);assert.equal(object.preparedAdopted,undefined);
 f.s.setRenderVisible(entity.id,false);f.renderer.collect(f.s);assert.equal(f.renderer.objects.has(entity.id),false);assert.equal(f.renderer.meshes.has(resource.key),false);assert.equal(object.uniform.destroys,1);assert.equal(resource.vertex.destroys,1);assert.deepEqual(f.renderer.collectedVisible,[]);
});

test('same-ID replacement preserves old live resources until new activation; cancelled and retired owners destroy buffers exactly once',()=>{
 const f=fixture(),m=mesh();f.resident(m);const original=f.s.add({id:'replace',mesh:m,renderOnly:true});f.renderer.prepare(original);const oldObject=f.renderer.objects.get('replace');
 const cancelled=f.s.prepareRenderEntity({id:'replace',mesh:m,renderOnly:true}),cancelLease=ready(f.renderer.prepareEntity(cancelled.entity));cancelLease.commit();assert.equal(f.renderer.objects.get('replace'),oldObject);cancelLease.dispose();assert.equal(f.buffers[1].destroys,1);assert.equal(oldObject.uniform.destroys,0);assert.equal(f.s.entities.get('replace'),original);
 const ticket=f.s.prepareRenderEntity({id:'replace',mesh:m,renderOnly:true,material:{color:[.2,.3,.4,1]}}),lease=ready(f.renderer.prepareEntity(ticket.entity));lease.commit();assert.equal(oldObject.uniform.destroys,0);
 f.s.remove('replace');ticket.adopt();f.renderer.collect(f.s);assert.equal(oldObject.uniform.destroys,0);f.renderer.prepare(ticket.entity);assert.equal(oldObject.uniform.destroys,1);lease.dispose();assert.equal(f.buffers[2].destroys,0);
 f.s.remove('replace');f.renderer.collect(f.s);assert.equal(f.buffers[2].destroys,1);lease.dispose();assert.deepEqual(f.buffers.map(b=>b.destroys),[1,1,1]);
});

test('moving/final-weather refresh reuses complete bindings and needs only the normal 400-byte first-live update',()=>{
 const f=fixture(),m=mesh();f.resident(m);const ticket=f.s.prepareRenderEntity({id:'moving',mesh:m,renderOnly:true,material:material()}),lease=ready(f.renderer.prepareEntity(ticket.entity));
 f.s.environment={...f.s.environment,sunlight:.8};ticket.refresh({position:[9,4,-3],rotation:[.4,.1,.2],material:{...material(),roughness:.42}});assert.equal(lease.ready,true);lease.commit();ticket.adopt();const work=f.events.length;f.renderer.prepare(ticket.entity);assert.deepEqual(f.events.slice(work).map(e=>e[0]),['write']);assert.equal(f.writes.at(-1).data.byteLength,400);
 const oracle=fixture();oracle.resident(m);oracle.s.environment=f.s.environment;const ordinary=oracle.s.add({id:'moving',mesh:m,renderOnly:true,position:[9,4,-3],rotation:[.4,.1,.2],material:{...material(),roughness:.42}});oracle.renderer.prepare(ordinary);assert.deepEqual(f.writes.at(-1).data,oracle.writes.at(-1).data);lease.dispose();
});

test('explicit Scene cache adoption retains offscreen prepared objects after all leases are released, without first-visible resource creation',()=>{
 const f=fixture(),m=mesh();f.resident(m);const tickets=[],leases=[];
 for(let i=0;i<12;i++){const t=f.s.prepareRenderEntity({id:'offscreen-'+i,mesh:m,renderOnly:true,position:[i*100,0,5000]});tickets.push(t);const l=ready(f.renderer.prepareEntity(t.entity));l.commit();leases.push(l);assert.throws(()=>f.renderer.adoptPreparedEntity(f.s,t.entity),/Scene first/);}
 const work=f.events.length;
 for(const t of tickets){t.adopt();f.renderer.adoptPreparedEntity(f.s,t.entity);f.renderer.adoptPreparedEntity(f.s,t.entity);}
 assert.equal(f.events.length,work);assert.equal(f.renderer.objects.size,tickets.length);for(const l of leases)l.dispose();assert.ok(f.buffers.every(b=>b.destroys===0));
 f.renderer.collect(f.s);const before=f.events.length;for(const t of tickets)f.renderer.prepare(t.entity);assert.equal(f.events.slice(before).some(e=>e[0]==='allocate'||e[0]==='bind'),false);assert.equal(f.buffers.length,12);
 for(const t of tickets)f.s.remove(t.entity.id);f.renderer.collect(f.s);assert.ok(f.buffers.every(b=>b.destroys===1));
});

test('captured primitive identity and mesh residency are fenced before cache admission or activation',()=>{
 for(const afterCommit of [false,true]){
  const f=fixture(),a=mesh(),b=mesh();f.resident(a);const t=f.s.prepareRenderEntity({id:'mesh-fence',mesh:a,renderOnly:true}),l=ready(f.renderer.prepareEntity(t.entity));if(afterCommit)l.commit();t.entity.mesh=b;
  assert.equal(l.ready,false);
  if(afterCommit){t.adopt();assert.throws(()=>f.renderer.adoptPreparedEntity(f.s,t.entity),/binding changed/);l.dispose();}else assert.throws(()=>l.step(),/binding changed/);
  assert.equal(f.buffers[0].destroys,1);assert.equal(f.renderer.objects.size,0);assert.equal(f.buffers.length,1);
 }
 const f=fixture(),a=mesh();f.resident(a);const t=f.s.prepareRenderEntity({id:'residency-fence',mesh:a,renderOnly:true}),l=ready(f.renderer.prepareEntity(t.entity));f.renderer.meshes.clear();assert.equal(l.ready,false);assert.throws(()=>l.step(),/binding changed/);assert.equal(f.buffers[0].destroys,1);
});

test('texture identity/URL changes fail closed, while staged URLs and glyph references survive unrelated collection',()=>{
 const f=fixture(),m=mesh();f.resident(m);const a=texture('a'),b=texture('b');f.textures.set('/a.png',a);
 const ticket=f.s.prepareRenderEntity({id:'textured',mesh:m,renderOnly:true,material:{texture:{url:'/a.png'}}}),lease=ready(f.renderer.prepareEntity(ticket.entity));f.renderer.collect(f.s);assert.equal(a.destroys,0);assert.equal(f.textures.get('/a.png'),a);
 f.textures.set('/a.png',b);assert.equal(lease.ready,false);assert.throws(()=>lease.step(),/binding changed/);assert.equal(f.buffers[0].destroys,1);assert.equal(f.renderer.objects.size,0);
 const retry=ready(f.renderer.prepareEntity(ticket.entity));ticket.refresh({material:{texture:{url:'/other.png'}}});assert.equal(retry.ready,false);assert.throws(()=>retry.step(),/binding changed/);assert.equal(f.buffers[1].destroys,1);
 const label=f.s.prepareRenderEntity({id:'label',mesh:m,renderOnly:true,material:{label:'outside cold glyph scope'}});assert.throws(()=>f.renderer.prepareEntity(label.entity),/resident label/);assert.equal(f.buffers.length,2);
});

test('authored URLs load one per readiness step, never publish fallback bindings, and failed/cancelled loads retain no detached GPU ownership',async()=>{
 const f=fixture(),m=mesh();f.resident(m);const requested=[],checks=[];
 f.renderer.surfaceTextures.load=url=>{requested.push(url);return new Promise((resolve,reject)=>checks.push({url,resolve,reject}));};
 const t=f.s.prepareRenderEntity({id:'async-material',mesh:m,renderOnly:true,material:{texture:{url:'/a.png',normalUrl:'/n.png',ormUrl:'/o.png',heightUrl:'/h.png',heightScaleM:.02}}}),lease=f.renderer.prepareEntity(t.entity);
 for(let i=0;i<4;i++){assert.equal(lease.step(),false);assert.equal(requested.length,i+1);assert.equal(f.events.length,0);}
 for(let i=0;i<20;i++)assert.equal(lease.step(),false);assert.equal(requested.length,4);assert.equal(f.buffers.length,0);assert.throws(()=>lease.commit(),/incomplete/);
 for(const c of checks){f.textures.set(c.url,texture(c.url));c.resolve();}await new Promise(resolve=>setImmediate(resolve));ready(lease);assert.equal(f.buffers.length,1);assert.equal(f.binds.length,1);
 lease.commit();t.adopt();f.renderer.adoptPreparedEntity(f.s,t.entity);lease.dispose();const work=f.events.length;f.renderer.prepare(t.entity);assert.equal(f.events.length,work,'first live use cannot discover a late material and rebuild its binding');
 const bad=f.s.prepareRenderEntity({id:'failed-load',mesh:m,renderOnly:true,material:{texture:{url:'/failed.png'}}}),rejected=f.renderer.prepareEntity(bad.entity);rejected.step();checks.at(-1).reject(new Error('decoder failed'));await new Promise(resolve=>setImmediate(resolve));assert.throws(()=>rejected.step(),/material texture failed/);assert.equal(f.buffers.length,1);assert.equal(f.s.entities.has('failed-load'),false);
 const cancelled=f.renderer.prepareEntity(bad.entity);cancelled.step();cancelled.dispose();checks.at(-1).reject(new Error('late failure'));await new Promise(resolve=>setImmediate(resolve));assert.equal(cancelled.ready,false);assert.equal(f.renderer.preparedEntityTextureURLs.size,0);assert.equal(f.buffers.length,1);
});

test('a resident label is pinned before the first preparation step, transfers to an adopted object, and retires exactly once',()=>{
 const f=fixture(),m=mesh();f.resident(m);const key=JSON.stringify(['retained glyph',[226/255,217/255,188/255]]),glyph=texture('glyph');f.renderer.labels.set(key,glyph);
 const t=f.s.prepareRenderEntity({id:'label-prewarm',mesh:m,renderOnly:true,material:{label:'retained glyph'}}),l=f.renderer.prepareEntity(t.entity);
 f.renderer.collect(f.s);assert.equal(glyph.destroys,0);assert.equal(f.buffers.length,0);assert.equal(f.renderer.labels.get(key),glyph);
 ready(l);l.commit();t.adopt();f.renderer.adoptPreparedEntity(f.s,t.entity);l.dispose();f.renderer.collect(f.s);assert.equal(glyph.destroys,0);
 f.s.remove(t.entity.id);f.renderer.collect(f.s);assert.equal(glyph.destroys,1);assert.equal(f.renderer.labels.size,0);l.dispose();assert.equal(glyph.destroys,1);
 const cancelled=texture('cancelled glyph');f.resident(m);f.renderer.labels.set(key,cancelled);const pending=f.renderer.prepareEntity(t.entity);pending.dispose();assert.equal(cancelled.destroys,1);assert.equal(f.buffers.length,1);
});

test('real SurfaceTextures pending decode survives BOTH live material-retention boundaries before detached publication',async t=>{
 const f=fixture(),m=mesh();f.resident(m);const requests=[],assets=[],bitmaps=[],originalFetch=globalThis.fetch,originalBitmap=globalThis.createImageBitmap;
 t.after(()=>{globalThis.fetch=originalFetch;if(originalBitmap===undefined)delete globalThis.createImageBitmap;else globalThis.createImageBitmap=originalBitmap;f.renderer.surfaceTextures.dispose();});
 globalThis.fetch=(url,options)=>new Promise((resolve,reject)=>requests.push({url,signal:options.signal,resolve,reject}));
 globalThis.createImageBitmap=async()=>{const bitmap={width:1,height:1,closed:0,close(){this.closed++;}};bitmaps.push(bitmap);return bitmap;};
 Object.assign(f.device,{createTexture(spec){const result=texture(spec.format);assets.push(result);return result;},createShaderModule(){return{async getCompilationInfo(){return{messages:[]};}};},createRenderPipeline(){return{getBindGroupLayout(){return{};}};},createSampler(){return{};},createCommandEncoder(){return{finish(){return{};}};}});
 f.device.queue.copyExternalImageToTexture=()=>{};f.device.queue.submit=()=>{};f.renderer.surfaceTextures=new SurfaceTextures(f.device);
 const ticket=f.s.prepareRenderEntity({id:'initial-ground',mesh:m,renderOnly:true,material:{texture:{projection:'terrain-map',url:'blob:pending-ground',sizeM:1024}}}),lease=f.renderer.prepareEntity(ticket.entity);
 assert.equal(lease.step(),false);assert.equal(requests.length,1);assert.equal(f.renderer.surfaceTextures.pendingCount,1);assert.equal(f.buffers.length,0);
 for(let i=0;i<5;i++){f.renderer.queueMaterialLoads(f.s);f.renderer.collect(f.s);assert.equal(requests[0].signal.aborted,false);assert.equal(f.renderer.surfaceTextures.pendingCount,1);assert.equal(lease.step(),false);}
 assert.equal(requests.length,1,'live-scene retention must not restart or independently fan out detached loads');
 requests[0].resolve({ok:true,async blob(){return{};}});await new Promise(resolve=>setImmediate(resolve));assert.equal(f.renderer.surfaceTextures.pendingCount,0);assert.equal(f.renderer.surfaceTextures.size,1);assert.equal(bitmaps[0].closed,1);ready(lease);
 lease.commit();ticket.adopt();f.renderer.adoptPreparedEntity(f.s,ticket.entity);lease.dispose();f.renderer.queueMaterialLoads(f.s);f.renderer.collect(f.s);const work=f.events.length;f.renderer.prepare(ticket.entity);assert.equal(f.events.length,work,'first object uses the fully loaded asset without allocation or binding');assert.equal(assets[0].destroys,0);
 f.s.remove(ticket.entity.id);f.renderer.queueMaterialLoads(f.s);f.renderer.collect(f.s);assert.equal(assets[0].destroys,1);assert.equal(f.renderer.surfaceTextures.size,0);
 const failed=f.s.prepareRenderEntity({id:'failed-decode',mesh:m,renderOnly:true,material:{texture:{url:'/failure.png'}}});f.resident(m);const errorLease=f.renderer.prepareEntity(failed.entity);errorLease.step();requests.at(-1).reject(new Error('actual fetch sentinel'));await new Promise(resolve=>setImmediate(resolve));assert.throws(()=>errorLease.step(),error=>String(error).includes('actual fetch sentinel')&&error.cause?.message==='actual fetch sentinel');
});

test('partial allocation/bind/upload failures and synchronous reentry cancel every detached buffer without replacing old objects',()=>{
 for(const operation of ['createBuffer','createBindGroup','writeBuffer'])for(const action of ['throw','cancel']){
  const f=fixture(),m=mesh();f.resident(m);const ticket=f.s.prepareRenderEntity({id:'failed',mesh:m,renderOnly:true}),lease=f.renderer.prepareEntity(ticket.entity),owner=operation==='writeBuffer'?f.device.queue:f.device,original=owner[operation],failure=new Error(operation);
  owner[operation]=function(...args){assert.throws(()=>lease.step(),/reenter/);if(action==='throw')throw failure;const result=original.apply(this,args);lease.dispose();return result;};
  assert.throws(()=>ready(lease),action==='throw'?e=>e===failure:/disposed/);assert.ok(f.buffers.every(b=>b.destroys===1),operation+' '+action);assert.equal(f.renderer.objects.size,0);assert.equal(f.renderer.entityPreparationLeases.size,0);assert.equal(f.renderer.preparedEntityTextureURLs.size,0);assert.equal(f.renderer.preparedMeshPins.size,0);
 }
});

test('asynchronous validation errors fence complete admission, late cancelled acknowledgements cannot publish, and no scope spans steps',async()=>{
 const f=fixture(),m=mesh();f.resident(m);const checks=[];let depth=0;f.device.pushErrorScope=()=>depth++;f.device.popErrorScope=()=>{depth--;return new Promise(resolve=>checks.push(resolve));};
 const ticket=f.s.prepareRenderEntity({id:'ack',mesh:m,renderOnly:true}),lease=f.renderer.prepareEntity(ticket.entity);for(let i=0;i<30;i++){assert.equal(lease.step(),false);assert.equal(depth,0);}assert.equal(f.events.length,3);assert.equal(checks.length,6);assert.equal(lease.ready,false);assert.throws(()=>lease.commit(),/incomplete/);
 checks[0]({message:'injected invalid binding'});for(const resolve of checks.slice(1))resolve(null);await new Promise(resolve=>setImmediate(resolve));assert.throws(()=>lease.step(),/injected invalid binding/);assert.equal(f.buffers[0].destroys,1);assert.equal(f.renderer.objects.size,0);
 const late=f.renderer.prepareEntity(ticket.entity);late.step();late.dispose();for(const resolve of checks)resolve({message:'cancelled'});await new Promise(resolve=>setImmediate(resolve));assert.equal(late.ready,false);assert.equal(f.buffers[1].destroys,1);
});

test('cache-publication cancellation and renderer disposal cannot publish a dead or late entity binding',async t=>{
 const f=fixture(),m=mesh();f.resident(m);const ticket=f.s.prepareRenderEntity({id:'transaction',mesh:m,renderOnly:true}),lease=ready(f.renderer.prepareEntity(ticket.entity)),set=f.renderer.preparedEntityObjects.set.bind(f.renderer.preparedEntityObjects);
 f.renderer.preparedEntityObjects.set=(...args)=>{set(...args);assert.throws(()=>lease.commit(),/reenter/);lease.dispose();};assert.throws(()=>lease.commit(),/disposed during admission/);assert.equal(f.renderer.preparedEntityObjects.has(ticket.entity),false);assert.equal(f.buffers[0].destroys,1);
 const env=initializationDevice(t),renderer=await WebGPURenderer.create(env.canvas);renderer.device.queue.writeBuffer=()=>{};const s=scene(),tri=mesh(),upload=renderer.prepareMesh(tri);for(let i=0;!upload.ready;i++){upload.step();await Promise.resolve();assert.ok(i<100);}upload.commit();
 const detached=s.prepareRenderEntity({id:'renderer-dispose',mesh:tri,renderOnly:true}),pending=renderer.prepareEntity(detached.entity);pending.step();renderer.dispose();renderer.dispose();assert.equal(renderer.entityPreparationLeases.size,0);assert.equal(renderer.preparedEntityTextureURLs.size,0);assert.throws(()=>pending.step(),/disposed/);assert.throws(()=>renderer.prepareEntity(detached.entity),/disposed/);
});
