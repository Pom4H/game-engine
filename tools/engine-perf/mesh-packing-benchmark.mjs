#!/usr/bin/env node
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {resolve,join,relative,isAbsolute,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {benchmarkMeshPacking} from './mesh-packing-workload.mjs';
const args=process.argv.slice(2),option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
if(!args.includes('--before'))throw Error('Use --before saved-mesh-before.mjs [--browser] [--out DIRECTORY]');
const root=resolve(import.meta.dirname,'../..'),beforePath=resolve(option('--before')),afterPath=join(root,'dist/procedural/mesh.js'),output=resolve(option('--out',join(root,'artifacts/engine-perf/mesh-packing')));
const [beforeSource,afterSource,workload]=await Promise.all([readFile(beforePath,'utf8'),readFile(afterPath,'utf8'),readFile(join(import.meta.dirname,'mesh-packing-workload.mjs'),'utf8')]);
const sha=value=>createHash('sha256').update(value).digest('hex');let result;
if(!args.includes('--browser')){
 result=await benchmarkMeshPacking(await import(pathToFileURL(beforePath)),await import(pathToFileURL(afterPath)));result.runtime={node:process.version,platform:process.platform,arch:process.arch};
}else{
 const browser=process.env.CHROME_PATH??['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);if(!browser)throw Error('Set CHROME_PATH');
 const server=createServer((req,res)=>{const content={'/before.mjs':beforeSource,'/after.mjs':afterSource,'/workload.mjs':workload}[req.url];res.setHeader('content-type',content?'text/javascript':'text/html');res.end(content??'<!doctype html><title>Mesh conversion benchmark</title>');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const profile=await mkdtemp(join(tmpdir(),'engine-mesh-bench-'));
 const child=spawn(browser,['--headless=new','--no-first-run','--disable-background-networking','--disable-extensions','--remote-debugging-port=0','--user-data-dir='+profile,'http://127.0.0.1:'+server.address().port+'/'],{windowsHide:true,stdio:'ignore'});
 const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));let socket,serial=0;const pending=new Map();
 try{
  let port;for(let i=0;i<100;i++){try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);if(port)break;}catch{}await delay(100);}if(!port)throw Error('Browser startup timed out');
  const targets=await fetch('http://127.0.0.1:'+port+'/json/list').then(r=>r.json()),page=targets.find(t=>t.type==='page');socket=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  socket.addEventListener('message',e=>{const message=JSON.parse(e.data),p=pending.get(message.id);if(p){pending.delete(message.id);clearTimeout(p.timer);message.error?p.reject(Error(message.error.message)):p.resolve(message.result);}});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' timed out'));},120000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
  const version=await send('Browser.getVersion'),r=await send('Runtime.evaluate',{expression:"(async()=>{const [before,after,workload]=await Promise.all([import('/before.mjs'),import('/after.mjs'),import('/workload.mjs')]);return workload.benchmarkMeshPacking(before,after);})()",awaitPromise:true,returnByValue:true});
  if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);result=r.result.value;result.runtime=version;
  await send('Browser.close').catch(()=>{});
 }finally{
  socket?.close();for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Benchmark closed'));}pending.clear();server.close();
  if(child.exitCode===null){child.kill();await Promise.race([new Promise(resolve=>child.once('exit',resolve)),delay(2000)]);}
  const target=resolve(profile),within=relative(resolve(tmpdir()),target);if(within&&!within.startsWith('..')&&!isAbsolute(within)&&basename(target).startsWith('engine-mesh-bench-'))for(let i=0;i<10;i++){try{await rm(target,{recursive:true,force:true});break;}catch{await delay(100);}}
 }
}
result.sourceHashes={before:sha(beforeSource),after:sha(afterSource),workload:sha(workload)};await mkdir(output,{recursive:true});await writeFile(join(output,'report.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({byteIdentical:result.byteIdentical,runtime:result.runtime,cases:result.cases.map(({vertices,colors,beforeMs,afterMs,speedup})=>({vertices,colors,beforeMs,afterMs,speedup})),report:join(output,'report.json')},null,2));
