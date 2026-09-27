import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {debugNetworkHost} from '../tools/docs/network-host.mjs';
import {arenaProjection} from '../dist/examples/car-ball.js';
import {idleInput} from '../dist/vehicles/arcade.js';
import {Replica} from '../dist/network/index.js';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(predicate,timeout=12000){const end=Date.now()+timeout;while(Date.now()<end){if(predicate())return;await sleep(20);}throw Error('Timed out waiting for arena frames');}
const fields=Object.fromEntries(arenaProjection.layout.map(f=>[f.name,f.offset]));

test('one live authority accepts two drivers, streams real deformation, rejects spoofing and retains replay', {timeout:25000},async t=>{
 const host=debugNetworkHost({arena:true}),server=createServer(async(req,res)=>{if(!await host.handle(req,res))res.writeHead(404).end();});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.address().port}/arena-network/`,abort=new AbortController(),streams=[],timers=[];
 t.after(()=>{timers.forEach(clearInterval);abort.abort();host.dispose();server.closeAllConnections();server.close();});
 const send=async(action,token='',body={},headers={})=>{const r=await fetch(url+action,{method:'POST',headers:{'content-type':'application/json','x-debug-token':token,...headers},body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});return{status:r.status,data:await r.json()};};
 const joins=await Promise.all([0,1,2].map(()=>send('join')));assert.ok(joins.every(j=>j.status===200));const players=joins.map(j=>j.data).sort((a,b)=>a.seat-b.seat),spectator=players.shift(),[one,two]=players;
 assert.equal(spectator.seat,-1);assert.deepEqual([one.seat,two.seat],[0,1]);assert.notEqual(one.token,two.token);
 assert.equal((await send('input','bad')).status,403);assert.equal((await send('input',spectator.token,{epoch:one.epoch,sequence:1,controls:idleInput()})).status,400);
 assert.equal((await send('ping',one.token,{}, {origin:'https://foreign.invalid'})).status,400);
 assert.equal((await send('input',one.token,{epoch:one.epoch,sequence:1,controls:{...idleInput(),car1:[0,0,0]}})).status,400);
 const views=[one,two].map(p=>({replica:new Replica(arenaProjection,p.epoch,600),frames:new Map(),error:null}));
 for(let i=0;i<2;i++){
  streams.push((async()=>{const response=await fetch(url+'events',{headers:{'x-debug-token':[one,two][i].token},signal:abort.signal});assert.equal(response.status,200);
   const decoder=new TextDecoder();let pending='';for await(const chunk of response.body){pending+=decoder.decode(chunk,{stream:true});let end;while((end=pending.indexOf('\n\n'))>=0){const text=pending.slice(0,end);pending=pending.slice(end+2);if(!text.startsWith('data: '))continue;
    const frame=arenaProjection.decode(text.slice(6)),view=views[i];if(frame.epoch!==view.replica.inspect().epoch)view.replica.reset(frame.epoch);view.replica.receive(frame,performance.now()/1000);view.frames.set(frame.sequence,frame);
   }}
  })().catch(e=>{if(!abort.signal.aborted)views[i].error=e;}));
 }
 let seq=0,busy=false,lastInput;
 timers.push(setInterval(async()=>{if(busy)return;busy=true;try{lastInput=await send('input',one.token,{epoch:one.epoch,sequence:++seq,peer:two.token,seat:1,controls:{...idleInput(),throttle:1,boost:true}});await send('ping',two.token);}finally{busy=false;}},30));
 await wait(()=>views.every(v=>v.replica.latest()?.tick>=400));assert.ok(views.every(v=>!v.error));assert.equal(lastInput.status,200);
 timers.forEach(clearInterval);await wait(()=>!busy);
 const common=[...views[0].frames.keys()].filter(n=>views[1].frames.has(n));assert.ok(common.length>30);
 const captured=views[0].frames.get(common.at(-1));assert.deepEqual(captured,views[1].frames.get(common.at(-1)));
 const data=captured.rows[0].values;assert.ok(data[fields.car0]>-14||data[fields.score]>0);assert.equal(data[fields.ack+1],0);assert.ok(data[fields.ack]>0);
 // Node coordinates are genuinely on the wire and differ from a rigid translated sphere.
 let flex=0;for(const sequence of common){const v=views[0].frames.get(sequence).rows[0].values;const span=Math.hypot(...[0,1,2].map(k=>v[fields.nodes+k]-v[fields.nodes+3+k]));flex=Math.max(flex,Math.abs(span-2.9));}
 assert.ok(flex>.002);
 const replay=await send('replay',one.token,{epoch:one.epoch,from:0,to:captured.time});assert.equal(replay.status,200);assert.ok(replay.data.frames.length>30);
 const before=views[0].replica.latest().sequence;views[0].replica.at(1);assert.equal(views[0].replica.latest().sequence,before);
 const latest=captured.rows[0].values[fields.ack];assert.equal((await send('input',one.token,{epoch:one.epoch,sequence:latest,controls:idleInput()})).data.accepted,false);
 assert.equal((await send('restart',two.token,{epoch:one.epoch})).status,400);
 const reset=await send('restart',one.token,{epoch:one.epoch});assert.equal(reset.status,200);assert.notEqual(reset.data.epoch,one.epoch);
 assert.equal((await send('input',one.token,{epoch:one.epoch,sequence:++seq,controls:idleInput()})).status,400);
 assert.equal((await send('leave',two.token)).status,200);const replacement=await send('join');assert.equal(replacement.data.seat,1);assert.equal((await send('ping',two.token)).status,403);
 t.diagnostic(JSON.stringify({transport:'actual loopback HTTP/SSE',drivers:2,commonFrames:common.length,maxOppositeNodeSpanChange:flex,wireBytes:Buffer.byteLength(JSON.stringify(captured)),tick:captured.tick,restoredSolver:false}));
 abort.abort();await Promise.all(streams);
});
