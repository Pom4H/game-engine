#!/usr/bin/env node
// Real game-engine WebGPU capture. Every MP4 frame is a Chrome GPU canvas screenshot.
import {createServer} from 'node:http';
import {readFile,mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {resolve,extname,sep,join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';

const root=resolve('.');
const width=Number(process.env.CASTLE_WIDTH||960),height=Number(process.env.CASTLE_HEIGHT||540);
const fps=Number(process.env.CASTLE_FPS||15),duration=7.2;
if(width<640||height<360||width%2||height%2||![12,15,20,30].includes(fps))throw new Error('Invalid video capture dimensions/fps');
const output=resolve(process.env.CASTLE_OUTPUT||'artifacts/castle-jelly');
await mkdir(output,{recursive:true});
const chrome=process.env.CHROME_PATH;if(!chrome)throw new Error('CHROME_PATH required: hardware WebGPU capture only');
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1');
  if(!/^\/(dist|tools\/castle-jelly)\//.test(url.pathname)){res.writeHead(404);res.end();return;}
  const path=resolve(root,'.'+url.pathname);
  if(!path.startsWith(root+sep))throw new Error('Path outside project');
  const ext=extname(path);
  res.setHeader('content-type',({'.mjs':'text/javascript','.js':'text/javascript','.html':'text/html','.json':'application/json'})[ext]||'application/octet-stream');
  res.end(await readFile(path));
 }catch(error){res.writeHead(500);res.end(String(error));}
});
await new Promise((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes);});
const profile=await mkdtemp(join(tmpdir(),'castle-jelly-webgpu-'));
const child=spawn(chrome,['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-extensions','--hide-scrollbars','--enable-unsafe-webgpu','--enable-gpu','--ignore-gpu-blocklist','--user-data-dir='+profile,'--remote-debugging-port=0','--window-size='+width+','+height,'about:blank'],{stdio:['ignore','ignore','pipe']});
let stderr='',ws,encoder;
child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-16000);});
const wait=ms=>new Promise(yes=>setTimeout(yes,ms));
const close=async()=>{
 try{ws?.close();}catch{}
 try{encoder?.stdin.destroy();encoder?.kill();}catch{}
 if(child.exitCode===null){child.kill();await Promise.race([once(child,'exit').catch(()=>{}),wait(1000)]);}
 server.closeAllConnections();await new Promise(yes=>server.close(yes));
 await rm(profile,{recursive:true,force:true});
};
try{
 const endpoint=await new Promise((yes,no)=>{
  const timer=setTimeout(()=>no(new Error('Chrome DevTools unavailable: '+stderr)),25000);
  const test=()=>{const m=stderr.match(/DevTools listening on (ws:\/\/\S+)/);if(m){clearTimeout(timer);yes(m[1]);}};
  child.stderr.on('data',test);child.once('error',no);child.once('exit',code=>{clearTimeout(timer);no(new Error('Chrome exited '+code+': '+stderr));});test();
 });
 const port=new URL(endpoint).port;
 const pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
 const page=pages.find(x=>x.type==='page'&&x.webSocketDebuggerUrl);
 if(!page)throw new Error('No browser page');
 ws=new WebSocket(page.webSocketDebuggerUrl);
 await new Promise((yes,no)=>{ws.addEventListener('open',yes,{once:true});ws.addEventListener('error',no,{once:true});});
 let nextId=0;const pending=new Map(),browserErrors=[];
 ws.addEventListener('message',event=>{
  const m=JSON.parse(String(event.data));
  if(m.method==='Runtime.exceptionThrown')browserErrors.push(m.params.exceptionDetails?.exception?.description||'Exception');
  const call=pending.get(m.id);if(!call)return;pending.delete(m.id);clearTimeout(call.timer);
  m.error?call.no(new Error(m.error.message)):call.yes(m.result);
 });
 const send=(method,params={})=>new Promise((yes,no)=>{
  const id=++nextId,timer=setTimeout(()=>{pending.delete(id);no(new Error('CDP timeout '+method));},60000);
  pending.set(id,{yes,no,timer});ws.send(JSON.stringify({id,method,params}));
 });
 const evaluate=async code=>{const r=await send('Runtime.evaluate',{expression:code,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value;};
 await send('Runtime.enable');await send('Page.enable');
 await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/tools/castle-jelly/player.html?capture=1&width='+width+'&height='+height});
 let state;
 for(let i=0;i<600;i++){
  state=await evaluate('({ready:window.castleReady===true,error:window.castleError||null})');
  if(state?.error)throw new Error(state.error);
  if(state?.ready)break;
  await wait(100);
 }
 if(!state?.ready)throw new Error('Castle player startup timed out: '+stderr+'\n'+JSON.stringify(browserErrors));
 const adapter=await evaluate("(async()=>{const a=await navigator.gpu.requestAdapter();if(!a)return null;const i=a.info||{};return {vendor:i.vendor,device:i.device,architecture:i.architecture,description:i.description,isFallbackAdapter:a.isFallbackAdapter||false};})()");
 if(!adapter)throw new Error('WebGPU GPU adapter missing');
 if(adapter.isFallbackAdapter||/swiftshader|lavapipe|llvmpipe|software|microsoft basic render/i.test(JSON.stringify(adapter)))throw new Error('Hardware GPU required: '+JSON.stringify(adapter));
 const frames=Math.round(duration*fps);
 const mp4=join(output,'castle-jelly.mp4'),poster=join(output,'poster.png');
 const available=spawnSync('ffmpeg',['-hide_banner','-encoders'],{encoding:'utf8'}).stdout||'';
 const choices=['libx264','libopenh264','h264_mf','h264_nvenc','mpeg4'];
 const codec=choices.find(name=>{
  if(!new RegExp('\\b'+name+'\\b').test(available))return false;
  const probe=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=black:s=160x90:r=1','-frames:v','1','-c:v',name,'-f','null','-'],{encoding:'utf8',timeout:10000});
  console.log('Encoder probe '+name+': '+(probe.status===0?'OK':(probe.stderr||probe.error||'unavailable').toString().slice(0,180)));
  return probe.status===0;
 });
 if(!codec)throw new Error('No available FFmpeg MP4 codec: '+available.slice(-3000));
 console.log('Castle video encoder: '+codec);
 encoder=spawn('ffmpeg',['-y','-hide_banner','-loglevel','error','-f','image2pipe','-vcodec','png','-framerate',String(fps),'-i','pipe:0','-an','-c:v',codec,'-pix_fmt','yuv420p','-movflags','+faststart',mp4],{stdio:['pipe','inherit','inherit']});
 const completed=once(encoder,'exit');completed.catch(()=>{});
 let encoderError;encoder.once('error',e=>{encoderError=e;});encoder.stdin.on('error',e=>{encoderError=e;});
 const samples=[];
 for(let i=0;i<frames;i++){
  const t=i/fps,telemetry=await evaluate('window.castle.frame('+t+')');
  if(telemetry?.renderer?.drawCalls<1||telemetry?.renderer?.errors?.length)throw new Error('GPU frame invalid: '+JSON.stringify(telemetry));
  const shot=await send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});
  const bytes=Buffer.from(shot.data,'base64');
  if(bytes.length<1000||bytes[0]!==137||bytes[1]!==80)throw new Error('Invalid WebGPU screenshot at frame '+i);
  if(i===Math.floor(frames*.46))await writeFile(poster,bytes);
  if(i%Math.max(1,Math.floor(fps))===0||i===frames-1){samples.push({frame:i,...telemetry});console.log('Castle WebGPU frame '+i+'/'+frames+' energy='+telemetry.waterEnergy.toFixed(5));}
  if(encoderError)throw encoderError;
  if(!encoder.stdin.write(bytes))await once(encoder.stdin,'drain');
 }
 encoder.stdin.end();
 const [code]=await completed;encoder=undefined;
 if(code!==0)throw new Error('ffmpeg failed with exit '+code);
 const video=await readFile(mp4);
 if(video.length<30000)throw new Error('Video file suspiciously small');
 if(samples.at(-1).waterEnergy<=0)throw new Error('Wave field did not evolve');
 const evidence={backend:'webgpu-hardware',adapter,sourceSha:process.env.GITHUB_SHA||null,frames,fps,width,height,duration,videoBytes:video.length,sha256:createHash('sha256').update(video).digest('hex'),samples};
 await writeFile(join(output,'evidence.json'),JSON.stringify(evidence,null,2)+'\n');
 console.log('CASTLE_VIDEO='+JSON.stringify({file:mp4,bytes:video.length,sha256:evidence.sha256,adapter}));
}finally{await close();}
