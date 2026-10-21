import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {LocationWorkerPool,SimulationPoolError} from '../dist/index.js';
const codec={
 validate:input=>{if(!Array.isArray(input.values)||!input.values.every(Number.isFinite))throw new TypeError('Finite values required');},
 pack:input=>({values:Float64Array.from(input.values),mode:input.mode??'normal'}),
 unpack:packed=>{if(!(packed instanceof Float64Array)||packed.length!==1)throw new TypeError('Malformed sum');return packed[0];},
 transferables:packed=>[packed.values.buffer],
};
const workerUrl=new URL('data:text/javascript,'+encodeURIComponent(`
 import {parentPort} from 'node:worker_threads';
 parentPort.on('message',({id,job})=>{
  const mode=job.input.mode;if(mode==='hang')return;if(mode==='crash')throw Error('Fixture worker crash');
  const token={...job.token};if(['locationId','ownerId'].includes(mode))token[mode]+=':stale';else if(['epoch','tick','revision'].includes(mode))token[mode]++;
  const output=new Float64Array(mode==='unpack'?[1,2]:[Array.from(job.input.values).reduce((a,b)=>a+b,0)]);
  parentPort.postMessage({id:mode==='requestId'?id+1:id,result:{token,output}},[output.buffer]);
 });
`));
function nodeWorker(url){
 const worker=new Worker(url),bridge={onmessage:null,onerror:null,onmessageerror:null,
  postMessage:(message,transfer)=>worker.postMessage(message,transfer),terminate:()=>worker.terminate(),
  addEventListener:(_type,listener)=>worker.on('exit',listener)};
 worker.on('message',data=>bridge.onmessage?.({data}));worker.on('error',error=>bridge.onerror?.({message:error.message,preventDefault(){}}));worker.on('messageerror',data=>bridge.onmessageerror?.({data}));return bridge;
}
const job=(id,values=[1,2,3],mode='normal',epoch=1)=>({token:{locationId:id,ownerId:'host',epoch,tick:2**40,revision:3},input:{values,mode}});
const options={workerUrl,workerFactory:nodeWorker,codec};

test('Engine executes an independent application codec in actual Node workers with copied tokens and transferable input/output',async()=>{
 const pool=new LocationWorkerPool({...options,workers:2});
 try{
  await assert.rejects(pool.submit({...job('invalid'),token:{...job('invalid').token,epoch:0}}),RangeError);
  await assert.rejects(pool.submit(job('invalid',[NaN])),TypeError);
  const source=job('a'),first=pool.submit(source),second=pool.submit(job('b',[11,31]));source.token.epoch=999;source.input.values[0]=999;
  const [a,b]=await Promise.all([first,second]);assert.equal(a.output,6);assert.equal(a.token.epoch,1);assert.equal(b.output,42);assert.equal(source.input.values.length,3);
  assert.equal(pool.stats.maxInFlight,2);assert.equal(pool.stats.completed,2);await pool.drain();assert.equal(pool.stats.pending,0);
 }finally{await pool.close();}
});

test('running and queued cancellation reject once, stale worker callbacks cannot satisfy a new epoch, and drain closes cleanly',async()=>{
 const created=[],factory=()=>{const worker={onmessage:null,onerror:null,onmessageerror:null,request:null,terminated:false,
  addEventListener(){},postMessage(message){this.request=message;},terminate(){this.terminated=true;},
  respond(){const r=this.request;this.onmessage?.({data:{id:r.id,result:{token:r.job.token,output:new Float64Array([Array.from(r.job.input.values).reduce((a,b)=>a+b,0)])}}});}};created.push(worker);return worker;};
 const pool=new LocationWorkerPool({...options,workers:1,maxQueued:1,workerFactory:factory});
 try{
  const first=pool.submit(job('a')),second=pool.submit(job('b')),cancelled=Promise.allSettled([first,second]);
  await assert.rejects(pool.submit(job('c')),error=>error instanceof SimulationPoolError&&error.code==='busy');await assert.rejects(pool.submit(job('b')),error=>error.code==='duplicate');
  assert.equal(pool.cancelLocation('b'),true);assert.equal(pool.cancelLocation('a'),true);assert.equal(pool.cancelLocation('a'),false);
  assert.ok((await cancelled).every(r=>r.status==='rejected'&&r.reason.code==='cancelled'));assert.equal(created[0].terminated,true);
  const next=pool.submit(job('a',[4,6],'normal',2)),source=job('b',[3,5]),queued=pool.submit(source);source.input.values[0]=500;
  created[0].respond();assert.equal(pool.stats.pending,2);assert.equal(pool.stats.completed,0);
  const closed=pool.close({drain:true});created[1].respond();created[1].respond();assert.equal((await next).token.epoch,2);assert.equal((await queued).output,8);await closed;
  assert.equal(pool.stats.cancelled,2);assert.equal(pool.stats.completed,2);assert.equal(pool.stats.pending,0);assert.equal(pool.stats.maxQueue,1);assert.equal(created[1].terminated,true);await assert.rejects(pool.submit(job('after')),error=>error.code==='closed');
 }finally{await pool.close();}
});

test('every fencing field, wrong response IDs, malformed results, worker crashes and hung jobs fail without retrying',async()=>{
 for(const mode of ['locationId','ownerId','epoch','tick','revision','requestId','unpack','crash','hang']){
  const pool=new LocationWorkerPool({...options,workers:1,timeoutMs:mode==='hang'?80:3000});
  try{await assert.rejects(pool.submit(job('a',[1],mode)),error=>error.code===(mode==='hang'?'timeout':'worker'));assert.equal(pool.stats.submitted,1);assert.equal(pool.stats.failed,1);assert.equal(pool.stats.completed,0);assert.equal(pool.stats.pending,0);await pool.drain();}
  finally{await pool.close();}
 }
});
