#!/usr/bin/env node
/** Capture the actual character editor and its WebGPU viewport with Chrome/CDP.
 * Hardware is required unless CHARACTER_ALLOW_SOFTWARE=1 is explicitly supplied.
 * Software captures prove editor interactions only and are labelled accordingly.
 */
import {createHash,randomUUID} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir,mkdtemp,readFile,readdir,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import {dirname,join,relative,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {inflateSync} from 'node:zlib';

const directory=dirname(fileURLToPath(import.meta.url));
const root=resolve(directory,'../..');
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const delay=ms=>new Promise(yes=>setTimeout(yes,ms));
const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;
const equal=(a,b)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
function check(condition,message){if(!condition)throw new Error(message);}

export function validateAdapter(adapter,{allowSoftware=false}={}){
  check(adapter&&typeof adapter==='object','The renderer did not acquire a WebGPU adapter');
  const description=['vendor','architecture','device','description'].map(key=>adapter[key]??'').join(' ');
  check(description.trim().length>0,'The WebGPU adapter has no inspectable identity');
  const software=adapter.isFallbackAdapter===true||/swiftshader|lavapipe|llvmpipe|software|microsoft basic render|warp\b/i.test(description);
  check(allowSoftware||!software,'Hardware WebGPU required; software adapter rejected: '+JSON.stringify(adapter));
  return software?'webgpu-software':'webgpu-hardware';
}

export function validateInspection(inspection,previousFrame=0){
  const renderer=inspection?.renderer;
  check(renderer?.backend==='webgpu','Character editor must use the engine WebGPU renderer');
  check(Number.isFinite(renderer.drawCalls)&&renderer.drawCalls>0&&Number.isFinite(renderer.triangles)&&renderer.triangles>0,'The character renderer submitted no geometry');
  check(Array.isArray(renderer.errors)&&renderer.errors.length===0,'WebGPU render errors: '+JSON.stringify(renderer.errors));
  const frames=inspection.renderedFrames;
  check(Number.isSafeInteger(frames)&&frames>previousFrame,`No fresh rendered frame: ${frames} after ${previousFrame}`);
  check(renderer.width>0&&renderer.height>0,'The renderer has an empty canvas');
  return frames;
}

/** Decode Chrome's non-interlaced RGB/RGBA PNG, independently of the page.
 * This catches empty or truncated files and reports observable image variation.
 */
export function inspectPng(bytes){
  check(bytes.length>=33&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'Capture is not a PNG');
  let width=0,height=0,channels=0,ended=false;
  const compressed=[];
  for(let at=8;at<bytes.length;){
    check(at+12<=bytes.length,'Truncated PNG chunk');
    const length=bytes.readUInt32BE(at),type=bytes.toString('ascii',at+4,at+8),end=at+12+length;
    check(end<=bytes.length,'Truncated PNG payload');
    const data=bytes.subarray(at+8,at+8+length);
    if(type==='IHDR'){
      check(at===8&&length===13,'Invalid PNG header');
      width=data.readUInt32BE(0);height=data.readUInt32BE(4);
      check(width>0&&height>0&&width<=8192&&height<=8192,'Invalid PNG dimensions');
      check(data[8]===8&&(data[9]===2||data[9]===6)&&data[10]===0&&data[11]===0&&data[12]===0,'Expected an 8-bit non-interlaced RGB/RGBA screenshot');
      channels=data[9]===6?4:3;
    }else if(type==='IDAT')compressed.push(data);
    else if(type==='IEND'){check(length===0&&end===bytes.length,'Invalid PNG end');ended=true;break;}
    at=end;
  }
  check(ended&&width&&height&&compressed.length,'PNG has no complete image');
  const stride=width*channels,raw=inflateSync(Buffer.concat(compressed),{maxOutputLength:(stride+1)*height});
  check(raw.length===(stride+1)*height,'PNG scanlines do not match dimensions');
  const pixels=Buffer.alloc(stride*height);
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  for(let y=0;y<height;y++){
    const filter=raw[y*(stride+1)];check(filter<=4,'Unsupported PNG filter');
    for(let x=0;x<stride;x++){
      const left=x>=channels?pixels[y*stride+x-channels]:0,up=y?pixels[(y-1)*stride+x]:0,corner=y&&x>=channels?pixels[(y-1)*stride+x-channels]:0;
      const predictor=filter===0?0:filter===1?left:filter===2?up:filter===3?Math.floor((left+up)/2):paeth(left,up,corner);
      pixels[y*stride+x]=(raw[y*(stride+1)+1+x]+predictor)&255;
    }
  }
  const colours=new Set();let total=0,squares=0,samples=0;
  const step=Math.max(1,Math.floor(Math.sqrt(width*height/16000)));
  for(let y=0;y<height;y+=step)for(let x=0;x<width;x+=step){
    const at=y*stride+x*channels,r=pixels[at],g=pixels[at+1],b=pixels[at+2],l=.2126*r+.7152*g+.0722*b;
    colours.add((r>>3)*1024+(g>>3)*32+(b>>3));total+=l;squares+=l*l;samples++;
  }
  return{width,height,bytes:bytes.length,sha256:sha256(bytes),sampledColours:colours.size,luminanceDeviation:Math.sqrt(Math.max(0,squares/samples-(total/samples)**2))};
}

async function manifest(){
  const files=[];
  async function walk(path){
    if(!existsSync(path))return;
    const metadata=await stat(path);
    if(metadata.isDirectory()){
      for(const child of (await readdir(path)).sort())await walk(join(path,child));
    }else files.push({path:relative(root,path).replaceAll('\\','/'),sha256:sha256(await readFile(path)),bytes:metadata.size});
  }
  for(const name of ['src','dist','tools/character-creator','package.json','bun.lock','tsconfig.json','tsconfig.build.json'])await walk(join(root,name));
  check(files.some(file=>file.path.startsWith('dist/')),'Build the engine before capturing: bun run build');
  let gitRevision=null,gitDirty=null;
  try{gitRevision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();gitDirty=execFileSync('git',['status','--porcelain','--untracked-files=all','--','src','tools/character-creator','package.json','bun.lock','tsconfig.json','tsconfig.build.json'],{cwd:root,encoding:'utf8'}).trim();}catch(error){if(process.env.GITHUB_ACTIONS==='true')throw error;}
  const expectedRevision=process.env.GITHUB_SHA??gitRevision;
  if(process.env.GITHUB_ACTIONS==='true'){
    check(gitRevision===expectedRevision,`Capture checkout ${gitRevision} differs from GITHUB_SHA ${expectedRevision}`);
    check(!gitDirty,'Capture sources changed after checkout: '+gitDirty);
  }
  return{gitRevision,expectedRevision,dirty:gitDirty,sha256:sha256(JSON.stringify(files)),files};
}

async function locateChrome(){
  if(process.env.CHROME_PATH){check(existsSync(process.env.CHROME_PATH),'CHROME_PATH does not exist: '+process.env.CHROME_PATH);return process.env.CHROME_PATH;}
  const candidates=process.platform==='win32'?[
    join(process.env.ProgramFiles??'C:\\Program Files','Google/Chrome/Application/chrome.exe'),
    join(process.env['ProgramFiles(x86)']??'C:\\Program Files (x86)','Google/Chrome/Application/chrome.exe'),
    join(process.env.LOCALAPPDATA??'','Google/Chrome/Application/chrome.exe'),
    join(process.env.ProgramFiles??'C:\\Program Files','Chromium/Application/chrome.exe'),
  ]:process.platform==='darwin'?[
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Chromium.app/Contents/MacOS/Chromium',
  ]:['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser'];
  const cache=process.env.PLAYWRIGHT_BROWSERS_PATH??join(homedir(),'.cache/ms-playwright');
  if(existsSync(cache))for(const entry of await readdir(cache))if(entry.startsWith('chromium-'))candidates.push(join(cache,entry,'chrome-linux64/chrome'),join(cache,entry,'chrome-linux/chrome'));
  const chrome=candidates.find(existsSync);
  check(chrome,'Chrome/Chromium not found. Set CHROME_PATH to the installed browser executable.');return chrome;
}

const gpuInstrumentation=`(() => {
  const records=[];
  Object.defineProperty(window,'__CHARACTER_CAPTURE_GPU__',{value:records});
  const gpu=navigator.gpu;
  if(!gpu)return;
  const requestAdapter=gpu.requestAdapter.bind(gpu);
  Object.defineProperty(gpu,'requestAdapter',{value:async options=>{
    const adapter=await requestAdapter(options);if(!adapter)return null;
    const info=adapter.info??await adapter.requestAdapterInfo?.()??{};
    const record={vendor:info.vendor??'',architecture:info.architecture??'',device:info.device??'',description:info.description??'',isFallbackAdapter:adapter.isFallbackAdapter??info.isFallbackAdapter??false,requestedDevices:0,powerPreference:options?.powerPreference??null};
    records.push(record);
    const requestDevice=adapter.requestDevice.bind(adapter);
    Object.defineProperty(adapter,'requestDevice',{value:async descriptor=>{const device=await requestDevice(descriptor);record.requestedDevices++;return device;}});
    return adapter;
  }});
})();`;

export async function captureCharacterCreator(){
  const allowSoftware=process.env.CHARACTER_ALLOW_SOFTWARE==='1';
  check(!(allowSoftware&&process.env.CHARACTER_REQUIRE_HARDWARE==='1'),'CHARACTER_ALLOW_SOFTWARE contradicts CHARACTER_REQUIRE_HARDWARE');
  const startedAt=new Date().toISOString(),token=randomUUID(),sources=await manifest();
  const evidence={schemaVersion:1,startedAt,completedAt:null,token,source:sources,run:{id:process.env.GITHUB_RUN_ID??null,attempt:process.env.GITHUB_RUN_ATTEMPT??null,workflow:process.env.GITHUB_WORKFLOW??null},mode:allowSoftware?'interaction-only-software-allowed':'hardware-required',hardwareProof:false,status:'running',adapters:[],checks:[],screenshots:[],browserErrors:[]};
  const output=resolve(process.env.CHARACTER_CAPTURE_OUTPUT??join(root,'artifacts'));
  await mkdir(output,{recursive:true});
  for(const name of await readdir(output))if(/^character-creator-.*\.(png|json)$/.test(name))await rm(join(output,name));
  const evidencePath=join(output,'character-creator-evidence.json');
  let profile,downloads,server,child,stderr='',socket,sequence=0,closed=false,lastFrame=0,documentId='served-editor';
  const pending=new Map();
  const cleanup=async()=>{
    if(closed)return;closed=true;
    for(const request of pending.values()){clearTimeout(request.timer);request.reject(new Error('Capture closed'));}pending.clear();
    socket?.close();
    if(child&&child.exitCode===null){child.kill();for(let i=0;i<40&&child.exitCode===null;i++)await delay(50);}
    if(server){server.closeAllConnections?.();await new Promise(yes=>server.close(yes));}
    if(profile)for(let i=0;i<5;i++){try{await rm(profile,{recursive:true,force:true});break;}catch(error){if(i===4)console.warn('Could not remove Chrome temporary profile:',error.message);else await delay(200);}}
  };
  try{
    const chrome=await locateChrome();profile=await mkdtemp(join(tmpdir(),'character-creator-'));
    downloads=join(profile,'downloads');await mkdir(downloads);
    const {startServer}=await import('./server.mjs');
    server=await startServer({port:0,host:'127.0.0.1'});
    const args=['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-extensions','--enable-unsafe-webgpu','--enable-gpu','--ignore-gpu-blocklist','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--window-size=1440,1000'];
    if(process.platform==='linux'){args.push('--disable-dev-shm-usage');if(process.getuid?.()===0)args.push('--no-sandbox');}
    if(allowSoftware)args.push('--enable-features=Vulkan','--use-angle=swiftshader','--use-vulkan=swiftshader','--use-webgpu-adapter=swiftshader','--disable-vulkan-surface');
    args.push('about:blank');
    child=spawn(chrome,args,{stdio:['ignore','ignore','pipe']});
    child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-20000);});
    const endpoint=await new Promise((yes,no)=>{
      const timer=setTimeout(()=>no(new Error('Chrome DevTools startup timed out: '+stderr)),30000);
      const inspect=()=>{const match=stderr.match(/DevTools listening on (ws:\/\/\S+)/);if(match){clearTimeout(timer);yes(match[1]);}};
      child.stderr.on('data',inspect);
      child.once('error',error=>{clearTimeout(timer);no(error);});
      child.once('exit',code=>{clearTimeout(timer);no(new Error(`Chrome exited ${code}: ${stderr}`));});inspect();
    });
    const debugPort=new URL(endpoint).port;
    const targets=await(await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    const target=targets.find(entry=>entry.type==='page'&&entry.webSocketDebuggerUrl);check(target,'Chrome has no page target');
    socket=new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((yes,no)=>{socket.addEventListener('open',yes,{once:true});socket.addEventListener('error',no,{once:true});});
    socket.addEventListener('message',event=>{
      const message=JSON.parse(String(event.data));
      if(message.method==='Runtime.exceptionThrown')evidence.browserErrors.push({type:'exception',details:message.params.exceptionDetails});
      if(message.method==='Runtime.consoleAPICalled'&&message.params.type==='error')evidence.browserErrors.push({type:'console',args:message.params.args.map(arg=>arg.value??arg.description??arg.type)});
      if(message.method==='Log.entryAdded'&&message.params.entry.level==='error')evidence.browserErrors.push({type:'log',entry:message.params.entry});
      if(message.method==='Network.requestWillBeSent'&&documentId==='standalone-file'){
        const {request,type}=message.params;
        if(/^https?:/i.test(request.url))evidence.standalone.httpRequests.push({url:request.url,method:request.method,type});
        if(type==='Document'&&request.url===evidence.standalone.href)evidence.standalone.documentRequestObserved=true;
      }
      const request=pending.get(message.id);if(!request)return;pending.delete(message.id);clearTimeout(request.timer);
      message.error?request.reject(new Error(message.error.message)):request.resolve(message.result);
    });
    const send=(method,params={})=>new Promise((yes,no)=>{
      const id=++sequence,timer=setTimeout(()=>{pending.delete(id);no(new Error('DevTools timeout: '+method));},60000);
      pending.set(id,{resolve:yes,reject:no,timer});socket.send(JSON.stringify({id,method,params}));
    });
    const evaluate=async expression=>{
      const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
      if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);
      return result.result?.value;
    };
    const assertBrowser=async()=>{
      const fatal=await evaluate('window.__CHARACTER_ERROR__??null');check(!fatal,'Character editor failed: '+fatal);
      check(evidence.browserErrors.length===0,'Browser errors: '+JSON.stringify(evidence.browserErrors));
    };
    const navigateReady=async(url,label)=>{
      const navigation=await send('Page.navigate',{url});check(!navigation.errorText,label+' navigation failed: '+navigation.errorText);
      for(let i=0;i<600;i++){
        let state;
        try{state=await evaluate('({href:location.href,ready:window.__CHARACTER_READY__===true,error:window.__CHARACTER_ERROR__??null})');}
        catch(error){if(!/Execution context was destroyed|Cannot find context with specified id|Cannot find default execution context/.test(error.message))throw error;await delay(100);continue;}
        // A previous document can remain observable briefly during navigation.
        // Its READY flag must never satisfy the new document's initialization.
        if(state.href===url){check(!state.error,label+' initialization failed: '+state.error);if(state.ready)return;}
        await delay(100);
      }
      throw new Error(label+' initialization timed out: '+stderr);
    };
    for(const method of ['Runtime.enable','Page.enable','Log.enable','Network.enable'])await send(method);
    await send('Page.addScriptToEvaluateOnNewDocument',{source:gpuInstrumentation});
    await send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});
    await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    const address=server.address();check(address&&typeof address==='object','Character server did not bind a TCP port');
    const pageURL=`http://127.0.0.1:${address.port}/?capture=1&captureToken=${encodeURIComponent(token)}`;
    await navigateReady(pageURL,'Served character editor');
    await evaluate('window.characterCreator.settle()');
    const initial=await evaluate('window.characterCreator.inspect()');
    check(await evaluate('new URL(location.href).searchParams.get("captureToken")')===token,'Capture run token was lost during navigation');
    if(sources.expectedRevision)check(initial.sourceRevision===sources.expectedRevision,`Served source revision ${initial.sourceRevision} differs from ${sources.expectedRevision}`);
    evidence.adapters=await evaluate('window.__CHARACTER_CAPTURE_GPU__');
    check(Array.isArray(evidence.adapters)&&evidence.adapters.some(adapter=>adapter.requestedDevices>0),'The editor created no observable WebGPU device');
    const activeAdapters=evidence.adapters.filter(adapter=>adapter.requestedDevices>0);
    const backends=activeAdapters.map(adapter=>validateAdapter(adapter,{allowSoftware}));
    evidence.backend=backends.includes('webgpu-software')?'webgpu-software':'webgpu-hardware';
    evidence.hardwareProof=!allowSoftware&&evidence.backend==='webgpu-hardware';
    evidence.checks.push({name:'source-and-adapter-provenance',passed:true,sourceRevision:initial.sourceRevision,adapterCount:activeAdapters.length});
    const initialSpec=await evaluate('window.characterCreator.getSpec()');

    const capture=async(name,{canvas=false}={})=>{
      await evaluate('window.characterCreator.settle()');await assertBrowser();
      const inspection=await evaluate('window.characterCreator.inspect()');lastFrame=validateInspection(inspection,lastFrame);
      const adapters=await evaluate('window.__CHARACTER_CAPTURE_GPU__');
      check(Array.isArray(adapters)&&adapters.some(adapter=>adapter.requestedDevices>0),'Current document created no observable WebGPU device');
      if(documentId==='standalone-file')evidence.standalone.adapters=adapters;else evidence.adapters=adapters;
      for(const adapter of adapters.filter(item=>item.requestedDevices>0))validateAdapter(adapter,{allowSoftware});
      const dimensions=await evaluate('({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth})');
      check(dimensions.scrollWidth<=dimensions.width+1,`Horizontal page overflow in ${name}: ${JSON.stringify(dimensions)}`);
      let clip;
      if(canvas){
        clip=await evaluate('(()=>{const c=document.querySelector("#viewport canvas");if(!c)throw new Error("Missing character viewport canvas");const r=c.getBoundingClientRect();const x=Math.max(0,Math.ceil(r.left)),y=Math.max(0,Math.ceil(r.top));return{x,y,width:Math.floor(Math.min(innerWidth,r.right))-x,height:Math.floor(Math.min(innerHeight,r.bottom))-y,scale:1};})()');
        check(clip.width>=200&&clip.height>=200,'Character viewport is clipped or hidden: '+JSON.stringify(clip));
      }
      const shot=await send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false,...(clip?{clip}:{})});
      const bytes=Buffer.from(shot.data,'base64'),png=inspectPng(bytes);
      check(png.width===(clip?.width??dimensions.width)&&png.height===(clip?.height??dimensions.height),'Screenshot dimensions differ from the requested viewport');
      check(png.sampledColours>=24&&png.luminanceDeviation>=4,`Suspiciously empty screenshot ${name}: ${JSON.stringify(png)}`);
      const filename=`character-creator-${name}.png`;await writeFile(join(output,filename),bytes);
      const spec=await evaluate('window.characterCreator.getSpec()');
      const record={name,documentId,file:filename,capturedAt:new Date().toISOString(),...png,viewport:dimensions,clip:clip??null,renderedFrames:lastFrame,revision:inspection.revision,pose:inspection.pose,camera:inspection.camera,metrics:inspection.metrics,renderer:inspection.renderer,spec,specSha256:sha256(JSON.stringify(ordered(spec)))};
      evidence.screenshots.push(record);console.log(JSON.stringify({capture:name,file:filename,backend:evidence.backend,width:png.width,height:png.height,frame:lastFrame,sha256:png.sha256}));
      return record;
    };

    await evaluate('window.characterCreator.setPose("idle",0)');
    await evaluate('window.characterCreator.setView("three-quarter")');
    await capture('desktop');await capture('three-quarter',{canvas:true});
    for(const view of ['front','side','back','face']){await evaluate(`window.characterCreator.setView(${JSON.stringify(view)})`);await capture(view,{canvas:true});}
    await evaluate('window.characterCreator.setView("three-quarter")');
    for(const pose of ['reach','t-pose']){await evaluate(`window.characterCreator.setPose(${JSON.stringify(pose)},0)`);await capture(pose,{canvas:true});}
    check(initialSpec.outfit.top==='parka','The default gait proof must render the parka recipe');
    await evaluate('window.characterCreator.setPose("walk",0.50)');
    await capture('parka-walk',{canvas:true});
    await evaluate('window.characterCreator.setPose("idle",0)');

    // Export must produce a real downloaded file, not only text on the page.
    await evaluate('document.querySelector("#tab-code").click()');
    await evaluate('(()=>{const button=document.querySelector("#export-json");if(!button)throw new Error("Missing JSON export control");button.click();})()');
    let exported,exportName;
    for(let i=0;i<200;i++){
      exportName=(await readdir(downloads)).find(name=>name.endsWith('.json'));
      if(exportName){exported=JSON.parse(await readFile(join(downloads,exportName),'utf8'));break;}await delay(50);
    }
    check(exported&&equal(exported,initialSpec),'Downloaded character JSON does not match the editor state');
    await writeFile(join(output,'character-creator-spec.json'),JSON.stringify(exported,null,2)+'\n');
    evidence.checks.push({name:'download-json-matches-spec',passed:true,filename:exportName});

    // Native keyboard input exercises the range element's actual input path.
    await evaluate('document.querySelector("#tab-body").click()');
    const range=await evaluate(`(()=>{const e=document.querySelector('input[type=range][data-path="body.height"]');if(!e)throw new Error("Missing height range");e.scrollIntoView({block:"center"});e.focus();return{value:Number(e.value),min:Number(e.min),max:Number(e.max)};})()`);
    const key=range.value!==range.max?'End':'Home',expectedHeight=key==='End'?range.max:range.min;
    for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key,code:key,windowsVirtualKeyCode:key==='End'?35:36,nativeVirtualKeyCode:key==='End'?35:36});
    await evaluate('window.characterCreator.settle()');
    const heightSpec=await evaluate('window.characterCreator.getSpec()');
    check(Math.abs(heightSpec.body.height-expectedHeight)<1e-8&&heightSpec.body.height!==initialSpec.body.height,'Height keyboard input did not update CharacterSpec');
    const heightInspection=await evaluate('window.characterCreator.inspect()');
    check(Math.abs(heightInspection.metrics.height-expectedHeight)<1e-8&&heightInspection.metrics.height!==initial.metrics.height,'Height control did not rebuild the measured character');
    await evaluate('document.querySelector("#tab-outfit").click()');
    const outfitChange=await evaluate(`(()=>{const e=document.querySelector('select[data-path="outfit.top"]');if(!e)throw new Error("Missing outfit selector");const before=e.value;const next=[...e.options].find(o=>!o.disabled&&o.value!==before);if(!next)throw new Error("No alternative outfit");e.value=next.value;e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));return{before,after:next.value};})()`);
    await evaluate('window.characterCreator.settle()');
    const variant=await evaluate('window.characterCreator.getSpec()');
    check(variant.outfit.top===outfitChange.after&&variant.outfit.top!==initialSpec.outfit.top,'Outfit control did not update CharacterSpec');
    await evaluate('window.characterCreator.setView("three-quarter")');
    await evaluate('window.characterCreator.setPose("walk",0.34)');
    await evaluate('window.scrollTo(0,0)');
    await capture('variant');await capture('variant-body',{canvas:true});
    evidence.checks.push({name:'height-keyboard-and-outfit-control',passed:true,heightBefore:initialSpec.body.height,heightAfter:variant.body.height,topBefore:outfitChange.before,topAfter:outfitChange.after});

    // A second edit during async geometry/material preparation must retain the
    // first edit, even before the first rendered scene has been published.
    const rapid=await evaluate(`(()=>{const hair=document.querySelector('input[data-path="colors.hair"]'),arms=document.querySelector('input[data-path="body.arms"]');hair.value=hair.value==='#403020'?'#654321':'#403020';hair.dispatchEvent(new Event('change',{bubbles:true}));arms.value=Number(arms.value)>1?'0.91':'1.19';arms.dispatchEvent(new Event('input',{bubbles:true}));arms.dispatchEvent(new Event('change',{bubbles:true}));return{hair:hair.value,arms:Number(arms.value)};})()`);
    await evaluate('window.characterCreator.settle()');
    const rapidSpec=await evaluate('window.characterCreator.getSpec()');
    check(rapidSpec.colors.hair===rapid.hair&&Math.abs(rapidSpec.body.arms-rapid.arms)<1e-8,'An overlapping edit discarded another requested field');
    evidence.checks.push({name:'overlapping-edits-retain-all-fields',passed:true,...rapid});

    // Re-import the exact exported file after changing the body and clothes.
    await evaluate('document.querySelector("#tab-code").click()');
    await evaluate(`(()=>{const editor=document.querySelector("#spec-json");const button=document.querySelector("#import-json");if(!editor||!button)throw new Error("Missing import controls");editor.value=${JSON.stringify(JSON.stringify(exported,null,2))};editor.dispatchEvent(new Event("input",{bubbles:true}));button.click();})()`);
    await evaluate('window.characterCreator.settle()');
    const imported=await evaluate('window.characterCreator.getSpec()');
    check(equal(imported,exported),'JSON import did not restore the complete exported character');
    const controls=await evaluate(`({height:Number(document.querySelector('input[data-path="body.height"]').value),top:document.querySelector('select[data-path="outfit.top"]').value})`);
    check(Math.abs(controls.height-imported.body.height)<1e-8&&controls.top===imported.outfit.top,'Imported state was not reflected in the controls');
    evidence.checks.push({name:'json-roundtrip-restores-spec-and-controls',passed:true});
    await evaluate('window.characterCreator.setPose("idle",0)');
    await evaluate('window.characterCreator.setView("three-quarter")');
    await evaluate('document.querySelector("#tab-body").click()');
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await evaluate('window.scrollTo(0,0)');
    await capture('mobile');await capture('mobile-body',{canvas:true});
    const finalInspection=await evaluate('window.characterCreator.inspect()');
    evidence.renderedFrames=finalInspection.renderedFrames;

    // Prove the delivered single file independently of the development server.
    // The same Chrome tab loads a new document and receives fresh GPU hooks.
    const standalonePath=join(root,'artifacts/character-creator.html');
    check(existsSync(standalonePath),'Build artifacts/character-creator.html before capture: node tools/character-creator/bundle.mjs');
    const standaloneBytes=await readFile(standalonePath),standaloneURL=pathToFileURL(standalonePath);
    standaloneURL.searchParams.set('capture','1');standaloneURL.searchParams.set('captureToken',token);
    evidence.standalone={status:'running',file:relative(root,standalonePath).replaceAll('\\','/'),bytes:standaloneBytes.length,sha256:sha256(standaloneBytes),href:standaloneURL.href,documentRequestObserved:false,httpRequests:[],adapters:[],previousDocumentLastFrame:lastFrame};
    await assertBrowser();
    server.closeAllConnections();await new Promise((yes,no)=>server.close(error=>error?no(error):yes()));server=null;
    evidence.standalone.serverStopped=true;
    await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    documentId='standalone-file';
    await navigateReady(standaloneURL.href,'Standalone character editor');
    lastFrame=0; // Renderer counters belong to one document, never across reloads.
    const fileState=await evaluate('({href:location.href,protocol:location.protocol,origin:location.origin,metadata:globalThis.__CHARACTER_BUILD_META__,captureToken:new URLSearchParams(location.search).get("captureToken")})');
    check(fileState.protocol==='file:'&&fileState.href===standaloneURL.href,'Standalone capture must come from the exact delivered file:// document');
    check(fileState.captureToken===token,'Standalone capture lost the current run token');
    check(fileState.metadata?.standalone===true,'Standalone document has no embedded standalone build metadata');
    check(fileState.metadata.sourceRevision===initial.sourceRevision,'Standalone HTML was built from another source revision');
    Object.assign(evidence.standalone,{origin:fileState.origin,protocol:fileState.protocol,metadata:fileState.metadata});
    await evaluate('window.characterCreator.settle()');
    const fileInitial=await evaluate('window.characterCreator.inspect()');
    check(fileInitial.sourceRevision===initial.sourceRevision,'Standalone renderer source revision differs from the served engine');
    lastFrame=validateInspection(fileInitial,0);evidence.standalone.initialRenderedFrames=lastFrame;evidence.standalone.initialRevision=fileInitial.revision;
    evidence.standalone.adapters=await evaluate('window.__CHARACTER_CAPTURE_GPU__');
    const fileAdapters=evidence.standalone.adapters.filter(adapter=>adapter.requestedDevices>0);
    check(fileAdapters.length>0,'Standalone file created no new WebGPU device');
    const fileBackends=fileAdapters.map(adapter=>validateAdapter(adapter,{allowSoftware}));
    evidence.standalone.backend=fileBackends.includes('webgpu-software')?'webgpu-software':'webgpu-hardware';
    evidence.standalone.hardwareProof=!allowSoftware&&evidence.standalone.backend==='webgpu-hardware';

    const presetPoint=await evaluate(`(()=>{const button=document.querySelector('button[data-preset="mechanic"]');if(!button||button.disabled)throw new Error('Missing active mechanic preset');button.scrollIntoView({block:'center'});const r=button.getBoundingClientRect();if(r.width<20||r.height<20||r.bottom>innerHeight||r.top<0)throw new Error('Mechanic preset is not visible');return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...presetPoint,button:'left',clickCount:1});
    await evaluate('window.characterCreator.settle()');
    const {CHARACTER_PRESETS}=await import('../../dist/characters/character.js');
    const mechanic=CHARACTER_PRESETS.find(preset=>preset.id==='mechanic');check(mechanic,'Engine has no mechanic preset');
    const fileSpec=await evaluate('window.characterCreator.getSpec()');
    check(equal(fileSpec,mechanic.spec),'Standalone preset click did not apply the complete mechanic recipe');
    const selectedInspection=await evaluate('window.characterCreator.inspect()');
    check(selectedInspection.revision>fileInitial.revision,'Standalone preset click did not commit a new character scene');
    check(await evaluate(`document.querySelector('button[data-preset="mechanic"]').getAttribute('aria-pressed')`)==='true','Standalone preset selection was not reflected in the editor');
    await evaluate('window.characterCreator.setPose("idle",0)');
    await evaluate('window.characterCreator.setView("three-quarter")');
    await evaluate('window.scrollTo(0,0)');
    const standaloneShot=await capture('standalone-mechanic');
    evidence.standalone.screenshot=standaloneShot.file;evidence.standalone.renderedFrames=standaloneShot.renderedFrames;
    evidence.standalone.resourceTiming=await evaluate(`(()=>{const resources=performance.getEntriesByType('resource');return{count:resources.length,protocols:[...new Set(resources.map(resource=>new URL(resource.name).protocol))],httpResources:resources.filter(resource=>/^https?:/i.test(resource.name)).map(resource=>({url:resource.name,type:resource.initiatorType}))};})()`);
    check(evidence.standalone.documentRequestObserved,'CDP did not observe loading the delivered file:// HTML');
    check(evidence.standalone.httpRequests.length===0&&evidence.standalone.resourceTiming.httpResources.length===0,'Standalone editor attempted HTTP asset or metadata requests: '+JSON.stringify(evidence.standalone.httpRequests));
    check(sha256(await readFile(standalonePath))===evidence.standalone.sha256,'Standalone HTML changed after being loaded for capture');
    evidence.standalone.status='passed';
    evidence.renderedFrames+=standaloneShot.renderedFrames;
    evidence.checks.push({name:'standalone-file-preset-and-no-http',passed:true,file:evidence.standalone.file,sha256:evidence.standalone.sha256,sourceRevision:fileState.metadata.sourceRevision,backend:evidence.standalone.backend,hardwareProof:evidence.standalone.hardwareProof,initialFrames:evidence.standalone.initialRenderedFrames,finalFrames:standaloneShot.renderedFrames,screenshot:standaloneShot.file});

    check(new Set(evidence.screenshots.map(shot=>shot.sha256)).size===evidence.screenshots.length,'Two requested captures are identical; a view or state update may have been lost');
    const finalSources=await manifest();check(finalSources.sha256===sources.sha256,'Source or compiled engine changed during capture');
    await assertBrowser();
    evidence.checks.push({name:'fresh-distinct-frames-and-stable-source',passed:true,screenshots:evidence.screenshots.length});
    evidence.status='passed';
  }catch(error){
    evidence.status='failed';evidence.hardwareProof=false;evidence.error=error?.stack??String(error);evidence.chromeStderr=stderr;
    if(evidence.standalone&&evidence.standalone.status!=='passed'){evidence.standalone.status='failed';evidence.standalone.hardwareProof=false;}
    throw error;
  }finally{
    evidence.completedAt=new Date().toISOString();
    try{await writeFile(evidencePath,JSON.stringify(evidence,null,2)+'\n');}finally{await cleanup();}
  }
  console.log(JSON.stringify({status:evidence.status,hardwareProof:evidence.hardwareProof,mode:evidence.mode,screenshots:evidence.screenshots.length,evidence:evidencePath}));
  return evidence;
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)await captureCharacterCreator();
