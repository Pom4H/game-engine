#!/usr/bin/env node
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,mkdtemp,rm,unlink} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {resolve,join,extname} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import {synthesizeIAmAlive,wavBytes} from '../../dist/index.js';

const root=resolve('.');
const out=resolve('artifacts/vocal-face');
await mkdir(out,{recursive:true});
const width=1280,height=720,fps=30,duration=2.0,frames=Math.ceil(duration*fps);
const html=await readFile(new URL('./player.html',import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8'};
const server=createServer(async(req,res)=>{try{
  const url=new URL(req.url??'/','http://127.0.0.1');
  if(url.pathname==='/'){res.writeHead(200,{'content-type':mime['.html']});res.end(html);return;}
  if(url.pathname.startsWith('/dist/')){const p=join(root,'dist',url.pathname.slice(6));res.writeHead(200,{'content-type':mime[extname(p)]??'application/octet-stream'});res.end(await readFile(p));return;}
  res.writeHead(404);res.end();
}catch(error){res.writeHead(500);res.end(String(error));}});
await new Promise((r,j)=>{server.once('error',j);server.listen(0,'127.0.0.1',r);});
const port=server.address().port;
const chrome=process.env.CHROME_PATH??(['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium'].find(existsSync));
if(!chrome)throw new Error('Chrome/Chromium not found');
const profile=await mkdtemp(join(tmpdir(),'vocal-face-'));
const child=spawn(chrome,[
  '--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-extensions','--hide-scrollbars',
  '--enable-unsafe-webgpu','--enable-gpu','--ignore-gpu-blocklist','--user-data-dir='+profile,'--remote-debugging-port=0',
  '--window-size='+width+','+height,'about:blank'
],{stdio:['ignore','ignore','pipe']});
let socket,seq=0;
const pending=new Map(),errors=[];
try{
  const endpoint=await new Promise((r,j)=>{let text='';const timer=setTimeout(()=>j(new Error(text||'DevTools timeout')),20000);child.stderr.on('data',d=>{text+=d;const m=text.match(/DevTools listening on (ws:\/\/\S+)/);if(m){clearTimeout(timer);r(m[1]);}});child.on('error',j);});
  const debugPort=new URL(endpoint).port;
  let page;
  for(let i=0;i<100;i++){const pages=await(await fetch('http://127.0.0.1:'+debugPort+'/json/list')).json();page=pages.find(p=>p.type==='page');if(page)break;await new Promise(r=>setTimeout(r,50));}
  if(!page)throw new Error('Chrome page target unavailable');
  socket=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true});});
  socket.addEventListener('message',event=>{const m=JSON.parse(String(event.data));if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);});
  const send=(method,params={})=>new Promise((r,j)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);j(new Error('Timeout: '+method));},30000);pending.set(id,{resolve:r,reject:j,timer});socket.send(JSON.stringify({id,method,params}));});
  const evalValue=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result?.value;};
  await send('Page.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:'http://127.0.0.1:'+port+'/'});
  for(let i=0;i<400;i++){const state=await evalValue("({ready:document.documentElement.dataset.ready==='1',error:window.__FACE_ERROR__||null})");if(state.error)throw new Error(state.error);if(state.ready)break;await new Promise(r=>setTimeout(r,50));}
  if(!await evalValue("document.documentElement.dataset.ready==='1'"))throw new Error('Vocal face player did not become ready: '+JSON.stringify(errors.slice(-5)));

  const adapter=await evalValue("(async()=>{const a=await navigator.gpu?.requestAdapter({powerPreference:'high-performance'});if(!a)return null;const i=a.info??{};return{vendor:i.vendor,architecture:i.architecture,device:i.device,description:i.description,isFallbackAdapter:a.isFallbackAdapter??i.isFallbackAdapter??false};})()");
  if(!adapter||adapter.isFallbackAdapter||/swiftshader|lavapipe|llvmpipe|software|microsoft basic render/i.test(JSON.stringify(adapter)))throw new Error('Hardware GPU required: '+JSON.stringify(adapter));

  const videoSilent=join(out,'i-am-alive-face-silent.mp4');
  const encoders=await new Promise((r,j)=>{const p=spawn('ffmpeg',['-hide_banner','-encoders'],{stdio:['ignore','pipe','pipe']});let text='';p.stdout.on('data',d=>text+=d);p.once('error',j);p.once('exit',code=>code===0?r(text):j(new Error('ffmpeg -encoders failed')));});
  const codec=encoders.includes('libx264')?['-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p']:['-c:v','mpeg4','-q:v','2','-pix_fmt','yuv420p'];
  const encoder=spawn('ffmpeg',['-y','-hide_banner','-loglevel','error','-f','image2pipe','-vcodec','png','-framerate',String(fps),'-i','pipe:0','-an',...codec,'-movflags','+faststart',videoSilent],{stdio:['pipe','inherit','inherit']});
  const completed=once(encoder,'exit'),telemetry=[];
  for(let frame=0;frame<frames;frame++){
    const time=frame/fps;
    telemetry.push(await evalValue('window.vocalFace.frame('+time+','+frame+')'));
    const shot=await send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});
    const png=Buffer.from(shot.data,'base64');
    if(!encoder.stdin.write(png))await once(encoder.stdin,'drain');
    if(frame===Math.floor(frames*.52))await writeFile(join(out,'poster.png'),png);
  }
  encoder.stdin.end();
  const videoExit=await completed;
  if(videoExit[0]!==0)throw new Error('Video encoder failed: '+videoExit[0]);

  const voice=synthesizeIAmAlive({sampleRate:48_000,seed:0xA11CE});
  const wav=join(out,'voice-temp.wav');
  await writeFile(wav,wavBytes(voice.audio));
  const mp4=join(out,'i-am-alive-face.mp4');
  const mux=spawn('ffmpeg',['-y','-hide_banner','-loglevel','error','-i',videoSilent,'-i',wav,'-c:v','copy','-c:a','aac','-b:a','192k','-shortest','-movflags','+faststart',mp4],{stdio:'inherit'});
  const muxExit=await once(mux,'exit');
  if(muxExit[0]!==0)throw new Error('Mux failed: '+muxExit[0]);
  await Promise.all([unlink(wav),unlink(videoSilent)]);
  const inspection=await evalValue('window.vocalFace.inspect()');
  await writeFile(join(out,'evidence.json'),JSON.stringify({adapter,fps,duration,frames,inspection,voice:voice.diagnostics,telemetry:telemetry.filter((_,i)=>i%5===0)},null,2));
  console.log(JSON.stringify({mp4,adapter,fps,frames,renderer:inspection},null,2));
}finally{
  if(socket)socket.close();
  for(const p of pending.values())clearTimeout(p.timer);
  child.kill();
  await Promise.race([once(child,'exit'),new Promise(r=>setTimeout(r,1000))]);
  server.closeAllConnections();
  await new Promise(r=>server.close(r));
  await rm(profile,{recursive:true,force:true});
}
