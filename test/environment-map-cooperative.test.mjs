import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {readFileSync} from 'node:fs';
import {bakeEnvironmentMap as original} from './fixtures/environment-map-before-cooperative.mjs';
import {bakeEnvironmentMap} from '../dist/render/environment-map.js';
import {EnvironmentBakeCursor} from '../dist/render/environment-map-bake.js';
import {createEnvironmentBakeWorkerDriver} from '../dist/render/environment-map-worker-driver.js';
import {EnvironmentMapWorker} from '../dist/render/environment-map-worker.js';
import {Scene} from '../dist/scene/scene.js';
import {buildSceneRadianceProbe} from '../dist/render/radiance.js';
import {V3} from '../dist/math.js';

const fixtures=[
 [{version:1,entities:[]},'b2b5976fdfd8c46618055fbab5a5d8ff545ac609a65f40169552430cb5d9eca3'],
 [{version:1,seed:9208765,entities:[{id:'wall',position:[3,2,0],mesh:{kind:'box',size:[4,4,1]},material:{color:[.6,.3,.2,1]}},{id:'lamp',position:[-2,3,5],mesh:{kind:'sphere',radius:1},material:{color:[1,.8,.2,1],emissive:[.6,.2,.1]}}],rendering:{sunDirection:[.4,.8,-.5],sunIntensity:1.7,skyColor:[.2,.3,.4]}},'f8f5c2f51479f20846564294bb3219c07ed843691c3667170232b7662354f091'],
];
function input(spec=fixtures[0][0]){const scene=new Scene(spec),s=scene.spec.rendering??{};return{radiance:buildSceneRadianceProbe(scene,[1,2,3],128,true),sun:V3.normalize(s.sunDirection??[-.55,.48,-.35]),sunColor:s.sunColor??[1,.87,.72],sky:s.skyColor??[.26,.34,.47],intensity:s.sunIntensity??scene.environment.sunlight*3};}
function digest(data){const h=createHash('sha256');h.update(data.irradiance);for(const mip of data.mips)h.update(mip);return h.digest('hex');}
function bytes(data){return new Uint8Array(data.buffer,data.byteOffset,data.byteLength);}
function same(actual,expected){assert.deepEqual(bytes(actual.irradiance),bytes(expected.irradiance));assert.equal(actual.mips.length,9);for(let i=0;i<9;i++)assert.deepEqual(bytes(actual.mips[i]),bytes(expected.mips[i]));}
function complete(request,credit){const cursor=new EnvironmentBakeCursor(request);let turns=0;while(!cursor.step(credit))turns++;assert.ok(turns>1);return cursor.data;}
function scheduler(){
 const queue=[],delivered=[];let closed=0;
 const port1={onmessage:null,postMessage(value){queue.push({port:port2,value});},close(){closed++;}},port2={onmessage:null,postMessage(value){queue.push({port:port1,value});},close(){closed++;}};
 return{channel:()=>({port1,port2}),queue,delivered,get closed(){return closed;},turn(){assert.equal(queue.length,1,'only one pending notification');const{port,value}=queue.shift();delivered.push(port===port1?1:2);port.onmessage?.({data:value});}};
}

test('independent oracle source changes require an explicit cooperative math review',()=>{
 const sources=[['environment-map.ts','0e2a1477fa242a89519e16a5ba53598a81e61a2e16565527da3c3a2d31e4b055'],['irradiance.ts','085cb552093119a3b3326e196c5e9353fa91d016ae427d2188b9ba3ea66db3c9'],['proxy-tiles.ts','d253712007fd4bd2ddec39deef93d92b62af7729dddc55c398c58428566f8a99']];
 for(const[name,expected]of sources)assert.equal(createHash('sha256').update(readFileSync(new URL('../src/render/'+name,import.meta.url))).digest('hex'),expected,'Update the frozen source, expected SHA and numerical oracle together after reviewing the cooperative counterpart');
});

