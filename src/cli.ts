#!/usr/bin/env node
import {spawn,type ChildProcess} from 'node:child_process';
import {access,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {constants as FS} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,extname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {serveScene} from './cli/server.js';
import {wavBytes} from './audio/synth.js';
import {renderSceneAudio} from './audio/offline.js';
import {decodeScene,sceneURL} from './scene/url.js';
import {validateScene} from './scene/validate.js';
import type {AppearancePatch,SceneSpec} from './scene/types.js';

const args=process.argv.slice(2),command=args.shift()??'help';
const distributionDirectory=dirname(fileURLToPath(import.meta.url));

async function main(){
  if(command==='help'||command==='--help'||command==='-h'){help();return;}
  if(command==='validate'){const file=need(args.shift(),'scene file');const scene=await loadSceneFile(file);console.log(JSON.stringify({ok:true,entities:scene.entities.length,version:scene.version},null,2));return;}
  if(command==='url'){const file=need(args.shift(),'scene file'),base=option('--base')??'http://localhost:4173/';console.log(sceneURL(await loadSceneFile(file),base));return;}
  if(command==='decode'){const token=need(args.shift(),'scene token');console.log(JSON.stringify(decodeScene(token),null,2));return;}
  if(command==='serve'){const file=args[0]&&!args[0]!.startsWith('--')?args.shift():undefined,port=numberOption('--port',4173);const scene=file?await loadSceneFile(file):undefined;const host=await serveScene(scene,{port,...(file?{sceneDirectory:dirname(resolve(file))}:{})});console.log(`Game Engine: ${host.url}`);await new Promise<void>((resolve,reject)=>{host.server.on('close',resolve);host.server.on('error',reject);});return;}
  if(command==='render'){const file=need(args.shift(),'scene file'),out=resolve(option('--out')??'frame.png'),time=numberOption('--time',0),width=numberOption('--width',1280),height=numberOption('--height',720);await render(await loadSceneFile(file),{out,time,width,height},dirname(resolve(file)));console.log(out);return;}
  if(command==='render-batch'){const manifest=need(args.shift(),'batch manifest'),outDir=resolve(option('--out-dir')??'artifacts/render-batch'),width=numberOption('--width',480),height=numberOption('--height',270),frames=numberOption('--frames',3),reference=option('--reference'),keep=numberOption('--keep',reference?3:128);const result=await renderBatch(manifest,{outDir,width,height,frames,keep,...(reference?{reference:resolve(reference)}:{})});console.log(JSON.stringify(result,null,2));return;}
  if(command==='probe'){const file=need(args.shift(),'scene file'),time=numberOption('--time',0),width=numberOption('--width',256),height=numberOption('--height',144),frames=numberOption('--frames',1),stage=(option('--stage')??'hdr') as 'hdr'|'reflection'|'effects'|'taa'|'all',raw=need(option('--pixels'),'--pixels JSON'),points=JSON.parse(raw) as [number,number][];if(!Number.isInteger(frames)||frames<1||frames>32)throw new RangeError('--frames must be an integer in [1,32]');if(!['hdr','reflection','effects','taa','all'].includes(stage))throw new TypeError('--stage must be hdr, reflection, effects, taa or all');if(!Array.isArray(points)||!points.every(p=>Array.isArray(p)&&p.length===2&&Number.isInteger(p[0])&&Number.isInteger(p[1])))throw new TypeError('--pixels must be JSON [[x,y],...]');const result=await probeScene(await loadSceneFile(file),{time,width,height,frames,stage,points},dirname(resolve(file)));console.log(JSON.stringify(result));return;}
  if(command==='record'){const file=need(args.shift(),'scene file'),out=resolve(option('--out')??'scene.mp4'),fps=numberOption('--fps',60),duration=numberOption('--duration',3),from=numberOption('--from',0),width=numberOption('--width',1920),height=numberOption('--height',1080);await record(await loadSceneFile(file),{out,fps,duration,from,width,height},dirname(resolve(file)));console.log(out);return;}
  if(command==='profile'){const file=need(args.shift(),'scene file'),out=resolve(option('--out')??'render-profile.json'),duration=numberOption('--duration',5),warmup=numberOption('--warmup',2),from=numberOption('--from',0),width=numberOption('--width',1280),height=numberOption('--height',720);const report=await profileScene(await loadSceneFile(file),{duration,warmup,from,width,height},dirname(resolve(file)));await writeFile(out,JSON.stringify(report,null,2));console.log(out);return;}
  throw new Error(`Unknown command: ${command}`);
}

function help(){console.log(`game-engine — deterministic scene runtime\n\nUsage:\n  game-engine serve [scene.ts|scene.json] [--port 4173]\n  game-engine url <scene> [--base https://example.com/]\n  game-engine validate <scene>\n  game-engine render <scene> --time 2.5 --out frame.png [--width 1280 --height 720]\n  game-engine render-batch <manifest.json|manifest.mjs> --out-dir artifacts/sweep [--reference ref.jpg] [--width 480 --height 360] [--frames 3] [--keep 3]\n  game-engine probe <scene> --pixels '[[64,48],[128,72]]' [--stage hdr|reflection|effects|taa|all] [--frames 1] [--width 256 --height 144]\n  game-engine record <scene> --duration 8 --fps 60 --out shot.mp4 [--from 0]\n  game-engine profile <scene> --duration 5 --warmup 2 --out render-profile.json [--width 1280 --height 720]\n\nScene modules export a SceneSpec as default. JSON is accepted directly.\nReferenced local material images resolve inside the scene file directory.\nrender/record use an installed Chromium/Chrome and no browser automation package.`);}
function need<T>(value:T|undefined,label:string):T{if(value===undefined)throw new Error(`Missing ${label}`);return value;}
function option(name:string):string|undefined{const i=args.indexOf(name);if(i<0)return;const value=args[i+1];if(!value||value.startsWith('--'))throw new Error(`${name} requires a value`);return value;}
function numberOption(name:string,fallback:number):number{const raw=option(name);if(raw===undefined)return fallback;const value=Number(raw);if(!Number.isFinite(value))throw new Error(`${name} must be numeric`);return value;}
async function loadSceneFile(file:string):Promise<SceneSpec>{const path=resolve(file),ext=extname(path).toLowerCase();if(ext==='.json')return validateScene(JSON.parse(await readFile(path,'utf8')));if(ext==='.ts'||ext==='.mts'||ext==='.cts'){const url=pathToFileURL(path).href,script=`const m=await import(${JSON.stringify(url)});process.stdout.write(JSON.stringify(m.default??m.scene));`;return validateScene(JSON.parse(await capture(process.execPath,['--experimental-strip-types','--no-warnings','--input-type=module','-e',script])));}const module=await import(pathToFileURL(path).href);return validateScene(module.default??module.scene);}

interface RenderOptions{out:string;time:number;width:number;height:number}
async function render(scene:SceneSpec,options:RenderOptions,sceneDirectory:string):Promise<void>{const host=await serveScene(scene,{sceneDirectory,distributionDirectory});let browser:BrowserSession|undefined;try{browser=await BrowserSession.launch(`${host.url}&play=0`,options.width,options.height);await browser.ready();await browser.evaluate(`const engine=window.__GAME_ENGINE__;engine.seek(${JSON.stringify(options.time)});await engine.flush();for(let i=0;i<7;i++){engine.render();await engine.drain();}true`);await assertBrowserRenderer(browser);await writeFile(options.out,await browser.screenshot());}finally{await browser?.close();await host.close();}}
interface ProbeOptions{time:number;width:number;height:number;frames:number;stage:'hdr'|'reflection'|'effects'|'taa'|'all';points:readonly [number,number][]}
async function probeScene(scene:SceneSpec,options:ProbeOptions,sceneDirectory:string){
  const host=await serveScene(scene,{sceneDirectory,distributionDirectory});let browser:BrowserSession|undefined;
  try{
    browser=await BrowserSession.launch(`${host.url}&play=0`,options.width,options.height);await browser.ready();
    const result=await browser.evaluate(`
      const engine=window.__GAME_ENGINE__;
      engine.seek(${JSON.stringify(options.time)});await engine.flush();
      for(let i=0;i<${JSON.stringify(options.frames)};i++){engine.render();await engine.drain();}
      if(${JSON.stringify(options.stage)}==='all')return {
        hdr:await engine.probeLinear(${JSON.stringify(options.points)},'hdr'),
        reflection:await engine.probeLinear(${JSON.stringify(options.points)},'reflection'),
        effects:await engine.probeLinear(${JSON.stringify(options.points)},'effects'),
        taa:await engine.probeLinear(${JSON.stringify(options.points)},'taa'),
      };
      return await engine.probeLinear(${JSON.stringify(options.points)},${JSON.stringify(options.stage)});
    `);
    await assertBrowserRenderer(browser);return options.stage==='all'?{version:1,width:options.width,height:options.height,time:options.time,frames:options.frames,stage:'all',samplesByStage:result}:{version:1,width:options.width,height:options.height,time:options.time,frames:options.frames,stage:options.stage,samples:result};
  }finally{await browser?.close();await host.close();}
}
interface RenderBatchOptions{outDir:string;width:number;height:number;frames:number;reference?:string;keep:number}
interface RenderBatchCapture{readonly id:string;readonly file?:string;readonly scene?:SceneSpec;readonly patch?:AppearancePatch;readonly time?:number;readonly frames?:number;readonly meta?:Record<string,unknown>}
interface RenderBatchManifest{readonly assetRoot?:string;readonly base?:string;readonly captures:readonly RenderBatchCapture[]}
async function prepareHeroMetric(browser:BrowserSession,reference:string):Promise<void>{
  await browser.evaluate(`
    const source=new Image();source.src=${JSON.stringify(reference)};await source.decode();
    const canvas=document.querySelector('canvas[data-game-engine]');
    if(!canvas)throw new Error('Game Engine canvas not found');
    const width=canvas.width,height=canvas.height,count=width*height;
    const current=new OffscreenCanvas(width,height),ctx=current.getContext('2d',{willReadFrequently:true});
    const target=new OffscreenCanvas(width,height),targetCtx=target.getContext('2d',{willReadFrequently:true});
    targetCtx.drawImage(source,0,0,width,height);
    const bp=targetCtx.getImageData(0,0,width,height).data;
    const Y=(p,i)=>.2126*p[i]+.7152*p[i+1]+.0722*p[i+2];
    const targetY=new Float64Array(count),currentY=new Float64Array(count),targetEdge=new Float64Array(count);
    for(let i=0;i<count;i++)targetY[i]=Y(bp,i*4);
    for(let y=0;y+1<height;y++)for(let x=0;x+1<width;x++){
      const i=y*width+x;
      targetEdge[i]=Math.hypot(targetY[i+1]-targetY[i],targetY[i+width]-targetY[i])/255;
    }
    const legacy=ap=>{
      let luma=0,chroma=0,edge=0,edgeN=0;
      for(let y=0;y<height;y++)for(let x=0;x<width;x++){
        const i=(y*width+x)*4,ay=Y(ap,i)/255,by=Y(bp,i)/255;
        luma+=Math.abs(ay-by);
        const ar=ap[i]/255,ag=ap[i+1]/255,ab=ap[i+2]/255,br=bp[i]/255,bg=bp[i+1]/255,bb=bp[i+2]/255;
        chroma+=(Math.abs((ar-ay)-(br-by))+Math.abs((ag-ay)-(bg-by))+Math.abs((ab-ay)-(bb-by)))/3;
        if(x+1<width&&y+1<height){const ix=i+4,iy=i+width*4;const ae=Math.hypot(Y(ap,ix)-Y(ap,i),Y(ap,iy)-Y(ap,i))/255,be=Math.hypot(Y(bp,ix)-Y(bp,i),Y(bp,iy)-Y(bp,i))/255;edge+=Math.abs(ae-be);edgeN++;}
      }
      return .55*(luma/(width*height))+.20*(chroma/(width*height))+.25*(edge/Math.max(1,edgeN));
    };
    const score=ap=>{
      for(let i=0;i<count;i++)currentY[i]=Y(ap,i*4);
      let luma=0,chroma=0,edge=0;
      for(let y=0;y<height;y++)for(let x=0;x<width;x++){
        const pixel=y*width+x,i=pixel*4,ay=currentY[pixel]/255,by=targetY[pixel]/255;
        luma+=Math.abs(ay-by);
        const ar=ap[i]/255,ag=ap[i+1]/255,ab=ap[i+2]/255,br=bp[i]/255,bg=bp[i+1]/255,bb=bp[i+2]/255;
        chroma+=(Math.abs((ar-ay)-(br-by))+Math.abs((ag-ay)-(bg-by))+Math.abs((ab-ay)-(bb-by)))/3;
        if(x+1<width&&y+1<height){const ae=Math.hypot(currentY[pixel+1]-currentY[pixel],currentY[pixel+width]-currentY[pixel])/255;edge+=Math.abs(ae-targetEdge[pixel]);}
      }
      return .55*(luma/count)+.20*(chroma/count)+.25*(edge/Math.max(1,(width-1)*(height-1)));
    };
    globalThis.__GE_HERO_METRIC__={
      screenshot:async(url,mode)=>{
        const image=new Image();image.src=url;await image.decode();ctx.drawImage(image,0,0,width,height);
        const ap=ctx.getImageData(0,0,width,height).data;
        return mode==='compare'?{cached:score(ap),legacy:legacy(ap)}:mode==='legacy'?legacy(ap):score(ap);
      }
    };
  `);
}
async function loadBatchManifest(file:string):Promise<RenderBatchManifest>{
  const path=resolve(file),ext=extname(path).toLowerCase();
  if(ext==='.json')return JSON.parse(await readFile(path,'utf8')) as RenderBatchManifest;
  const module=await import(pathToFileURL(path).href);return (module.default??module.manifest) as RenderBatchManifest;
}
function imageMime(path:string){const ext=extname(path).toLowerCase();return ext==='.jpg'||ext==='.jpeg'?'image/jpeg':ext==='.webp'?'image/webp':'image/png';}
function referenceDataUrl(path:string,bytes:Buffer){return `data:${imageMime(path)};base64,${bytes.toString('base64')}`;}
/**
 * Render-lab fast path: Chrome, WebGPU device, shader pipelines and mesh buffers are
 * warmed once, then Scene objects are swapped through the engine bridge. This turns
 * parameter sweeps into GPU work instead of repeated browser/runtime startup.
 */
async function renderBatch(manifestFile:string,options:RenderBatchOptions){
  if(!Number.isInteger(options.width)||!Number.isInteger(options.height)||options.width<16||options.height<9||options.width>4096||options.height>4096)throw new RangeError('batch dimensions must be integers in [16,4096]');
  if(!Number.isInteger(options.frames)||options.frames<1||options.frames>32)throw new RangeError('--frames must be an integer in [1,32]');
  if(!Number.isInteger(options.keep)||options.keep<0||options.keep>128)throw new RangeError('--keep must be an integer in [0,128]');
  const manifestPath=resolve(manifestFile),directory=dirname(manifestPath),manifest=await loadBatchManifest(manifestPath),captures=manifest.captures;
  if(!Array.isArray(captures)||captures.length<1||captures.length>128)throw new RangeError('batch manifest captures must contain 1..128 entries');
  const ids=new Set<string>();
  for(const capture of captures){
    if(typeof capture.id!=='string'||!/^[A-Za-z0-9._-]{1,80}$/.test(capture.id)||ids.has(capture.id))throw new TypeError('batch capture ids must be unique filesystem-safe names');
    ids.add(capture.id);
    const sources=Number(capture.file!==undefined)+Number(capture.scene!==undefined)+Number(capture.patch!==undefined);
    if(sources!==1)throw new TypeError(`batch capture ${capture.id} must provide exactly one of file, scene or patch`);
    if(capture.patch!==undefined&&!manifest.base)throw new TypeError(`batch capture ${capture.id} uses patch but manifest.base is missing`);
    const frames=capture.frames??options.frames;if(!Number.isInteger(frames)||frames<1||frames>32)throw new RangeError(`batch capture ${capture.id} frames must be in [1,32]`);
  }
  const baseScene=manifest.base?await loadSceneFile(resolve(directory,manifest.base)):undefined;
  const load=async(capture:RenderBatchCapture)=>capture.patch?baseScene!:capture.scene?validateScene(capture.scene):await loadSceneFile(resolve(directory,capture.file!));
  const first=await load(captures[0]!),assetRoot=resolve(directory,manifest.assetRoot??'.');
  const reference=options.reference?referenceDataUrl(options.reference,await readFile(options.reference)):undefined;
  await mkdir(options.outDir,{recursive:true});
  const host=await serveScene(first,{sceneDirectory:assetRoot,distributionDirectory});let browser:BrowserSession|undefined;
  const started=performance.now(),results:{id:string;milliseconds:number;metricMilliseconds?:number;heroGap?:number;meta?:Record<string,unknown>}[]=[],topFrames:{id:string;heroGap:number;png:Buffer}[]=[];
  try{
    browser=await BrowserSession.launch(`${host.url}&play=0`,options.width,options.height);await browser.ready();
    if(reference)await prepareHeroMetric(browser,reference);
    let metricPath:'cached'|'legacy'='cached',metricParityDelta:number|undefined;
    const warm=performance.now();
    for(let index=0;index<captures.length;index++){
      const capture=captures[index]!,scene=index===0?first:await load(capture),time=capture.time??0,frames=capture.frames??options.frames,begin=performance.now();
      const transition=capture.patch
        ?`engine.patchAppearance(${JSON.stringify(capture.patch)});`
        :(index===0?'':`await engine.replaceScene(${JSON.stringify(scene)});`);
      await browser.evaluate(`const engine=window.__GAME_ENGINE__;${transition}engine.seek(${JSON.stringify(time)});await engine.flush();for(let i=0;i<${JSON.stringify(frames)};i++){engine.render();await engine.drain();}true`);
      await assertBrowserRenderer(browser);
      if(capture.id==='road-magenta-0_055')console.log('ROAD_SNOW_RUNTIME',JSON.stringify(await browser.evaluate("return window.__GAME_ENGINE__.inspect().surfaces.surfaces.filter(s=>s.id==='road'||s.id==='hero-road-skin').map(s=>({id:s.id,snowDepthM:s.snowDepthM,trackMelt:s.trackMelt}))")));
      let heroGap:number|undefined,metricMilliseconds:number|undefined,candidatePng:Buffer|undefined;
      if(reference){
        const metricStart=performance.now();
        candidatePng=await browser.screenshot();
        // Keep the unmodified baseline even when every candidate beats it.
        // The fast visual loop still needs to inspect what production renders.
        if(index===0&&options.keep>0)await writeFile(join(options.outDir,`${capture.id}.png`),candidatePng);
        const dataUrl=`data:image/png;base64,${candidatePng.toString('base64')}`;
        if(index===0){
          const scores:{cached:number;legacy:number}=await browser.evaluate(`return await globalThis.__GE_HERO_METRIC__.screenshot(${JSON.stringify(dataUrl)},'compare')`);
          metricParityDelta=Math.abs(scores.cached-scores.legacy);
          if(!Number.isFinite(metricParityDelta)||metricParityDelta>1e-9)metricPath='legacy';
          heroGap=metricPath==='cached'?scores.cached:scores.legacy;
        }else{
          heroGap=await browser.evaluate(`return await globalThis.__GE_HERO_METRIC__.screenshot(${JSON.stringify(dataUrl)},${JSON.stringify(metricPath)})`);
        }
        metricMilliseconds=performance.now()-metricStart;
      }else{
        const out=join(options.outDir,`${capture.id}.png`);await writeFile(out,await browser.screenshot());
      }
      if(heroGap!==undefined&&options.keep>0&&(topFrames.length<options.keep||heroGap<topFrames[topFrames.length-1]!.heroGap)){
        topFrames.push({id:capture.id,heroGap,png:candidatePng??await browser.screenshot()});
        topFrames.sort((a,b)=>a.heroGap-b.heroGap);
        if(topFrames.length>options.keep)topFrames.pop();
      }
      results.push({id:capture.id,milliseconds:performance.now()-begin,...(heroGap===undefined?{}:{heroGap}),...(metricMilliseconds===undefined?{}:{metricMilliseconds}),...(capture.meta?{meta:capture.meta}:{})});
      console.log(JSON.stringify({capture:capture.id,index:index+1,total:captures.length,milliseconds:results[index]!.milliseconds,metricPath:reference?metricPath:null,heroGap}));
    }
    const ranked=[...results].sort((a,b)=>(a.heroGap??Infinity)-(b.heroGap??Infinity));
    for(const item of topFrames)await writeFile(join(options.outDir,`${item.id}.png`),item.png);
    const total=performance.now()-started,report={version:2,width:options.width,height:options.height,captures:results.length,startupMilliseconds:warm-started,batchMilliseconds:total-(warm-started),totalMilliseconds:total,meanHotCaptureMilliseconds:results.reduce((sum,item)=>sum+item.milliseconds,0)/results.length,metricPath:reference?metricPath:null,metricParityDelta:reference?metricParityDelta:null,best:ranked[0]??null,ranked,results};
    await writeFile(join(options.outDir,'report.json'),JSON.stringify(report,null,2));return report;
  }finally{await browser?.close();await host.close();}
}

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
