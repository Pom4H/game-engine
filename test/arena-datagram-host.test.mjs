import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {debugNetworkHost} from '../tools/docs/network-host.mjs';
import {arenaDatagram} from '../dist/examples/car-ball.js';
import {idleInput} from '../dist/vehicles/arcade.js';

test('datagram room keeps reliable bootstrap identical to wire state and denies TCP gameplay fallback',async t=>{
 const host=debugNetworkHost({arena:true,datagrams:true});
 const server=createServer(async(req,res)=>{if(!await host.handle(req,res))res.writeHead(404).end();});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>{host.dispose();server.closeAllConnections();server.close();});
 const url=`http://127.0.0.1:${server.address().port}/arena-network/`;
 const send=async(action,token='',body={})=>{const r=await fetch(url+action,{method:'POST',headers:{'content-type':'application/json','x-debug-token':token},body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});return{status:r.status,data:await r.json()};};
 const first=await send('join');assert.equal(first.status,200);
 const {token,epoch,frame}=first.data;
 assert.deepEqual(frame,arenaDatagram.decode(arenaDatagram.encode(frame)));
 assert.throws(()=>host.bindDatagrams('foreign'));
 const peer=host.bindDatagrams(token),frames=new Map();t.after(()=>peer.release());
 assert.throws(()=>host.bindDatagrams(token));
 peer.subscribe(bytes=>{const f=arenaDatagram.decode(bytes);frames.set(`${f.epoch}:${f.sequence}`,f);});
 const second=await send('join');assert.equal(second.data.seat,1);
 assert.deepEqual(second.data.frame,frames.get(`${second.data.epoch}:${second.data.frame.sequence}`));
 assert.equal((await send('input',token,{epoch,sequence:1,controls:idleInput()})).status,400);
 assert.equal((await fetch(url+'events',{headers:{'x-debug-token':token}})).status,400);
 const accepted=JSON.parse((await peer.input({epoch,sequence:1,controls:idleInput()})).text);assert.equal(accepted.accepted,true);
 const reset=await send('restart',token);assert.equal(reset.status,200);assert.ok(reset.data.epoch>epoch);
 assert.deepEqual(reset.data.frame,frames.get(`${reset.data.epoch}:${reset.data.frame.sequence}`));
 assert.equal(await peer.input({epoch,sequence:0x7fffffff,controls:idleInput()}),undefined);
 const current=JSON.parse((await peer.input({epoch:reset.data.epoch,sequence:1,controls:idleInput()})).text);assert.equal(current.accepted,true);
 peer.release();assert.equal((await send('ping',token)).status,403);
 await assert.rejects(()=>peer.input({epoch:reset.data.epoch,sequence:2,controls:idleInput()}));
});

// The host can admit a packet before learning that a queued restart changed the worker epoch.
// Validate again AT the authority; rejecting obsolete input must not kill the QUIC peer.
test('in-flight old input crossing restart is dropped at the authority without consuming the new sequence',async t=>{
 const {Worker}=await import('node:worker_threads');
 const worker=new Worker(new URL('../tools/docs/arena-authority.mjs',import.meta.url),{workerData:{epoch:100,datagrams:true}}),pending=new Map();let id=0;
 t.after(()=>worker.terminate());
 worker.on('message',m=>{const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error)):p.resolve(JSON.parse(m.text));});
 const ask=data=>new Promise((resolve,reject)=>{const serial=++id,timer=setTimeout(()=>{pending.delete(serial);reject(Error('Authority response timeout'));},5000);pending.set(serial,{resolve,reject,timer});worker.postMessage({...data,id:serial,peer:'owned-driver'});});
 const first=await ask({action:'join'});
 const restarting=ask({action:'restart'});
 const crossing=ask({action:'input',epoch:first.epoch,sequence:0x7fffffff,controls:idleInput()});
 const [next,discarded]=await Promise.all([restarting,crossing]);
 assert.equal(discarded.accepted,false);assert.equal(discarded.reason,'stale-epoch');assert.equal(discarded.sequence,0);assert.equal(discarded.epoch,next.epoch);
 const accepted=await ask({action:'input',epoch:next.epoch,sequence:1,controls:idleInput()});assert.equal(accepted.accepted,true);assert.equal(accepted.sequence,1);
});
