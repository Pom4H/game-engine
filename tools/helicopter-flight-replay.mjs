#!/usr/bin/env node
import {createServer} from 'node:http';
import {createServer as createTcpServer} from 'node:net';
import {readFile,mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,resolve,extname} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn,spawnSync} from 'node:child_process';

const CSV=process.env.HELICOPTER_FLIGHT_CSV??'artifacts/helicopter-flight-exam/flight.csv';
const OUT=process.env.HELICOPTER_REPLAY_OUT??'artifacts/helicopter-flight-exam';
const FPS=Number(process.env.HELICOPTER_REPLAY_FPS??6);
const WIDTH=Number(process.env.HELICOPTER_REPLAY_WIDTH??960),HEIGHT=Number(process.env.HELICOPTER_REPLAY_HEIGHT??540);
if(!Number.isFinite(FPS)||FPS<1||FPS>30||!Number.isInteger(WIDTH)||!Number.isInteger(HEIGHT))throw new RangeError('Invalid replay settings');

const parseCsv=text=>{
 const [header,...lines]=text.trim().split(/\r?\n/),keys=header.split(',');
 return lines.filter(Boolean).map(line=>Object.fromEntries(line.split(',').map((v,i)=>[keys[i],keys[i]==='phase'?v:Number(v)])));
};
const rows=parseCsv(await readFile(CSV,'utf8'));
if(rows.length<2)throw new Error('Flight telemetry is empty');
const duration=rows.at(-1).t;
const interp=t=>{
 let lo=0,hi=rows.length-1;
 while(lo+1<hi){const m=(lo+hi)>>1;if(rows[m].t<=t)lo=m;else hi=m;}
 const a=rows[lo],b=rows[Math.min(lo+1,rows.length-1)],u=Math.max(0,Math.min(1,(t-a.t)/Math.max(1e-9,b.t-a.t))),out={phase:u<.5?a.phase:b.phase,t};
 for(const key of Object.keys(a))if(key!=='phase'&&key!=='t')out[key]=a[key]+(b[key]-a[key])*u;
 return out;
};
await mkdir(OUT,{recursive:true});
const frameRoot=resolve(OUT,'.replay-frames');await rm(frameRoot,{recursive:true,force:true});await mkdir(frameRoot,{recursive:true});

