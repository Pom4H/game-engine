import test from 'node:test';
import assert from 'node:assert/strict';
import {projection,scalar,vector3,Publication,LatestStateOutbox,Replica,AuthoritySession,PlaybackClock,SceneReplicaView,presentationScene,sceneMotion,captureSceneMotion,populationCells,populationProjection,PresentationLOD,projectedRadiusPx} from '../dist/network/index.js';
import {Scene} from '../dist/scene/scene.js';
import {buildRenderFrame} from '../dist/render/frame.js';
const schema=projection('test/v1',{position:vector3(),rotation:vector3('angle'),wear:scalar('step',0,1)});
const stamp=(tick,paused=false,epoch=1,sequence=tick)=>({epoch,sequence,tick,time:tick/60,paused});
const point=(t,id='car',generation=0)=>({id,generation,data:{position:[10*t,2500+3*t,-2*t],rotation:[0,t,0],wear:.2,privateSecret:'NOT ON WIRE',mesh:new Array(100).fill(7)}});
const frame=(tick,rows=[point(tick/60)])=>schema.capture(stamp(tick),rows);

test('explicit fields exclude private data/geometry and preserve f64 altitude',()=>{
 const f=frame(7);const text=schema.encode(f);assert.ok(!text.includes('NOT ON WIRE'));assert.ok(!text.includes('privateSecret'));assert.ok(!text.includes('mesh'));assert.deepEqual(schema.decode(text),f);assert.ok(Object.isFrozen(f.rows[0].values));
 assert.equal(schema.decode(text).rows[0].values[1],2500+.35);
});
test('malformed final row is atomic; old presentation survives',()=>{
 const r=new Replica(schema,1);r.receive(frame(1),0);const bad=structuredClone(frame(2,[point(.1,'a'),point(.1,'b')]));bad.rows[1].values[1]=NaN;
 assert.throws(()=>r.receive(bad,.03));assert.equal(r.latest().tick,1);assert.equal(r.inspect().accepted,1);
 assert.throws(()=>schema.decode(' '.repeat(schema.maxBytes+1)));assert.throws(()=>schema.capture(stamp(1),[point(0),point(0)]));
});
test('same publication is encoded once and reused by 16 subscribers',()=>{
 const before=schema.stats.encodes,p=new Publication(schema,frame(2));for(let i=0;i<16;i++)assert.equal(p.text(),p.text());assert.equal(schema.stats.encodes-before,1);
});
test('renderer samples a coherent 3D time despite jitter, loss, reordering and batching',()=>{
 const r=new Replica(schema,1,32,1e6,.12),deliveries=[];
 for(let tick=0;tick<600;tick+=3){if(tick%21===0&&tick>0)continue;deliveries.push({at:tick/60+.03+(tick%15===0?.10:(tick%9)*.003),f:frame(tick)});}deliveries.sort((a,b)=>a.at-b.at);
 let previous=-1,maxError=0,frames=0;
 for(let now=0;now<10;now+=1/144){while(deliveries.length&&deliveries[0].at<=now){const p=deliveries.shift();r.receive(p.f,now);}const s=r.present(now);if(!s.rows.length)continue;assert.ok(s.time>=previous);previous=s.time;
  const v=s.rows[0].values;maxError=Math.max(maxError,Math.abs(v[0]-s.time*10),Math.abs(v[1]-(2500+s.time*3)),Math.abs(v[2]+s.time*2));frames++;
 }
 assert.ok(frames>1300);assert.ok(maxError<1e-9);assert.ok(r.stats.stale>0);assert.equal(r.stats.allocations,1);assert.ok(r.inspect().frames<=32);
});
test('lost traffic holds the last cause, does not disappear, extrapolate forever or run physics',()=>{
 const r=new Replica(schema,1);r.receive(frame(3),0);const a=r.present(.2);r.present(90);assert.equal(r.sample.time,.05);assert.equal(r.sample.rows.length,1);assert.equal(r.sample.rows[0],a.rows[0]);assert.equal(r.sample.rows[0].values[1],2500.15);
});
test('roster removal and generation discontinuity happen at their timestamp, not arrival',()=>{
 const r=new Replica(schema,1);r.receive(frame(0),0);r.receive(frame(60,[point(100,'car',2)]),1);
 assert.equal(r.at(.5).rows[0].values[0],0);assert.equal(r.at(1).rows[0].values[0],1000);
 r.receive(frame(120,[]),2);assert.equal(r.at(1.5).rows.length,1);assert.equal(r.at(2).rows.length,0);
});
test('epoch fences reset packets and snapshots at paused ticks may repeat time',()=>{
 const r=new Replica(schema,1);r.receive(frame(3),.1);const paused=schema.capture(stamp(3,true,1,4),[point(.05)]);assert.equal(r.receive(paused,.2),true);
 r.reset(2);assert.equal(r.receive(frame(600),.3),false);assert.equal(r.inspect().frames,0);r.receive(schema.capture(stamp(0,true,2,1),[point(0)]),.4);assert.equal(r.present(.4).time,0);
});
test('history is bounded and replay never changes the live authority sequence',()=>{
 const r=new Replica(schema,1,8,8000);for(let i=0;i<80;i++)r.receive(frame(i),i/60);assert.equal(r.inspect().frames,8);const seq=r.latest().sequence;
 const a=structuredClone(r.at(1.23));for(let i=0;i<200;i++)r.at(1.2+i%7/60);assert.equal(r.latest().sequence,seq);assert.equal(a.time,1.23);
 assert.ok(r.inspect().payloadBytes<=8000);assert.ok(Object.isFrozen(r.exportRange(1.2,2)[0]));
});
test('clock learns a slow authority and same-wall-time batches stay finite',()=>{
 const c=new PlaybackClock(.1);for(let i=0;i<20;i++){c.observe(i*.025,i*.05);c.sample(i*.05);}assert.ok(c.rate<.7&&c.rate>.3);for(let i=0;i<10;i++)c.observe(.5+i*.01,1);assert.ok(Number.isFinite(c.sample(1.02)));
});
test('pause is permission checked at a tick boundary; resume creates no catch-up debt',()=>{
 let tick=0,time=0,steps=0;const world={get tick(){return tick;},get time(){return time;},step(dt){steps++;tick++;time+=dt;},capture:s=>schema.capture(s,[point(time)]),dump:()=>({tick,restorable:false})};
 const s=new AuthoritySession(world,schema,7,p=>p==='owner');
 assert.throws(()=>s.command('viewer',{action:'resume',epoch:7,expectedTick:0}));assert.equal(s.advance(8),0);
 s.command('owner',{action:'resume',epoch:7,expectedTick:0});s.advance(3);s.publish();s.command('owner',{action:'pause',epoch:7,expectedTick:0});
 for(let i=0;i<100;i++)s.advance(8);assert.equal(steps,3);
 assert.throws(()=>s.command('owner',{action:'step',epoch:7,expectedTick:2}));s.command('owner',{action:'step',epoch:7,expectedTick:3});assert.equal(steps,4);
 assert.equal(s.command('owner',{action:'dump',epoch:7,expectedTick:4}).dump.tick,4);
 s.command('owner',{action:'resume',epoch:7,expectedTick:4});s.advance();assert.equal(steps,5);assert.throws(()=>s.command('owner',{action:'pause',epoch:6,expectedTick:5}));
});
test('slow transport keeps one latest absolute state, not an unbounded queue',()=>{
 const q=new LatestStateOutbox();for(let i=0;i<10000;i++)q.offer(i);assert.equal(q.size,1);assert.equal(q.replaced,9999);assert.equal(q.take(),9999);assert.equal(q.size,0);
});
test('replica scene has no bodies, receives vertical pose and retains the same geometry across gaps',()=>{
 const authority=new Scene({version:1,entities:[{id:'ball',position:[0,200,0],mesh:{kind:'sphere',radius:.4},body:{mass:1}}]});
 const client=new Scene(presentationScene(authority)),view=new SceneReplicaView(client,['ball']),r=new Replica(sceneMotion,1);const e=client.entities.get('ball'),mesh=e.mesh;
 r.receive(captureSceneMotion(authority,stamp(0)),0);authority.step(1/60);r.receive(captureSceneMotion(authority,stamp(1)),1/60);
 for(let i=0;i<144;i++){view.apply(r.at(i/144/60));assert.equal(e.mesh,mesh);assert.ok(e.position[1]>199);}
 assert.equal(client.physics.bodies.size,0);assert.equal(client.physics.steps,0);assert.ok(client.renderMoverIds().has('ball'));assert.equal(buildRenderFrame(client).objects.length,1);
 r.receive(sceneMotion.capture(stamp(2),[]),.04);view.apply(r.at(.04));assert.equal(buildRenderFrame(client).objects.length,0);assert.equal(e.mesh,mesh);
 view.apply(r.at(0));assert.equal(buildRenderFrame(client).objects.length,1);assert.equal(e.position[1],200);
 view.dispose();assert.equal(client.renderMoverIds().size,0);authority.dispose();client.dispose();
});
test('100000 NPCs project as counts without identities and preserve separate height bands',()=>{
 function* positions(){for(let i=0;i<100000;i++)yield[i%4*128+1,i%2*32+1,0];}
 const f=populationCells(stamp(0),positions());assert.equal(f.rows.length,4);assert.equal(f.rows.reduce((n,r)=>n+r.values[3],0),100000);
 assert.ok(f.rows.some(r=>r.values[1]===40));assert.ok(f.rows.some(r=>r.values[1]===8));assert.ok(populationProjection.encode(f).length<1500);
});
test('projected LOD accounts for full height and FOV, not only horizontal distance',()=>{
 const near=projectedRadiusPx([0,0,0],1,[0,0,10],Math.PI/3,720),high=projectedRadiusPx([0,0,0],1,[0,1000,10],Math.PI/3,720);
 assert.ok(near>high*90);assert.equal(projectedRadiusPx([0,1000,0],1,[0,1000,10],Math.PI/3,720),near);
 assert.ok(projectedRadiusPx([0,0,0],1,[0,0,10],Math.PI/6,720)>near);assert.equal(projectedRadiusPx([0,0,0],1,[0,0,0],Math.PI/3,720),Infinity);
});
test('LOD keeps prepared geometry, rejects obsolete jobs and never owns height',()=>{
 const high={mesh:'fine'},low={mesh:'coarse'},lod=new PresentationLOD([100],high),pending=lod.want(70);assert.equal(lod.current(),high);
 assert.ok(lod.prepared(pending,low));assert.equal(lod.current(),low);for(const p of [98,101,105,95]){lod.want(p);assert.equal(lod.current(),low);}const stale=lod.want(140);lod.revise(1,{mesh:'damaged'});assert.equal(lod.prepared(stale,high),false);assert.equal(lod.current().mesh,'damaged');assert.ok(!('position' in lod));
});
