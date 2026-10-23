import test from 'node:test';
import assert from 'node:assert/strict';
import {projection,scalar,vector3,Publication,LatestStateOutbox,Replica,AuthoritySession,PlaybackClock} from '../dist/network/index.js';

const schema=projection('test/v1',{position:vector3(),rotation:vector3('angle'),wear:scalar('step',0,1)});
const stamp=(tick,paused=false,epoch=1,sequence=tick)=>({epoch,sequence,tick,time:tick/60,paused});
const point=(t,id='entity',generation=0)=>({id,generation,data:{position:[10*t,2500+3*t,-2*t],rotation:[0,t,0],wear:.2,privateSecret:'NOT ON WIRE'}});
const frame=(tick,rows=[point(tick/60)])=>schema.capture(stamp(tick),rows);

test('projection exposes only declared bounded numeric fields',()=>{
 const f=frame(7),text=schema.encode(f);
 assert.ok(!text.includes('privateSecret'));
 assert.deepEqual(schema.decode(text),f);
 assert.equal(schema.decode(text).rows[0].values[1],2500+.35);
});

test('invalid frame is rejected atomically',()=>{
 const r=new Replica(schema,1);
 r.receive(frame(1),0);
 const bad=structuredClone(frame(2,[point(.1,'a'),point(.1,'b')]));
 bad.rows[1].values[1]=NaN;
 assert.throws(()=>r.receive(bad,.03));
 assert.equal(r.latest().tick,1);
 assert.equal(r.inspect().accepted,1);
});

test('one publication encoding is shared by a cohort',()=>{
 const before=schema.stats.encodes,p=new Publication(schema,frame(2));
 for(let i=0;i<16;i++)assert.equal(p.text(),p.text());
 assert.equal(schema.stats.encodes-before,1);
});

test('replica presents coherent time under jitter loss and reordering',()=>{
 const r=new Replica(schema,1,32,1e6,.12),deliveries=[];
 for(let tick=0;tick<600;tick+=3){
  if(tick%21===0&&tick>0)continue;
  deliveries.push({at:tick/60+.03+(tick%15===0?.10:(tick%9)*.003),f:frame(tick)});
 }
 deliveries.sort((a,b)=>a.at-b.at);
 let previous=-1,maxError=0,frames=0;
 for(let now=0;now<10;now+=1/144){
  while(deliveries.length&&deliveries[0].at<=now){const p=deliveries.shift();r.receive(p.f,now);}
  const s=r.present(now);if(!s.rows.length)continue;
  assert.ok(s.time>=previous);previous=s.time;
  const v=s.rows[0].values;
  maxError=Math.max(maxError,Math.abs(v[0]-s.time*10),Math.abs(v[1]-(2500+s.time*3)),Math.abs(v[2]+s.time*2));frames++;
 }
 assert.ok(frames>1300);
 assert.ok(maxError<1e-9);
 assert.ok(r.stats.stale>0);
 assert.equal(r.stats.allocations,1);
 assert.ok(r.inspect().frames<=32);
});

test('packet gaps hold last cause rather than extrapolating',()=>{
 const r=new Replica(schema,1);
 r.receive(frame(3),0);
 const a=r.present(.2);
 r.present(90);
 assert.equal(r.sample.time,.05);
 assert.equal(r.sample.rows.length,1);
 assert.equal(r.sample.rows[0],a.rows[0]);
});

test('epoch and sequence fences reject stale state',()=>{
 const r=new Replica(schema,1);
 r.receive(frame(3),.1);
 r.reset(2);
 assert.equal(r.receive(frame(600),.3),false);
 assert.equal(r.inspect().frames,0);
 r.receive(schema.capture(stamp(0,true,2,1),[point(0)]),.4);
 assert.equal(r.present(.4).time,0);
});

test('history and latest-state queues are hard bounded',()=>{
 const r=new Replica(schema,1,8,8000);
 for(let i=0;i<80;i++)r.receive(frame(i),i/60);
 assert.equal(r.inspect().frames,8);
 assert.ok(r.inspect().payloadBytes<=8000);
 const q=new LatestStateOutbox();
 for(let i=0;i<10000;i++)q.offer(i);
 assert.equal(q.size,1);
 assert.equal(q.replaced,9999);
 assert.equal(q.take(),9999);
});

test('playback clock learns authority rate without wall-time becoming simulation time',()=>{
 const c=new PlaybackClock(.1);
 for(let i=0;i<20;i++){c.observe(i*.025,i*.05);c.sample(i*.05);}
 assert.ok(c.rate<.7&&c.rate>.3);
 for(let i=0;i<10;i++)c.observe(.5+i*.01,1);
 assert.ok(Number.isFinite(c.sample(1.02)));
});

test('debug authority mutates only at authorized tick boundaries',()=>{
 let tick=0,time=0,steps=0;
 const world={get tick(){return tick;},get time(){return time;},step(dt){steps++;tick++;time+=dt;},capture:s=>schema.capture(s,[point(time)]),dump:()=>({tick,restorable:false})};
 const s=new AuthoritySession(world,schema,7,p=>p==='owner');
 assert.throws(()=>s.command('viewer',{action:'resume',epoch:7,expectedTick:0}));
 assert.equal(s.advance(8),0);
 s.command('owner',{action:'resume',epoch:7,expectedTick:0});
 s.advance(3);s.publish();
 s.command('owner',{action:'pause',epoch:7,expectedTick:0});
 for(let i=0;i<100;i++)s.advance(8);
 assert.equal(steps,3);
 assert.throws(()=>s.command('owner',{action:'step',epoch:7,expectedTick:2}));
 s.command('owner',{action:'step',epoch:7,expectedTick:3});
 assert.equal(steps,4);
 assert.equal(s.command('owner',{action:'dump',epoch:7,expectedTick:4}).dump.tick,4);
});
