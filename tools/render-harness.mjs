#!/usr/bin/env node
import {createServer} from 'node:http';
import {createServer as createTcpServer} from 'node:net';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,resolve,extname} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';

const [sceneFile,viewsFile,widthArg='1280',heightArg='720']=process.argv.slice(2);
if(!sceneFile||!viewsFile)throw new Error('usage: node tools/render-harness.mjs <scene.mjs> <views.mjs> [width] [height]');
const width=Number(widthArg),height=Number(heightArg);
if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1)throw new Error('invalid render size');
const scenePath=resolve(sceneFile);
const viewsPath=resolve(viewsFile);
const sceneUrl='/tools/'+scenePath.slice(resolve('tools').length+1).replaceAll('\\\\','/').replaceAll('\\','/');
const views=(await import(pathToFileURL(viewsPath).href)).default;
if(!Array.isArray(views)||views.length===0)throw new Error('views module must export a non-empty default array');

const dist=resolve('dist');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.css':'text/css'};
const html='<!doctype html><html><body style="margin:0;overflow:hidden;background:#111"><canvas id="c"></canvas><script type="module">'+
`const sceneUrl=${JSON.stringify(sceneUrl)};
try{
  const {default:scene}=await import(sceneUrl);
  const {BrowserRuntime}=await import('/dist/runtime/browser.js');
  const canvas=document.getElementById('c');
  canvas.width=innerWidth;
  canvas.height=innerHeight;
  const runtime=await BrowserRuntime.create(canvas,scene,{autoplay:false,audio:false,exposeBridge:true});
  globalThis.__RENDER_HARNESS__={runtime};
  document.documentElement.dataset.engineReady='1';
}catch(error){
  window.__ENGINE_ERROR__=error?.stack??String(error);
  throw error;
}`+
'</script></body></html>';

const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url??'/', 'http://127.0.0.1');
    if(url.pathname==='/'){
      res.writeHead(200,{'content-type':mime['.html'],'cache-control':'no-store'});res.end(html);return;
    }
    if(url.pathname.startsWith('/dist/')){
      const p=join(dist,url.pathname.slice(6));
      const data=await readFile(p);res.writeHead(200,{'content-type':mime[extname(p)]??'application/octet-stream','cache-control':'no-store'});res.end(data);return;
    }
    if(url.pathname.startsWith('/assets/')){
      const p=resolve('tools/promo/assets',url.pathname.slice(8));
      const data=await readFile(p);res.writeHead(200,{'content-type':url.pathname.endsWith('.png')?'image/png':'application/octet-stream','cache-control':'no-store'});res.end(data);return;
    }
    if(url.pathname.startsWith('/tools/')){
      const p=resolve('tools',url.pathname.slice(7));
      const data=await readFile(p);res.writeHead(200,{'content-type':mime[extname(p)]??'text/javascript; charset=utf-8','cache-control':'no-store'});res.end(data);return;
    }
    res.writeHead(404);res.end();
  }catch(error){res.writeHead(500);res.end(String(error))}
});
await new Promise((resolvePromise,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolvePromise)});
const port=server.address().port;
const chrome=process.env.CHROME_PATH??(['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser'].find(existsSync));
if(!chrome)throw new Error('Chrome/Chromium not found');

const profile=await mkdtemp(join(tmpdir(),'game-engine-chrome-'));
const debugServer=createTcpServer();
await new Promise((resolvePromise,reject)=>{debugServer.once('error',reject);debugServer.listen(0,'127.0.0.1',resolvePromise)});
const debugPort=debugServer.address().port;
debugServer.close();

const child=spawn(chrome,[
  '--headless=new','--no-sandbox','--no-first-run','--no-default-browser-check',
  '--disable-background-networking','--disable-extensions','--hide-scrollbars',
  '--enable-unsafe-webgpu','--enable-gpu',
  '--user-data-dir='+profile,
  '--remote-debugging-address=127.0.0.1','--remote-debugging-port='+debugPort,
  '--window-size='+width+','+height,'about:blank'
],{stdio:['ignore','pipe','pipe']});

let stderr='';
child.stderr.on('data',chunk=>{stderr+=chunk});
let ws;
let closed=false;
const cleanup=async()=>{
  if(closed)return;
  closed=true;
  try{ws?.close()}catch{}
  try{child.kill()}catch{}
  try{server.close()}catch{}
  try{await rm(profile,{recursive:true,force:true})}catch{}
};

