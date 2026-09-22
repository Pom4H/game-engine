import test from 'node:test';
import assert from 'node:assert/strict';
import {CheckpointTimeline,ReplicationStream,ReplicationReceiver,InputCommandBuffer,RigidBody,colliderBounds} from '../dist/index.js';

test('checkpoint reads are detached and a failed restore keeps the previous history',()=>{
  const timeline=new CheckpointTimeline();
  const captured=timeline.capture(1,1,{nested:{value:1}});
  captured.state.nested.value=9;
  const latest=timeline.latest;latest.state.nested.value=8;
  assert.equal(timeline.atOrBefore(1).state.nested.value,1);
  const codec={encode:checkpoint=>new TextEncoder().encode(JSON.stringify(checkpoint)),decode:bytes=>JSON.parse(new TextDecoder().decode(bytes))};
  const invalid=[...timeline.encode(codec),codec.encode({version:1,tick:1,time:2,state:{nested:{value:2}}})];
  assert.throws(()=>timeline.restore(invalid,codec),/sequence/);
  assert.equal(timeline.latest.state.nested.value,1);
});

test('malformed replication and input batches do not mutate established state',()=>{
  const stream=new ReplicationStream(),receiver=new ReplicationReceiver();
  receiver.apply(stream.frame(1,[{id:'a',revision:2,value:1}],true));
  assert.throws(()=>stream.frame(2,[{id:'bad',revision:-1}],true),/revision/);
  const valid=stream.frame(2,[{id:'a',revision:2,value:1}]);
  assert.equal(valid.baseTick,1);
  assert.deepEqual(valid.changed,[]);
  assert.throws(()=>receiver.apply({schemaVersion:1,tick:2,baseTick:1,full:false,removed:[],changed:[
    {id:'a',revision:3,value:3},{id:'a',revision:4,value:4}
  ]}),/unique/);
  assert.equal(receiver.currentTick,1);
  assert.equal(receiver.snapshot().get('a').value,1);
  assert.throws(()=>receiver.apply({schemaVersion:1,tick:2,baseTick:null,full:true,removed:[],changed:[
    {id:'bad',revision:-1}
  ]}),/revision/);
  assert.equal(receiver.snapshot().get('a').value,1);
  const input=new InputCommandBuffer();
  assert.throws(()=>input.push([{commandSeq:65536}],0),/uint16/);
  assert.deepEqual(input.push([{commandSeq:3}],1).map(item=>item.commandSeq),[3]);
});

test('rigid bodies accept only validated narrow-phase members of the collider schema',()=>{
  assert.throws(()=>new RigidBody({id:'capsule',position:[0,0,0],shape:{kind:'capsule',radius:1,halfHeight:1}}),/sphere and box/);
  assert.throws(()=>new RigidBody({id:'bad-box',position:[0,0,0],shape:{kind:'box',half:[1,0,1]}}),/half extents/);
});

test('large world geometry computes bounds without expanding vertices or call arguments',()=>{
  const heights=new Array(512*512).fill(0);heights[1]=-4;heights[heights.length-1]=8;
  assert.deepEqual(colliderBounds({kind:'heightfield',width:512,depth:512,cellSize:2,heights}),
    {min:[0,-4,0],max:[1022,8,1022]});
  const positions=Array.from({length:6000},(_,i)=>i%3===0?i/3:i%3===1?-2:5);
  assert.deepEqual(colliderBounds({kind:'triangle-mesh',positions,indices:[0,1,2]}),
    {min:[0,-2,5],max:[1999,-2,5]});
});

