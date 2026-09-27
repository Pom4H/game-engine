import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {debugNetworkHost} from '../tools/docs/network-host.mjs';
import {scene,box} from '../dist/dsl/index.js';
import {setTimeout as sleep} from 'node:timers/promises';

test('two actual HTTP/SSE clients share authority; denied control, pause, step, dump, replay and stale epochs',async t=>{
 const host=debugNetworkHost(),server=createServer(async(req,res)=>{if(!await host.handle(req,res)){res.writeHead(404);res.end();}});await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 const base=`http://127.0.0.1:${server.address().port}/debug-network/`,abort=new AbortController();
 t.after(()=>{abort.abort();host.dispose();server.closeAllConnections();server.close();});
 const {token}=await(await fetch(base+'config')).json();
 const post=async(action,body={},key=token)=>{const r=await fetch(base+action,{method:'POST',headers:{'content-type':'application/json','x-debug-token':key},body:JSON.stringify(body)});return{status:r.status,...await r.json()};};
 const program=scene({durationSeconds:20,entities:[box('ball',[.5,.5,.5],{position:[0,20,0],body:{mass:1}})]});
 const ready=await post('init',{program});assert.equal(ready.status,200);assert.equal(ready.paused,true);assert.equal(ready.scene.entities[0].body,undefined);
 const state={epoch:ready.epoch,expectedTick:0};assert.equal((await post('resume',state,'not-the-token')).status,403);
 const [a,b]=await Promise.all([fetch(base+'events',{signal:abort.signal}),fetch(base+'events',{signal:abort.signal})]);const readerA=a.body.getReader(),readerB=b.body.getReader();
 const [firstA,firstB]=await Promise.all([readerA.read(),readerB.read()]);assert.equal(new TextDecoder().decode(firstA.value),new TextDecoder().decode(firstB.value));
 await post('resume',state);await sleep(200);const paused=await post('pause',state);assert.ok(paused.tick>0);state.expectedTick=paused.tick;
 await sleep(120);assert.equal((await(await fetch(base+'status')).json()).tick,paused.tick);
 const step=await post('step',state);assert.equal(step.tick,paused.tick+1);state.expectedTick=step.tick;
 const dump=await post('dump',state);assert.equal(dump.dump.tick,step.tick);assert.equal(dump.dump.restorable,false);assert.ok(dump.dump.memory.heapUsed>0);
 const replay=await post('replay',{epoch:ready.epoch,from:0,to:step.time});assert.ok(replay.frames.length>1);assert.ok(replay.frames.some(f=>f.tick===step.tick));assert.equal((await post('dump',state)).tick,step.tick);
 assert.equal((await post('heap',state)).status,400);
 assert.equal((await post('edit',{...state,program:{kind:'nonsense'}})).status,400);assert.equal((await post('dump',state)).tick,step.tick);
 const edited=await post('edit',{...state,program:scene({durationSeconds:20,entities:[box('ball',[.5,.5,.5],{position:[0,30,0],body:{mass:2}})]})});assert.equal(edited.mode,'rebuild');assert.ok(edited.epoch>state.epoch);assert.equal(edited.tick,0);
 assert.equal((await post('resume',state)).status,400);assert.equal((await fetch(base+'config',{headers:{Origin:'https://untrusted.invalid'}})).status,400);
 await readerA.cancel();await readerB.cancel();
});
