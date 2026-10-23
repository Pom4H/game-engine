#!/usr/bin/env node
/** Browser/GPU evidence from the real Agent Office UI on the self-hosted runner. */
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer as createTcpServer} from 'node:net';
import {startServer} from './server.mjs';
import {inspectPng} from '../character-creator/capture.mjs';

const sleep=ms=>new Promise(done=>setTimeout(done,ms));
const check=(truth,message)=>{if(!truth)throw new Error(message);};
const chromeCandidates=process.platform==='win32'?[
  join(process.env.ProgramFiles??'C:\\Program Files','Google/Chrome/Application/chrome.exe'),
  join(process.env['ProgramFiles(x86)']??'C:\\Program Files (x86)','Google/Chrome/Application/chrome.exe'),
  join(process.env.LOCALAPPDATA??'','Google/Chrome/Application/chrome.exe'),
]:['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser'];
const chrome=process.env.CHROME_PATH??chromeCandidates.find(existsSync);
check(chrome&&existsSync(chrome),'Chrome unavailable: configure CHROME_PATH on self-hosted worker');

const originServer=await startServer({port:0,mode:'demo'});
const origin='http://127.0.0.1:'+originServer.address().port;
const profile=await mkdtemp(join(tmpdir(),'office-chrome-'));
const probe=createTcpServer();
await new Promise((done,fail)=>{probe.once('error',fail);probe.listen(0,'127.0.0.1',done);});
const debugPort=probe.address().port;await new Promise(done=>probe.close(done));
const browser=spawn(chrome,[
  '--headless=new','--no-first-run','--disable-background-networking',
  '--disable-extensions','--hide-scrollbars','--enable-unsafe-webgpu','--enable-gpu',
  ...(process.platform==='win32'?['--use-angle=d3d11']:['--no-sandbox']),
  '--window-size=1600,900','--user-data-dir='+profile,
  '--remote-debugging-address=127.0.0.1','--remote-debugging-port='+debugPort,
  'about:blank',
],{stdio:['ignore','pipe','pipe']});
let stderr='',socket,requestId=0;const pending=new Map(),issues=[];
browser.stderr.on('data',bytes=>stderr+=bytes.toString().slice(-2000));
try{
  let version;
  for(let i=0;i<250;i++){
    try{const result=await fetch('http://127.0.0.1:'+debugPort+'/json/version');if(result.ok){version=await result.json();break;}}catch{}
    await sleep(80);
  }
  check(version,'Chrome CDP startup failed: '+stderr.slice(-2000));
  const targets=await (await fetch('http://127.0.0.1:'+debugPort+'/json/list')).json();
  const target=targets.find(item=>item.type==='page'&&item.webSocketDebuggerUrl);
  check(target,'Chrome page target not found');
  socket=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done,fail)=>{socket.addEventListener('open',done,{once:true});socket.addEventListener('error',fail,{once:true});});
  socket.addEventListener('message',message=>{
    const data=JSON.parse(String(message.data));
    if(data.method==='Runtime.exceptionThrown')issues.push(data.params.exceptionDetails);
    const item=pending.get(data.id);if(!item)return;
    pending.delete(data.id);
    data.error?item.reject(new Error(data.error.message)):item.resolve(data.result);
  });
  const send=(method,params={})=>new Promise((resolve,reject)=>{
    const id=++requestId;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));
  });
  const evaluate=async expression=>{
    const response=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    if(response.exceptionDetails)throw new Error('Page evaluation failed: '+JSON.stringify(response.exceptionDetails));
    return response.result?.value;
  };
  await send('Runtime.enable');await send('Page.enable');await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1600,height:900,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:origin+'/'});
  let ready=false,reason='';
  for(let i=0;i<250;i++){
    const state=await evaluate('({ready:document.documentElement.dataset.engineReady,err:document.querySelector("#error")?.textContent||""})').catch(e=>({err:String(e)}));
    if(state?.ready==='1'){ready=true;break;}
    reason=state?.err||reason;
    if(state?.err)break;
    await sleep(120);
  }
  check(ready,'Office did not render: '+reason+' '+JSON.stringify(issues.slice(-2)));
  const layout=await evaluate('(()=>{const rect=id=>{const r=document.querySelector(id).getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height}};return {viewport:innerHeight,stage:rect(".stage"),canvas:rect("#scene"),timeline:rect(".timeline")}})()');
  check(layout.stage.bottom<=layout.viewport+2&&layout.timeline.bottom<=layout.viewport+2,
    'Office overflows the visible browser viewport: '+JSON.stringify(layout));
  check(Math.abs(layout.canvas.top-layout.stage.top)<2&&Math.abs(layout.canvas.height-layout.stage.height)<2,
    'WebGPU canvas does not fill the stage: '+JSON.stringify(layout));
  await sleep(550);
  const initial=await evaluate('globalThis.__AGENT_OFFICE__.inspect()');
  const adapter=await evaluate('(async()=>{const a=await navigator.gpu?.requestAdapter({powerPreference:"high-performance"});const i=a?.info??{};return {vendor:i.vendor??"",device:i.device??"",architecture:i.architecture??"",description:i.description??"",isFallbackAdapter:a?.isFallbackAdapter??i.isFallbackAdapter??false}})()');
  check(initial.webgpu&&initial.renderer?.backend==='webgpu','Browser did not use the engine WebGPU renderer');
  check(initial.renderer.drawCalls>0&&initial.renderer.triangles>0,'GPU submitted no office geometry');
  check(initial.style==='toy-brick-v1','CI must render the toy-brick scene, not the former dark office');
  check(initial.sceneEntities<250,'Toy-brick static batching regressed; too many drawables: '+initial.sceneEntities);
  check(initial.renderer.drawCalls<250,'The toy scene must submit fewer draws than the old 319-draw office: '+initial.renderer.drawCalls);
  check(initial.agents.length===4,'Expected four real projected actors in the demo');
  const adapterText=Object.values(adapter).join(' ');
  const software=adapter.isFallbackAdapter||/swiftshader|lavapipe|llvmpipe|software|warp\b|microsoft basic render/i.test(adapterText);
  if(process.env.OFFICE_REQUIRE_HARDWARE==='1')check(!software&&adapterText.trim().length>0,'Hardware WebGPU not proven: '+adapterText);
  await evaluate('globalThis.__AGENT_OFFICE__.seek(27)');
  await sleep(550);
  const failed=await evaluate('globalThis.__AGENT_OFFICE__.inspect()');
  check(failed.agents.some(a=>a.phase==='blocked'),'CI failure must be visible in replay state');
  await evaluate('globalThis.__AGENT_OFFICE__.seek(44.5)');
  await sleep(550);
  const final=await evaluate('globalThis.__AGENT_OFFICE__.inspect()');
  check(final.agents.some(a=>a.phase==='done'),'Replay must show task completion');
  check((final.renderer?.errors??[]).length===0,'GPU validation error: '+JSON.stringify(final.renderer?.errors));
  const full=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  const stageUrl=await evaluate('globalThis.__AGENT_OFFICE__.capture()');
  check(typeof stageUrl==='string'&&stageUrl.startsWith('data:image/png;base64,'),'Canvas PNG capture failed');
  const dir=resolve('artifacts');await mkdir(dir,{recursive:true});
  const screenshot=Buffer.from(full.data,'base64'),stage=Buffer.from(stageUrl.split(',')[1],'base64');
  const screenshotProof=inspectPng(screenshot),stageProof=inspectPng(stage);
  check(stageProof.sampledColours>25&&stageProof.luminanceDeviation>5,'Office GPU image lacks meaningful geometric variation');
  await writeFile(join(dir,'agent-office-demo.png'),screenshot);
  await writeFile(join(dir,'agent-office-canvas.png'),stage);
  // Exercise the actual agent-selection drill-down. The viewport must move to
  // a real observed performer rather than a hidden/generated actor.
  await evaluate('document.querySelector("#agents .agent")?.click()');
  await sleep(550);
  const detail=await evaluate('globalThis.__AGENT_OFFICE__.inspect()');
  check(detail.focusedAgent==='orchestrator','Selecting an agent must focus the 3D performer');
  check(Math.abs(detail.camera.target[0])>0.1,'Drill-down camera did not move to the observed performer');
  const detailPng=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  const detailBytes=Buffer.from(detailPng.data,'base64');
  const detailProof=inspectPng(detailBytes);
  check(detailProof.sampledColours>35,'Agent close-up contains no meaningful geometry');
  await writeFile(join(dir,'agent-office-detail.png'),detailBytes);
  const evidence={schema:1,revision:process.env.GITHUB_SHA??null,source:'real WebGPU browser capture',
    adapter,software,layout,initial:{events:initial.events,agents:initial.agents,renderer:initial.renderer},
    failed:{atMs:failed.atMs,agents:failed.agents},
    final:{atMs:final.atMs,agents:final.agents,renderer:final.renderer},
    screenshot:screenshotProof,canvas:stageProof,detail:detailProof,focusedAgent:detail.focusedAgent,issues};
  await writeFile(join(dir,'agent-office-evidence.json'),JSON.stringify(evidence,null,2));
  console.log(JSON.stringify({ok:true,image:'artifacts/agent-office-demo.png',canvas:'artifacts/agent-office-canvas.png',adapter,stageProof,agents:final.agents.length},null,2));
}finally{
  for(const item of pending.values())item.reject(new Error('Capture closing'));pending.clear();
  socket?.close();browser.kill();
  originServer.closeAllConnections?.();
  await new Promise(resolve=>originServer.close(()=>resolve()));
  await rm(profile,{recursive:true,force:true,maxRetries:4,retryDelay:250});
}
