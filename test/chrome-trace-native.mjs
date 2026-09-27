import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {existsSync} from 'node:fs';
import assert from 'node:assert/strict';
import {recordChromeTrace} from '../tools/chrome-trace.mjs';
const chrome=process.env.CHROME_PATH??['/usr/bin/chromium','/usr/bin/google-chrome','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
if(!chrome)throw new Error('Set CHROME_PATH for the native trace test');
const profile=await mkdtemp(join(tmpdir(),'native-trace-test-'));
const browser=spawn(chrome,['--headless=new','--no-sandbox','--no-first-run','--disable-background-networking','--disable-extensions','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','ignore']});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let socket;
try {
 let port;for(let i=0;i<100;i++){try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);if(port)break;}catch{}await sleep(50);}
 assert.ok(port,'native Chrome started');
 const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
 socket=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
 await new Promise((ok,no)=>{socket.addEventListener('open',ok,{once:true});socket.addEventListener('error',no,{once:true});});
 let id=0;const pending=new Map();
 socket.addEventListener('message',({data})=>{const msg=JSON.parse(String(data)),p=pending.get(msg.id);if(p){pending.delete(msg.id);clearTimeout(p.timer);msg.error?p.no(new Error(msg.error.message)):p.ok(msg.result);}});
 const send=(method,params={})=>new Promise((ok,no)=>{const key=++id,timer=setTimeout(()=>{pending.delete(key);no(new Error('CDP timeout '+method));},15000);pending.set(key,{ok,no,timer});socket.send(JSON.stringify({id:key,method,params}));});
 await send('Page.enable');await send('Runtime.enable');
 const html=`<!doctype html><canvas width="640" height="360" id="c"></canvas><script>
 const ctx=c.getContext('2d');let n=0;
 function traceFixtureWork(){const until=performance.now()+4;while(performance.now()<until){Math.sqrt(Math.random());}}
 function tick(){traceFixtureWork();ctx.fillStyle=n++%2?'#963':'#369';ctx.fillRect(0,0,640,360);requestAnimationFrame(tick);}tick();
 const worker=new Worker(URL.createObjectURL(new Blob([\`function workerFixtureWork(){const until=performance.now()+5;while(performance.now()<until){Math.sqrt(Math.random());}}setInterval(workerFixtureWork,10);\`],{type:'text/javascript'})));
 </script>`;
 const setup=await send('Runtime.evaluate',{expression:`document.open();document.write(${JSON.stringify(html)});document.close();`,returnByValue:true});assert.equal(setup.exceptionDetails,undefined,JSON.stringify(setup));await sleep(300);
 const output=resolve('artifacts/chrome-trace-native/fixture.trace.json');await rm(output,{force:true});
 await recordChromeTrace(send,socket,output,()=>sleep(1200));
 const trace=JSON.parse(await readFile(output,'utf8')),events=trace.traceEvents;
 const screenshots=events.filter(e=>e.name==='Screenshot'),chunks=events.filter(e=>e.name==='ProfileChunk');
 const nodes=chunks.flatMap(e=>e.args?.data?.cpuProfile?.nodes??[]);
 const funcs=[...new Set(nodes.map(n=>n.callFrame?.functionName).filter(Boolean))];
 const summary={browser:(await send('Browser.getVersion')).product,bytes:(await readFile(output)).length,events:events.length,screenshots:screenshots.length,profileChunks:chunks.length,hasMainStack:funcs.includes('traceFixtureWork'),hasWorkerStack:funcs.includes('workerFixtureWork'),fixture:'native browser Canvas2D + Worker; NOT a game-engine render'};
 assert.ok(summary.screenshots>0,'real filmstrip');assert.ok(summary.hasMainStack,'main stack samples');assert.ok(summary.hasWorkerStack,'worker stack samples');
 await writeFile(resolve('artifacts/chrome-trace-native/report.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
} finally {socket?.close();browser.kill();await sleep(200);await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100}).catch(()=>{});}
