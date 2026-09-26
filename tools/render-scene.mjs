#!/usr/bin/env node
import {createServer} from 'node:http';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,resolve,extname} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';

const [sceneFile,widthArg='1280',heightArg='720',outArg='artifacts/render.png'] = process.argv.slice(2);
if(!sceneFile) throw new Error('usage: node tools/render-scene.mjs <scene.mjs> [width] [height] [out]');
const width=Number(widthArg),height=Number(heightArg),out=resolve(outArg);
const scenePath=resolve(sceneFile);
const sceneSource=await readFile(scenePath,'utf8');
const dist=resolve('dist');

const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.css':'text/css'};
const html='<!doctype html><html><body style="margin:0;overflow:hidden;background:#111"><canvas id="c"></canvas><script type="module">'+sceneSource+'\n</script></body></html>';

const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url??'/', 'http://127.0.0.1');
    if(url.pathname==='/'){
      res.writeHead(200,{'content-type':mime['.html']});res.end(html);return;
    }
    if(url.pathname.startsWith('/dist/')){
      const p=join(dist,url.pathname.slice(6));
      const data=await readFile(p);res.writeHead(200,{'content-type':mime[extname(p)]??'application/octet-stream'});res.end(data);return;
    }
    res.writeHead(404);res.end();
  }catch(e){res.writeHead(500);res.end(String(e))}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const port=server.address().port;
const chrome=process.env.CHROME_PATH??(['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser'].find(existsSync));
if(!chrome) throw new Error('Chrome/Chromium not found');
const profile=await mkdtemp(join(tmpdir(),'game-engine-chrome-'));
const child=spawn(chrome,['--headless=new','--no-sandbox','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-extensions','--hide-scrollbars','--enable-unsafe-webgpu','--use-angle=swiftshader','--user-data-dir='+profile,'--remote-debugging-port=0','--window-size='+width+','+height,'about:blank'],{stdio:['ignore','pipe','pipe']});
let stderr=''; child.stderr.on('data,c=>stderr+=c);
const wsUrl=await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('Chrome DevTools timeout: '+stderr.slice(-2000))),10000);const f=c=>{const m=stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(t);resolve(m[1])}};child.stderr.on('data',f);child.once('error',reject);});
const port2=Number(new URL(wsUrl).port);
let page;
for(let i=0;i<200;i++){try{const list=await (await fetch('http://127.0.0.1:'+port2+'/json/list')).json();page=list.find(x=>x.type==='page'&&x.webSocketDebuggerUrl);if(page)break}catch{}await new Promise(r=>setTimeout(r,50))}
if(!page) throw new Error('Chrome page target unavailable');
const ws=new WebSocket(page.webSocketDebuggerUrl);let id=0;const pending=new Map();
ws.on('message',raw=>{const m=JSON.parse(raw);const p=pending.get(m.id);if(!p)return;pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result)});
const send=(method,params={})=>new Promise((resolve,reject)=>{const i=++id;pending.set(i,{resolve,reject});ws.send(JSON.stringify({id:i,method,params}))});
await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject)});
await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
await send('Page.navigate',{url:'http://127.0.0.1:'+port+'/'});
let ready=false,last='';
for(let i=0;i<300;i++){try{const r=await send('Runtime.evaluate',{expression:'({ready:!!window.__GAME_ENGINE__,error:window.__ENGINE_ERROR__||null})',returnByValue:true});const v=r.result?.value;if(v?.error)throw new Error(v.error);if(v?.ready){ready=true;break}}catch(e){last=String(e)}await new Promise(r=>setTimeout(r,50))}
if(!ready) throw new Error('Engine did not become ready: '+last);
await send('Runtime.evaluate',{expression:'(async()=>{window.__GAME_ENGINE__.pause();window.__GAME_ENGINE__.seek(0);await window.__GAME_ENGINE__.flush();return window.__GAME_ENGINE__.inspect()})()',awaitPromise:true,returnByValue:true});
const inspection=await send('Runtime.evaluate',{expression:'window.__GAME_ENGINE__.inspect()',returnByValue:true});
const renderer=inspection.result?.value?.renderer;
if((renderer?.drawCalls??0)<=0&&(renderer?.triangles??0)<=0)throw new Error('Renderer produced no geometry: '+JSON.stringify(renderer));
const shot=await send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});
const {mkdir,writeFile}=await import('node:fs/promises');await mkdir(resolve('artifacts'),{recursive:true});await writeFile(out,Buffer.from(shot.data,'base64'));
console.log(JSON.stringify({out,width,height,renderer},null,2));
ws.close();child.kill();server.close();await rm(profile,{recursive:true,force:true});
