import test from 'node:test';
import assert from 'node:assert/strict';
import {
  locationAt,locationBounds,InterestPlanner,WorldRuntime,jsonColdCodec,CheckpointTimeline,
  ReplicationStream,ReplicationReceiver,InputCommandBuffer,AtmosphereField,createAirSample,
  Aerodynamics,AudioScene,colliderBounds,tyreContactForce,ParticleEmitter,InMemoryOwnership,WorldMailbox
} from '../dist/index.js';

test('world locations are stable across negative coordinates and interest drives residency',()=>{
  const a=locationAt(7,-1,-257);assert.equal(a.cellX,-1);assert.equal(a.cellZ,-2);assert.equal(locationBounds(a.id).id,a.id);
  const runtime=new WorldRuntime(jsonColdCodec(),{interest:{downgradeTicks:2}});
  runtime.upsert('near',{value:1});runtime.upsert('far',{value:2});
  let plan=runtime.plan(0,[{id:'near',x:0,z:0,cost:2},{id:'far',x:2000,z:0,cost:1}],[{x:0,z:0}],{maxJobs:2,maxCost:3});
  assert.equal(plan.interest.find(x=>x.id==='near').tier,'detailed');assert.equal(plan.interest.find(x=>x.id==='far').tier,'dormant');assert.equal(runtime.residency.isMaterialized('far'),false);
  plan=runtime.plan(1,[{id:'near',x:2000,z:0,cost:2},{id:'far',x:0,z:0,cost:1}],[{x:0,z:0}],{maxJobs:2,maxCost:3});
  assert.equal(plan.interest.find(x=>x.id==='far').tier,'detailed');assert.equal(runtime.residency.isMaterialized('far'),true);
});

test('ownership epochs fence stale messages',()=>{
  const ownership=new InMemoryOwnership(),a=ownership.acquire('loc:v1:1:0:0','a'),b=ownership.acquire('loc:v1:1:1:0','b');
  assert.ok(a&&b);const mailbox=new WorldMailbox();
  assert.equal(mailbox.enqueue({id:'m',source:a,target:b,tick:3,sequence:0,type:'transfer',payload:{x:1}},a,b),'accepted');
  assert.equal(mailbox.drain(b,2).length,0);assert.equal(mailbox.drain(b,3).length,1);
  const next=ownership.transfer(b,'c');assert.ok(next);assert.equal(ownership.accepts(b),false);
});

test('checkpoint timeline rewinds generic state without aliasing',()=>{
  const timeline=new CheckpointTimeline(2);const state={x:1,nested:{v:2}};timeline.capture(10,1,state);state.nested.v=9;timeline.capture(20,2,state);
  const old=timeline.atOrBefore(15);assert.deepEqual(old.state,{x:1,nested:{v:2}});timeline.capture(30,3,{x:3,nested:{v:3}});assert.equal(timeline.size,2);assert.equal(timeline.atOrBefore(10),undefined);
});

test('replication frames are transport agnostic and require an exact base tick',()=>{
  const tx=new ReplicationStream(),rx=new ReplicationReceiver();
  rx.apply(tx.frame(10,[{id:'a',revision:1,x:1}],true));
  let view=rx.apply(tx.frame(11,[{id:'a',revision:2,x:2},{id:'b',revision:1,x:3}]));
  assert.equal(view.get('a').x,2);assert.equal(view.size,2);
  assert.throws(()=>rx.apply({schemaVersion:1,tick:13,baseTick:9,full:false,changed:[],removed:[]}),/base/);
});

test('input reorder waits for a missing sequence then advances deterministically',()=>{
  const q=new InputCommandBuffer();assert.deepEqual(q.push([{commandSeq:4}],0).map(x=>x.commandSeq),[4]);assert.deepEqual(q.push([{commandSeq:6}],1),[]);assert.deepEqual(q.drain(100).map(x=>x.commandSeq),[6]);assert.equal(q.skipped,1);
});

test('atmosphere and aerodynamic surface derive force from relative air instead of aircraft identity',()=>{
  const field=new AtmosphereField(3,()=>({temperatureC:15,wind:[0,0],gust:0,humidity:.5})),air=field.sample([0,100,0],0,0,0,createAirSample());
  assert.ok(air.density>1&&air.density<1.3);
  const forces=[];const body={position:[0,0,0],linearVelocity:[30,0,0],angularVelocity:[0,0,0],
    worldPoint(local,out){out.splice(0,3,...local);return out;},worldDirection(local,out){out.splice(0,3,...local);return out;},
    pointVelocity(_point,out){out.splice(0,3,...this.linearVelocity);return out;},applyForce(force,point){forces.push({force:[...force],point:[...point]});}};
  const aero=new Aerodynamics([{id:'wing',center:[0,0,0],chord:[1,0,0],normal:[0,1,0],area:8,aspectRatio:6,incidence:.12}]);
  const telemetry=aero.solve(body,air);assert.ok(telemetry.force[1]>0);assert.equal(forces.length,1);
});

test('audio admission, collider boundary, tyre grip and particles stay bounded',()=>{
  const audio=new AudioScene({maxSources:1,maxCost:1}),frame=audio.select({position:[0,0,0]},[
    {id:'far',mode:'continuous',position:[30,0,0],energy:100,cost:1},
    {id:'critical',mode:'transient',position:[50,0,0],energy:1,cost:1,protected:true}
  ]);assert.equal(frame.admitted[0].id,'critical');
  assert.deepEqual(colliderBounds({kind:'capsule',radius:.5,halfHeight:1}),{min:[-.5,-1.5,-.5],max:[.5,1.5,.5]});
  const [fx,fy]=tyreContactForce({normalForce:4000,friction:1,nominalLoad:4000,longitudinalSlip:.2,lateralSlip:.1,longitudinalStiffness:9,lateralStiffness:7});assert.ok(Math.hypot(fx,fy)<=4000*1.08);
  const particles=new ParticleEmitter(1);assert.ok(particles.spawn({position:[0,1,0],velocity:[1,0,0],lifetime:1}));assert.equal(particles.spawn({position:[0,1,0],velocity:[0,0,0],lifetime:1}),undefined);particles.step(.1);assert.equal(particles.size,1);
});
