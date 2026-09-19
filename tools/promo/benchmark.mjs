// Reproducible native runtime throughput; GPU completion, not exported video FPS.
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {once} from 'node:events';
import {serveScene} from '../../dist/cli/server.js';
import spec from '../../tools/promo/street.scene.mjs';
const output=resolve(process.env.BENCH_OUT??'artifacts/performance/after.json');await mkdir(resolve(output,'..'),{recursive:true});
const root=resolve('.'),host=await serveScene(spec,{sceneDirectory:join(root,'tools/promo')}),profile=await mkdtemp(join(tmpdir(),'winter-fps-'));
const child=spawn(process.env.CHROME_PATH??(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':'google-chrome'),['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-extensions','--enable-unsafe-webgpu','--disable-background-timer-throttling','--disable-renderer-backgrounding',`--user-data-dir=${profile}`,'--remote-debugging-port=0','about:blank'],{stdio:['ignore','ignore','pipe']});
let socket;const pending=new Map();let seq=0;
try{
 const endpoint=await new Promise((r,j)=>{let s='';const timeout=setTimeout(()=>j(new Error(s)),20000);child.stderr.on('data',d=>{s+=d;const m=s.match(/DevTools listening on (ws:\/\/\S+)/);if(m){clearTimeout(timeout);r(m[1]);}});child.on('error',j);});
 const pages=await(await fetch(`http://127.0.0.1:${new URL(endpoint).port}/json/list`)).json();socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await once(socket,'open');
 socket.addEventListener('message',event=>{const m=JSON.parse(String(event.data)),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`CDP ${method} timed out`));},120000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async code=>{const r=await send('Runtime.evaluate',{expression:`(async()=>{${code}})()`,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result?.value;};
 await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:host.url+'&play=0'});
 for(let i=0;i<200;i++){if(await evaluate('return !!window.__GAME_ENGINE__'))break;const failure=await evaluate('return document.documentElement.dataset.engineError');if(failure)throw new Error(failure);await new Promise(r=>setTimeout(r,100));}
 // Fixed arrival camera keeps benchmark comparisons independent of promo captures.
 const shot={camera:[-21.51,1.6320200678244328,6.16],target:[-15.46,1.3620200678244327,3.795]};
 await evaluate(`window.__GAME_ENGINE__.seek(4);window.__GAME_ENGINE__.setCamera(${JSON.stringify({position:shot.camera,target:shot.target,fov:46,focusDistance:20,aperture:0})});await window.__GAME_ENGINE__.flush();
 const {WebGPURenderer}=await import('/dist/render/webgpu.js');const {Scene}=await import('/dist/scene/scene.js');
 const original=WebGPURenderer.prototype.render,step=Scene.prototype.step;
 window.bench={active:false,frames:[],completions:[],cpu:[],simCpu:[],pending:[]};
 WebGPURenderer.prototype.render=function(...args){const b=window.bench,t=performance.now();const result=original.apply(this,args);if(b.active){b.frames.push(t);b.cpu.push(performance.now()-t);b.pending.push(this.flush().then(()=>b.completions.push(performance.now())));}return result;};
 Scene.prototype.step=function(...args){const t=performance.now();const result=step.apply(this,args);if(window.bench.active)window.bench.simCpu.push(performance.now()-t);return result;};
 return true;`);
 const version=await send('Browser.getVersion');const environment=await evaluate(`const a=await navigator.gpu.requestAdapter();return {userAgent:navigator.userAgent,visibility:document.visibilityState,devicePixelRatio,adapter:{vendor:a.info.vendor,architecture:a.info.architecture,device:a.info.device,description:a.info.description,isFallbackAdapter:a.info.isFallbackAdapter??a.isFallbackAdapter},audio:window.__GAME_ENGINE__.inspect().audio};`);
 const results=[];
 for(const [label,width,height] of [['1080p-1',1920,1080],['1080p-2',1920,1080],['720p',1280,720]]){
  await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
  const r=await evaluate(`const bridge=window.__GAME_ENGINE__,b=window.bench;bridge.seek(4);await bridge.flush();bridge.resume();await new Promise(r=>setTimeout(r,3000));bridge.pause();await bridge.flush();
  b.frames=[];b.cpu=[];b.completions=[];b.simCpu=[];b.pending=[];const worldStart=bridge.inspect().time;b.start=performance.now();b.active=true;bridge.resume();await new Promise(r=>setTimeout(r,10000));bridge.pause();b.active=false;const stop=performance.now();const worldEnd=bridge.inspect().time;await Promise.all(b.pending);const drained=performance.now();
  const intervals=b.frames.slice(1).map((t,i)=>t-b.frames[i]),percentile=(values,p)=>{const s=[...values].sort((a,b)=>a-b);return s[Math.min(s.length-1,Math.floor(s.length*p))]??0;},mean=a=>a.reduce((s,v)=>s+v,0)/Math.max(1,a.length);
  return {wallSeconds:(stop-b.start)/1000,drainedSeconds:(drained-b.start)/1000,renderedFrames:b.frames.length,submittedFps:b.frames.length*1000/(stop-b.start),completedWithinWindow:b.completions.filter(t=>t<=stop).length,completedFps:b.frames.length*1000/(Math.max(stop,...b.completions)-b.start),medianFrameMs:percentile(intervals,.5),p95FrameMs:percentile(intervals,.95),meanRenderCpuMs:mean(b.cpu),meanSimulationTickCpuMs:mean(b.simCpu),simulationTicks:b.simCpu.length,simulatedSeconds:worldEnd-worldStart,simulationToWallRatio:(worldEnd-worldStart)*1000/(stop-b.start),renderer:bridge.inspect().renderer};`);
  results.push({label,width,height,...r});console.log(JSON.stringify(results.at(-1)));
 }
 const report={measuredAt:new Date().toISOString(),method:'Production BrowserRuntime autoplay; 3 s warm-up and 10 s samples; no screenshots or video encoding; render submissions and GPU queue-completion fences observed. Fixed arrival-mid camera. Headless Chrome, audio not unlocked.',version,environment,results};await writeFile(output,JSON.stringify(report,null,2));
}finally{socket?.close();child.kill();await Promise.race([once(child,'exit'),new Promise(r=>setTimeout(r,1000))]);await host.close();await rm(profile,{recursive:true,force:true});}
