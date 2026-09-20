#!/usr/bin/env node
import {spawn,type ChildProcess} from 'node:child_process';
import {access,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {constants as FS} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,extname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {serveScene} from './cli/server.js';
import {wavBytes} from './audio/synth.js';
import {renderSceneAudio} from './audio/offline.js';
import {decodeScene,sceneURL} from './scene/url.js';
import {validateScene} from './scene/validate.js';
import type {SceneSpec} from './scene/types.js';

const args=process.argv.slice(2),command=args.shift()??'help';
const distributionDirectory=dirname(fileURLToPath(import.meta.url));

async function main(){
  if(command==='help'||command==='--help'||command==='-h'){help();return;}
  if(command==='validate'){const file=need(args.shift(),'scene file');const scene=await loadSceneFile(file);console.log(JSON.stringify({ok:true,entities:scene.entities.length,version:scene.version},null,2));return;}
  if(command==='url'){const file=need(args.shift(),'scene file'),base=option('--base')??'http://localhost:4173/';console.log(sceneURL(await loadSceneFile(file),base));return;}
  if(command==='decode'){const token=need(args.shift(),'scene token');console.log(JSON.stringify(decodeScene(token),null,2));return;}
  if(command==='serve'){const file=args[0]&&!args[0]!.startsWith('--')?args.shift():undefined,port=numberOption('--port',4173);const scene=file?await loadSceneFile(file):undefined;const host=await serveScene(scene,{port,...(file?{sceneDirectory:dirname(resolve(file))}:{})});console.log(`Game Engine: ${host.url}`);await new Promise<void>((resolve,reject)=>{host.server.on('close',resolve);host.server.on('error',reject);});return;}
  if(command==='render'){const file=need(args.shift(),'scene file'),out=resolve(option('--out')??'frame.png'),time=numberOption('--time',0),width=numberOption('--width',1280),height=numberOption('--height',720);await render(await loadSceneFile(file),{out,time,width,height},dirname(resolve(file)));console.log(out);return;}
  if(command==='record'){const file=need(args.shift(),'scene file'),out=resolve(option('--out')??'scene.mp4'),fps=numberOption('--fps',60),duration=numberOption('--duration',3),from=numberOption('--from',0),width=numberOption('--width',1920),height=numberOption('--height',1080);await record(await loadSceneFile(file),{out,fps,duration,from,width,height},dirname(resolve(file)));console.log(out);return;}
  if(command==='profile'){const file=need(args.shift(),'scene file'),out=resolve(option('--out')??'render-profile.json'),duration=numberOption('--duration',5),warmup=numberOption('--warmup',2),from=numberOption('--from',0),width=numberOption('--width',1280),height=numberOption('--height',720);const report=await profileScene(await loadSceneFile(file),{duration,warmup,from,width,height},dirname(resolve(file)));await writeFile(out,JSON.stringify(report,null,2));console.log(out);return;}
  throw new Error(`Unknown command: ${command}`);
}

function help(){console.log(`game-engine — deterministic scene runtime\n\nUsage:\n  game-engine serve [scene.ts|scene.json] [--port 4173]\n  game-engine url <scene> [--base https://example.com/]\n  game-engine validate <scene>\n  game-engine render <scene> --time 2.5 --out frame.png [--width 1280 --height 720]\n  game-engine record <scene> --duration 8 --fps 60 --out shot.mp4 [--from 0]\n  game-engine profile <scene> --duration 5 --warmup 2 --out render-profile.json [--width 1280 --height 720]\n\nScene modules export a SceneSpec as default. JSON is accepted directly.\nReferenced local material images resolve inside the scene file directory.\nrender/record use an installed Chromium/Chrome and no browser automation package.`);}
function need<T>(value:T|undefined,label:string):T{if(value===undefined)throw new Error(`Missing ${label}`);return value;}
function option(name:string):string|undefined{const i=args.indexOf(name);if(i<0)return;const value=args[i+1];if(!value||value.startsWith('--'))throw new Error(`${name} requires a value`);return value;}
function numberOption(name:string,fallback:number):number{const raw=option(name);if(raw===undefined)return fallback;const value=Number(raw);if(!Number.isFinite(value))throw new Error(`${name} must be numeric`);return value;}
async function loadSceneFile(file:string):Promise<SceneSpec>{const path=resolve(file),ext=extname(path).toLowerCase();if(ext==='.json')return validateScene(JSON.parse(await readFile(path,'utf8')));if(ext==='.ts'||ext==='.mts'||ext==='.cts'){const url=pathToFileURL(path).href,script=`const m=await import(${JSON.stringify(url)});process.stdout.write(JSON.stringify(m.default??m.scene));`;return validateScene(JSON.parse(await capture(process.execPath,['--experimental-strip-types','--no-warnings','--input-type=module','-e',script])));}const module=await import(pathToFileURL(path).href);return validateScene(module.default??module.scene);}

interface RenderOptions{out:string;time:number;width:number;height:number}
async function render(scene:SceneSpec,options:RenderOptions,sceneDirectory:string):Promise<void>{const host=await serveScene(scene,{sceneDirectory,distributionDirectory});let browser:BrowserSession|undefined;try{browser=await BrowserSession.launch(`${host.url}&play=0`,options.width,options.height);await browser.ready();await browser.evaluate(`const engine=window.__GAME_ENGINE__;engine.seek(${JSON.stringify(options.time)});await engine.flush();for(let i=0;i<7;i++){engine.render();await engine.drain();}true`);await assertBrowserRenderer(browser);await writeFile(options.out,await browser.screenshot());}finally{await browser?.close();await host.close();}}
interface RecordOptions{out:string;fps:number;duration:number;from:number;width:number;height:number}
async function record(scene:SceneSpec,options:RecordOptions,sceneDirectory:string):Promise<void>{
  if(!(options.fps>0&&options.fps<=240)||!(options.duration>0&&options.duration<=3600)||!Number.isFinite(options.from)||options.from<0||options.from+options.duration>86_400)throw new RangeError('Invalid recording fps/duration/from');
  const frames=Math.ceil(options.fps*options.duration),host=await serveScene(scene,{sceneDirectory});
  let browser:BrowserSession|undefined,directory:string|undefined;
  try{
    directory=await mkdtemp(join(tmpdir(),'game-engine-'));
    browser=await BrowserSession.launch(`${host.url}&play=0`,options.width,options.height);await browser.ready();
    for(let frame=0;frame<frames;frame++){
      const time=options.from+frame/options.fps;
      await browser.evaluate(`window.__GAME_ENGINE__.seek(${JSON.stringify(time)}); await window.__GAME_ENGINE__.flush(); true`);
      await writeFile(join(directory,`frame-${String(frame).padStart(6,'0')}.png`),await browser.screenshot());
    }
    await assertBrowserRenderer(browser);
    const audioPath=join(directory,'audio.wav'),sound=renderSceneAudio(scene,options.duration,{startTime:options.from,sampleRate:48_000});
    await writeFile(audioPath,wavBytes(sound.audio));
    const codec=await ffmpegCodecArgs(),audio=await ffmpegAudioArgs();
    await run('ffmpeg',['-y','-loglevel','error','-framerate',String(options.fps),'-i',join(directory,'frame-%06d.png'),'-i',audioPath,...codec,...audio,'-movflags','+faststart','-shortest',options.out]);
  }finally{
    try{await browser?.close();}finally{try{await host.close();}finally{if(directory)await rm(directory,{recursive:true,force:true});}}
  }
}

interface ProfileOptions{duration:number;warmup:number;from:number;width:number;height:number}
async function profileScene(scene:SceneSpec,options:ProfileOptions,sceneDirectory:string){
  if(!(options.duration>0&&options.duration<=15)||!(options.warmup>=0&&options.warmup<=60)||!Number.isFinite(options.from)||options.from<0||options.from>86_400)throw new RangeError('Invalid profile duration/warmup/from');
  const host=await serveScene(scene,{sceneDirectory});let browser:BrowserSession|undefined;
  try{
    browser=await BrowserSession.launch(`${host.url}&play=0&profile=1`,options.width,options.height);await browser.ready();
    const report=await browser.evaluate(`
      const engine=window.__GAME_ENGINE__;
      engine.seek(${JSON.stringify(options.from)});await engine.flush();
      engine.resume();await new Promise(r=>setTimeout(r,${Math.round(options.warmup*1000)}));engine.pause();await engine.drain();
      engine.resetProfile();
      const wallStart=performance.now(),simulationStart=engine.inspect().time;
      engine.resume();await new Promise(r=>setTimeout(r,${Math.round(options.duration*1000)}));engine.pause();
      const wallEnd=performance.now();await engine.drain();await new Promise(r=>setTimeout(r,0));
      const inspection=engine.inspect(),profile=engine.profile();
      return {wallSeconds:(wallEnd-wallStart)/1000,simulatedSeconds:inspection.time-simulationStart,simulationToWallRatio:(inspection.time-simulationStart)*1000/(wallEnd-wallStart),profile,renderer:inspection.renderer};
    `);
    await assertBrowserRenderer(browser);return{version:1,width:options.width,height:options.height,from:options.from,duration:options.duration,warmup:options.warmup,...report};
  }finally{await browser?.close();await host.close();}
}

async function assertBrowserRenderer(browser:BrowserSession):Promise<void>{const inspect=await browser.evaluate(`return window.__GAME_ENGINE__.inspect()`),errors=inspect?.renderer?.errors;if(Array.isArray(errors)&&errors.length)throw new Error('WebGPU validation errors: '+errors.join(' | '));if(!(inspect?.renderer?.drawCalls>0)&&!(inspect?.renderer?.triangles>0))throw new Error('Renderer produced no geometry');}

class BrowserSession{
  private constructor(private readonly process:ChildProcess,private readonly socket:WebSocket,private readonly profile:string){socket.addEventListener('message',event=>{const message=JSON.parse(String(event.data));if(!message.id)return;const pending=this.pending.get(message.id);if(!pending)return;this.pending.delete(message.id);message.error?pending.reject(new Error(message.error.message)):pending.resolve(message.result);});}
  private sequence=0;private readonly pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void}>();
  static async launch(url:string,width:number,height:number):Promise<BrowserSession>{const chrome=await chromePath(),profile=await mkdtemp(join(tmpdir(),'game-engine-chrome-')),flags=['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-extensions','--hide-scrollbars','--enable-unsafe-webgpu',`--user-data-dir=${profile}`,'--remote-debugging-port=0',`--window-size=${width},${height}`];if(process.getuid?.()===0)flags.push('--no-sandbox');flags.push('about:blank');const child=spawn(chrome,flags,{stdio:['ignore','pipe','pipe']});const wsBrowser=await devtoolsURL(child),port=Number(new URL(wsBrowser).port);let page:any;for(let i=0;i<100;i++){try{const list=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as any[];page=list.find(item=>item.type==='page');if(page?.webSocketDebuggerUrl)break;}catch{}await sleep(50);}if(!page?.webSocketDebuggerUrl){child.kill();throw new Error('Chrome page DevTools target not found');}const socket=new WebSocket(page.webSocketDebuggerUrl);await new Promise<void>((resolve,reject)=>{socket.addEventListener('open',()=>resolve(),{once:true});socket.addEventListener('error',()=>reject(new Error('CDP WebSocket failed')),{once:true});});const session=new BrowserSession(child,socket,profile);await session.send('Runtime.enable');await session.send('Page.enable');await session.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});const navigation=await session.send('Page.navigate',{url});if(navigation?.errorText)throw new Error(`Chrome navigation failed: ${navigation.errorText} (${url})`);return session;}
  send(method:string,params:Record<string,unknown>={}):Promise<any>{return new Promise((resolve,reject)=>{const id=++this.sequence;this.pending.set(id,{resolve,reject});this.socket.send(JSON.stringify({id,method,params}));});}
  async evaluate(expression:string):Promise<any>{const result=await this.send('Runtime.evaluate',{expression:`(async()=>{${expression}})()`,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);return result.result?.value;}
  async ready():Promise<void>{let diagnostic:any=null;for(let i=0;i<300;i++){try{if(await this.evaluate(`return Boolean(window.__GAME_ENGINE__)`))return;diagnostic=await this.evaluate(`return {ready:document.readyState,error:document.documentElement.dataset.engineError??null,url:location.href}`);if(diagnostic?.error)break;}catch(error){diagnostic=String(error);}await sleep(50);}throw new Error(`Browser runtime did not become ready: ${JSON.stringify(diagnostic)}`);}
  async screenshot():Promise<Buffer>{const result=await this.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});return Buffer.from(result.data,'base64');}
  async close():Promise<void>{try{this.socket.close();}catch{}if(!this.process.killed)this.process.kill();await Promise.race([new Promise(resolve=>this.process.once('exit',resolve)),sleep(1000)]);await rm(this.profile,{recursive:true,force:true});}
}
async function devtoolsURL(child:ChildProcess):Promise<string>{return await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(new Error(`Chrome DevTools endpoint timeout: ${text.slice(-1000)}`)),10_000);const onData=(chunk:Buffer)=>{text+=chunk.toString();const match=text.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timer);resolve(match[1]!);}};child.stderr!.on('data',onData);child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',code=>{if(code!==null){clearTimeout(timer);reject(new Error(`Chrome exited before DevTools was ready (${code}): ${text.slice(-1000)}`));}});});}
async function chromePath():Promise<string>{const env=process.env.CHROME_PATH??process.env.GOOGLE_CHROME_BIN;if(env&&await exists(env))return env;const candidates=process.platform==='darwin'?['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Chromium.app/Contents/MacOS/Chromium']:process.platform==='win32'?['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe']:['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser'];for(const candidate of candidates)if(await exists(candidate))return candidate;throw new Error('Chrome/Chromium not found. Set CHROME_PATH.');}
async function exists(path:string):Promise<boolean>{try{await access(path,FS.X_OK);return true;}catch{return false;}}
function sleep(ms:number){return new Promise(resolve=>setTimeout(resolve,ms));}
async function capture(binary:string,argv:string[]):Promise<string>{return await new Promise<string>((resolve,reject)=>{const child=spawn(binary,argv,{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);child.once('error',reject);child.once('exit',code=>code===0?resolve(stdout):reject(new Error(`${binary} exited with ${code}: ${stderr}`)));});}
async function ffmpegAudioArgs():Promise<string[]>{const encoders=await capture('ffmpeg',['-hide_banner','-encoders']);if(encoders.includes(' aac '))return['-c:a','aac','-b:a','160k'];if(encoders.includes(' libmp3lame '))return['-c:a','libmp3lame','-b:a','160k'];throw new Error('ffmpeg has neither AAC nor MP3 audio encoder');}
async function ffmpegCodecArgs():Promise<string[]>{const encoders=await capture('ffmpeg',['-hide_banner','-encoders']);const candidates:[string,string[]][]=[['libx264',['-c:v','libx264','-profile:v','high','-level:v','4.0','-crf','18']],['h264_mf',['-c:v','h264_mf','-rate_control','quality','-quality','75']],['h264_videotoolbox',['-c:v','h264_videotoolbox','-q:v','65']],['h264_amf',['-c:v','h264_amf','-quality','quality']],['h264_qsv',['-c:v','h264_qsv','-global_quality','20']],['h264_nvenc',['-c:v','h264_nvenc','-preset','p5','-cq','20']]];for(const [name,args] of candidates)if(encoders.includes(name))return[...args,'-pix_fmt','yuv420p'];throw new Error('No H.264 encoder is available in ffmpeg. Install a full ffmpeg build with libx264 or a platform H.264 encoder; refusing to emit an incompatible mp4v .mp4 file.');}
async function run(binary:string,argv:string[]):Promise<void>{await new Promise<void>((resolve,reject)=>{const child=spawn(binary,argv,{stdio:'inherit'});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`${binary} exited with ${code}`)));});}

main().catch(error=>{console.error(error instanceof Error?error.stack??error.message:String(error));process.exitCode=1;});
