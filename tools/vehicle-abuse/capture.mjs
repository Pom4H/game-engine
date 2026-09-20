import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,mkdtemp,rm,access} from 'node:fs/promises';
import {constants as FS} from 'node:fs';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {renderAudio,renderAmbience,wavBytes} from '../../dist/index.js';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const root=fileURLToPath(new URL('../../',import.meta.url)),tool=join(root,'tools/vehicle-abuse'),out=join(root,'artifacts/vehicle-abuse');
await mkdir(out,{recursive:true});
const html=await readFile(join(tool,'player.html'));
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/'){res.setHeader('content-type','text/html');res.end(html);return;}
    if(url.pathname==='/timeline.mjs'){res.setHeader('content-type','text/javascript');res.end(await readFile(join(tool,'timeline.mjs')));return;}
    const match=url.pathname.match(/^\/dist\/(.+\.js)$/);
    if(!match||match[1].includes('..')){res.statusCode=404;res.end();return;}
    res.setHeader('content-type','text/javascript');res.end(await readFile(join(root,'dist',match[1])));
  }catch(error){res.statusCode=500;res.end(String(error));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
const chrome=await chromePath(),profile=await mkdtemp(join(tmpdir(),'vehicle-abuse-'));
const child=spawn(chrome,['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-extensions','--hide-scrollbars','--enable-unsafe-webgpu',`--user-data-dir=${profile}`,'--remote-debugging-port=0','--window-size=1920,1080','about:blank'],{stdio:['ignore','ignore','pipe']});
let socket,sequence=0;const pending=new Map(),browserEvents=[];
try{
  const endpoint=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(new Error(text)),20_000);child.stderr.on('data',data=>{text+=data;const m=text.match(/DevTools listening on (ws:\/\/\S+)/);if(m){clearTimeout(timer);resolve(m[1]);}});child.on('error',reject);});
  const debugPort=new URL(endpoint).port;let page;
  for(let i=0;i<100;i++){const pages=await(await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();page=pages.find(candidate=>candidate.type==='page');if(page)break;await sleep(80);}
  if(!page?.webSocketDebuggerUrl)throw new Error('Chrome page target not found');
  socket=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  socket.addEventListener('message',event=>{const message=JSON.parse(String(event.data));if(!message.id){if(message.method==='Runtime.exceptionThrown'||message.method==='Log.entryAdded'||message.method==='Runtime.consoleAPICalled'){browserEvents.push(message);if(browserEvents.length>40)browserEvents.shift();}return;}const item=pending.get(message.id);if(!item)return;pending.delete(message.id);clearTimeout(item.timer);message.error?item.reject(new Error(message.error.message)):item.resolve(message.result);});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error(`Timeout: ${method}`));},30_000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression:`(async()=>{${expression}})()`,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);return result.result?.value;};
  await send('Page.enable');await send('Runtime.enable');await send('Log.enable');await send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:`http://127.0.0.1:${port}/`});
  for(let i=0;i<120;i++){if(await evaluate('return window.ready===true'))break;await sleep(100);}
  if(!await evaluate('return window.ready===true')){const state=await evaluate('return {failure:window.failure??null,ready:window.ready??null,readyState:document.readyState,href:location.href}');throw new Error('Player not ready: '+JSON.stringify(state)+'\nCDP: '+JSON.stringify(browserEvents.slice(-12)));}
  const duration=await evaluate('return window.demo.duration'),fps=30,frames=Math.round(duration*fps),silent=join(out,'m3-human-abuse-silent.mp4');
  const available=await ffmpegEncoders(),videoCodec=ffmpegVideoArgs(available),audioCodec=ffmpegAudioArgs(available);
  console.log('ffmpeg codecs',JSON.stringify({video:videoCodec,audio:audioCodec}));
  const encoder=spawn('ffmpeg',['-y','-hide_banner','-loglevel','error','-f','image2pipe','-vcodec','png','-framerate',String(fps),'-i','pipe:0','-an',...videoCodec,'-movflags','+faststart',silent],{stdio:['pipe','inherit','inherit']});
  const completed=once(encoder,'exit');
  for(let frame=0;frame<frames;frame++){
    await evaluate(`await window.demo.frame(${frame/fps}); return true;`);
    const frameFailure=await evaluate('return window.failure??null');
    if(frameFailure)throw new Error(`Browser failure at frame ${frame}: ${frameFailure}`);
    const shot=await send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false}),png=Buffer.from(shot.data,'base64');
    if(!encoder.stdin.write(png))await once(encoder.stdin,'drain');
    if(frame%120===0)console.log(`vehicle-abuse ${frame}/${frames}`);
  }
  encoder.stdin.end();const [videoCode]=await completed;if(videoCode!==0)throw new Error(`ffmpeg video exit ${videoCode}`);
  const events=await evaluate('return window.demo.events()'),telemetry=await evaluate('return window.demo.telemetry()'),evidence=await evaluate('return window.demo.inspect()');
  if(evidence.errors?.length)throw new Error('Renderer errors: '+JSON.stringify(evidence.errors));
  await writeFile(join(out,'events.json'),JSON.stringify(events,null,2));await writeFile(join(out,'telemetry.json'),JSON.stringify(telemetry));await writeFile(join(out,'evidence.json'),JSON.stringify(evidence,null,2));
  const audio=renderAudio(events,duration,48_000,0);
  const ambience=renderAmbience([
    {time:0,listener:[4.5,1.5,-4],target:[.4,.9,0],vehicle:[0,0,0],speedMps:0},
    {time:duration,listener:[3.0,1.3,-2.5],target:[.4,1.0,0],vehicle:[0,0,0],speedMps:0},
  ],duration,{sampleRate:48_000,seed:26092026,windSpeedMps:.9,vehicleGain:0});
  for(let i=0;i<audio.left.length;i++){audio.left[i]=Math.tanh(audio.left[i]+ambience.left[i]*.42);audio.right[i]=Math.tanh(audio.right[i]+ambience.right[i]*.42);}
  const wav=join(out,'m3-human-abuse.wav');await writeFile(wav,wavBytes(audio));
  const final=join(out,'m3-human-abuse.mp4'),mux=spawn('ffmpeg',['-y','-hide_banner','-loglevel','error','-i',silent,'-i',wav,'-c:v','copy',...audioCodec,'-shortest','-movflags','+faststart',final],{stdio:['ignore','inherit','inherit']});
  const [muxCode]=await once(mux,'exit');if(muxCode!==0)throw new Error(`ffmpeg mux exit ${muxCode}`);
  console.log(JSON.stringify({final,duration,frames,events:events.length,evidence},null,2));
}finally{
  socket?.close();for(const item of pending.values())clearTimeout(item.timer);if(!child.killed)child.kill();await Promise.race([once(child,'exit'),sleep(1000)]);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(profile,{recursive:true,force:true});
}

