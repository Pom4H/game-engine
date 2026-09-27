import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {recordChromeTrace} from '../tools/chrome-trace.mjs';

async function fixture(t, {chunks=[{data:'{"traceEvents":[]}',eof:true}], loss=false, startError=false, noComplete=false}={}) {
  const dir=await mkdtemp(join(tmpdir(),'trace-unit-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const output=join(dir,'trace.json'),socket=new EventTarget(),calls=[];
  const send=async(method,params)=>{
    calls.push({method,params});
    if(method==='Tracing.start'&&startError)throw new Error('another tracing session');
    if(method==='Tracing.end'&&!noComplete)socket.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({method:'Tracing.tracingComplete',params:{stream:'trace-handle',dataLossOccurred:loss}})}));
    if(method==='IO.read')return chunks.shift();
    return {};
  };
  return {send,socket,output,calls};
}

test('native categories, streamed UTF-8/base64 chunks, result and stream cleanup',async t=>{
  const f=await fixture(t,{chunks:[{data:'{"traceEvents":',eof:false},{data:Buffer.from('[]}').toString('base64'),base64Encoded:true,eof:true}]});
  const r=await recordChromeTrace(f.send,f.socket,f.output,async()=>42);
  assert.deepEqual(JSON.parse(await readFile(f.output,'utf8')),{traceEvents:[]});assert.equal(r.result,42);assert.equal(r.bytes,18);
  const start=f.calls[0];assert.equal(start.method,'Tracing.start');assert.equal(start.params.transferMode,'ReturnAsStream');
  assert.ok(start.params.traceConfig.includedCategories.includes('disabled-by-default-v8.cpu_profiler'));
  assert.ok(start.params.traceConfig.includedCategories.includes('disabled-by-default-devtools.screenshot'));
  assert.equal(f.calls.filter(x=>x.method==='Tracing.end').length,1);assert.equal(f.calls.at(-1).method,'IO.close');
});
test('scenario error still ends trace and closes native stream',async t=>{
  const f=await fixture(t);
  await assert.rejects(recordChromeTrace(f.send,f.socket,f.output,async()=>{throw new Error('scenario');}),/scenario/);
  assert.equal(f.calls.at(-1).method,'IO.close');await assert.rejects(access(f.output));
});
test('overflow is explicit and is not exported as a complete capture',async t=>{
  const f=await fixture(t,{loss:true});await assert.rejects(recordChromeTrace(f.send,f.socket,f.output,async()=>{}),/overflow/);
  assert.equal(f.calls.at(-1).method,'IO.close');await assert.rejects(access(f.output));
});
test('output cap deletes partial files and closes the stream',async t=>{
  const f=await fixture(t);await assert.rejects(recordChromeTrace(f.send,f.socket,f.output,async()=>{},{maxBytes:4}),/limit/);
  assert.equal(f.calls.at(-1).method,'IO.close');await assert.rejects(access(f.output));
});
test('existing captures are never overwritten',async t=>{
  const f=await fixture(t);await writeFile(f.output,'previous');await assert.rejects(recordChromeTrace(f.send,f.socket,f.output,async()=>{}),{code:'EEXIST'});
  assert.equal(await readFile(f.output,'utf8'),'previous');assert.equal(f.calls.at(-1).method,'IO.close');
});
test('start failure never stops another tracing session',async t=>{
  const f=await fixture(t,{startError:true});await assert.rejects(recordChromeTrace(f.send,f.socket,f.output,async()=>assert.fail('must not run')),/another/);
  assert.deepEqual(f.calls.map(x=>x.method),['Tracing.start']);
});
test('missing completion is bounded',async t=>{
  const f=await fixture(t,{noComplete:true});await assert.rejects(recordChromeTrace(f.send,f.socket,f.output,async()=>{},{timeoutMs:20}),/timed out/);
  await assert.rejects(access(f.output));
});
test('invalid limits do not start a recorder',async t=>{
  const f=await fixture(t);await assert.rejects(recordChromeTrace(f.send,f.socket,f.output,async()=>{},{maxBytes:NaN}),/limits/);assert.equal(f.calls.length,0);
});
