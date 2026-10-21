#!/usr/bin/env node
import {createServer} from 'node:http';
import {createServer as createTcpServer} from 'node:net';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,resolve,extname} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

const [sceneFile,viewsFile,widthArg='1280',heightArg='720']=process.argv.slice(2);
if(!sceneFile||!viewsFile)throw new Error('usage: node tools/render-harness.mjs <scene.mjs> <views.mjs> [width] [height]');
const width=Number(widthArg),height=Number(heightArg);
if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1)throw new Error('invalid render size');
const warmupFrames=Number(process.env.RENDER_WARMUP_FRAMES??0);
if(!Number.isSafeInteger(warmupFrames)||warmupFrames<0||warmupFrames>512)throw new RangeError('RENDER_WARMUP_FRAMES must be in [0, 512]');
const profiling=process.env.RENDER_PROFILING==='1',requireHardware=process.env.RENDER_REQUIRE_HARDWARE==='1';
const fpsBenchFrames=Number(process.env.RENDER_FPS_BENCH_FRAMES??0);
if(!Number.isSafeInteger(fpsBenchFrames)||fpsBenchFrames<0||fpsBenchFrames>240)throw new RangeError('RENDER_FPS_BENCH_FRAMES must be within 0..240');
if(fpsBenchFrames&&!requireHardware)throw new Error('GPU FPS benchmark requires a hardware WebGPU adapter');
const fpsBenchLabel=process.env.RENDER_FPS_BENCH_LABEL??'';
const fpsRigidBackend=process.env.RENDER_RIGID_BACKEND??'js';
if(!['js','rust'].includes(fpsRigidBackend))throw new TypeError('Invalid RENDER_RIGID_BACKEND');
const fpsRoutePath=(process.env.RENDER_FPS_ROUTE_MODULE??'').replaceAll('\\','/');
if(fpsRoutePath&&!/^tools\/[a-z0-9\/-]+\.mjs$/.test(fpsRoutePath))
  throw new TypeError('RENDER_FPS_ROUTE_MODULE must be a module beneath tools/');
const fpsRouteUrl=fpsRoutePath?'/'+fpsRoutePath:'';
const fpsLastFrame=process.env.RENDER_FPS_LAST_FRAME??'';
if(fpsLastFrame&&!/^[a-z][a-z0-9-]{0,20}$/.test(fpsLastFrame))
  throw new TypeError('Invalid RENDER_FPS_LAST_FRAME');
if((fpsRigidBackend==='rust'||fpsRouteUrl||fpsLastFrame)&&!fpsBenchFrames)
  throw new TypeError('City backend/route/capture requires RENDER_FPS_BENCH_FRAMES');