try{
  let devtoolsReady=false;
  for(let i=0;i<200;i++){
    try{const response=await fetch('http://127.0.0.1:'+debugPort+'/json/version');if(response.ok){devtoolsReady=true;break}}catch{}
    await new Promise(resolvePromise=>setTimeout(resolvePromise,50));
  }
  if(!devtoolsReady)throw new Error('Chrome DevTools timeout: '+stderr.slice(-3000));

  let page;
  for(let i=0;i<200;i++){
    try{
      const list=await(await fetch('http://127.0.0.1:'+debugPort+'/json/list')).json();
      page=list.find(item=>item.type==='page'&&item.webSocketDebuggerUrl);
      if(page)break;
    }catch{}
    await new Promise(resolvePromise=>setTimeout(resolvePromise,50));
  }
  if(!page)throw new Error('Chrome page target unavailable');

  ws=new WebSocket(page.webSocketDebuggerUrl);
  let id=0;
  const pending=new Map();
  const browserErrors=[];
  ws.addEventListener('message',event=>{
    const message=JSON.parse(String(event.data));
    if(message.method==='Runtime.exceptionThrown')browserErrors.push({type:'exception',details:message.params.exceptionDetails});
    if(message.method==='Runtime.consoleAPICalled')browserErrors.push({type:'console',level:message.params.type,args:message.params.args?.map(arg=>arg.value??arg.description??arg.type)});
    if(message.method==='Log.entryAdded')browserErrors.push({type:'log',entry:message.params.entry});
    const pendingCall=pending.get(message.id);
    if(!pendingCall)return;
    pending.delete(message.id);
    message.error?pendingCall.reject(new Error(message.error.message)):pendingCall.resolve(message.result);
  });
  const send=(method,params={})=>new Promise((resolvePromise,reject)=>{
    const requestId=++id;
    pending.set(requestId,{resolve:resolvePromise,reject});
    ws.send(JSON.stringify({id:requestId,method,params}));
  });
  await new Promise((resolvePromise,reject)=>{ws.addEventListener('open',resolvePromise,{once:true});ws.addEventListener('error',reject,{once:true})});
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:'http://127.0.0.1:'+port+'/'});

  let ready=false,lastError='';
  for(let i=0;i<400;i++){
    try{
      const result=await send('Runtime.evaluate',{
        expression:'({ready:document.documentElement.dataset.engineReady===\'1\',bridge:!!window.__GAME_ENGINE__,error:window.__ENGINE_ERROR__||null})',
        returnByValue:true
      });
      const value=result.result?.value;
      if(value?.error)throw new Error(value.error);
      if(value?.ready&&value?.bridge){ready=true;break}
    }catch(error){lastError=String(error)}
    await new Promise(resolvePromise=>setTimeout(resolvePromise,50));
  }
  if(!ready){
    const result=await send('Runtime.evaluate',{
      expression:'({href:location.href,ready:document.documentElement.dataset.engineReady||null,bridge:!!window.__GAME_ENGINE__,error:window.__ENGINE_ERROR__||null,body:document.body?.innerText||\'\',html:document.documentElement.outerHTML.slice(0,5000)})',
      returnByValue:true
    });
    throw new Error('Render harness did not become ready: '+JSON.stringify({lastError,state:result.result?.value,browserErrors:browserErrors.slice(-20)}));
  }

  await send('Runtime.evaluate',{
    expression:'(async()=>{window.__GAME_ENGINE__.pause();window.__GAME_ENGINE__.seek(0);await window.__GAME_ENGINE__.flush();return window.__GAME_ENGINE__.inspect()})()',
    awaitPromise:true,returnByValue:true
  });

  await mkdir(resolve('artifacts'),{recursive:true});
  const results=[];
  for(const view of views){
    if(!view?.name||!view?.output||!view?.camera)throw new Error('Invalid view entry: '+JSON.stringify(view));
    const cameraJson=JSON.stringify(view.camera),time=Number(view.time??0);
    if(!Number.isFinite(time)||time<0)throw new Error('Invalid view time for '+view.name);
    const result=await send('Runtime.evaluate',{
      expression:`(async()=>{window.__GAME_ENGINE__.setCamera(${cameraJson});window.__GAME_ENGINE__.seek(${time});await window.__GAME_ENGINE__.flush();window.__GAME_ENGINE__.render();await window.__GAME_ENGINE__.flush();return window.__GAME_ENGINE__.inspect()})()`,
      awaitPromise:true,returnByValue:true
    });
    const inspection=result.result?.value;
    const renderer=inspection?.renderer;
    if((renderer?.drawCalls??0)<=0&&(renderer?.triangles??0)<=0)throw new Error('Renderer produced no geometry for '+view.name+': '+JSON.stringify(renderer));

    const shot=await send('Runtime.evaluate',{
      expression:'document.getElementById(\'c\').toDataURL(\'image/png\').split(\',\')[1]',
      returnByValue:true
    });
    const encoded=shot.result?.value;
    if(typeof encoded!=='string')throw new Error('Canvas capture returned non-string value for '+view.name);
    const output=resolve(view.output);
    await mkdir(join(output,'..'),{recursive:true});
    await writeFile(output,Buffer.from(encoded,'base64'));
    results.push({name:view.name,output,renderer,camera:view.camera});
    console.log(JSON.stringify(results.at(-1),null,2));
  }

  const hud={resolution:[width,height],views:results.map(({name,output,renderer,camera})=>({name,output,renderer,camera}))};
  await writeFile(resolve('artifacts/render-hud.json'),JSON.stringify(hud,null,2));
  console.log(JSON.stringify({views:results.length,outputs:results.map(result=>result.output),hud:'artifacts/render-hud.json'},null,2));
}finally{
  await cleanup();
}