const dist=resolve('dist'),tools=resolve('tools'),mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json','.css':'text/css'};
const html=`<!doctype html><html><head><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#0d1218}canvas{width:100%;height:100%;display:block}
#hud{position:fixed;left:18px;top:16px;padding:10px 12px;border:1px solid #ffffff30;background:#0b1017c8;color:#eef5ff;font:13px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre;backdrop-filter:blur(5px)}
#badge{font-weight:700;font-size:15px;margin-bottom:3px}
</style></head><body><canvas id="c"></canvas><div id="hud"><div id="badge">HELICOPTER FLIGHT EXAM</div><span id="stats"></span></div><script type="module">
import scene from '/tools/helicopter-replay.scene.mjs';
import {BrowserRuntime} from '/dist/runtime/browser.js';
import {ForceFrame} from '/dist/physics/force-frame.js';
import {eulerFromBasis} from '/dist/physics/rotation.js';
const canvas=document.getElementById('c');canvas.width=${WIDTH};canvas.height=${HEIGHT};
const runtime=await BrowserRuntime.create(canvas,scene,{autoplay:false,audio:false,exposeBridge:false,resolution:[${WIDTH},${HEIGHT}]});
const moving=['heli/cabin','heli/nose','heli/tail','heli/fin','heli/skid-l','heli/skid-r','heli/main-a','heli/main-b','heli/tail-a'];
runtime.scene.trackPresentation(moving);
const frame=new ForceFrame(),tmp=[0,0,0],basis=new Float64Array(9);
const E=id=>runtime.scene.entities.get(id);
const norm=v=>{const l=Math.hypot(...v)||1;return v.map(x=>x/l)};
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const rotateLocal=v=>{frame.rotate(v,tmp);return [...tmp]};
const place=(id,s,local)=>{const e=E(id),p=rotateLocal(local);e.position.splice(0,3,s.x+p[0],s.y+p[1],s.z+p[2]);e.rotation.splice(0,3,s.roll,s.yaw,s.pitch)};
function rotorBasis(baseN,baseC,fp,fr,lag,spin,tail=false){
 const rx=cross(baseC,baseN),tp=Math.tan(fp+lag*.12),tr=Math.tan(fr-lag*.12),n=norm(baseN.map((v,i)=>v+baseC[i]*tp+rx[i]*tr));
 const along=dot(baseC,n),ch=norm(baseC.map((v,i)=>v-n[i]*along)),span=cross(ch,n);
 const blade=ch.map((v,i)=>v*Math.cos(spin)+span[i]*Math.sin(spin)),worldBlade=rotateLocal(blade),worldN=rotateLocal(n);
 if(tail){const worldAcross=cross(worldN,worldBlade);basis.set(worldBlade,0);basis.set(worldAcross,3);basis.set(worldN,6)}
 else{const worldAcross=cross(worldBlade,worldN);basis.set(worldBlade,0);basis.set(worldN,3);basis.set(worldAcross,6)}
 return basis;
}
function placeRotor(id,s,local,baseN,baseC,fp,fr,lag,spin,tail=false){
 const e=E(id),p=rotateLocal(local);e.position.splice(0,3,s.x+p[0],s.y+p[1],s.z+p[2]);eulerFromBasis(rotorBasis(baseN,baseC,fp,fr,lag,spin,tail),e.rotation);
}
globalThis.__REPLAY_RENDER__=async(s,view)=>{
 frame.update([s.roll,s.yaw,s.pitch]);
 place('heli/cabin',s,[0,0,0]);place('heli/nose',s,[1.55,0,0]);place('heli/tail',s,[-3,0,0]);place('heli/fin',s,[-5,.45,0]);
 place('heli/skid-l',s,[-.1,-.85,-.72]);place('heli/skid-r',s,[-.1,-.85,.72]);
 placeRotor('heli/main-a',s,[-.2,1.25,0],[0,1,0],[1,0,0],s.mainFlapPitch,s.mainFlapRoll,s.mainLeadLag,s.mainSpin,false);
 placeRotor('heli/main-b',s,[-.2,1.25,0],[0,1,0],[1,0,0],s.mainFlapPitch,s.mainFlapRoll,s.mainLeadLag,s.mainSpin+Math.PI/2,false);
 placeRotor('heli/tail-a',s,[-5,1.25,0],[0,0,1],[1,0,0],s.tailFlapPitch,s.tailFlapRoll,s.tailLeadLag,s.tailSpin,true);
 const pos=[s.x,s.y,s.z],forward=rotateLocal([1,0,0]),right=rotateLocal([0,0,1]),speed=Math.hypot(s.vx,s.vz);
 const travel=speed>2?norm([s.vx,0,s.vz]):norm([forward[0],0,forward[2]]);
 const camera=view==='side'
   ?{position:[pos[0]+right[0]*18,pos[1]+6,pos[2]+right[2]*18],target:[pos[0],pos[1]+1,pos[2]],fov:40}
   :{position:[pos[0]-travel[0]*17,pos[1]+7,pos[2]-travel[2]*17],target:[pos[0]+travel[0]*4,pos[1]+1,pos[2]+travel[2]*4],fov:42};
 runtime.setCamera(camera);
 document.getElementById('stats').textContent='phase  '+String(s.phase).padEnd(15)+' t '+s.t.toFixed(1)+' s\n'
   +'alt    '+s.y.toFixed(1).padStart(6)+' m      speed '+Math.hypot(s.vx,s.vz).toFixed(1).padStart(5)+' m/s\n'
   +'main   '+s.mainRpm.toFixed(0).padStart(6)+' rpm    VRS   '+s.vrs.toFixed(2)+'\n'
   +'stall  '+s.retreatingStall.toFixed(2)+'             blades '+s.blades.toFixed(0);
 await runtime.flush();runtime.render();await runtime.flush();return runtime.inspect();
};
globalThis.__REPLAY_READY__=true;
</script></body></html>`;

