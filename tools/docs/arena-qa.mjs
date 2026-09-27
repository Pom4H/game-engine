#!/usr/bin/env node
/** Two real browser pages and the same engine renderer/authority. No synthetic screenshots. */
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
const output=resolve('artifacts/arena');await mkdir(output,{recursive:true});
const chrome=process.env.CHROME_PATH??['/usr/bin/google-chrome','/usr/bin/chromium','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
if(!chrome)throw Error('CHROME_PATH must identify native Chrome with WebGPU');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function port(){const s=createServer();await new Promise((ok,no)=>{s.once('error',no);s.listen(0,'127.0.0.1',ok);});const n=s.address().port;await new Promise(ok=>s.close(ok));return n;}
const http=await port(),debug=await port(),profile=await mkdtemp(join(tmpdir(),'arena-qa-')),connections=[],checks=[],exceptions=[];let stderr='',result={};
const server=spawn(process.execPath,['tools/docs/server.mjs'],{env:{...process.env,PORT:String(http),ARENA:'1'},stdio:['ignore','pipe','pipe']});server.stderr.on('data',c=>stderr+=c);
const browser=spawn(chrome,['--headless=new','--no-sandbox','--no-first-run','--disable-background-networking','--disable-extensions','--hide-scrollbars','--enable-unsafe-webgpu','--enable-gpu','--disable-background-timer-throttling','--disable-renderer-backgrounding',`--user-data-dir=${profile}`,`--remote-debugging-port=${debug}`,'about:blank'],{stdio:['ignore','pipe','pipe']});browser.stderr.on('data',c=>stderr+=c);
async function connect(page){const ws=new WebSocket(page.webSocketDebuggerUrl);connections.push(ws);await new Promise((ok,no)=>{ws.addEventListener('open',ok,{once:true});ws.addEventListener('error',no,{once:true});});let serial=0;const waiting=new Map();
 ws.addEventListener('message',({data})=>{const m=JSON.parse(String(data));if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text);const p=waiting.get(m.id);if(p){waiting.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{waiting.delete(id);reject(Error('CDP '+method+' timeout'));},60000);waiting.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
 const evalJS=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
 const wait=async(expression,timeout=60000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await evalJS(expression))return;await sleep(60);}throw Error('Timed out: '+expression+'; '+await evalJS('document.querySelector("#error")?.textContent'));};
 const capture=async name=>{await evalJS('__ARENA__.renderer.flush()');await sleep(100);const image=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(output,name+'.png'),Buffer.from(image.data,'base64'));};
 await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
 return{send,evalJS,wait,capture};
}
try{
 let first;for(let i=0;i<200;i++){try{const pages=await(await fetch(`http://127.0.0.1:${debug}/json/list`)).json();first=pages.find(p=>p.type==='page');if(first)break;}catch{}await sleep(50);}if(!first)throw Error('Chrome did not start');
 for(let i=0;i<100;i++){try{if((await fetch(`http://127.0.0.1:${http}/docs/arena.html`)).ok)break;}catch{}await sleep(50);}
 const p=await connect(first);await p.send('Page.navigate',{url:`http://127.0.0.1:${http}/docs/arena.html`});await p.wait('globalThis.__ARENA__?.replica?.latest() && __ARENA__.inspect().frames > 5');
 const second=await(await fetch(`http://127.0.0.1:${debug}/json/new?about:blank`,{method:'PUT'})).json(),q=await connect(second);
 await q.send('Page.navigate',{url:`http://127.0.0.1:${http}/docs/arena.html`});await q.wait('globalThis.__ARENA__?.replica?.latest() && __ARENA__.inspect().frames > 5');
 const pages=[p,q];const initial=await Promise.all(pages.map(c=>c.evalJS('__ARENA__.inspect()')));assert.deepEqual(initial.map(i=>i.seat),[0,1]);assert.ok(initial.every(i=>i.renderer.backend==='webgpu'&&i.clientPhysicsSteps===0&&i.clientBodies===0));checks.push('two distinct owned seats; actual WebGPU; zero client physics bodies/steps');await p.capture('arena-kickoff');
 await p.send('Page.bringToFront');await p.evalJS("document.querySelector('#restart').click()");await p.wait(`__ARENA__.inspect().epoch > ${initial[0].epoch}`);
 // Native input goes through ArcadeControls, the HTTP command route and the authority worker.
 await p.send('Input.dispatchKeyEvent',{type:'keyDown',key:'w',code:'KeyW',windowsVirtualKeyCode:87});
 await p.send('Input.dispatchMouseEvent',{type:'mousePressed',x:650,y:400,button:'left',buttons:1,clickCount:1});await sleep(3800);
 await p.send('Input.dispatchKeyEvent',{type:'keyUp',key:'w',code:'KeyW',windowsVirtualKeyCode:87});await p.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:650,y:400,button:'left',buttons:0,clickCount:1});
 await p.wait('__ARENA__.replica.latest().tick > 350');await q.wait('__ARENA__.replica.latest().tick > 350');
 const histories=await Promise.all(pages.map(c=>c.evalJS('__ARENA__.replica.exportRange(0,100)'))),common=histories[0].filter(a=>histories[1].some(b=>a.epoch===b.epoch&&a.sequence===b.sequence));assert.ok(common.length>15);
 for(const a of common){const b=histories[1].find(b=>a.sequence===b.sequence&&a.epoch===b.epoch);assert.deepEqual(a,b);}
 const layout=JSON.parse(common[0].schema)[1];let cursor=0;const offsets=Object.fromEntries(layout.map(([name,width])=>{const start=cursor;cursor+=width;return[name,start];}));
 let flex=0,motion=0,impact=common[0];for(const f of common){const v=f.rows[0].values,span=Math.hypot(...[0,1,2].map(k=>v[offsets.nodes+k]-v[offsets.nodes+3+k])),strain=Math.abs(span-2.9);if(strain>flex){flex=strain;impact=f;}motion=Math.max(motion,Math.abs(v[offsets.car0]+16));}
 assert.ok(motion>2);assert.ok(flex>.002);checks.push('real keyboard/mouse -> authenticated input -> wheel drive/boost -> deformable impact');checks.push('both browser decoders receive byte-identical authoritative pose and node frames');
 for(const c of pages)await c.evalJS(`__ARENA__.seek(${impact.time})`);await sleep(250);
 const nodes=await Promise.all(pages.map(c=>c.evalJS('__ARENA__.view.ballMesh.positions')));assert.deepEqual(nodes[0],nodes[1]);await p.capture('arena-soft-impact');await q.capture('arena-player-two');checks.push('same replay time skins to identical vertices without a client solver');
 // The common console and recorder from #27, not a duplicate UI or a generated clip.
 await p.send('Input.dispatchKeyEvent',{type:'keyDown',key:'ё',code:'Backquote',windowsVirtualKeyCode:192});await p.wait('!document.querySelector("#console").hidden');
 await p.evalJS(`document.querySelector('#recording-panel').hidden=false;__ARENA__.recording.command('start');`);await p.wait('__ARENA__.recording.model.images >= 2 && __ARENA__.recording.model.frames.length >= 8');await p.evalJS(`__ARENA__.recording.command('stop');document.querySelector('[data-do=previous]').click();`);
 const recording=await p.evalJS('({stats:__ARENA__.recording.model.inspect(),frames:__ARENA__.recording.model.frames.map(f=>({key:f.key,cpu:f.cpu.frame,gpu:f.gpu?.frame}))})');assert.ok(recording.frames.every(f=>f.gpu===undefined||f.cpu===f.gpu));checks.push('shared Ё console records real canvas images and frame-correlated CPU/GPU measurements');await p.capture('arena-recording');
 const tickBefore=await p.evalJS('__ARENA__.view.scene.tick');await p.evalJS(`document.querySelector('[data-time]').value='0';document.querySelector('[data-time]').dispatchEvent(new Event('input',{bubbles:true}));`);await sleep(150);assert.equal(await p.evalJS('__ARENA__.view.scene.tick'),tickBefore);checks.push('recorded filmstrip scrub does not seek the authoritative world or the replay view');
 await p.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await p.evalJS('__ARENA__.live()');
 await p.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});await p.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await p.capture('arena-mobile');
 const final=await Promise.all(pages.map(c=>c.evalJS('__ARENA__.inspect()')));assert.ok(final.every(i=>i.clientPhysicsSteps===0&&i.clientBodies===0&&i.renderer.errors.length===0));assert.deepEqual(exceptions,[]);
 result={success:true,checks,initial,final,commonFrames:common.length,maxOppositeNodeSpanChange:flex,impactTime:impact.time,recording:recording.stats,exceptions,userAgent:await p.evalJS('navigator.userAgent')};
}catch(error){result={success:false,checks,exceptions,error:String(error.stack??error)};process.exitCode=1;
 try{if(connections.length){const pages=await(await fetch(`http://127.0.0.1:${debug}/json/list`)).json();const p=await connect(pages.find(p=>p.type==='page'));await p.capture('arena-failure');result.errorPanel=await p.evalJS('document.querySelector("#error")?.textContent');}}catch{}
}finally{await writeFile(join(output,'browser-report.json'),JSON.stringify(result,null,2));await writeFile(join(output,'browser-stderr.log'),stderr);for(const ws of connections)ws.close();server.kill();browser.kill();await sleep(200);await rm(profile,{recursive:true,force:true,maxRetries:8,retryDelay:200}).catch(()=>{});console.log(JSON.stringify(result,null,2));}
