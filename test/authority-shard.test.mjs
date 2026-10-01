import test from 'node:test';
import assert from 'node:assert/strict';
import {AuthorityShardLease,projection,scalar} from '../dist/network/index.js';

const schema=projection('meshwork-shard-test/v1',{value:scalar('step',0,1e9)});

function worldAt(startTick,value=startTick){
 let tick=startTick,time=startTick/60,current=value;
 return{
  get tick(){return tick;},
  get time(){return time;},
  step(dt){tick++;time+=dt;current++;},
  capture(at){return schema.capture(at,[{id:'region',data:{value:current}}]);},
  dump(){return{tick,time,current};},
 };
}
const assignment=(overrides={})=>({
 shard:{id:'region-0-0',epoch:7,startTick:20},
 leaseId:'lease-a',leaseUntil:Date.now()+30_000,resumeTick:20,
 ...overrides,
});

test('authority shard accepts only an exact restored epoch/tick fence',()=>{
 const world=worldAt(20);
 const lease=new AuthorityShardLease('worker-a',assignment(),world,schema);
 assert.equal(lease.heartbeat().tick,20);
 assert.throws(()=>new AuthorityShardLease('worker-a',assignment({resumeTick:21}),worldAt(20),schema),/does not match restored world tick/);
 assert.throws(()=>new AuthorityShardLease('worker-a',assignment({publication:{epoch:6,tick:20,sequence:1}}),worldAt(20),schema),/does not match resume fence/);
});

test('migration continues publication sequence from the previous bounded projection',()=>{
 const first=new AuthorityShardLease('worker-a',assignment(),worldAt(20),schema);
 assert.equal(first.advance(2),2);
 const publication=first.publish('snapshot-22');
 assert.equal(publication.tick,22);
 assert.equal(publication.output.sequence,1);
 assert.equal(publication.output.epoch,7);

 const secondAssignment=assignment({
  leaseId:'lease-b',
  resumeTick:22,
  publication:publication.output,
  snapshotHash:'snapshot-22',
 });
 const second=new AuthorityShardLease('worker-b',secondAssignment,worldAt(22,22),schema);
 second.advance();
 const next=second.publish('snapshot-23');
 assert.equal(next.tick,23);
 assert.equal(next.output.sequence,2);
 assert.equal(next.output.epoch,7);
});

test('revoke is fenced by shard lease and epoch and stops local authority',()=>{
 const lease=new AuthorityShardLease('worker-a',assignment(),worldAt(20),schema);
 assert.equal(lease.revoke({type:'shard.revoke',shardId:'region-0-0',leaseId:'old',epoch:7,reason:'stale'}),false);
 assert.equal(lease.revoked,false);
 assert.equal(lease.revoke({type:'shard.revoke',shardId:'region-0-0',leaseId:'lease-a',epoch:7,reason:'moved'}),true);
 assert.equal(lease.revoked,true);
 assert.throws(()=>lease.advance(),/revoked/);
});