if(fpsBenchLabel&&!/^[a-z][a-z0-9-]{0,24}$/.test(fpsBenchLabel))throw new RangeError('Invalid FPS benchmark artifact label');
const videoOutput=process.env.RENDER_VIDEO_OUTPUT??null,videoFps=Number(process.env.RENDER_VIDEO_FPS??30),videoStart=Number(process.env.RENDER_VIDEO_START??0),videoDuration=Number(process.env.RENDER_VIDEO_DURATION??0);
if(videoOutput&&(!Number.isSafeInteger(videoFps)||videoFps<1||videoFps>60||!Number.isFinite(videoStart)||videoStart<0||!Number.isFinite(videoDuration)||videoDuration<=0||videoDuration>30))throw new RangeError('Invalid render video options');
const scenePath=resolve(sceneFile);
const viewsPath=resolve(viewsFile);
const sceneUrl='/tools/'+scenePath.slice(resolve('tools').length+1).replaceAll('\\','/');
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
  canvas.width=${width};canvas.height=${height};
  // Probe the same adapter preference used by WebGPURenderer; never silently
  // count SwiftShader/lavapipe as a successful hardware-rendering CI run.
  let adapterInfo=null;
  if(${requireHardware}){
    const adapter=await navigator.gpu?.requestAdapter({powerPreference:'high-performance'});
    if(!adapter)throw new Error('Hardware adapter unavailable');
    const info=adapter.info??await adapter.requestAdapterInfo?.()??{};
    adapterInfo={vendor:info.vendor,architecture:info.architecture,device:info.device,description:info.description,isFallbackAdapter:adapter.isFallbackAdapter??info.isFallbackAdapter??false};
    if(adapterInfo.isFallbackAdapter||/swiftshader|lavapipe|llvmpipe|software|microsoft basic render/i.test(JSON.stringify(adapterInfo)))throw new Error('Software adapter rejected: '+JSON.stringify(adapterInfo));
  }
  const runtime=await BrowserRuntime.create(canvas,scene,{autoplay:false,audio:false,exposeBridge:true,resolution:[${width},${height}],profiling:${profiling}});
  const fpsRoute=${fpsRouteUrl?JSON.stringify(fpsRouteUrl):'null'};
  const route=fpsRoute?await import(fpsRoute):null;
  if(route&&typeof route.cityCameraAtTick!=='function')
    throw new Error('FPS route must export cityCameraAtTick(tick)');
  let rigidKernel=null;
  if(${fpsRigidBackend==='rust'}){
    const {createWasmRigidContactKernel}=await import('/dist/physics/rigid-wasm.js');
    const source=await fetch('/kernels/world-rigid/target/wasm32-unknown-unknown/release/world_rigid_kernel.wasm');
    if(!source.ok)throw new Error('Built Rust rigid kernel was not served');
    rigidKernel=await createWasmRigidContactKernel(await source.arrayBuffer());
    runtime.scene.physics.setRigidContactKernel(rigidKernel);
  }
  globalThis.__RENDER_HARNESS__={runtime,adapterInfo,
    fpsRoute:route?.cityCameraAtTick??null,rigidKernel,
    backend:rigidKernel?'rust':'js'};
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
    if(url.pathname==='/kernels/world-rigid/target/wasm32-unknown-unknown/release/world_rigid_kernel.wasm'){
      const data=await readFile(resolve('kernels/world-rigid/target/wasm32-unknown-unknown/release/world_rigid_kernel.wasm'));
      res.writeHead(200,{'content-type':'application/wasm','cache-control':'no-store'});
      res.end(data);return;
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
const chromeCandidates=process.platform==='win32'
  ?[
    join(process.env.ProgramFiles??process.env.PROGRAMFILES??'C:\\Program Files','Google','Chrome','Application','chrome.exe'),
    join(process.env['ProgramFiles(x86)']??process.env['PROGRAMFILES(X86)']??'C:\\Program Files (x86)','Google','Chrome','Application','chrome.exe'),
    join(process.env.LOCALAPPDATA??'', 'Google','Chrome','Application','chrome.exe'),
  ]
  :process.platform==='darwin'
    ?['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Chromium.app/Contents/MacOS/Chromium']
    :['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser'];
const chrome=process.env.CHROME_PATH??chromeCandidates.find(existsSync);
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
  const adapterResult=await send('Runtime.evaluate',{expression:'window.__RENDER_HARNESS__.adapterInfo',returnByValue:true});

  await mkdir(resolve('artifacts'),{recursive:true});
  let fpsBenchmark=null;
  if(fpsBenchFrames){
    // A real Chrome animation-frame loop at the authored render resolution:
    // scene.step + the production WebGPU renderer, without screenshot/readback per frame.
    // GPU pass durations come from RenderProfiler timestamp queries, if supported.
    const fpsExpression=String.raw`(async()=>{
      const runtime=window.__RENDER_HARNESS__.runtime;
      runtime.pause();
      const requested=__FPS_FRAMES__;
      const quantile=(values,q)=>{
        if(!values.length)return null;
        const ordered=[...values].sort((a,b)=>a-b);
        return ordered[Math.floor((ordered.length-1)*q)];
      };
      const stats=values=>({samples:values.length,meanMs:values.length?values.reduce((a,b)=>a+b,0)/values.length:null,
        p50Ms:quantile(values,.50),p95Ms:quantile(values,.95),p99Ms:quantile(values,.99),
        maxMs:values.length?Math.max(...values):null});
      const interval=[],frameCpu=[],simulationCpu=[],renderCpu=[];
      runtime.resetProfile();
      let previous=0;
      await new Promise(resolve=>{
        let done=0;
        const frame=(timestamp)=>{
          if(previous>0)interval.push(timestamp-previous);
          previous=timestamp;
          const a=performance.now();
          if(window.__RENDER_HARNESS__.fpsRoute)
            runtime.scene.setCamera(window.__RENDER_HARNESS__.fpsRoute(done));
          runtime.scene.step(1/60);
          const b=performance.now();
          runtime.render();
          const c=performance.now();
          simulationCpu.push(b-a);
          renderCpu.push(c-b);
          frameCpu.push(c-a);
          done++;
          if(done>=requested)resolve();
          else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
      await runtime.drain();
      // Let async GPU timestamp readbacks settle without adding simulated frames.
      await new Promise(resolve=>setTimeout(resolve,30));
      const gpuProfile=runtime.profile();
      // Sample authoritative rigid state before the separate diagnostic
      // simulation below; that phase is deliberately excluded from FPS.
      const rigidDiagnostics=runtime.scene.physics.rigidContactDiagnostics;
      const trafficBodies=[...runtime.scene.physics.bodies.values()]
        .filter(body=>body.id.startsWith('bench-car-'))
        .map(body=>({id:body.id,position:[...body.position],
          velocity:[...body.velocity],rotation:[...body.rotation],
          sleeping:body.sleeping}));
      const finalCamera=runtime.scene.camera;
      const budget=1000/60;
      const pace=stats(interval),whole=stats(frameCpu),simulation=stats(simulationCpu),render=stats(renderCpu);
      const gpuStats=gpuProfile.timestampQueries&&gpuProfile.gpuFrames>0?gpuProfile.gpuTotal??null:null;
      const gpu= gpuStats?{...gpuStats,samples:gpuProfile.gpuFrames}:null;
      // Separate unrendered simulation pass for precise system-level costs.
      // Kept out of the FPS loop so diagnostic clock reads do not perturb pacing.
      runtime.scene.enablePerformanceProfiling({tickBudgetMs:5,sampleEvery:1,history:120});
      for(let i=0;i<90;i++)runtime.scene.step(1/60);
      const simulationProfile=runtime.scene.performanceReport();
      runtime.scene.disablePerformanceProfiling();
      const simulationHotspots=simulationProfile?
        Object.entries(simulationProfile.systems).map(([name,value])=>({name,...value}))
          .sort((a,b)=>b.p95Ms-a.p95Ms):[];
      const pass=(value)=>value!==null&&value<=budget;
      return{
        schema:1,requestedFrames:requested,resolution:[runtime.renderer.inspect().width,runtime.renderer.inspect().height],
        rigidBackend:window.__RENDER_HARNESS__.backend,rigidDiagnostics,
        trafficBodies,finalCamera,cameraRouteEnabled:!!window.__RENDER_HARNESS__.fpsRoute,
        budgetMs:budget,frameInterval:pace,frameCpu:whole,simulationCpu:simulation,renderCpu:render,
        observedFps:pace.p50Ms?1000/pace.p50Ms:null,
        gpu,
        timestampQueries:gpuProfile.timestampQueries,
        gpuFrames:gpuProfile.gpuFrames,
        gpuPasses:gpuProfile.gpu,
        cpuStages:gpuProfile.cpu,
        simulationProfile,simulationHotspots,
        renderWork:gpuProfile.latestCpu?.work??null,
        validation:{cpuP95WithinBudget:pass(whole.p95Ms),
          gpuP95WithinBudget:gpu?pass(gpu.p95Ms):null,
          frameP95WithinBudget:pass(pace.p95Ms)}
      };
    })()`.replace('__FPS_FRAMES__',String(fpsBenchFrames));
    const sampled=await send('Runtime.evaluate',{expression:fpsExpression,awaitPromise:true,returnByValue:true});
    if(sampled.exceptionDetails||!sampled.result?.value)throw new Error('GPU benchmark failed: '+JSON.stringify(sampled.exceptionDetails??sampled));
    fpsBenchmark={...sampled.result.value,adapter:adapterResult.result?.value};
    await mkdir(resolve('artifacts/fps'),{recursive:true});
    const artifactName=fpsBenchLabel?'gpu-budget-'+fpsBenchLabel+'.json':'gpu-budget.json';
    await writeFile(resolve('artifacts/fps',artifactName),JSON.stringify(fpsBenchmark,null,2)+'\n');
    console.log('GPU_FPS_BENCHMARK='+JSON.stringify(fpsBenchmark));
    if(fpsLastFrame){
      const frame=await send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});
      const destination=resolve('artifacts/city-benchmark/last-'+fpsLastFrame+'.png');
      await mkdir(resolve('artifacts/city-benchmark'),{recursive:true});
      await writeFile(destination,Buffer.from(frame.data,'base64'));
      console.log('FPS_FINAL_IMAGE='+destination);
    }
  }
  let video=null;
  if(videoOutput){
    const output=resolve(videoOutput);await mkdir(join(output,'..'),{recursive:true});
    const frames=Math.max(1,Math.round(videoDuration*videoFps));
    const encoder=spawn('ffmpeg',['-y','-hide_banner','-loglevel','error','-f','image2pipe','-vcodec','png','-framerate',String(videoFps),'-i','pipe:0','-an','-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',output],{stdio:['pipe','inherit','inherit']});
    const completed=once(encoder,'exit');
    for(let frame=0;frame<frames;frame++){
      const time=videoStart+frame/videoFps;
      const result=await send('Runtime.evaluate',{expression:`(async()=>{const bridge=window.__GAME_ENGINE__;bridge.seek(${time});await bridge.flush();return{inspection:bridge.inspect(),camera:window.__RENDER_HARNESS__.runtime.scene.camera}})()`,awaitPromise:true,returnByValue:true});
      if(result.exceptionDetails)throw new Error('Video render failed: '+JSON.stringify(result.exceptionDetails));
      const shot=await send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});
      const png=Buffer.from(shot.data,'base64');if(!encoder.stdin.write(png))await once(encoder.stdin,'drain');
      if(frame%30===0)console.log('video',frame+'/'+frames);
    }
    encoder.stdin.end();const [code]=await completed;if(code!==0)throw new Error('ffmpeg exit '+code);
    video={output,frames,fps:videoFps,start:videoStart,duration:videoDuration};
  }
  const results=[];
  for(const view of views){
    if(!view?.name||!view?.output||!view?.camera)throw new Error('Invalid view entry: '+JSON.stringify(view));
    const cameraJson=JSON.stringify(view.camera),time=Number(view.time??0);
    if(!Number.isFinite(time)||time<0)throw new Error('Invalid view time for '+view.name);
    const result=await send('Runtime.evaluate',{
      expression:`(async()=>{const bridge=window.__GAME_ENGINE__;bridge.seek(${time});bridge.setCamera(${cameraJson});await bridge.flush();bridge.resetProfile();for(let i=0;i<${warmupFrames};i++){bridge.render();await bridge.drain();}bridge.render();await bridge.flush();return{inspection:bridge.inspect(),actualCamera:window.__RENDER_HARNESS__.runtime.scene.camera}})()`,
      awaitPromise:true,returnByValue:true
    });
    if(result.exceptionDetails)throw new Error('Render failed: '+JSON.stringify(result.exceptionDetails));
    const value=result.result?.value,inspection=value?.inspection,actualCamera=value?.actualCamera;
    if(JSON.stringify(actualCamera)!==cameraJson)throw new Error('Proof camera diverged for '+view.name+': requested '+cameraJson+', actual '+JSON.stringify(actualCamera));
    const renderer=inspection?.renderer;
    if((renderer?.drawCalls??0)<=0&&(renderer?.triangles??0)<=0)throw new Error('Renderer produced no geometry for '+view.name+': '+JSON.stringify(renderer));
    if(renderer.errors?.length)throw new Error('Renderer errors: '+JSON.stringify(renderer.errors));

    const shot=await send('Runtime.evaluate',{
      expression:'document.getElementById(\'c\').toDataURL(\'image/png\').split(\',\')[1]',
      returnByValue:true
    });
    const encoded=shot.result?.value;
    if(typeof encoded!=='string')throw new Error('Canvas capture returned non-string value for '+view.name);
    const output=resolve(view.output);
    await mkdir(join(output,'..'),{recursive:true});
    await writeFile(output,Buffer.from(encoded,'base64'));
    results.push({name:view.name,output,renderer,camera:actualCamera,time:inspection.time,environment:inspection.environment});
    console.log(JSON.stringify(results.at(-1),null,2));
  }

  const hud={resolution:[width,height],warmupFrames,adapter:adapterResult.result?.value,fpsBenchmark,video,views:results};
  await writeFile(resolve('artifacts/render-hud.json'),JSON.stringify(hud,null,2));
  console.log(JSON.stringify({views:results.length,outputs:results.map(result=>result.output),hud:'artifacts/render-hud.json'},null,2));
}finally{
  await cleanup();
}
