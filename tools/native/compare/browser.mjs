import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';

export async function startBrowser({width=1280,height=720,headful=false}={}){
 const executable=process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe';
 const profile=await mkdtemp(join(tmpdir(),'engine-native-compare-'));
 const args=[...(headful?[]:['--headless=new']),'--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-extensions',
  '--enable-unsafe-webgpu','--enable-gpu','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows','--disable-background-timer-throttling',
  '--remote-debugging-port=0',`--user-data-dir=${profile}`,`--window-size=${width},${height}`,'about:blank'];
 const child=spawn(executable,args,{windowsHide:true,stdio:['ignore','ignore','pipe']});
 let stderr='',socket,sequence=0;const pending=new Map(),listeners=[];
 child.stderr.on('data',v=>{stderr=(stderr+v).slice(-20000);});
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 let port;
 for(let i=0;i<200;i++){
  if(child.exitCode!==null)throw new Error('Chrome exited: '+stderr);
  try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);if(port)break;}catch{}
  await pause(50);
 }
 if(!port)throw new Error('Chrome startup timeout: '+stderr);
 const pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
 socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
 await new Promise((yes,no)=>{socket.addEventListener('open',yes,{once:true});socket.addEventListener('error',no,{once:true});});
 socket.addEventListener('message',event=>{
  const m=JSON.parse(String(event.data)),p=pending.get(m.id);
  if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}
  else for(const f of listeners)f(m);
 });
 const send=(method,params={})=>new Promise((yes,no)=>{
  const id=++sequence,timer=setTimeout(()=>{pending.delete(id);no(new Error('CDP timeout: '+method));},240000);
  pending.set(id,{resolve:yes,reject:no,timer});socket.send(JSON.stringify({id,method,params}));
 });
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result?.value;};
 await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
 return {send,evaluate,port,args,executable,onEvent:f=>listeners.push(f),
  async waitFor(expression,seconds=240){for(let i=0;i<seconds*4;i++){const r=await evaluate(expression);if(r)return r;await pause(250);}throw new Error('Page readiness timeout');},
  async screenshot(){return Buffer.from((await send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false})).data,'base64');},
  async close(){try{await send('Browser.close');}catch{}socket.close();for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('Browser closed'));}pending.clear();
   for(let i=0;i<30&&child.exitCode===null;i++)await pause(100);if(child.exitCode===null)child.kill();
   if(!resolve(profile).startsWith(resolve(tmpdir())+sep+'engine-native-compare-'))throw new Error('Unexpected browser profile path');
   await rm(profile,{recursive:true,force:true,maxRetries:8,retryDelay:100});
  }};
}
