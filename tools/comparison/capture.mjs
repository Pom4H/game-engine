import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {scenes} from './scenes.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),baseline=resolve(process.argv[2]??''),mode=process.argv[3]??'preview';
if(!process.argv[2])throw new Error('Usage: node tools/comparison/capture.mjs <baseline-worktree> preview|all|case-version');
const out=join(root,'artifacts/comparison');await mkdir(out,{recursive:true});
const html=await readFile(join(root,'tools/comparison/player.html'));
const server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');if(url.pathname==='/'){res.setHeader('content-type','text/html');res.end(html);return;}if(url.pathname==='/scenes.json'){res.setHeader('content-type','application/json');res.end(JSON.stringify(scenes));return;}const match=url.pathname.match(/^\/(before|after)\/dist\/(.+\.js)$/);if(!match||match[2].includes('..')){res.statusCode=404;res.end();return;}const path=join(match[1]==='before'?baseline:root,'dist',match[2]);res.setHeader('content-type','text/javascript');res.end(await readFile(path));}catch(e){res.statusCode=500;res.end(String(e));}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
const profile=await mkdtemp(join(tmpdir(),'engine-film-'));
const child=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-extensions','--hide-scrollbars','--enable-unsafe-webgpu',`--user-data-dir=${profile}`,'--remote-debugging-port=0','--window-size=1920,1080','about:blank'],{stdio:['ignore','ignore','pipe']});
let socket,sequence=0;const pending=new Map();
try{
 const endpoint=await new Promise((resolve,reject)=>{let text='';const timeout=setTimeout(()=>reject(new Error(text)),20000);child.stderr.on('data',data=>{text+=data;const m=text.match(/DevTools listening on (ws:\/\/\S+)/);if(m){clearTimeout(timeout);resolve(m[1]);}});child.on('error',reject);});
 const debugPort=new URL(endpoint).port;let page;
 for(let i=0;i<60;i++){const pages=await(await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();page=pages.find(p=>p.type==='page');if(page)break;await new Promise(r=>setTimeout(r,100));}
 socket=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true});});
 socket.addEventListener('message',event=>{const message=JSON.parse(String(event.data));if(!message.id)return;const entry=pending.get(message.id);if(!entry)return;pending.delete(message.id);clearTimeout(entry.timer);message.error?entry.reject(new Error(message.error.message)):entry.resolve(message.result);});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error(`Timeout: ${method}`));},30000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression:`(async()=>{${expression}})()`,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);return result.result?.value;};
 await send('Page.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:`http://127.0.0.1:${port}/`});
 for(let i=0;i<100;i++){if(await evaluate('return window.ready===true'))break;await new Promise(r=>setTimeout(r,100));}
 if(!await evaluate('return window.ready===true'))throw new Error('Player not ready');
 const screenshot=async()=>Buffer.from((await send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false})).data,'base64');
 const clips=[{id:'intro',duration:6},...Object.keys(scenes).flatMap(id=>['before','after'].map(version=>({id,version,duration:9}))),{id:'outro',duration:6}];
 for(const clip of clips){
  const name=clip.version?`${clip.id}-${clip.version}`:clip.id;if(mode!=='all'&&mode!=='preview'&&mode!==name)continue;
  if(clip.version)await evaluate(`await window.film.load(${JSON.stringify(clip.id)},${JSON.stringify(clip.version)});`);
  if(mode==='preview'){
   if(clip.version)await evaluate('await window.film.frame(6);');else await evaluate(`await window.film.card(${JSON.stringify(clip.id)},3);`);
   await writeFile(join(out,`${name}-layout.png`),await screenshot());const inspection=await evaluate('return window.film.inspect()');if(inspection.errors.length)throw new Error(JSON.stringify(inspection.errors));console.log('preview',name);continue;
  }
  const path=join(out,`${name}-silent.mp4`),encoder=spawn('ffmpeg',['-y','-hide_banner','-loglevel','error','-f','image2pipe','-vcodec','png','-framerate','30','-i','pipe:0','-an','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',path],{stdio:['pipe','inherit','inherit']});
  const completed=once(encoder,'exit');
  for(let frame=0;frame<clip.duration*30;frame++){
   if(clip.version)await evaluate(`await window.film.frame(${frame/30});`);else await evaluate(`await window.film.card(${JSON.stringify(clip.id)},${frame/30});`);
   const png=await screenshot();if(!encoder.stdin.write(png))await once(encoder.stdin,'drain');
   if(frame%90===0)console.log(name,`${frame}/${clip.duration*30}`);
  }
  encoder.stdin.end();const [code]=await completed;if(code!==0)throw new Error(`ffmpeg exit ${code}`);
  const inspection=await evaluate('return window.film.inspect()');if(inspection.errors.length)throw new Error(JSON.stringify(inspection.errors));
  if(clip.version){await writeFile(join(out,`${name}-events.json`),JSON.stringify(await evaluate('return window.film.events()')));await writeFile(join(out,`${name}-evidence.json`),JSON.stringify(inspection,null,2));}
  console.log('recorded',name,JSON.stringify(inspection));
 }
}finally{
 socket?.close();for(const entry of pending.values())clearTimeout(entry.timer);child.kill();await Promise.race([once(child,'exit'),new Promise(r=>setTimeout(r,1000))]);server.closeAllConnections();await new Promise(r=>server.close(r));await rm(profile,{recursive:true,force:true});
}