const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url??'/','http://127.0.0.1');
  if(url.pathname==='/'){res.writeHead(200,{'content-type':mime['.html'],'cache-control':'no-store'});res.end(html);return}
  const root=url.pathname.startsWith('/dist/')?dist:url.pathname.startsWith('/tools/')?tools:null;
  if(root){const prefix=root===dist?6:7,p=join(root,url.pathname.slice(prefix));const data=await readFile(p);res.writeHead(200,{'content-type':mime[extname(p)]??'application/octet-stream','cache-control':'no-store'});res.end(data);return}
  res.writeHead(404);res.end();
 }catch(error){res.writeHead(500);res.end(String(error))}
});
await new Promise((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',ok)});
const port=server.address().port;
const chrome=process.env.CHROME_PATH??(['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium'].find(existsSync));
if(!chrome)throw new Error('Chrome/Chromium not found');
const profile=await mkdtemp(join(tmpdir(),'heli-replay-')),debug=createTcpServer();
await new Promise((ok,fail)=>{debug.once('error',fail);debug.listen(0,'127.0.0.1',ok)});const debugPort=debug.address().port;debug.close();
const child=spawn(chrome,['--headless=new','--no-sandbox','--no-first-run','--disable-background-networking','--disable-extensions','--hide-scrollbars','--enable-unsafe-webgpu','--enable-gpu','--user-data-dir='+profile,'--remote-debugging-address=127.0.0.1','--remote-debugging-port='+debugPort,'--window-size='+WIDTH+','+HEIGHT,'about:blank'],{stdio:['ignore','pipe','pipe']});
let stderr='',ws;child.stderr.on('data',x=>stderr+=x);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try{
 let ready=false;for(let i=0;i<240;i++){try{if((await fetch('http://127.0.0.1:'+debugPort+'/json/version')).ok){ready=true;break}}catch{}await sleep(50)}if(!ready)throw new Error('Chrome DevTools timeout '+stderr.slice(-2000));
 let page;for(let i=0;i<200;i++){try{page=(await(await fetch('http://127.0.0.1:'+debugPort+'/json/list')).json()).find(x=>x.type==='page'&&x.webSocketDebuggerUrl);if(page)break}catch{}await sleep(50)}if(!page)throw new Error('No Chrome page');
 ws=new WebSocket(page.webSocketDebuggerUrl);let id=0;const pending=new Map();
 ws.addEventListener('message',e=>{const m=JSON.parse(String(e.data)),p=pending.get(m.id);if(!p)return;pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result)});
 const send=(method,params={})=>new Promise((ok,fail)=>{const n=++id;pending.set(n,{resolve:ok,reject:fail});ws.send(JSON.stringify({id:n,method,params}))});
 await new Promise((ok,fail)=>{ws.addEventListener('open',ok,{once:true});ws.addEventListener('error',fail,{once:true})});
 await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:WIDTH,height:HEIGHT,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:'http://127.0.0.1:'+port+'/'});
 ready=false;for(let i=0;i<600;i++){const r=await send('Runtime.evaluate',{expression:'!!globalThis.__REPLAY_READY__',returnByValue:true});if(r.result?.value){ready=true;break}await sleep(50)}if(!ready)throw new Error('Replay page did not initialize');
 const frames=Math.floor(duration*FPS)+1,views=['chase','side'];
 for(const view of views){
  const dir=join(frameRoot,view);await mkdir(dir,{recursive:true});
  for(let i=0;i<frames;i++){
   const s=interp(Math.min(duration,i/FPS)),expr='__REPLAY_RENDER__(' + JSON.stringify(s) + ',' + JSON.stringify(view) + ')';
   const r=await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);
   const shot=await send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});
   await writeFile(join(dir,String(i).padStart(5,'0')+'.png'),Buffer.from(shot.data,'base64'));
  }
  const ffmpeg=process.env.FFMPEG_PATH??'ffmpeg',output=resolve(OUT,'replay-'+view+'.mp4');
  const proc=spawnSync(ffmpeg,['-y','-hide_banner','-loglevel','warning','-framerate',String(FPS),'-i',join(dir,'%05d.png'),'-c:v','libx264','-preset','medium','-crf','22','-pix_fmt','yuv420p','-movflags','+faststart',output],{stdio:'inherit'});
  if(proc.error)throw proc.error;if(proc.status!==0)throw new Error('ffmpeg failed for '+view+': '+proc.status);
 }
 await writeFile(resolve(OUT,'replay.json'),JSON.stringify({source:CSV,duration,fps:FPS,resolution:[WIDTH,HEIGHT],views:['replay-chase.mp4','replay-side.mp4'],physics:'not rerun; frames are rendered from recorded flight.csv state'},null,2));
 console.log(JSON.stringify({duration,fps:FPS,frames:Math.floor(duration*FPS)+1,outputs:['replay-chase.mp4','replay-side.mp4']},null,2));
}finally{
 try{ws?.close()}catch{}try{child.kill()}catch{}try{server.close()}catch{}try{await rm(profile,{recursive:true,force:true})}catch{}try{await rm(frameRoot,{recursive:true,force:true})}catch{}
}
