import test from 'node:test';
import assert from 'node:assert/strict';
import {AuthorityShardLease} from '../dist/network/index.js';
import {populationProjection} from '../dist/network/population.js';
import {THEGAME_REGION_CAPABILITY,ThegameRegionAuthority,readThegameRegionSpec} from '../dist/games/thegame/region.js';

const spec={seed:29,x:-1,z:0,sizeM:1024,population:2048,cellM:128,stepSeconds:1};
const assignment=(tick=0,publication)=>({
 shard:{id:'region:-1:0',capability:THEGAME_REGION_CAPABILITY,input:spec,epoch:3,startTick:0},
 leaseId:'lease-a',leaseUntil:Date.now()+30000,resumeTick:tick,...(publication?{publication}:{}),
});

test('distant population is deterministic, reconstructable from tick and bounded into cells',()=>{
 const a=new ThegameRegionAuthority(spec,123),b=new ThegameRegionAuthority(spec,123);
 for(const i of [0,1,77,1024,2047])assert.deepEqual(a.residentPosition(i),b.residentPosition(i));
 const frame=a.capture({epoch:3,sequence:1,tick:123,time:123,paused:false});
 assert.equal(frame.schema,populationProjection.signature);
 assert.ok(frame.rows.length>0&&frame.rows.length<=128);
 const total=frame.rows.reduce((n,row)=>n+row.values[3],0);
 assert.equal(total,spec.population);
 assert.equal(a.dump().reconstructable,true);
 a.dispose();b.dispose();
});

test('region shard migrates to another worker from tick without resident heap',()=>{
 const firstWorld=new ThegameRegionAuthority(spec,0);
 const first=new AuthorityShardLease('worker-a',assignment(),firstWorld,populationProjection,{stepSeconds:1});
 first.advance(10);
 const published=first.publish();
 assert.equal(published.tick,10);
 assert.equal(published.output.sequence,1);

 const secondWorld=new ThegameRegionAuthority(spec,10);
 const second=new AuthorityShardLease('worker-b',{...assignment(10,published.output),leaseId:'lease-b'},secondWorld,populationProjection,{stepSeconds:1});
 second.advance();
 const next=second.publish();
 assert.equal(next.tick,11);
 assert.equal(next.output.sequence,2);
 assert.deepEqual(secondWorld.residentPosition(42),new ThegameRegionAuthority(spec,11).residentPosition(42));
 firstWorld.dispose();secondWorld.dispose();
});

test('region input is strict and capability is stable',()=>{
 assert.equal(THEGAME_REGION_CAPABILITY,'world.region.v1');
 assert.equal(readThegameRegionSpec(spec).population,2048);
 assert.throws(()=>readThegameRegionSpec({...spec,unknown:true}));
 assert.throws(()=>readThegameRegionSpec({...spec,sizeM:1000,cellM:128}));
});
