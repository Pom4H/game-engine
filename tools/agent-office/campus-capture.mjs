#!/usr/bin/env node
/** Deterministic WebGPU screenshots -> H.264 video; no generated/fake frames. */
import {spawn} from 'node:child_process';
import {createServer as tcpServer} from 'node:net';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {once} from 'node:events';
import {startCampusServer} from './campus-server.mjs';
import {inspectPng} from '../character-creator/capture.mjs';

const check=(yes,message)=>{if(!yes)throw new Error(message);};
const delay=ms=>new Promise(done=>setTimeout(done,ms));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const candidates=process.platform==='win32'?[
 join(process.env.ProgramFiles??'C:\\Program Files','Google/Chrome/Application/chrome.exe'),
 join(process.env['ProgramFiles(x86)']??'C:\\Program Files (x86)','Google/Chrome/Application/chrome.exe'),
 join(process.env.LOCALAPPDATA??'','Google/Chrome/Application/chrome.exe'),
]:['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser'];
const chrome=process.env.CHROME_PATH??candidates.find(existsSync);
check(chrome&&existsSync(chrome),'Self-hosted GPU worker needs Chrome at CHROME_PATH');
const width=1920,height=1080,fps=24,durationSeconds=13,frames=fps*durationSeconds;
const dir=resolve('artifacts/agent-campus');await mkdir(dir,{recursive:true});
const video=join(dir,'campus-walkthrough.mp4');
const profile=await mkdtemp(join(tmpdir(),'agent-campus-gpu-'));
const server=await startCampusServer({port:0}),origin='http://127.0.0.1:'+server.address().port;
const socketPort=tcpServer();
await new Promise((yes,no)=>{socketPort.once('error',no);socketPort.listen(0,'127.0.0.1',yes);});
const debugPort=socketPort.address().port;await new Promise(yes=>socketPort.close(yes));
const args=[
 '--headless=new','--no-first-run','--disable-background-networking','--disable-extensions',
 '--hide-scrollbars','--enable-unsafe-webgpu','--enable-gpu','--ignore-gpu-blocklist',
 ...(process.platform==='win32'?['--use-angle=d3d11']:['--no-sandbox']),
 '--window-size='+width+','+height,'--user-data-dir='+profile,
 '--remote-debugging-address=127.0.0.1','--remote-debugging-port='+debugPort,'about:blank',
];
const child=spawn(chrome,args,{stdio:['ignore','pipe','pipe']});
let stderr='',ws,nextId=0,encoder;
const pending=new Map(),errors=[];
child.stderr.on('data',buffer=>{stderr=(stderr+String(buffer)).slice(-12000);});
try{
 let found=false;
 for(let i=0;i<240;i++){
  try{const response=await fetch('http://127.0.0.1:'+debugPort+'/json/version');if(response.ok){found=true;break;}}catch{}
  await delay(75);
 }
 check(found,'Chrome CDP unavailable: '+stderr.slice(-2500));
 const targets=await (await fetch('http://127.0.0.1:'+debugPort+'/json/list')).json();
 const target=targets.find(x=>x.type==='page'&&x.webSocketDebuggerUrl);
 check(target,'No Chrome page to capture');
 ws=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((yes,no)=>{ws.addEventListener('open',yes,{once:true});ws.addEventListener('error',no,{once:true});});
 ws.addEventListener('message',event=>{
  const data=JSON.parse(String(event.data));
  if(data.method==='Runtime.exceptionThrown')errors.push(data.params?.exceptionDetails);
  const p=pending.get(data.id);if(!p)return;
  pending.delete(data.id);data.error?p.reject(new Error(data.error.message)):p.resolve(data.result);
 });
 const send=(method,params={})=>new Promise((yes,no)=>{
  const id=++nextId;pending.set(id,{resolve:yes,reject:no});ws.send(JSON.stringify({id,method,params}));
 });
 const evalOnPage=async expression=>{
  const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
  if(result.exceptionDetails)throw new Error('Browser evaluation error: '+JSON.stringify(result.exceptionDetails));
  return result.result?.value;
 };
 await send('Runtime.enable');await send('Page.enable');await send('Log.enable');
 await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:origin+'/?capture=1'});
 let ready=false,pageError='';
 for(let i=0;i<300;i++){
  const result=await evalOnPage('({ready:document.documentElement.dataset.engineReady,error:globalThis.__CAMPUS_ERROR__||null})')
   .catch(error=>({error:String(error)}));
  if(result?.ready==='1'){ready=true;break;}
  if(result?.error){pageError=result.error;break;}
  await delay(90);
 }
 check(ready,'Campus WebGPU never started: '+pageError+' '+JSON.stringify(errors.slice(-2)));
 const adapter=await evalOnPage('(async()=>{const a=await navigator.gpu?.requestAdapter({powerPreference:"high-performance"}),i=a?.info??{};return{vendor:i.vendor??"",device:i.device??"",architecture:i.architecture??"",description:i.description??"",isFallbackAdapter:a?.isFallbackAdapter??i.isFallbackAdapter??false}})()');
 const software=adapter.isFallbackAdapter||/swiftshader|lavapipe|llvmpipe|software|warp\b|microsoft basic render/i.test(Object.values(adapter).join(' '));
 if(process.env.CAMPUS_REQUIRE_HARDWARE==='1')check(!software&&(adapter.vendor||adapter.device||adapter.description),
  'Expected hardware GPU for the real video: '+JSON.stringify(adapter));
 const seek=sec=>evalOnPage('globalThis.__CAMPUS__.seek('+sec+')');
 const first=await seek(0),middle=await seek(5.25),last=await seek(12.9);
 check(first.renderer?.backend==='webgpu'&&first.renderer.drawCalls>0,'Real engine renderer did not submit campus geometry');
 check(first.renderer.width>=width*1.3&&first.renderer.height>=height*1.3,
   'WebGPU supersampling was disabled; staircase-edge regression: '+JSON.stringify(first.renderer));
 check(first.renderer.drawCalls<170,'Art scene exceeded mobile-friendly draw budget');
 check(first.renderer.errors?.length===0,'Initial WebGPU errors: '+JSON.stringify(first.renderer.errors));
 const p=(set,id)=>set.agents.find(a=>a.id===id);
 check(p(first,'researcher').position[0]<-6&&p(last,'researcher').position[0]>6,'Researcher did not move between offices');
 check(p(middle,'researcher').traveling===true,'Researcher lacks actual walking interval');
 check(Math.abs(p(first,'researcher').position[0]-p(middle,'researcher').position[0])>2,'Character motion is not spatially visible');
 check((last.renderer.errors??[]).length===0,'Final GPU errors: '+JSON.stringify(last.renderer.errors));
 await seek(0);
 const encoders=await new Promise((yes,no)=>{
  const process=spawn('ffmpeg',['-hide_banner','-encoders'],{stdio:['ignore','pipe','pipe']});
  let output='',err='';process.stdout.on('data',v=>output+=String(v));process.stderr.on('data',v=>err+=String(v));
  process.once('error',no);process.once('close',code=>code===0?yes(output):no(new Error(err)));
 });
 const codec=encoders.includes('libx264')?['-c:v','libx264','-preset','slow','-crf','17']:
  ['-c:v','mpeg4','-q:v','2'];
 encoder=spawn('ffmpeg',['-y','-hide_banner','-loglevel','error','-f','image2pipe',
  '-vcodec','png','-framerate',String(fps),'-i','pipe:0','-an',...codec,
  '-pix_fmt','yuv420p','-movflags','+faststart',video],{stdio:['pipe','pipe','pipe']});
 let encodeError='';encoder.stderr.on('data',data=>encodeError=(encodeError+data).slice(-4000));
 const encoderExit=once(encoder,'exit');
 const previews=[];
 for(let frame=0;frame<frames;frame++){
  const time=frame/fps;
  const state=await seek(time);
  check(state.renderer?.drawCalls>0&&state.renderer.errors?.length===0,'GPU render failed at frame '+frame);
  const capture=await send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});
  const png=Buffer.from(capture.data,'base64');
  if(frame===0||frame===Math.floor(frames/2)||frame===frames-1){
   const name=frame===0?'campus-start.png':frame===frames-1?'campus-end.png':'campus-middle.png';
   const proof=inspectPng(png);
   check(proof.width===width&&proof.height===height,'Browser screenshot resolution changed at '+frame);
   check(proof.sampledColours>35&&proof.luminanceDeviation>24,
     'Scene is clipped/flat at frame '+frame+': '+JSON.stringify(proof));
   await writeFile(join(dir,name),png);
   previews.push({frame,time,name,sha256:sha(png),bytes:png.length,visualProof:proof,
    positions:state.agents.map(a=>({id:a.id,x:a.position[0],z:a.position[2],walking:a.traveling}))});
  }
  if(!encoder.stdin.write(png))await once(encoder.stdin,'drain');
  if(frame%24===0)console.log('Campus WebGPU video frame '+frame+'/'+frames);
 }
 encoder.stdin.end();
 const [code]=await encoderExit;check(code===0,'ffmpeg failed: '+encodeError);
 check(previews.length===3&&new Set(previews.map(p=>p.sha256)).size===3,
  'Identical screenshots show no visual motion');
 const probe=await new Promise((yes,no)=>{
  const process=spawn('ffprobe',['-v','error','-count_frames','-show_entries',
   'stream=codec_name,width,height,nb_read_frames,duration','-of','json',video],
   {stdio:['ignore','pipe','pipe']});
  let output='',err='';process.stdout.on('data',v=>output+=String(v));
  process.stderr.on('data',v=>err+=String(v));
  process.once('error',no);process.once('close',code=>code===0?yes(JSON.parse(output)):no(new Error(err)));
 });
 const stream=probe.streams?.[0];
 check(stream?.width===width&&stream?.height===height,'MP4 dimensions wrong: '+JSON.stringify(stream));
 check(Number(stream.nb_read_frames)===frames,'MP4 was truncated: '+JSON.stringify(stream));
 const evidence={schema:2,source:'real WebGPU supersampled screenshot sequence',syntheticReplay:true,outputResolution:[width,height],supersampleFactor:4/3,
  gitRevision:process.env.GITHUB_SHA??null,adapter,software,fps,frames,durationSeconds,
  renderer:last.renderer,previews,mp4:video,ffprobe:probe,errors};
 await writeFile(join(dir,'campus-evidence.json'),JSON.stringify(evidence,null,2));
 console.log(JSON.stringify({ok:true,video,frames,fps,adapter,renderer:last.renderer,
  first:previews[0],middle:previews[1],end:previews[2]},null,2));
}finally{
 for(const p of pending.values())p.reject(new Error('Capture exited'));
 pending.clear();ws?.close();encoder?.kill();child.kill();
 server.closeAllConnections?.();await new Promise(done=>server.close(()=>done()));
 await rm(profile,{recursive:true,force:true,maxRetries:3,retryDelay:250}).catch(()=>{});
}
