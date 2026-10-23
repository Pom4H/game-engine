// Chrome/V8 CPU-only same-input proxy; no WebGPU adapter, device, or game service.
import {spawn} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
const dir=resolve('artifacts/render-model-clip-v8-20261021'),profile=join(dir,'chrome-profile-'+Date.now());mkdirSync(profile,{recursive:true});
const build=await Bun.build({entrypoints:['test/fixtures/model-clip-standalone-benchmark.mjs'],outdir:dir,naming:'benchmark.js',target:'browser',format:'esm'});if(!build.success)throw Error(build.logs.join('\n'));
const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){return new URL(req.url).pathname==='/benchmark.js'?new Response(Bun.file(join(dir,'benchmark.js')),{headers:{'content-type':'text/javascript'}}):new Response('<!doctype html><script type="module">import{benchmarkModelClipPairs}from"/benchmark.js";window.runBenchmark=benchmarkModelClipPairs;window.ready=true;</script>',{headers:{'content-type':'text/html'}});}});
const exe=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);if(!exe)throw Error('Browser missing');
const child=spawn(exe,['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-extensions','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
let ws:WebSocket|undefined,id=0;const pending=new Map<number,any>(),delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
try{
 let port=0;for(let n=0;n<200;n++){try{port=Number(readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);if(port)break;}catch{}await delay(50);}if(!port)throw Error('CDP unavailable');
 const pages:any=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();ws=new WebSocket(pages.find((p:any)=>p.type==='page').webSocketDebuggerUrl);
 ws.addEventListener('message',e=>{const m=JSON.parse(String(e.data)),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}});await new Promise((r,j)=>{ws!.addEventListener('open',r,{once:true});ws!.addEventListener('error',j,{once:true});});
 const send=(method:string,params:any={})=>new Promise<any>((resolve,reject)=>{const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(Error('CDP timeout '+method));},60000);pending.set(n,{resolve:(r:any)=>{clearTimeout(timer);resolve(r);},reject});ws!.send(JSON.stringify({id:n,method,params}));});
 const evaluate=async(expression:string)=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result?.value;};
 await send('Page.navigate',{url:'http://127.0.0.1:'+server.port});for(let n=0;n<200;n++){if(await evaluate('!!window.ready'))break;await delay(50);}
 const runtime=await evaluate('({userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,timerTimeOrigin:performance.timeOrigin})');
 const result=await evaluate('window.runBenchmark({repeats:32,pairs:25,warmup:12})');
 const report={status:'measured',scope:'Allocation-free alternating paired Chrome/V8 CPU-only synthetic spotlight inputs; NOT actual-r7 data, game FPS or isolated performance acceptance. Concurrent Game correctness suite; OS power plan unchanged.',runtime,result};
 writeFileSync(join(dir,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({runtime,results:result.results.map((r:any)=>({label:r.label,callsPerSample:r.callsPerSample,distribution:r.rejectedPlaneOrAccepted,original:r.originalMs,staged:r.stagedMs,pairedRatio:r.pairedRatio}))}));
}finally{ws?.close();child.kill();await server.stop(true);}
