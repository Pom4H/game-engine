#!/usr/bin/env node
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,join,extname,relative,isAbsolute,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';

const root=resolve(import.meta.dirname,'../..'),output=resolve(root,process.env.RENDER_STABILITY_OUTPUT??'artifacts/render-stability');
const chrome=process.env.CHROME_PATH??['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(existsSync);
if(!chrome)throw new Error('Set CHROME_PATH to a native WebGPU browser');
const width=Number(process.env.RENDER_STABILITY_WIDTH??480),height=Number(process.env.RENDER_STABILITY_HEIGHT??270);
if(![width,height].every(value=>Number.isSafeInteger(value)&&value>=64&&value<=2048))throw new RangeError('Invalid render stability dimensions');
if(!existsSync(join(root,'dist/render/probe-capture.js')))throw new Error('Build the engine before running render stability verification');
await mkdir(output,{recursive:true});
const server=createServer(async(req,res)=>{
 try{
  const path=new URL(req.url,'http://localhost').pathname;
  if(req.method!=='GET'){res.writeHead(405);res.end();return;}
  if(path==='/'){res.setHeader('content-type','text/html');res.end('<!doctype html><title>Native render stability</title><style>body{margin:0;background:#111}canvas{width:100vw;height:100vh}</style><canvas></canvas><script type="module" src="/tools/render-stability/client.mjs"></script>');return;}
  const file=resolve(root,'.'+decodeURIComponent(path)),within=relative(root,file);
  const allowed=path.startsWith('/dist/')||path.startsWith('/tools/render-stability/')||['/tools/agent-office/taa-resolve-check.mjs','/tools/agent-office/taa-finite-check.mjs'].includes(path);
  if(within.startsWith('..')||isAbsolute(within)||!allowed){res.writeHead(404);res.end();return;}
  res.setHeader('content-type',['.js','.mjs'].includes(extname(file))?'text/javascript':'application/octet-stream');res.end(await readFile(file));
 }catch(error){res.writeHead(error.code==='ENOENT'?404:500);res.end(String(error));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const profileDir=await mkdtemp(join(tmpdir(),'engine-render-stability-'));
const child=spawn(chrome,['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-extensions','--enable-unsafe-webgpu','--enable-gpu','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--user-data-dir='+profileDir,'--window-size='+width+','+height,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms)),pending=new Map(),browserErrors=[];let stderr='',startupError,ws,id=0,send,report;
child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-16000);});child.on('error',error=>{startupError=error;});
try{
 let port;for(let n=0;n<200;n++){if(startupError)throw startupError;if(child.exitCode!==null)throw new Error('Browser exited: '+stderr);try{port=Number((await readFile(join(profileDir,'DevToolsActivePort'),'utf8')).split('\n')[0]);if(port)break;}catch{}await delay(50);}
 if(!port)throw new Error('Native browser startup timed out: '+stderr);
 const pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json(),page=pages.find(page=>page.type==='page');if(!page)throw new Error('No browser page');
 ws=new WebSocket(page.webSocketDebuggerUrl);
 ws.addEventListener('message',event=>{const message=JSON.parse(String(event.data));if(message.method==='Runtime.exceptionThrown')browserErrors.push(message.params.exceptionDetails);const request=pending.get(message.id);if(request){pending.delete(message.id);clearTimeout(request.timer);message.error?request.reject(new Error(message.error.message)):request.resolve(message.result);}});
 ws.addEventListener('close',()=>{for(const request of pending.values()){clearTimeout(request.timer);request.reject(new Error('Native browser connection closed'));}pending.clear();});
 await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 send=(method,params={})=>new Promise((resolve,reject)=>{const requestId=++id,timer=setTimeout(()=>{pending.delete(requestId);reject(new Error(method+' timed out'));},120000);pending.set(requestId,{resolve,reject,timer});ws.send(JSON.stringify({id:requestId,method,params}));});
 const evaluate=async expression=>{const response=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(response.exceptionDetails)throw new Error(response.exceptionDetails.exception?.description??response.exceptionDetails.text);return response.result.value;};
 await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/'});
 let ready=false;for(let n=0;n<200;n++){if(await evaluate("document.documentElement.dataset.ready==='1'")){ready=true;break;}if(browserErrors.length)throw new Error(JSON.stringify(browserErrors));await delay(50);}if(!ready)throw new Error('Native regression client did not initialize');
 console.log(JSON.stringify({event:'begin',width,height,browser:chrome}));
 report=await evaluate('runRenderStability('+JSON.stringify({width,height,trace:process.env.ENGINE_TRACE==='1'})+')');report.browserErrors=browserErrors;report.browser=chrome;report.width=width;report.height=height;report.generatedAt=new Date().toISOString();
 if(process.env.ENGINE_TRACE==='1'){const capture=await evaluate('globalThis.enginePerformanceCapture??null'),trace=await evaluate('globalThis.enginePerformanceTrace??null');if(capture)await writeFile(join(output,'capture.json'),JSON.stringify(capture,null,2));if(trace)await writeFile(join(output,'trace.json'),JSON.stringify(trace,null,2));}
 if(browserErrors.length)report.status='failed';
 const png=await evaluate('globalThis.renderStabilityImage??null');if(png)await writeFile(join(output,'native-render.png'),Buffer.from(png.split(',')[1],'base64'));
 await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({event:report.status,adapter:report.adapter,scenarios:report.scenarios?.map(s=>({scenario:s.scenario,cpuMs:s.cpuMs})),probePixels:report.probePixels,taa:report.taa,rendererErrors:report.rendererErrors,report:join(output,'report.json')}));
 if(report.status!=='passed')throw new Error(report.error??'Native render stability regression failed');
}catch(error){
 report={...report,status:'failed',error:String(error),browserErrors,browser:chrome,stderr};await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));console.error(error);process.exitCode=1;
}finally{
 try{if(send&&ws?.readyState===WebSocket.OPEN)await Promise.race([send('Browser.close'),delay(2000)]);}catch{}
 ws?.close();server.close();
 if(child.exitCode===null){await Promise.race([new Promise(resolve=>child.once('exit',resolve)),delay(2000)]);if(child.exitCode===null){child.kill();await Promise.race([new Promise(resolve=>child.once('exit',resolve)),delay(2000)]);}}
 // Delete only this freshly created profile, after checking its absolute target.
 const target=resolve(profileDir),within=relative(resolve(tmpdir()),target);
 if(within&&!within.startsWith('..')&&!isAbsolute(within)&&basename(target).startsWith('engine-render-stability-'))for(let n=0;n<10;n++){try{await rm(target,{recursive:true,force:true});break;}catch{await delay(100);}}
 for(const request of pending.values())clearTimeout(request.timer);pending.clear();
}
