import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {shots} from './shots.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),mode=process.argv[2]??'preview';

if(!['preview','storyboard','all',...shots.map(s=>s.id)].includes(mode))throw new Error(`Unknown capture mode or shot: ${mode}`);
if(process.argv[3]&&!shots.some(s=>s.id===process.argv[3]))throw new Error(`Unknown shot filter: ${process.argv[3]}`);
const out=join(root,'artifacts/promo-v2');await mkdir(out,{recursive:true});
const html=await readFile(join(root,'tools/promo/player.html'));
const server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');if(url.pathname==='/'){res.setHeader('content-type','text/html');res.end(html);return;}if(['/city.mjs','/shots.mjs','/vehicle.mjs','/laboratory.mjs','/actors.mjs','/snow-surface.mjs','/wet-spray.mjs'].includes(url.pathname)){res.setHeader('content-type','text/javascript');res.end(await readFile(join(root,'tools/promo',url.pathname.slice(1))));return;}if(url.pathname==='/assets/m3.json'){res.setHeader('content-type','application/json');res.end(await readFile(join(root,'tools/promo/assets/m3.json')));return;}const match=url.pathname.match(/^\/dist\/(.+\.js)$/);if(!match||match[1].includes('..')){res.statusCode=404;res.end();return;}res.setHeader('content-type','text/javascript');res.end(await readFile(join(root,'dist',match[1])));}catch(e){res.statusCode=500;res.end(String(e));}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
const profile=await mkdtemp(join(tmpdir(),'winter-promo-'));
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
 if(!await evaluate('return window.ready===true'))throw new Error(await evaluate('return window.failure??"Player not ready"'));
 const screenshot=async()=>Buffer.from((await send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false})).data,'base64');
 const clips=process.argv[3]?shots.filter(s=>s.id===process.argv[3]):shots;
 for(const clip of clips){
  const name=clip.id;if(mode!=='all'&&mode!=='preview'&&mode!=='storyboard'&&mode!==name)continue;
  await evaluate(`await window.promo.load(${JSON.stringify(clip.id)});`);
  if(mode==='storyboard'){for(const [label,t] of [['start',0],['mid',clip.duration*.5],['end',clip.duration-1/30]]){await evaluate(`await window.promo.frame(${t});`);await writeFile(join(out,`${name}-${label}.png`),await screenshot());}const inspection=await evaluate('return window.promo.inspect()');if(inspection.errors.length)throw new Error(JSON.stringify(inspection.errors));console.log('storyboard',name);continue;}
  if(mode==='preview'){
   await evaluate(`await window.promo.frame(${clip.duration*.5});`);
   await writeFile(join(out,`${name}-layout.png`),await screenshot());const inspection=await evaluate('return window.promo.inspect()');if(inspection.errors.length)throw new Error(JSON.stringify(inspection.errors));console.log('preview',name,JSON.stringify(inspection));continue;
  }
  const path=join(out,`${name}-silent.mp4`),encoder=spawn('ffmpeg',['-y','-hide_banner','-loglevel','error','-f','image2pipe','-vcodec','png','-framerate','30','-i','pipe:0','-an','-c:v','libx264','-preset','slow','-crf','17','-pix_fmt','yuv420p','-movflags','+faststart',path],{stdio:['pipe','inherit','inherit']});
  const completed=once(encoder,'exit');
  for(let frame=0;frame<clip.duration*30;frame++){
   await evaluate(`await window.promo.frame(${frame/30});`);
   const png=await screenshot();if(!encoder.stdin.write(png))await once(encoder.stdin,'drain');
   if(frame%90===0)console.log(name,`${frame}/${clip.duration*30}`);
  }
  encoder.stdin.end();const [code]=await completed;if(code!==0)throw new Error(`ffmpeg exit ${code}`);
  const inspection=await evaluate('return window.promo.inspect()');if(inspection.errors.length)throw new Error(JSON.stringify(inspection.errors));
  {await writeFile(join(out,`${name}-telemetry.json`),JSON.stringify(await evaluate('return window.promo.telemetry()')));await writeFile(join(out,`${name}-footsteps.json`),JSON.stringify(await evaluate('return window.promo.footsteps()')));await writeFile(join(out,`${name}-events.json`),JSON.stringify(await evaluate('return window.promo.events()')));await writeFile(join(out,`${name}-evidence.json`),JSON.stringify(inspection,null,2));}
  console.log('recorded',name,JSON.stringify(inspection));
 }
}finally{
 socket?.close();for(const entry of pending.values())clearTimeout(entry.timer);child.kill();await Promise.race([once(child,'exit'),new Promise(r=>setTimeout(r,1000))]);server.closeAllConnections();await new Promise(r=>server.close(r));await rm(profile,{recursive:true,force:true});
}
