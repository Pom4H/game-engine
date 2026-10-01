import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkBudget,BufferUpload,FrameGate} from '../dist/core/work-budget.js';
import {PreparedMesh} from '../dist/procedural/prepared-mesh.js';
import {primitiveMesh,primitiveKey} from '../dist/procedural/mesh.js';
import {EnvironmentUpload} from '../dist/render/environment-upload.js';
import {meshBounds} from '../dist/render/visibility.js';
import {buildSceneRadianceProbe} from '../dist/render/radiance.js';
import {Scene} from '../dist/scene/scene.js';
import {ChunkWindow} from '../dist/runtime/chunk-window.js';
import {chunkGeometry,prepareChunkGeometry} from '../dist/games/thegame/geometry.js';
import {OpenWorld} from '../dist/games/thegame/world.js';
const meshPacket=()=>{const m=primitiveMesh({kind:'box',size:[1,1,1]});return {...m,indices:new Uint32Array(m.indices),bounds:meshBounds(m.vertices)};};
test('render geometry adoption preserves buffer identity without authoring expansion',()=>{
 const p=meshPacket(),mesh=new PreparedMesh(p),scene=new Scene({version:1,entities:[]});
 const entity=scene.addPrepared({id:'streamed',position:[0,0,0],material:{kind:'concrete'}},mesh);
 assert.equal(entity.renderMesh,mesh);assert.equal(primitiveMesh(mesh).vertices,p.vertices);
 for(let i=0;i<10;i++){primitiveKey(mesh);buildSceneRadianceProbe(scene,[0,2,10]);}
 assert.equal(mesh.expanded,false);assert.equal(scene.physics.bodies.size,0);
 entity.presentationVisible=false;assert.equal(buildSceneRadianceProbe(scene,[0,2,10]).proxies.length,0);
 assert.throws(()=>scene.addPrepared({id:'invalid',body:{mass:5}},mesh));scene.dispose();
});
test('prepared envelope rejects detached, oversized and nonfinite metadata',()=>{
 const p=meshPacket();assert.throws(()=>new PreparedMesh({...p,bounds:{center:[NaN,0,0],half:[1,1,1]}}));
 assert.throws(()=>new PreparedMesh({...p,colors:new Uint8Array(4)}));
 const m=meshPacket();structuredClone(m.vertices,{transfer:[m.vertices.buffer]});assert.throws(()=>new PreparedMesh(m));
});
test('byte/operation limits are hard; deadline stops the next operation without claiming preemption',()=>{
 let now=0;const budget=new WorkBudget(16,3,1,()=>now).begin();assert.equal(budget.claim(12),true);assert.equal(budget.claim(8),false);assert.equal(budget.bytes,12);
 assert.equal(budget.claim(4),true);assert.equal(budget.claim(),true);assert.equal(budget.claim(),false);assert.equal(budget.bytes,16);assert.equal(budget.operations,3);
 budget.begin();assert.equal(budget.claim(),true);now=2;assert.equal(budget.claim(),false);budget.finish();assert.equal(budget.overruns,1);assert.throws(()=>budget.claim(3));
});
test('large geometry uploads are bounded slices, completed once and cancellable',()=>{
 const a=new Uint8Array(300000).fill(19),b=new Uint8Array(100000).fill(23),c=new Uint32Array(70000).fill(17),writes=[],destroyed=[];
 const upload=new BufferUpload([a,b,c],{create:n=>new Uint8Array(n),write:(buffer,offset,bytes)=>{writes.push(bytes.length);buffer.set(bytes,offset);},destroy:buffer=>destroyed.push(buffer)});
 let frames=0;const budget=new WorkBudget(128*1024,8,1,()=>0);
 do{budget.begin();frames++;if(upload.advance(budget))break;assert.ok(budget.bytes<=128*1024);assert.ok(budget.operations<=8);}while(frames<100);
 assert.ok(frames>1);assert.ok(upload.done);assert.deepEqual(upload.buffers[0],a);assert.deepEqual(upload.buffers[1],b);assert.deepEqual(upload.buffers[2],new Uint8Array(c.buffer));assert.ok(writes.every(n=>n<=65536));
 const count=writes.length;upload.advance(budget.begin());assert.equal(writes.length,count);upload.dispose();upload.dispose();assert.equal(destroyed.length,3);assert.throws(()=>upload.advance(budget));
});
test('failed GPU write releases partial staging; cancellation cannot publish partial geometry',()=>{
 let destroyed=0;const a=new Uint8Array(8);const upload=new BufferUpload([a,a,a],{create:n=>({n}),write(){throw Error('device lost');},destroy(){destroyed++;}});
 assert.throws(()=>upload.advance(new WorkBudget(16,8,1,()=>0).begin()),/device lost/);assert.equal(destroyed,1);assert.equal(upload.done,false);
 const released=[],window=new ChunkWindow((key,value)=>released.push(value));window.want(0,0,1);const ticket=window.next(),value={stage:1};window.prepared(ticket,value);
 assert.equal(window.admit(()=>false),false);assert.equal(window.has(ticket.key),false);assert.equal(window.inspect().ready,1);assert.equal(window.next(),undefined);
 window.want(100,100,1);assert.equal(window.inspect().ready,0);assert.deepEqual(released,[value]);
 const late={stage:2};assert.equal(window.prepared(ticket,late),false);assert.equal(released.at(-1),late);
});
test('only a complete chunk publishes; a rebase preserves overlapping resident identity',()=>{
 const window=new ChunkWindow(()=>{});window.want(0,0,1);const ticket=window.next(),value={work:0};window.prepared(ticket,value);
 assert.equal(window.admit((_t,v)=>++v.work===3),false);assert.equal(window.admit((_t,v)=>++v.work===3),false);assert.equal(window.inspect().resident,0);
 assert.equal(window.admit((_t,v)=>++v.work===3),true);assert.equal(window.has(ticket.key),true);window.want(1,0,1);assert.equal(window.has(ticket.key),true);window.dispose();
});
test('GPU credit bounds submitted work and failed completion is observable',async()=>{
 const gate=new FrameGate(2);let a,b;assert.ok(gate.admit());gate.track(new Promise(r=>a=r));assert.ok(gate.admit());gate.track(new Promise(r=>b=r));assert.equal(gate.admit(),false);assert.equal(gate.pending,2);assert.throws(()=>gate.track(Promise.resolve()));
 a();b();await new Promise(r=>setImmediate(r));assert.equal(gate.pending,0);assert.equal(gate.completed,2);gate.track(Promise.reject(Error('lost')));await new Promise(r=>setImmediate(r));assert.match(gate.error,/lost/);assert.equal(gate.admit(),false);assert.equal(gate.maxPending,2);
});
test('cubemap face/row upload keeps the prior environment until all nine mips complete',()=>{
 const mips=Array.from({length:9},(_,mip)=>{const size=Math.max(1,256>>mip);return {mip,size,pixels:new Uint16Array(size*size*6*4).fill(mip+1)};});
 let bytes=0,writes=0;const targets=mips.map(m=>new Uint16Array(m.pixels.length));
 const upload=new EnvironmentUpload(mips,(mip,face,row,size,rows,pixels)=>{assert.ok(pixels.byteLength<=65536);assert.equal(pixels.length,size*rows*4);targets[mip].set(pixels,(face*size+row)*size*4);bytes+=pixels.byteLength;writes++;});
 const budget=new WorkBudget(128*1024,8,1,()=>0);let frames=0;while(++frames<200){const complete=upload.advance(budget.begin());assert.ok(budget.bytes<=128*1024);assert.ok(budget.operations<=8);if(complete)break;}
 assert.ok(frames>20&&frames<200);assert.equal(bytes,mips.reduce((n,m)=>n+m.pixels.byteLength,0));for(let i=0;i<9;i++)assert.deepEqual(targets[i],mips[i].pixels);assert.ok(writes>9);assert.throws(()=>new EnvironmentUpload(mips.slice(1),()=>{}));
});
test('all world scenery batches pack off-thread, keep terrain parity and fit admission bounds',()=>{
 const world=new OpenWorld();for(const [cx,cz] of [[-3,-1],[-1,-1],[-8,-2],[10,0]]){
  const authored=chunkGeometry(world,cx,cz),parts=prepareChunkGeometry(world,cx,cz);assert.ok(parts.length<=8);assert.equal(parts.length,authored.length);let bytes=0;
  for(const part of parts){const mesh=new PreparedMesh(part.mesh);assert.equal(mesh.expanded,false);bytes+=mesh.byteLength;assert.ok(part.mesh.vertices.every(Number.isFinite));assert.ok(part.mesh.indices.every(i=>i<part.mesh.vertices.length/6));assert.equal('mesh' in part.spec,false);}
  assert.ok(bytes<8*1024*1024);const vertices=parts[0].mesh.vertices,indices=parts[0].mesh.indices;assert.equal(indices.length,16*16*6);
  for(let n=0;n<indices.length;n+=3){let x=0,y=0,z=0;for(let j=0;j<3;j++){const offset=indices[n+j]*6;x+=vertices[offset]/3;y+=vertices[offset+1]/3;z+=vertices[offset+2]/3;}assert.ok(Math.abs(world.ground(cx*128+x,cz*128+z).y-y)<1e-5);}
 }
 world.dispose();
});

test('whole-run frame evidence retains old hitches after thousands of fast frames',async()=>{
 const {FrameHealth}=await import('../dist/core/frame-health.js'),frames=new FrameHealth();frames.record(116.7);for(let i=0;i<20000;i++)frames.record(8.33);const f=frames.inspect();assert.equal(f.samples,20001);assert.equal(f.maxMs,116.7);assert.equal(f.over100Ms,1);assert.equal(f.p95Ms,8.5);frames.reset();assert.equal(frames.inspect().samples,0);assert.throws(()=>frames.record(NaN));
});
