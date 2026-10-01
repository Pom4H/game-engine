import test from 'node:test';
import assert from 'node:assert/strict';
import {createThegameHost} from '../tools/thegame/host.mjs';
import {populationCells,populationProjection} from '../dist/network/population.js';
import {WORLD_REVISION} from '../dist/games/thegame/world.js';

const frame=populationCells(
 {epoch:2,sequence:1,tick:4,time:4,paused:false},
 [[0,0,0],[8,0,8],[300,0,300]],
 128,16,
);

test('thegame host shares latest distributed population without coupling player authority cadence',()=>{
 let now=0;
 const host=createThegameHost({},{
  now:()=>now,
  epoch:7,
  population:()=>[populationProjection.read(frame)],
 });
 const packets=[];
 const socket={send:text=>{packets.push(JSON.parse(text));return text.length;},close(){host.close(socket);}};
 host.open(socket);
 host.message(socket,JSON.stringify({type:'join',version:WORLD_REVISION,name:'Region test'}));
 for(let i=1;i<=6;i++){now=i*1000/60;host.advance(now);}
 const state=packets.find(packet=>packet.type==='state');
 assert.ok(state);
 assert.equal(state.population.length,1);
 assert.equal(state.population[0].rows.reduce((n,row)=>n+row.values[3],0),3);
 assert.ok(host.game.tick>=3);
 host.dispose();
});

test('broken population provider is isolated from the 60 Hz player authority',()=>{
 let now=0,calls=0;
 const host=createThegameHost({},{
  now:()=>now,
  epoch:8,
  population:()=>{calls++;throw new Error('meshwork offline');},
 });
 const packets=[];
 const socket={send:text=>{packets.push(JSON.parse(text));return text.length;},close(){host.close(socket);}};
 host.open(socket);
 host.message(socket,JSON.stringify({type:'join',version:WORLD_REVISION,name:'No mesh'}));
 for(let i=1;i<=12;i++){now=i*1000/60;host.advance(now);}
 assert.ok(host.game.tick>=9);
 assert.ok(calls>0);
 assert.ok(host.inspect().transport.populationErrors>0);
 assert.ok(packets.some(packet=>packet.type==='state'));
 host.dispose();
});
