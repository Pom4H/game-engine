// One real-engine browser check, not an appearance search or subjective score.
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {serveLookDev,revision} from './serve.mjs';
const root=new URL('../../',import.meta.url),out=new URL('_site/',root);
const candidates=[process.env.CHROME_BIN,process.env.CHROME_PATH,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',process.env.LOCALAPPDATA&&join(process.env.LOCALAPPDATA,'Google/Chrome/Application/chrome.exe'),'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/chromium','/usr/bin/google-chrome'].filter(Boolean);
const binary=candidates.find(path=>existsSync(path));if(!binary)throw new Error('Chrome not found; set CHROME_BIN');
const server=await serveLookDev(0),profile=await mkdtemp(join(tmpdir(),'look-dev-'));
const child=spawn(binary,['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-extensions','--enable-unsafe-webgpu',`--user-data-dir=${profile}`,'--remote-debugging-port=0','--window-size=1600,1000','about:blank'],{stdio:['ignore','ignore','pipe']});
let socket,sequence=0;const pending=new Map();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try{
 const endpoint=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(new Error(`Chrome startup: ${text.slice(-2000)}`)),20000);child.stderr.on('data',data=>{text+=data;const match=text.match(/DevTools listening on (ws:\/\/\S+)/);if(match){clearTimeout(timer);resolve(match[1]);}});child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Chrome exited: ${code}`));});});
 let page;for(let i=0;i<100&&!page;i++){page=(await(await fetch(`http://127.0.0.1:${new URL(endpoint).port}/json/list`)).json()).find(p=>p.type==='page');if(!page)await sleep(100);}assert.ok(page,'No browser page');
 socket=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
 socket.addEventListener('message',event=>{const message=JSON.parse(String(event.data)),entry=pending.get(message.id);if(!entry)return;pending.delete(message.id);clearTimeout(entry.timer);message.error?entry.reject(new Error(message.error.message)):entry.resolve(message.result);});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error(`CDP timeout: ${method}`));},120000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async code=>{const result=await send('Runtime.evaluate',{expression:`(async()=>{${code}})()`,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);return result.result?.value;};
 await send('Page.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});
 let ready=false;for(let i=0;i<300;i++){const state=await evaluate('return {ready:window.__LOOK_DEV__?.ready,error:window.__LOOK_DEV__?.error,status:document.getElementById("status")?.textContent};');if(state.error)throw new Error(state.error);if(state.ready){ready=true;break;}await sleep(200);}assert.ok(ready,'Look-dev did not become ready');
 const sample=async()=>await evaluate(`const blob=await window.__LOOK_DEV__.capture();const bitmap=await createImageBitmap(blob);const c=document.createElement('canvas');c.width=320;c.height=180;const ctx=c.getContext('2d');ctx.drawImage(bitmap,0,0,320,180);bitmap.close();const a=ctx.getImageData(0,0,320,180).data;let sum=0;for(let i=0;i<a.length;i+=4)sum+=a[i]+a[i+1]+a[i+2];return sum/(320*180*3);`);
 const initial=await evaluate('return window.__LOOK_DEV__.state();'),before=await sample();
 // Use the actual slider event, not a parallel rendering implementation.
 await evaluate('const input=document.querySelector("input[type=range][data-control=exposure]");input.value="0.45";input.dispatchEvent(new Event("input",{bubbles:true}));');
 const after=await sample(),changed=await evaluate('return window.__LOOK_DEV__.state();');
 assert.equal(changed.time,initial.time,'Appearance control advanced simulation');assert.deepEqual(changed.camera,initial.camera);assert.equal(changed.rendering.exposure,.45);assert.ok(before-after>2,`Exposure failed to change image luminance: ${before} -> ${after}`);
 await evaluate(`window.__LOOK_DEV__.setRendering({exposure:${initial.rendering.exposure}});await window.__LOOK_DEV__.pin();`);
 const inspection=await evaluate('return window.__LOOK_DEV__.stats();');assert.equal(inspection.renderer.backend,'webgpu');assert.deepEqual(inspection.renderer.errors,[]);
 const approved=await evaluate('return JSON.parse(localStorage.getItem("look-dev-approved-v1"));');assert.equal(approved.engineRevision,revision());assert.ok(approved.approvedAt);
 await evaluate('document.getElementById("compare").click();');assert.equal(await evaluate('return document.getElementById("baseline").hidden;'),false);
 await evaluate('document.getElementById("compare").click();');
 await mkdir(out,{recursive:true});await writeFile(new URL('look-dev-proof.png',out),Buffer.from((await send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false})).data,'base64'));
 const evidence={revision:revision(),backend:inspection.renderer.backend,exposure:{before,after,simulationTime:changed.time},renderer:inspection.renderer,subjectiveQuality:'NOT ASSESSED; user approval required'};
 await writeFile(new URL('look-dev-proof.json',out),JSON.stringify(evidence,null,2));console.log('LOOK_DEV_SMOKE',JSON.stringify(evidence));
}finally{
 socket?.close();for(const entry of pending.values())clearTimeout(entry.timer);child.kill();await Promise.race([once(child,'exit'),sleep(2000)]);server.closeAllConnections();await new Promise(r=>server.close(r));await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:300});
}
