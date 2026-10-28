#!/usr/bin/env node
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,join,extname,relative,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';

const root=resolve(import.meta.dirname,'../..'),output=resolve(root,'artifacts/gpu-visibility');
const chrome=process.env.CHROME_PATH??['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(existsSync);
if(!chrome)throw new Error('Set CHROME_PATH to a native WebGPU browser');
const frames=Number(process.env.VISIBILITY_FRAMES??120),warmup=Number(process.env.VISIBILITY_WARMUP??32),width=Number(process.env.VISIBILITY_WIDTH??1920),height=Number(process.env.VISIBILITY_HEIGHT??1080);
const counts=(process.env.VISIBILITY_COUNTS??'5000,10000').split(',').map(Number),scenarios=(process.env.VISIBILITY_SCENARIOS??'static,camera-motion').split(',');
if(!Number.isSafeInteger(frames)||frames<8||frames>1024||!Number.isSafeInteger(warmup)||warmup<0||warmup>512||!counts.every(count=>Number.isSafeInteger(count)&&count>=4&&count<=100000)||!scenarios.every(scenario=>['static','camera-motion'].includes(scenario)))throw new RangeError('Invalid benchmark parameters');
if(!Number.isSafeInteger(width)||width<1||width>4096||!Number.isSafeInteger(height)||height<1||height>4096)throw new RangeError('Invalid benchmark resolution');
await mkdir(output,{recursive:true});
const server=createServer(async(req,res)=>{
 try{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/'){res.setHeader('content-type','text/html');res.end('<!doctype html><style>body{margin:0}canvas{width:100vw;height:100vh}</style><canvas></canvas><script type="module" src="/tools/gpu-visibility/client.mjs"></script>');return;}
  const file=resolve(root,'.'+decodeURIComponent(path)),within=relative(root,file);
  if(within.startsWith('..')||isAbsolute(within)||!path.startsWith('/dist/')&&!path.startsWith('/tools/gpu-visibility/')){res.writeHead(404);res.end();return;}
  res.setHeader('content-type',['.js','.mjs'].includes(extname(file))?'text/javascript':'application/octet-stream');res.end(await readFile(file));
 }catch(error){res.writeHead(500);res.end(String(error));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const profileDir=await mkdtemp(join(tmpdir(),'engine-visibility-'));
// CDP selects a free debugging port; all measurements use the native adapter.
const child=spawn(chrome,['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-extensions','--enable-unsafe-webgpu','--enable-gpu','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--user-data-dir='+profileDir,'--window-size='+width+','+height,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let stderr='',ws,id=0;const pending=new Map(),browserErrors=[],results=[];let failure;
child.stderr.on('data',chunk=>stderr+=chunk);child.on('error',error=>failure=error);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
 let port;for(let n=0;n<200;n++){if(failure)throw failure;try{port=Number((await readFile(join(profileDir,'DevToolsActivePort'),'utf8')).split('\n')[0]);if(port)break;}catch{}await delay(50);}
 if(!port)throw new Error('Browser startup failed: '+stderr.slice(-2000));
 const pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json(),page=pages.find(page=>page.type==='page');ws=new WebSocket(page.webSocketDebuggerUrl);
 ws.addEventListener('message',event=>{const message=JSON.parse(String(event.data));if(message.method==='Runtime.exceptionThrown')browserErrors.push(message.params.exceptionDetails);const request=pending.get(message.id);if(request){pending.delete(message.id);message.error?request.reject(new Error(message.error.message)):request.resolve(message.result);}});
 ws.addEventListener('close',()=>{for(const request of pending.values())request.reject(new Error('Browser connection closed'));pending.clear();});
 await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const requestId=++id;pending.set(requestId,{resolve,reject});ws.send(JSON.stringify({id:requestId,method,params}));});
 const evaluate=async expression=>{const response=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(response.exceptionDetails)throw new Error(response.exceptionDetails.exception?.description??response.exceptionDetails.text);return response.result.value;};
 await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/'});
 let ready=false;for(let n=0;n<200;n++){if(await evaluate("document.documentElement.dataset.ready==='1'")){ready=true;break;}if(browserErrors.length)throw new Error(JSON.stringify(browserErrors));await delay(50);}if(!ready)throw new Error('Benchmark page did not initialize');
 for(const count of counts)for(const scenario of scenarios)for(const mode of ['cpu','cpu-batched','gpu']){
  console.log(JSON.stringify({event:'begin',count,scenario,mode}));
  const result=await evaluate('runVisibilityBenchmark('+JSON.stringify({count,scenario,mode,frames,warmup,width,height})+')');
  const png=await evaluate('visibilityImage');await writeFile(join(output,`${count}-${scenario}-${mode}.png`),Buffer.from(png.split(',')[1],'base64'));
  results.push(result);await writeFile(join(output,'report.json'),JSON.stringify({version:1,status:'running',results},null,2));
  console.log(JSON.stringify({event:'result',count,scenario,mode,cpuP95:result.cpuMs.p95,gpuP95:result.gpuMs?.p95Ms,intervalP95:result.frameIntervalMs.p95,fps:result.fps,uploadMean:result.uploadBytes.mean,visible:result.render.visibility?.diagnostics?.visibleInstances}));
 }
 const comparisons=[];
 for(const count of counts)for(const scenario of scenarios){
  const group=results.filter(result=>result.count===count&&result.scenario===scenario),reference=group.find(result=>result.mode==='cpu');
  for(const result of group.filter(result=>result.mode!=='cpu')){
   let maxError=0,rms=0;for(let n=0;n<reference.linear.length;n++)for(let channel=0;channel<4;channel++){const error=Math.abs(reference.linear[n].rgba[channel]-result.linear[n].rgba[channel]);maxError=Math.max(maxError,error);rms+=error*error;}
   const diagnostic=result.qualityRender.visibility?.diagnostics,referenceDiagnostic=group.find(result=>result.mode==='cpu-batched')?.qualityRender.visibility?.diagnostics;
   const comparison={count,scenario,mode:result.mode,replayMatch:result.replayHash===reference.replayHash&&result.afterHash===reference.afterHash,sourceMatch:result.sourceHash===reference.sourceHash,linearMaxError:maxError,linearRmsError:Math.sqrt(rms/(reference.linear.length*4)),pixelComparison:result.pixelComparison,measuredPixelComparison:result.measuredPixelComparison,timestampQueries:result.timestampQueries,indirectDraws:result.render.visibility?.batches??0,visibilityFrame:diagnostic?.frame,visibleCountsMatch:diagnostic?.frame===referenceDiagnostic?.frame&&diagnostic?.visibleInstances===referenceDiagnostic?.visibleInstances};
   comparisons.push(comparison);
   if(!comparison.replayMatch||!comparison.sourceMatch||maxError>.002||[comparison.pixelComparison,comparison.measuredPixelComparison].some(pixels=>pixels.maxError>2||pixels.rmsError>.1)||!comparison.indirectDraws||!comparison.visibleCountsMatch)throw new Error('Crossover correctness gate failed: '+JSON.stringify(comparison));
  }
 }
 const frameBudgetMs=1000/60,budgetChecks=results.filter(result=>result.mode==='gpu').map(result=>({count:result.count,scenario:result.scenario,passed:result.cpuMs.p95<=frameBudgetMs&&result.gpuMs.p95Ms<=frameBudgetMs&&result.frameIntervalMs.p95<=frameBudgetMs})),frameBudgetPassed=budgetChecks.every(check=>check.passed);
 const report={version:1,status:'correctness-passed',frameBudgetMs,frameBudgetPassed,budgetChecks,note:'Performance is measured separately; a passed correctness check does not establish 60 FPS. CPU is still the default.',results,comparisons};
 await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({event:'correctness-passed',frameBudgetPassed,report:join(output,'report.json'),comparisons}));
 if(process.env.VISIBILITY_REQUIRE_60FPS==='1'&&!frameBudgetPassed){console.error('60 FPS p95 frame budget exceeded');process.exitCode=1;}
}catch(error){await writeFile(join(output,'report.json'),JSON.stringify({version:1,status:'failed',error:String(error),results,browserErrors},null,2));console.error(error);process.exitCode=1;}
finally{
 ws?.close();server.close();child.kill();await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));
 // Only the freshly created, resolved temp profile is removed.
 const tempRoot=resolve(tmpdir()),target=resolve(profileDir),within=relative(tempRoot,target);if(within&&!within.startsWith('..')&&!isAbsolute(within))for(let n=0;n<10;n++){try{await rm(target,{recursive:true,force:true});break;}catch{await delay(100);}}
}