test('one work credit bounds every SH, cold-cache, tile and pixel loop by instrumented numeric operations',()=>{
 const request=input(fixtures[1][0]),originalMath={pow:Math.pow,hypot:Math.hypot},originalVector={dot:V3.dot,normalize:V3.normalize};
 const per={pow:0,hypot:0,dot:0,normalize:0},maximum={...per},total={...per};let turns=0,result;
 Math.pow=(...args)=>{per.pow++;return originalMath.pow(...args);};Math.hypot=(...args)=>{per.hypot++;return originalMath.hypot(...args);};V3.dot=(...args)=>{per.dot++;return originalVector.dot(...args);};V3.normalize=(...args)=>{per.normalize++;return originalVector.normalize(...args);};
 try{
  const cursor=new EnvironmentBakeCursor(request);let done=false;
  while(!done){for(const name of Object.keys(per))per[name]=0;done=cursor.step(1);turns++;
   if(per.pow>1||per.dot>1||per.normalize>1||per.hypot>2)throw Error('Hidden whole numeric loop: '+JSON.stringify({turns,...per}));
   for(const name of Object.keys(per)){maximum[name]=Math.max(maximum[name],per[name]);total[name]+=per[name];}
  }
  result=cursor.data;
 }finally{Object.assign(Math,originalMath);Object.assign(V3,originalVector);}
 assert.ok(turns>524286,'the first cooperative bake must include every cold direction');assert.ok(total.normalize>=524286);assert.ok(total.dot>0);assert.ok(total.pow>1048572);same(result,original(request));
});

