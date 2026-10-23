import test from 'node:test';
import assert from 'node:assert/strict';
import {CHARACTER_TUNING,characterState} from '../../../src/runtime/character-motor.ts';
import {OpenWorld} from '../game/world.ts';
import {materializeCrowd} from '../game/crowd.ts';
import {NearbyNpcAuthority} from '../game/npc-authority.ts';
import {ThegameAuthority} from '../game/session.ts';

function putPlayerOnAmbient(world,around,tick=0){
 const person=materializeCrowd(world,[],around,tick,24)[0];
 assert.ok(person,'expected an ambient resident in this area');
 const state=characterState(person.data.position[0],person.data.position[1],person.data.position[2],person.data.yaw);
 return{person,state};
}

test('promotion keeps the exact ambient identity and starting pose',()=>{
 const world=new OpenWorld(29,32),{person,state}=putPlayerOnAmbient(world,{x:-345,z:-66});
 const npcs=new NearbyNpcAuthority(world,CHARACTER_TUNING);
 npcs.refresh([{id:'p1',state}],0);
 assert.ok(npcs.has(person.id));
 const row=npcs.rowsAround(state,512,16).find(value=>value.id===person.id);
 assert.ok(row);
 assert.deepEqual(row.data.position,person.data.position);
 assert.equal(row.data.yaw,person.data.yaw);
 assert.equal(row.data.phase,person.data.phase);
 assert.equal(row.data.kind,1);
 npcs.dispose();world.dispose();
});

test('authoritative NPC advances at 60 Hz while preserving identity',()=>{
 const world=new OpenWorld(29,32),{person,state}=putPlayerOnAmbient(world,{x:-345,z:-66});
 const npcs=new NearbyNpcAuthority(world,CHARACTER_TUNING);
 npcs.refresh([{id:'p1',state}],0);
 const before=npcs.rowsAround(state,512,16).find(row=>row.id===person.id);
 assert.ok(before);
 for(let tick=1;tick<=30;tick++)npcs.step(tick);
 const after=npcs.rowsAround(state,512,16).find(row=>row.id===person.id);
 assert.ok(after);
 assert.equal(after.id,before.id);
 assert.ok(Math.hypot(
  after.data.position[0]-before.data.position[0],
  after.data.position[2]-before.data.position[2],
 )>.01);
 npcs.dispose();world.dispose();
});

test('one refresh demotes distant ownership before promoting the new neighborhood',()=>{
 const world=new OpenWorld(29,32),first=putPlayerOnAmbient(world,{x:-345,z:-66},0);
 const npcs=new NearbyNpcAuthority(world,CHARACTER_TUNING),player={id:'p1',state:first.state};
 npcs.refresh([player],0);
 assert.ok(npcs.has(first.person.id));

 const second=putPlayerOnAmbient(world,{x:-1000,z:120},12);
 Object.assign(player.state,second.state);
 npcs.refresh([player],12);
 assert.equal(npcs.has(first.person.id),false);
 assert.ok(npcs.has(second.person.id));
 assert.ok(npcs.inspect().forcedDemotions>0);
 npcs.dispose();world.dispose();
});

test('NPC authority remains globally bounded with many nearby ambient identities',()=>{
 const world=new OpenWorld(29,64),npcs=new NearbyNpcAuthority(world,CHARACTER_TUNING);
 const ambient=materializeCrowd(world,[],{x:-345,z:-66},0,24);
 assert.ok(ambient.length>0);
 const players=ambient.map((person,index)=>({
  id:'p'+index.toString(36),
  state:characterState(person.data.position[0],person.data.position[1],person.data.position[2],person.data.yaw),
 }));
 npcs.refresh(players,0);
 assert.ok(npcs.size>0);
 assert.ok(npcs.size<=16);
 npcs.dispose();world.dispose();
});

test('Thegame snapshot has one row per identity across ambient and authoritative tiers',()=>{
 const game=new ThegameAuthority({},12),peer=game.join('p1');
 const {person,state}=putPlayerOnAmbient(game.world,peer.state,0);
 Object.assign(peer.state,state);
 game.step();
 const snapshot=game.snapshot(peer.id);
 const ids=snapshot.frame.rows.map(row=>row.id);
 assert.equal(new Set(ids).size,ids.length);
 const row=snapshot.frame.rows.find(value=>value.id===person.id);
 assert.ok(row);
 assert.equal(row.values[6],1);
 assert.ok(game.inspect().npcs.active>0);
 game.dispose();
});
