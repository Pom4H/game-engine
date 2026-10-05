import {mkdtemp,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import {startTeaServer} from './server.mjs';

export async function createWebGpuCapture({root,width,height,planPath,audioPath,pagePath='/tools/tea-scene/player.html'}){
  if(!['/tools/tea-scene/player.html','/tools/tea-performance/player.html','/tools/face-lab/player.html'].includes(pagePath))throw new RangeError('Unknown tea capture page');
  const chrome=process.env.CHROME_PATH;if(!chrome)throw new Error('CHROME_PATH is required for WebGPU capture');
  const server=await startTeaServer({root,planPath,audioPath});
  const profile=await mkdtemp(join(tmpdir(),'winter-tea-'));
  const software=process.env.TEA_SOFTWARE_GPU==='1';
  const args=['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-extensions','--hide-scrollbars','--enable-unsafe-webgpu','--enable-gpu','--ignore-gpu-blocklist',`--user-data-dir=${profile}`,'--remote-debugging-port=0',`--window-size=${width},${height}`];
  if(process.platform==='linux'&&process.getuid?.()===0)args.push('--no-sandbox');
  if(software)args.push('--enable-features=Vulkan','--use-angle=swiftshader','--use-vulkan=swiftshader','--use-webgpu-adapter=swiftshader','--disable-vulkan-surface');
  args.push('about:blank');
  const child=spawn(chrome,args,{stdio:['ignore','ignore','pipe']}),pending=new Map();
  let socket,sequence=0,stderr='';
  child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-20000);});
  const close=async()=>{
    socket?.close();for(const request of pending.values())clearTimeout(request.timer);pending.clear();
    if(child.exitCode===null){child.kill();await Promise.race([once(child,'exit'),new Promise(yes=>setTimeout(yes,1000))]);}
    server.closeAllConnections();await new Promise(yes=>server.close(yes));await rm(profile,{recursive:true,force:true});
  };
  try{
    const endpoint=await new Promise((yes,no)=>{
      const timer=setTimeout(()=>no(new Error('Chrome DevTools timeout: '+stderr)),20000);
      const inspect=()=>{const match=stderr.match(/DevTools listening on (ws:\/\/\S+)/);if(match){clearTimeout(timer);yes(match[1]);}};
      child.stderr.on('data',inspect);child.once('error',error=>{clearTimeout(timer);no(error);});child.once('exit',code=>{clearTimeout(timer);no(new Error(`Chrome exited ${code}: ${stderr}`));});inspect();
    });
    const debugPort=new URL(endpoint).port;
    const pages=await(await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json(),page=pages.find(p=>p.type==='page');
    if(!page)throw new Error('Chrome page target unavailable');
    socket=new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((yes,no)=>{socket.addEventListener('open',yes,{once:true});socket.addEventListener('error',no,{once:true});});
    socket.addEventListener('message',event=>{const message=JSON.parse(String(event.data));if(!message.id){if(message.method==='Runtime.exceptionThrown')stderr=(stderr+'\nPAGE_EXCEPTION '+JSON.stringify(message.params.exceptionDetails)).slice(-20000);if(message.method==='Runtime.consoleAPICalled'&&message.params.type==='error')stderr=(stderr+'\nPAGE_ERROR '+JSON.stringify(message.params.args)).slice(-20000);return;}const request=pending.get(message.id);if(!request)return;pending.delete(message.id);clearTimeout(request.timer);message.error?request.reject(new Error(message.error.message)):request.resolve(message.result);});
    const send=(method,params={})=>new Promise((yes,no)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);no(new Error('DevTools timeout: '+method));},60000);pending.set(id,{resolve:yes,reject:no,timer});socket.send(JSON.stringify({id,method,params}));});
    const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result?.value;};
    await send('Page.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}${pagePath}?capture=1&width=${width}&height=${height}`});
    let state;
    for(let i=0;i<600;i++){state=await evaluate('({ready:window.teaReady===true,error:window.teaError??null})');if(state.error)throw new Error(state.error);if(state.ready)break;await new Promise(yes=>setTimeout(yes,100));}
    if(!state?.ready)throw new Error('Tea player did not initialize: '+JSON.stringify(await evaluate('({url:location.href,stage:window.labStage,state:document.readyState,html:document.body.innerHTML.slice(0,300)})'))+'\n'+stderr);
    const adapter=await evaluate("(async()=>{const a=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});if(!a)return null;const i=a.info??{};return {vendor:i.vendor,architecture:i.architecture,device:i.device,description:i.description,isFallbackAdapter:a.isFallbackAdapter??i.isFallbackAdapter??false};})()");
    if(!adapter)throw new Error('No WebGPU adapter');
    const isSoftware=software||adapter.isFallbackAdapter||/swiftshader|lavapipe|llvmpipe|software|microsoft basic render/i.test(JSON.stringify(adapter));
    if(process.env.TEA_REQUIRE_HARDWARE==='1'&&isSoftware)throw new Error('Hardware WebGPU requested, software adapter reported: '+JSON.stringify(adapter));
    return{duration:await evaluate('window.teaScene.duration'),kind:isSoftware?'webgpu-software':'webgpu-hardware',adapter,
      async frame(timeS){
        const state=await evaluate(`window.teaScene.frame(${timeS})`);
        const screenshot=await send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});
        return{...state,bytes:Buffer.from(screenshot.data,'base64')};
      },close,
    };
  }catch(error){await close();throw error;}
}
