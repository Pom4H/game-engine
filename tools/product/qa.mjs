#!/usr/bin/env node
/** Product acceptance on actual Chrome, actual source workers and WebGPU.
 * Screenshots are produced by the application, never a reconstructed canvas. */
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
const chrome=process.env.CHROME_PATH??['/usr/bin/google-chrome','/usr/bin/chromium','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
if(!chrome)throw Error('Native CHROME_PATH required');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function port(){const s=createServer();await new Promise((ok,no)=>{s.once('error',no);s.listen(0,'127.0.0.1',ok);});const p=s.address().port;await new Promise(ok=>s.close(ok));return p;}
const http=await port(),debug=await port(),output=resolve('artifacts/product'),profile=await mkdtemp(join(tmpdir(),'product-qa-'));
await mkdir(output,{recursive:true});
let ws,stderr='',result={};const checks=[],exceptions=[],requests=[];
const server=spawn(process.execPath,['tools/docs/server.mjs'],{env:{...process.env,PORT:String(http),ARENA:'0',NETWORK_DEBUG:'0'},stdio:['ignore','pipe','pipe']});server.stderr.on('data',c=>stderr+=c);
const browser=spawn(chrome,['--headless=new','--no-sandbox','--no-first-run','--disable-background-networking','--disable-extensions','--enable-unsafe-webgpu','--enable-gpu',`--user-data-dir=${profile}`,`--remote-debugging-port=${debug}`,'about:blank'],{stdio:['ignore','pipe','pipe']});browser.stderr.on('data',c=>stderr+=c);
try{
 let page;for(let n=0;n<200;n++){try{page=(await(await fetch(`http://127.0.0.1:${debug}/json/list`)).json()).find(p=>p.type==='page');if(page&&(await fetch(`http://127.0.0.1:${http}/`)).ok)break;}catch{}await sleep(50);}if(!page)throw Error('Chrome startup failed');
 ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((ok,no)=>{ws.addEventListener('open',ok,{once:true});ws.addEventListener('error',no,{once:true});});
 let sequence=0;const waiting=new Map();
 ws.addEventListener('message',({data})=>{const m=JSON.parse(String(data));if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text);if(m.method==='Network.requestWillBeSent')requests.push(m.params.request.url);const p=waiting.get(m.id);if(p){waiting.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{waiting.delete(id);reject(Error('CDP timeout '+method));},60000);waiting.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
 const wait=async(expression,timeout=60000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await evaluate(expression))return;await sleep(60);}throw Error('Timed out '+expression+'\n'+await evaluate('document.querySelector(".wb-status")?.textContent+" / "+document.querySelector("#error")?.textContent'));};
 const screenshot=async name=>{const image=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(output,name+'.png'),Buffer.from(image.data,'base64'));};
 const click=async selector=>{const p=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);await send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',buttons:1,clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',buttons:0,clickCount:1});};
 const navigate=async path=>{await send('Page.navigate',{url:`http://127.0.0.1:${http}${path}`});await wait('document.readyState === "complete"');};
 await send('Runtime.enable');await send('Page.enable');await send('Network.enable');await send('Emulation.setDeviceMetricsOverride',{width:1440,height:960,deviceScaleFactor:1,mobile:false});
 await navigate('/');await wait('document.querySelectorAll(".module-card").length === 13');await screenshot('home');checks.push('root product and 13 module areas are built from the source catalogue');
 await navigate('/games/');await wait('document.querySelectorAll(".game-card").length === 3');await screenshot('games');
 requests.length=0;await navigate('/games/chess/');await wait('globalThis.__CHESS__?.game');
 assert.equal(await evaluate('__CHESS__.game.position.turn'),1);assert.equal(await evaluate('document.querySelectorAll("#board .cell").length'),64);
 await click('[data-square="e2"]');await click('[data-square="e4"]');assert.equal(await evaluate('__CHESS__.game.history[0].san'),'e4');assert.equal(await evaluate('__CHESS__.game.position.turn'),-1);
 assert.ok(!requests.some(url=>/\/engine\/(physics|render)\//.test(url)));checks.push('actual chess module graph has no physics/render import; pointer move follows chess rules');
 await screenshot('chess');await click('#source-toggle');await wait('!document.querySelector("#workbench").hidden');
 const original=await evaluate('__CHESS__.source');await evaluate('globalThis.__oldChess=__CHESS__.game');
 await evaluate(`(()=>{const e=document.querySelector('.wb-code textarea');e.value=${JSON.stringify(original)}+'\nexport default';e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await sleep(250);await click('.wb-head .primary');await wait('document.querySelector(".wb-status").dataset.error === "true"');assert.ok(await evaluate('__CHESS__.game===__oldChess'));checks.push('invalid source retains the running match');
 await evaluate(`(()=>{const e=document.querySelector('.wb-code textarea');e.value=${JSON.stringify(original)};e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await click('.wb-head .primary');await wait('__CHESS__.game !== __oldChess && !document.querySelector(".wb-head .primary").disabled');
 await evaluate(`(()=>{const f=document.querySelector('[data-key="historyLimit"] input');f.value='1024';f.dispatchEvent(new Event('change',{bubbles:true}));})()`);await wait('__CHESS__.source.includes("historyLimit: 1024")');await click('.wb-head .primary');await wait('__CHESS__.game.definition.historyLimit === 1024');checks.push('game parameter -> shared AST patch -> TypeScript -> checked module installation');await screenshot('chess-source');
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'));await screenshot('chess-mobile');checks.push('390px chess layout has no horizontal overflow');
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:960,deviceScaleFactor:1,mobile:false});await navigate('/games/car-ball/?mode=local');
 await wait('globalThis.__ARENA__?.workbench && __ARENA__.inspect().frames>5 && !document.querySelector(".wb-head .primary").disabled');
 let info=await evaluate('__ARENA__.inspect()');assert.equal(info.transport,'local');assert.equal(info.clientPhysicsSteps,0);assert.equal(info.clientBodies,0);assert.equal(info.renderer.backend,'webgpu');checks.push('explicit local worker authority and real passive WebGPU renderer; no network room required');await screenshot('arena-local');
 await evaluate('__ARENA__.request("trace",{enabled:true})');await sleep(350);const traced=await evaluate('__ARENA__.request("trace")');assert.ok(traced.trace.length>0&&traced.trace.length<=1024);assert.ok(traced.trace.every(row=>row.end>=row.start));checks.push('bounded execution trace is measured inside the authority worker');
 const epoch=info.epoch;await click('#source-toggle');await evaluate(`(()=>{const f=document.querySelector('[data-key="gravity"] input');f.value='5';f.dispatchEvent(new Event('change',{bubbles:true}));})()`);await wait('__ARENA__.workbench.source.includes("gravity: 5")');await click('.wb-head .primary');await wait(`__ARENA__.inspect().epoch > ${epoch} && !document.querySelector('.wb-head .primary').disabled`);
 assert.equal((await evaluate('__ARENA__.request("inspect")')).config.gravity,5);assert.equal((await evaluate('__ARENA__.request("inspect")')).paused,true);checks.push('arena DSL applies gravity at a new local epoch while editor keeps physics paused');await screenshot('arena-source');
 await click('#source-close');await wait('__ARENA__.replica.latest().tick > 240');
 const before=await evaluate('Array.from(__ARENA__.view.scene.entities.get("car:0/body").position)');
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'w',code:'KeyW',windowsVirtualKeyCode:87});await sleep(1200);await send('Input.dispatchKeyEvent',{type:'keyUp',key:'w',code:'KeyW',windowsVirtualKeyCode:87});
 const after=await evaluate('Array.from(__ARENA__.view.scene.entities.get("car:0/body").position)');assert.ok(Math.hypot(...after.map((n,i)=>n-before[i]))>.25);checks.push('native keyboard drives the existing vehicle solver through the local transport');
 assert.deepEqual(await evaluate('__ARENA__.renderer.inspect().errors'),[]);assert.deepEqual(exceptions,[]);
 result={success:true,checks,exceptions,traceRecords:traced.trace.length,client:await evaluate('__ARENA__.inspect()')};
}catch(error){result={success:false,checks,exceptions,error:String(error.stack??error)};process.exitCode=1;}
finally{await writeFile(join(output,'browser-report.json'),JSON.stringify(result,null,2));await writeFile(join(output,'browser-stderr.log'),stderr);ws?.close();server.kill();browser.kill();await sleep(300);await rm(profile,{recursive:true,force:true,maxRetries:8,retryDelay:200}).catch(()=>{});console.log(JSON.stringify(result,null,2));}
