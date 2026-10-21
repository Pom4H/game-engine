import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,sep,extname} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {startBrowser} from './video-browser.mjs';
const root=resolve(import.meta.dirname,'../..'),out=resolve(process.env.ACTING_VIDEO_OUT??join(root,'artifacts/acting-video')),preview=process.env.ACTING_VIDEO_MODE==='preview',fps=30;
await mkdir(out,{recursive:true});const plan=JSON.parse(await readFile(join(out,'plan.json'),'utf8'));
const mime={'.mjs':'text/javascript','.js':'text/javascript','.html':'text/html','.json':'application/json','.png':'image/png'};
const cache=new Map();const server=createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://localhost');let path;
 if(u.pathname==='/plan.json')path=join(out,'plan.json');else if(/^\/(dist|tools\/acting|tools\/promo)\//.test(u.pathname))path=resolve(root,'.'+u.pathname);else{res.writeHead(404);res.end();return;}
 if(path!==join(out,'plan.json')&&!path.startsWith(root+sep))throw new Error('Invalid local path');
 let bytes=cache.get(path);if(!bytes){bytes=await readFile(path);cache.set(path,bytes);}res.setHeader('Content-Type',mime[extname(path)]??'application/octet-stream');res.end(bytes);
 }catch(e){res.writeHead(500);res.end(String(e));}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser,encoder,encodeDone;const exceptions=[],telemetry=[];const started=performance.now();
try{
 browser=await startBrowser({width:1280,height:720});browser.onEvent(m=>{if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails);});
 await browser.send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/tools/acting/video.html`});
 await browser.waitFor('window.videoReady||window.videoError',240);const error=await browser.evaluate('window.videoError??null');if(error)throw new Error(error);
 const adapter=await browser.evaluate('(async()=>{const a=await navigator.gpu.requestAdapter();return{...a.info,vendor:a.info.vendor,architecture:a.info.architecture,device:a.info.device,description:a.info.description,isFallbackAdapter:a.isFallbackAdapter??a.info.isFallbackAdapter??false};})()');
 if(adapter.isFallbackAdapter||/swiftshader|lavapipe|llvmpipe|software/i.test(JSON.stringify(adapter)))throw new Error('Hardware adapter required: '+JSON.stringify(adapter));
 console.log(JSON.stringify({event:'video-ready',adapter,durationS:plan.duration,mode:preview?'preview':'video'}));
 const capture=async t=>{const info=await browser.evaluate(`window.actingVideo.frame(${t})`);return{info,bytes:await browser.screenshot()};};
 if(preview){
  for(const t of [2.2,8,16,25.5,39]){const f=await capture(t),name=`preview-${t}.png`;await writeFile(join(out,name),f.bytes);telemetry.push({image:name,...f.info});console.log(JSON.stringify({image:name,time:t}));}
 }else{
  const silent=join(out,'npc-emotions-silent.mp4');
  encoder=spawn('ffmpeg',['-y','-hide_banner','-loglevel','error','-f','image2pipe','-vcodec','png','-framerate',String(fps),'-i','pipe:0','-an','-c:v','libopenh264','-b:v','8M','-profile:v','high','-allow_skip_frames','0','-pix_fmt','yuv420p','-movflags','+faststart',silent],{stdio:['pipe','ignore','pipe'],windowsHide:true});
  let encodingError='',pipeError;encoder.stderr.on('data',c=>encodingError+=c);encoder.stdin.on('error',e=>pipeError=e);encoder.on('error',e=>pipeError=e);encodeDone=once(encoder,'exit');
  const count=Math.ceil(plan.duration*fps);
  for(let frame=0;frame<count;frame++){
   const f=await capture(frame/fps);if(pipeError)throw pipeError;if(!encoder.stdin.write(f.bytes))await once(encoder.stdin,'drain');
   if(frame%30===0||frame===count-1){telemetry.push({frame,...f.info});console.log(JSON.stringify({frame,total:count,timeS:frame/fps,elapsedS:(performance.now()-started)/1000}));}
   if(frame===Math.round(25.5*fps))await writeFile(join(out,'poster.png'),f.bytes);
  }
  encoder.stdin.end();const [code]=await encodeDone;if(code!==0)throw new Error(encodingError);encoder=null;
  const mp4=join(out,'npc-emotions-and-sentiments.mp4'),mux=spawnSync('ffmpeg',['-y','-hide_banner','-loglevel','error','-i',silent,'-i',join(out,'dialogue.wav'),'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','192k','-af','loudnorm=I=-16:TP=-1.5:LRA=11','-t',String(plan.duration),'-movflags','+faststart',mp4],{encoding:'utf8',windowsHide:true});if(mux.status!==0)throw new Error(mux.stderr);
  const probe=spawnSync('ffprobe',['-v','error','-count_frames','-show_entries','stream=codec_name,width,height,nb_read_frames,r_frame_rate:format=duration,size','-of','json',mp4],{encoding:'utf8',windowsHide:true});if(probe.status!==0)throw new Error(probe.stderr);
  const media=JSON.parse(probe.stdout);if(!media.streams.some(s=>s.codec_name==='h264'&&s.width===1280&&s.nb_read_frames===String(count))||!media.streams.some(s=>s.codec_name==='aac'))throw new Error('Encoded media does not match the capture');
  await writeFile(join(out,'media.json'),JSON.stringify(media,null,2));
 }
 if(exceptions.length)throw new Error(JSON.stringify(exceptions));
 const sourceFiles=['tools/acting/video-scene.mjs','tools/acting/video.html','tools/acting/video-prepare.mjs','tools/acting/video-speech.ps1','dist/acting/motivation.js','dist/acting/rig.js','dist/acting/performance.js','dist/animation/conversation-face.js','dist/render/webgpu.js'];
 const evidence={backend:'hardware-webgpu',adapter,fps,width:1280,height:720,durationS:plan.duration,offlineCapture:true,syntheticScenarioReceipts:true,speech:plan.audio,frames:preview?telemetry.length:Math.ceil(plan.duration*fps),exceptions,sourceSha256:Object.fromEntries(await Promise.all(sourceFiles.map(async p=>[p,createHash('sha256').update(await readFile(join(root,p))).digest('hex')]))),telemetry};
 await writeFile(join(out,preview?'preview-evidence.json':'video-evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({event:'completed',mode:preview?'preview':'video',frames:evidence.frames,out}));
}finally{
 if(encoder){encoder.stdin.destroy();encoder.kill();}await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));
}