async function ffmpegEncoders(){
  return await new Promise((resolve,reject)=>{
    const child=spawn('ffmpeg',['-hide_banner','-encoders'],{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
    child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);child.once('error',reject);
    child.once('exit',code=>code===0?resolve(stdout):reject(new Error('ffmpeg -encoders failed: '+stderr)));
  });
}
function ffmpegVideoArgs(encoders){
  const candidates=[
    ['libx264',['-c:v','libx264','-profile:v','high','-level:v','4.0','-crf','18']],
    ['h264_mf',['-c:v','h264_mf','-rate_control','quality','-quality','88']],
    ['h264_videotoolbox',['-c:v','h264_videotoolbox','-q:v','80']],
    ['h264_amf',['-c:v','h264_amf','-quality','quality']],
    ['h264_qsv',['-c:v','h264_qsv','-global_quality','20']],
    ['h264_nvenc',['-c:v','h264_nvenc','-preset','p5','-cq','20']],
  ];
  for(const [name,args] of candidates)if(encoders.includes(name))return[...args,'-pix_fmt','yuv420p'];
  throw new Error('No H.264 encoder available in ffmpeg');
}
function ffmpegAudioArgs(encoders){
  if(encoders.includes(' aac '))return['-c:a','aac','-b:a','192k'];
  if(encoders.includes(' libmp3lame '))return['-c:a','libmp3lame','-b:a','192k'];
  throw new Error('No AAC/MP3 encoder available in ffmpeg');
}

async function chromePath(){
  const env=process.env.CHROME_PATH??process.env.GOOGLE_CHROME_BIN;if(env&&await exists(env))return env;
  const candidates=process.platform==='darwin'?['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Chromium.app/Contents/MacOS/Chromium']:process.platform==='win32'?['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe']:['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser'];
  for(const candidate of candidates)if(await exists(candidate))return candidate;throw new Error('Chrome/Chromium not found. Set CHROME_PATH.');
}
async function exists(path){try{await access(path,FS.X_OK);return true;}catch{return false;}}
