import test from 'node:test';
import assert from 'node:assert/strict';
import {ThegameAuthority} from '../game/session.ts';
import {residentIntent,residentProfile,WORLD_START_HOUR} from '../game/resident-life.ts';
import {WORLD_REVISION} from '../game/world.ts';

test('resident life is deterministic and fresh world starts during meaningful daytime activity',()=>{
 const id='crowd:-3:-1:0',a=residentProfile(29,id),b=residentProfile(29,id);
 assert.deepEqual(a,b);
 assert.equal(WORLD_START_HOUR,8);
 const intent=residentIntent(29,id,0);
 assert.equal(intent.meaningful,true);
 assert.ok(['commute-work','work','breakfast'].includes(intent.activity));
 assert.ok(['shop','office','maintenance','delivery','hospitality','services'].includes(a.job));
});

test('new player possesses an existing resident instead of spawning a synthetic world identity',()=>{
 const game=new ThegameAuthority({},21),peer=game.join('p1','Roman');
 assert.match(peer.residentId,/^crowd:-?\d+:-?\d+:\d+$/);
 assert.equal(game.npcs.isPossessed(peer.residentId),true);
 const resident=game.resident(peer.id);
 assert.equal(resident.id,peer.residentId);
 assert.ok(resident.activity);
 assert.ok(resident.job);
 assert.equal(resident.possessions,1);
 game.dispose();
});

test('other players see the possessed resident identity, not the transport peer id',()=>{
 const game=new ThegameAuthority({},22),a=game.join('p1','A'),b=game.join('p2','B');
 game.step();
 const snapshot=game.snapshot(a.id);
 assert.ok(snapshot.frame.rows.some(row=>row.id===b.residentId));
 assert.ok(!snapshot.frame.rows.some(row=>row.id===b.id));
 assert.equal(new Set(snapshot.frame.rows.map(row=>row.id)).size,snapshot.frame.rows.length);
 game.dispose();
});

test('disconnect returns body to NPC authority and reconnect reclaims the same resident',()=>{
 const game=new ThegameAuthority({},23),first=game.join('p1','Roman');
 const residentId=first.residentId,saved={state:{...first.state},discovered:first.discovered,residentId};
 game.leave(first.id);
 assert.equal(game.npcs.isPossessed(residentId),false);
 assert.ok(game.npcs.has(residentId));
 for(let i=0;i<12;i++)game.step();
 const second=game.join('p1','Roman',saved);
 assert.equal(second.residentId,residentId);
 assert.equal(game.npcs.isPossessed(residentId),true);
 assert.ok(game.resident(second.id).possessions>=2);
 game.dispose();
});

