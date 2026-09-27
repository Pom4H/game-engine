#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
const output=resolve('artifacts/network');await mkdir(output,{recursive:true});
const chrome=process.env.CHROME_PATH??['/usr/bin/chromium','/usr/bin/google-chrome'].find(existsSync);if(!chrome)throw Error('Set CHROME_PATH');
async function port(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
const httpPort=await port(),debugPort=await port(),profile=await mkdtemp(join(tmpdir(),'net-qa-')),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const server=spawn(process.execPath,['tools/docs/server.mjs'],{env:{...process.env,NETWORK_DEBUG:'1',PORT:String(httpPort)},stdio:['ignore','pipe','pipe']});
const browser=spawn(chrome,['--headless=new','--no-sandbox','--no-first-run','--disable-background-networking','--disable-extensions','--no-proxy-server','--enable-unsafe-webgpu','--enable-gpu',...(process.env.WEBGPU_SOFTWARE==='1'?['--use-angle=swiftshader','--enable-unsafe-swiftshader']:[]),`--user-data-dir=${profile}`,`--remote-debugging-port=${debugPort}`,'about:blank'],{stdio:['ignore','pipe','pipe']});
let stderr='',ws,serial=0;const pending=new Map(),checks=[],errors=[];server.stderr.on('data',c=>stderr+=c);browser.stderr.on('data',c=>stderr+=c);
try{
 let target;for(let i=0;i<200;i++){try{target=(await(await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(x=>x.type==='page');if(target)break;}catch{}await sleep(50);}if(!target)throw Error('Chrome unavailable');
 ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((ok,no)=>{ws.addEventListener('open',ok,{once:true});ws.addEventListener('error',no,{once:true});});
 ws.addEventListener('message',({data})=>{const m=JSON.parse(data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text);const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},90000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result?.value;};
 const wait=async(expression,timeout=60000)=>{const until=Date.now()+timeout;while(Date.now()<until){if(await evaluate(expression))return;await sleep(80);}throw Error('Wait failed '+expression+'; '+await evaluate('JSON.stringify({error:document.querySelector("#error")?.textContent,url:location.href,body:document.body.innerText.slice(0,400)})'));};
 const shot=async name=>{await evaluate('__DSL_EDITOR__.runtime.flush()');const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(output,name+'.png'),Buffer.from(r.data,'base64'));};
 for(let i=0;i<200;i++){try{if((await fetch(`http://127.0.0.1:${httpPort}/docs/`)).ok)break;}catch{}if(i===199)throw Error('HTTP server unavailable');await sleep(50);}
 console.log('browser connected');await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:process.env.WEBGPU_SOFTWARE==='1'?800:1440,height:process.env.WEBGPU_SOFTWARE==='1'?500:900,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:`http://127.0.0.1:${httpPort}/docs/`});
 const settled='globalThis.__DSL_EDITOR__?.runtime && __DSL_EDITOR__.revision === __DSL_EDITOR__.appliedRevision && document.querySelector("#error").hidden';await wait(settled);console.log('editor ready');
 await evaluate('__DSL_EDITOR__.select("wings")');await wait(settled);console.log('connecting authority');await evaluate('__DSL_EDITOR__.network.connect()');console.log('authority connected');
 assert.equal(await evaluate('__DSL_EDITOR__.network.inspect().clientBodies'),0);checks.push('remote presentation owns zero physical bodies');
 const first=await evaluate('__DSL_EDITOR__.network.inspect()');await sleep(200);assert.equal((await evaluate('__DSL_EDITOR__.network.inspect()')).tick,first.tick);assert.ok((await evaluate('__DSL_EDITOR__.network.inspect()')).renderedFrames>first.renderedFrames);checks.push('paused server keeps the render loop alive');
 await evaluate('__DSL_EDITOR__.network.resumeServer()');await wait('__DSL_EDITOR__.network.tick>40');await evaluate('__DSL_EDITOR__.network.pauseServer()');
 const paused=await evaluate('__DSL_EDITOR__.network.inspect()');await sleep(150);assert.equal((await evaluate('__DSL_EDITOR__.network.inspect()')).tick,paused.tick);console.log('server paused');checks.push('pause acknowledgement is a stable authoritative tick');
 await evaluate('__DSL_EDITOR__.network.command("step")');assert.equal((await evaluate('__DSL_EDITOR__.network.inspect()')).tick,paused.tick+1);checks.push('server single-step integrates exactly once');
 const root=await evaluate(`(()=>{globalThis.__remoteRoot=__DSL_EDITOR__.runtime.scene.entities.get('car');return [...__remoteRoot.position]})()`);
 await evaluate(`__DSL_EDITOR__.setSource(__DSL_EDITOR__.source.replace('roughness: .24','roughness: .68'))`);await wait(settled);
 assert.equal(await evaluate('__DSL_EDITOR__.runtime.scene.entities.get("car")==__remoteRoot'),true);assert.deepEqual(await evaluate('[...__remoteRoot.position]'),root);checks.push('two-way paint edit on paused remote world preserves authoritative pose');
 const dump=await evaluate('__DSL_EDITOR__.network.command("dump")');assert.equal(dump.dump.tick,paused.tick+1);assert.equal(dump.dump.restorable,false);checks.push('bounded domain dump from the paused authority isolate');
 await evaluate('__DSL_EDITOR__.network.requestReplay()');await wait('__DSL_EDITOR__.network.clip !== null && __DSL_EDITOR__.network.mode === "replay"');await evaluate('__DSL_EDITOR__.network.seek(.2)');
 assert.equal((await evaluate('__DSL_EDITOR__.network.command("dump")')).tick,paused.tick+1);checks.push('server archive replay does not rewind or step the authoritative world');
 console.log('capturing replay');await shot('network-replay');console.log('replay captured');
 console.log('running flight');await evaluate('__DSL_EDITOR__.network.resumeServer()');await wait('__DSL_EDITOR__.network.tick>970',30000);await evaluate('__DSL_EDITOR__.network.pauseServer()');
 const airborne=await evaluate('({y:__DSL_EDITOR__.runtime.scene.entities.get("car").position[1],physics:__DSL_EDITOR__.runtime.scene.physics.steps,network:__DSL_EDITOR__.network.inspect(),renderer:__DSL_EDITOR__.runtime.renderer.inspect(),camera:__DSL_EDITOR__.runtime.scene.camera})');
 assert.ok(airborne.y>.9,'server-computed airborne height reached the renderer');assert.equal(airborne.physics,0);assert.ok(airborne.camera.target[1]>.8);checks.push('server flight height and camera follow retain vertical coordinates; no client physics');
 await shot('network-airborne');assert.equal(airborne.renderer.errors.length,0);assert.ok(airborne.renderer.environmentCache.jobs.completed>0);assert.equal(airborne.renderer.environmentCache.jobs.failed,false);assert.ok(airborne.renderer.environmentCache.jobs.active<=1&&airborne.renderer.environmentCache.jobs.pending<=1);checks.push('complete environment bakes finish off render thread with bounded worker queue');assert.equal(errors.length,0,errors.join('\n'));const report={checks,airborne,errors,software:process.env.WEBGPU_SOFTWARE==='1',notes:['Real local HTTP/SSE authority worker + real WebGPU renderer.','No WAN/Safari/FPS/whole-population-simulation or seamless terrain LOD claim.']};await writeFile(join(output,'browser-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){await writeFile(join(output,'browser-failure.json'),JSON.stringify({error:String(error),stack:error.stack,checks,errors,stderr:stderr.slice(-3500)},null,2));throw error;}
finally{for(const p of pending.values())clearTimeout(p.timer);ws?.close();browser.kill();server.kill();await sleep(300);await rm(profile,{recursive:true,force:true,maxRetries:3}).catch(()=>{});}
