import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,rm,access} from 'node:fs/promises';
import {spawn,execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {staticSite} from '../tools/site.mjs';

import {fileURLToPath} from 'node:url';
const cwd=fileURLToPath(new URL('..',import.meta.url));
async function listen(server){await new Promise((ok,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',ok);});return 'http://127.0.0.1:'+server.address().port;}
async function close(server){server.closeAllConnections();await new Promise(ok=>server.close(ok));}
async function childHost(file,env){
 const child=spawn(process.execPath,[file],{cwd,env:{...process.env,PORT:'0',ARENA:'0',NETWORK_DEBUG:'0',...env},stdio:['ignore','pipe','pipe']});
 let text='',errors='';child.stderr.on('data',c=>errors+=c);
 const url=await new Promise((ok,no)=>{
  const timer=setTimeout(()=>{child.kill();no(Error('Host timeout: '+errors));},10000);
  child.once('exit',code=>{clearTimeout(timer);no(Error('Host exited '+code+': '+errors));});
  child.stdout.on('data',c=>{text+=c;const match=text.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);ok(match[0]);}});
 });
 return{child,url,stop:()=>new Promise(ok=>{if(child.exitCode!==null)return ok();child.once('exit',ok);child.kill();})};
}

test('one built site serves games separately, with shared modules and no old arena mount',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'game-engine-site-'));
 try{
 execFileSync(process.execPath,['tools/docs/build.mjs'],{cwd,env:{...process.env,DOCS_OUT:directory}});
 const server=createServer(staticSite(directory,{connectOrigins:['https://localhost:4433']})),url=await listen(server);
 try{
  for(const path of ['/games/','/games/car-ball/','/docs/']){const r=await fetch(url+path);assert.equal(r.status,200,path);assert.match(r.headers.get('content-type'),/text\/html/);}
  for(const path of ['/games','/games/car-ball','/docs']){const r=await fetch(url+path+'?test=1',{redirect:'manual'});assert.equal(r.status,308);assert.equal(r.headers.get('location'),path+'/?test=1');}
  assert.match(await(await fetch(url+'/docs/')).text(),/\.\.\/games\/car-ball\//);
  assert.match(await(await fetch(url+'/games/')).text(),/\.\/car-ball\//);
  for(const path of ['/docs/arena.html','/docs/arena.mjs','/docs/arena.css','/docs/engine/index.js','/games/no-such-game/','/.git/config','/engine/%2e%2e%2fsite.mjs','/engine/%5c..%5csite.mjs','/shared/%00x','/serve.mjs'])assert.equal((await fetch(url+path)).status,404,path);
  await assert.rejects(access(join(directory,'docs/arena.html')));await assert.rejects(access(join(directory,'docs/engine')));
  assert.match((await fetch(url+'/docs/compiler-worker.js')).headers.get('content-security-policy'),/connect-src 'none'/);
  const gameCsp=(await fetch(url+'/games/car-ball/')).headers.get('content-security-policy');assert.doesNotMatch(gameCsp,/unsafe-eval/);assert.match(gameCsp,/https:\/\/localhost:4433/);
  assert.equal((await fetch(url+'/games/car-ball/',{method:'HEAD'})).status,200);assert.equal((await fetch(url+'/games/car-ball/',{method:'DELETE'})).status,405);
  // Follow actual module imports and worker URLs; the game must not depend on /docs assets.
  const pending=['/games/car-ball/app.mjs'],seen=new Set();
  while(pending.length){const path=pending.pop();if(seen.has(path))continue;seen.add(path);assert.ok(!path.startsWith('/docs/'),path);
   const r=await fetch(url+path);assert.equal(r.status,200,path);assert.match(r.headers.get('content-type'),/text\/javascript/);const source=await r.text();
   for(const [,target] of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(|\bnew URL\s*\()\s*['"]([^'"]+)['"]/g))if(target.startsWith('.'))pending.push(new URL(target,url+path).pathname);
  }
  assert.ok(seen.has('/shared/network-worker.js'));assert.ok(seen.has('/engine/examples/car-ball.js'));assert.ok(seen.has('/shared/recording-ui.mjs'));
  t.diagnostic(JSON.stringify({canonicalGame:'/games/car-ball/',uniqueGameModules:seen.size,gameImportsFromDocs:0}));
 }finally{await close(server);}
  const hosts=[];
  try{
   hosts.push(await childHost('tools/docs/server.mjs',{DOCS_OUT:directory,ARENA:'1',ARENA_TRANSPORT:'sse'}));
   hosts.push(await childHost(join(directory,'serve.mjs'),{}));
   assert.equal((await fetch(hosts[0].url+'/',{redirect:'manual'})).headers.get('location'),'/games/');
   assert.equal((await fetch(hosts[1].url+'/',{redirect:'manual'})).headers.get('location'),'/docs/');
   for(const path of ['/docs/','/games/','/games/car-ball/','/shared/network-worker.js']){
    const results=await Promise.all(hosts.map(async h=>{const r=await fetch(h.url+path);assert.equal(r.status,200,path);return r.text();}));assert.equal(results[0],results[1],path);
   }
  }finally{await Promise.all(hosts.map(h=>h.stop()));}
 }finally{await rm(directory,{recursive:true,force:true,maxRetries:3});}
});
