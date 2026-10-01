import test from 'node:test';
import assert from 'node:assert/strict';
import {OpenWorld} from '../dist/games/thegame/world.js';
import {materializeCrowd} from '../dist/games/thegame/crowd.js';
import {populationCells} from '../dist/network/population.js';
import {ThegameAuthority} from '../dist/games/thegame/session.js';

test('ambient crowd exists without Meshwork and stays bounded',()=>{
 const world=new OpenWorld(29,32);
 const city=materializeCrowd(world,[],{x:-345,z:-66},120,24);
 const forest=materializeCrowd(world,[],{x:-1000,z:120},120,24);
 assert.ok(city.length>0);
 assert.ok(forest.length>0);
 assert.ok(city.length<=24&&forest.length<=24);
 assert.equal(new Set(city.map(person=>person.id)).size,city.length);
 world.dispose();
});

test('distributed counts refine density without changing stable cell identities',()=>{
 const world=new OpenWorld(29,32),self={x:0,z:0},tick=180;
 const fallback=materializeCrowd(world,[],self,tick,24);
 const positions=Array.from({length:20},(_,i)=>[8+(i%4),0,8+Math.floor(i/4)] as const);
 const frame=populationCells({epoch:1,sequence:1,tick:18,time:1.8,paused:false},positions,128,16);
 const refined=materializeCrowd(world,[frame],self,tick,24);
 const fallbackCenter=fallback.filter(person=>person.id.startsWith('crowd:0:0:')).map(person=>person.id);
 const refinedCenter=refined.filter(person=>person.id.startsWith('crowd:0:0:')).map(person=>person.id);
 assert.deepEqual(refinedCenter,fallbackCenter);
 for(const id of refinedCenter){
  const a=fallback.find(person=>person.id===id),b=refined.find(person=>person.id===id);
  assert.deepEqual(b,a);
 }
 world.dispose();
});

test('player snapshots always contain ambient residents and accept distributed population refinement',()=>{
 const game=new ThegameAuthority({},11),peer=game.join('p1');
 game.step();
 const local=game.snapshot(peer.id);
 assert.ok(local.frame.rows.some(row=>row.id.startsWith('crowd:')));
 const beforeIds=new Set(local.frame.rows.filter(row=>row.id.startsWith('crowd:')).map(row=>row.id));

 const positions=Array.from({length:20},(_,i)=>[-344+(i%4),0,-64+Math.floor(i/4)] as const);
 const population=populationCells({epoch:2,sequence:1,tick:10,time:1,paused:false},positions,128,16);
 game.step();
 const distributed=game.snapshot(peer.id,[population]);
 const crowd=distributed.frame.rows.filter(row=>row.id.startsWith('crowd:'));
 assert.ok(crowd.length>0);
 assert.ok(crowd.some(row=>beforeIds.has(row.id)));
 assert.ok(crowd.every(row=>row.values[6]===2));
 game.dispose();
});
