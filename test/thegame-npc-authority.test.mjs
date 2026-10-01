import test from 'node:test';
import assert from 'node:assert/strict';
import {CHARACTER_TUNING,characterState} from '../dist/runtime/character-motor.js';
import {OpenWorld} from '../dist/games/thegame/world.js';
import {materializeCrowd} from '../dist/games/thegame/crowd.js';
import {NearbyNpcAuthority} from '../dist/games/thegame/npc-authority.js';
import {ThegameAuthority} from '../dist/games/thegame/session.js';

const distance=(a,b)=>Math.hypot(a.x-b.data.position[0],a.z-b.data.position[2]);

test('promotion keeps the exact ambient identity and starting pose',()=>{
 const world=new OpenWorld(29,32),state=characterState(-345,0,-66),npcs=new NearbyNpcAuthority(world,CHARACTER_TUNING);
 const candidates=materializeCrowd(world,[],state,0,24).filter(person=>distance(state,person)<=80);
 assert.ok(candidates.length>0);
 npcs.refresh([{id:'p1',state}],0);
 const rows=npcs.rowsAround(state,512,16);
 const promoted=candidates.find(person=>npcs.has(person.id));
 assert.ok(promoted);
 const row=rows.find(value=>value.id===promoted.id);
 assert.ok(row);
 assert.deepEqual(row.data.position,promoted.data.position);
 assert.equal(row.data.yaw,promoted.data.yaw);
 assert.equal(row.data.phase,promoted.data.phase);
 assert.equal(row.data.kind,1);
 npcs.dispose();world.dispose();
});

test('authoritative NPC advances at 60 Hz while preserving identity',()=>{
 const world=new OpenWorld(29,32),state=characterState(-345,0,-66),npcs=new NearbyNpcAuthority(world,CHARACTER_TUNING);
 npcs.refresh([{id:'p1',state}],0);
 const before=npcs.rowsAround(state,512,16).map(row=>({id:row.id,position:[...row.data.position]}));
 assert.ok(before.length>0);
 for(let tick=1;tick<=30;tick++)npcs.step(tick);
 const after=npcs.rowsAround(state,512,16);
 assert.deepEqual(after.map(row=>row.id),before.map(row=>row.id));
 assert.ok(after.some((row,index)=>Math.hypot(
  row.data.position[0]-before[index].position[0],
  row.data.position[2]-before[index].position[2],
 )>.01));
 npcs.dispose();world.dispose();
});

test('one refresh demotes distant ownership before promoting the new neighborhood',()=>{
 const world=new OpenWorld(29,32),state=characterState(-345,0,-66),npcs=new NearbyNpcAuthority(world,CHARACTER_TUNING);
 const player={id:'p1',state};
 npcs.refresh([player],0);
 const oldIds=npcs.rowsAround(state,512,16).map(row=>row.id);
 assert.ok(oldIds.length>0);

 state.x=-1000;state.z=120;
 npcs.refresh([player],12);
 assert.ok(oldIds.every(id=>!npcs.has(id)));
 assert.ok(npcs.size>0);
 assert.ok(npcs.rowsAround(state,512,16).every(row=>Math.hypot(row.data.position[0]-state.x,row.data.position[2]-state.z)<512));
 assert.ok(npcs.inspect().forcedDemotions>0);
 npcs.dispose();world.dispose();
});

test('NPC authority remains globally bounded with many players',()=>{
 const world=new OpenWorld(29,64),npcs=new NearbyNpcAuthority(world,CHARACTER_TUNING),players=[];
 for(let i=0;i<32;i++){
  const state=characterState(-345+(i%8)*8,0,-66+Math.floor(i/8)*8);
  players.push({id:'p'+i.toString(36),state});
 }
 npcs.refresh(players,0);
 assert.ok(npcs.size>0);
 assert.ok(npcs.size<=16);
 npcs.dispose();world.dispose();
});

test('Thegame snapshot has one row per identity across ambient and authoritative tiers',()=>{
 const game=new ThegameAuthority({},12),peer=game.join('p1');
 for(let i=0;i<2;i++)game.step();
 const snapshot=game.snapshot(peer.id);
 const ids=snapshot.frame.rows.map(row=>row.id);
 assert.equal(new Set(ids).size,ids.length);
 const authoritative=snapshot.frame.rows.filter(row=>row.id.startsWith('crowd:')&&row.values[6]===1);
 assert.ok(authoritative.length>0);
 assert.equal(game.inspect().npcs.active,authoritative.length);
 game.dispose();
});