test('cold and warm cooperative output is exactly the frozen SH and all nine mip channels',()=>{
 for(const[spec,expected]of fixtures){const request=input(spec),frozen=original(request);assert.equal(digest(frozen),expected);assert.equal(digest(bakeEnvironmentMap(request)),expected);for(const credit of [1,4096])same(complete(request,credit),frozen);}
});
test('proxy order, NaN branch polarity, signed zeros, threshold edges and maximum canonical proxies preserve bytes',()=>{
 const basic=input(fixtures[1][0]);
 for(const patch of [
  {sun:[-0,-1,0],sky:[-0,.3,.4],intensity:0},
  {radiance:{...basic.radiance,proxies:Array.from({length:128},(_,i)=>({direction:V3.normalize([i%7-3,i%5-2,i%11-5]),color:[i/127,.2,.8-i/254],threshold:i%2?.99999:-.1,strength:i%3?.25:2}))}},
  {radiance:{...basic.radiance,proxies:[{direction:[0,0,0],color:[.2,.3,.4],threshold:NaN,strength:1}]}},
  {radiance:{...basic.radiance,proxies:[{direction:[0,0,0],color:[.2,.3,.4],threshold:NaN,strength:1},{direction:[0,1,0],color:[8,.2,.1],threshold:-.5,strength:3}]}},
 ]){const request={...basic,...patch};same(complete(request,4096),original(request));}
});
test('one-credit progress covers cold setup and SH without any early whole-map publication; cancel is terminal',()=>{
 const cursor=new EnvironmentBakeCursor(input(fixtures[1][0]));for(let i=0;i<64;i++){assert.equal(cursor.step(1),false);assert.throws(()=>cursor.data,/not complete/);}cursor.cancel();cursor.cancel();assert.equal(cursor.done,false);assert.throws(()=>cursor.step(1),/cancelled/);assert.throws(()=>cursor.data,/not complete/);
 for(const credit of [0,-1,1.5,4097,NaN])assert.throws(()=>new EnvironmentBakeCursor(input()).step(credit),/credit/);
});
test('one frozen-clock pump never expands its4096operation cap into4096batches',()=>{
 const s=scheduler(),request=input(),saved={pow:Math.pow,hypot:Math.hypot,dot:V3.dot,normalize:V3.normalize},calls={pow:0,hypot:0,dot:0,normalize:0};
 const driver=createEnvironmentBakeWorkerDriver({channel:s.channel,now:()=>0,publish(){throw Error('First4096operations cannot finish this full bake');},fail:error=>{throw error;}});driver.receive(request);
 Math.pow=(...args)=>{calls.pow++;return saved.pow(...args);};Math.hypot=(...args)=>{calls.hypot++;return saved.hypot(...args);};V3.dot=(...args)=>{calls.dot++;return saved.dot(...args);};V3.normalize=(...args)=>{calls.normalize++;return saved.normalize(...args);};
 try{s.turn();}finally{Math.pow=saved.pow;Math.hypot=saved.hypot;V3.dot=saved.dot;V3.normalize=saved.normalize;driver.dispose();}
 assert.ok(calls.pow<=4096);assert.ok(calls.dot<=4096);assert.ok(calls.normalize<=4096);assert.ok(calls.hypot<=8192);assert.ok(calls.pow+calls.normalize>0);
});
test('a frozen clock performs exactly eight bounded512unit steps before yielding the single notification',()=>{
 const s=scheduler(),credits=[],originalStep=EnvironmentBakeCursor.prototype.step;
 const driver=createEnvironmentBakeWorkerDriver({channel:s.channel,now:()=>0,publish(){throw Error('First4096operations cannot finish a full bake');},fail:error=>{throw error;}});
 EnvironmentBakeCursor.prototype.step=function(maxOps){credits.push(maxOps);return originalStep.call(this,maxOps);};
 try{driver.receive(input());s.turn();assert.deepEqual(credits,[512,512,512,512,512,512,512,512]);assert.equal(s.queue.length,1);assert.deepEqual(s.delivered,[1]);assert.equal(driver.inspect().active,true);}
 finally{EnvironmentBakeCursor.prototype.step=originalStep;driver.dispose();}
 assert.equal(s.channel().port1.onmessage,null);assert.equal(s.channel().port2.onmessage,null);s.turn();assert.equal(s.queue.length,0);
});
test('the secondary deadline and a second-clock failure are checked after one512unit chunk',()=>{
 const originalStep=EnvironmentBakeCursor.prototype.step;
 for(const failure of [false,true]){
  const s=scheduler(),credits=[],errors=[];let clocks=0;
  const driver=createEnvironmentBakeWorkerDriver({channel:s.channel,now(){if(++clocks===1)return 0;if(failure)throw Error('second clock failed');return 2;},publish(){throw Error('First512operations cannot finish a full bake');},fail:error=>errors.push(error)});
  EnvironmentBakeCursor.prototype.step=function(maxOps){credits.push(maxOps);return originalStep.call(this,maxOps);};
  try{driver.receive(input());s.turn();assert.deepEqual(credits,[512]);assert.equal(clocks,2);assert.equal(errors.length,failure?1:0);assert.equal(s.queue.length,failure?0:1);assert.equal(driver.inspect().disposed,failure);if(failure)assert.match(String(errors[0]),/second clock failed/);}
  finally{EnvironmentBakeCursor.prototype.step=originalStep;driver.dispose();}
  assert.equal(s.closed,2);assert.equal(s.channel().port1.onmessage,null);assert.equal(s.channel().port2.onmessage,null);
 }
});
test('task driver holds exactly one notification, publishes only complete data and keeps hard credit progress with a frozen clock',()=>{
 const s=scheduler(),published=[],errors=[],driver=createEnvironmentBakeWorkerDriver({channel:s.channel,now:()=>0,publish:data=>published.push(data),fail:error=>errors.push(error)});
 driver.receive(input());assert.deepEqual(driver.inspect(),{active:true,pending:true,disposed:false});assert.equal(published.length,0);s.turn();assert.equal(published.length,0);assert.equal(s.queue.length,1);
 let turns=1;while(!published.length){s.turn();turns++;assert.ok(turns<100000);}assert.ok(turns>2);assert.deepEqual(s.delivered.slice(0,4),[1,2,1,2]);assert.equal(s.queue.length,0);assert.equal(errors.length,0);assert.equal(digest(published[0]),fixtures[0][1]);driver.dispose();assert.equal(s.closed,2);assert.equal(s.channel().port1.onmessage,null);assert.equal(s.channel().port2.onmessage,null);
});
test('dispose and late task delivery cannot publish; each failure closes both ports and rejects further jobs',()=>{
 const s=scheduler(),published=[],errors=[],driver=createEnvironmentBakeWorkerDriver({channel:s.channel,now:()=>0,publish:data=>published.push(data),fail:error=>errors.push(error)});
 driver.receive(input());s.turn();driver.dispose();s.turn();assert.deepEqual(published,[]);assert.equal(s.closed,2);assert.throws(()=>driver.receive(input()),/disposed/);
 const q=scheduler(),broken=createEnvironmentBakeWorkerDriver({channel:q.channel,now:()=>0,publish(){throw Error('transfer rejected');},fail:error=>errors.push(error)});broken.receive(input());while(!errors.length)q.turn();assert.match(String(errors[0]),/transfer rejected/);assert.equal(q.closed,2);assert.equal(broken.inspect().active,false);
});
test('publish reentry starts exactly one next job; overlap refusal cannot replace the active job',()=>{
 const s=scheduler(),results=[],failures=[];let driver;
 driver=createEnvironmentBakeWorkerDriver({channel:s.channel,now:()=>0,publish(data){results.push(digest(data));if(results.length===1)driver.receive(input(fixtures[1][0]));},fail:error=>failures.push(error)});
 driver.receive(input());assert.throws(()=>driver.receive(input(fixtures[1][0])),/overlapping/);
 while(results.length<2)s.turn();assert.deepEqual(results,fixtures.map(x=>x[1]));assert.equal(failures.length,0);assert.equal(s.queue.length,0);driver.dispose();
});
test('clock and notification failures cancel ownership and cannot leave a runnable late job',()=>{
 const errors=[],s=scheduler(),driver=createEnvironmentBakeWorkerDriver({channel:s.channel,now(){throw Error('clock failed');},publish(){throw Error('must not publish');},fail:error=>errors.push(error)});
 driver.receive(input());s.turn();assert.match(String(errors[0]),/clock failed/);assert.deepEqual(driver.inspect(),{active:false,pending:false,disposed:true});assert.equal(s.closed,2);
 const q=scheduler(),pair=q.channel();pair.port2.postMessage=()=>{throw Error('notification failed');};const broken=createEnvironmentBakeWorkerDriver({channel:()=>pair,publish(){throw Error('must not publish');},fail:error=>errors.push(error)});broken.receive(input());assert.match(String(errors[1]),/notification failed/);assert.equal(q.closed,2);assert.equal(broken.inspect().active,false);assert.throws(()=>broken.receive(input()),/disposed/);
 const r=scheduler(),other=r.channel();other.port1.postMessage=()=>{throw Error('reverse notification failed');};const reverse=createEnvironmentBakeWorkerDriver({channel:()=>other,now:()=>0,publish(){throw Error('must not publish');},fail:error=>errors.push(error)});reverse.receive(input());r.turn();assert.match(String(errors[2]),/reverse notification failed/);assert.equal(r.closed,2);assert.equal(other.port1.onmessage,null);assert.equal(other.port2.onmessage,null);assert.equal(reverse.inspect().active,false);
});
test('worker scheduling preserves host active/latest/reset/idle/error contracts without touching the synchronous API',async()=>{
 const s=scheduler(),sent=[],published=[],errors=[];let adapter;
 const driver=createEnvironmentBakeWorkerDriver({channel:s.channel,now:()=>0,publish:data=>adapter.onmessage({data}),fail:error=>{errors.push(error);adapter.onerror({message:String(error),preventDefault(){}});}});
 adapter={onmessage:null,onerror:null,postMessage(request){sent.push(request);driver.receive(request);},terminate(){driver.dispose();}};
 const host=new EnvironmentMapWorker((key,data)=>published.push({key,data}),()=>adapter);
 host.request('a',input());host.request('b',input());host.request('c',input(fixtures[1][0]));let done=false;const idle=host.idle().then(()=>done=true);
 while(published.length<2)s.turn();await idle;assert.equal(done,true);assert.deepEqual(published.map(x=>x.key),['a','c']);assert.equal(sent.length,2);assert.equal(errors.length,0);assert.equal(digest(published[1].data),fixtures[1][1]);
 host.request('old',input());host.request('obsolete',input());host.reset();host.request('new',input());while(published.length<3)s.turn();assert.equal(published[2].key,'new');
 host.request('return',input());host.request('discard',input());host.request('return',input());while(published.length<4)s.turn();assert.equal(published[3].key,'return');await host.idle();host.dispose();assert.equal(s.closed,2);
});
function actualWorker(){
 const entry=new URL('../dist/render/environment-map.worker.js',import.meta.url).href;
 const worker=new Worker(`const {parentPort,MessageChannel:NativeChannel}=require('node:worker_threads');let worked=false;const heartbeat=new NativeChannel();heartbeat.port1.onmessage=()=>{parentPort.postMessage({type:'heartbeat'});heartbeat.port1.close();heartbeat.port2.close();};globalThis.MessageChannel=class{constructor(){const native=new NativeChannel();for(const key of ['port1','port2']){const original=native[key],port={onmessage:null,postMessage:value=>original.postMessage(value),close:()=>original.close()};this[key]=port;original.onmessage=event=>{port.onmessage?.(event);if(!worked){worked=true;parentPort.postMessage({type:'worked'});heartbeat.port2.postMessage(0);}};}}};globalThis.postMessage=(data,transfer)=>parentPort.postMessage({type:'result',data},transfer);import(${JSON.stringify(entry)}).then(()=>{parentPort.postMessage({type:'ready'});parentPort.on('message',data=>globalThis.onmessage({data}));});`,{eval:true});
 const events=[],waiters=[];const deliver=message=>{events.push(message);for(const waiter of [...waiters])if(waiter.type===message.type){clearTimeout(waiter.timer);waiters.splice(waiters.indexOf(waiter),1);waiter.resolve(message);}};
 worker.on('message',deliver);worker.on('error',error=>deliver({type:'error',error}));worker.on('exit',code=>deliver({type:'exit',code}));
 return{worker,events,wait(type){const existing=events.find(event=>event.type===type);return existing?Promise.resolve(existing):new Promise((resolve,reject)=>{const waiter={type,resolve,timer:setTimeout(()=>{waiters.splice(waiters.indexOf(waiter),1);reject(Error('Actual worker timed out waiting for '+type));},20000)};waiters.push(waiter);});}};
}
test('actual worker receives an independent local heartbeat after known bake work and before complete exact transfer',async()=>{
 const h=actualWorker();try{await h.wait('ready');h.worker.postMessage(input(fixtures[1][0]));const result=await h.wait('result'),workedIndex=h.events.findIndex(e=>e.type==='worked'),heartbeatIndex=h.events.findIndex(e=>e.type==='heartbeat'),resultIndex=h.events.findIndex(e=>e.type==='result');assert.ok(workedIndex>=0,'an actual bake pump must finish first');assert.ok(heartbeatIndex>=0,'independent local heartbeat must actually be received');assert.ok(workedIndex<heartbeatIndex&&heartbeatIndex<resultIndex);assert.equal(digest(result.data),fixtures[1][1]);assert.equal(h.events.some(e=>e.type==='error'),false);}finally{await h.worker.terminate();}
});
test('actual mid-bake termination cannot publish a late result; malformed input follows real worker error',async()=>{
 const h=actualWorker();try{await h.wait('ready');h.worker.postMessage(input(fixtures[1][0]));await h.wait('worked');assert.equal(h.events.some(e=>e.type==='result'),false);await h.worker.terminate();await h.wait('exit');assert.equal(h.events.some(e=>e.type==='result'),false);}finally{await h.worker.terminate();}
 const broken=actualWorker();try{await broken.wait('ready');broken.worker.postMessage({...input(),radiance:null});const event=await broken.wait('error');assert.match(String(event.error),/null|background/);await broken.wait('exit');assert.equal(broken.events.some(e=>e.type==='result'),false);}finally{await broken.worker.terminate();}
});
