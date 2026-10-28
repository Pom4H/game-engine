import {resolve,dirname,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {createWorldHost,type SavedSession} from './host.js';
import {DEFAULT_PORT} from './shared.js';
import {FixedClock} from '../../src/core/fixed-clock.js';

const root=dirname(fileURLToPath(import.meta.url)),data=resolve(root,'data'),port=Number(process.env.PORT??DEFAULT_PORT),seed=Number(process.env.WORLD_SEED??29);
const allowedOrigins=new Set((process.env.THEGAME_OFFICE_ORIGINS??'http://127.0.0.1:8765,http://localhost:8765,http://127.0.0.1:5173,http://localhost:5173').split(','));
const editorOrigins=new Set(allowedOrigins);
const officeOrigin=process.env.OFFICE_BACKEND??'http://127.0.0.1:7860';
const statePath=resolve(data,`world-${seed}.json`);let saved:{sessions?:SavedSession[];layout?:unknown}={};
await mkdir(data,{recursive:true});const keyPath=resolve(data,'editor.key');let editorToken=process.env.THEGAME_EDITOR_TOKEN??'';
if(!editorToken)try{editorToken=(await readFile(keyPath,'utf8')).trim();}catch{}
if(!/^[a-f0-9]{64}$/.test(editorToken)){editorToken=randomBytes(32).toString('hex');await writeFile(keyPath,editorToken,{mode:0o600});}
try{saved=JSON.parse(await readFile(statePath,'utf8'));}catch{}
let initial=saved.layout;
try{const response=await fetch(officeOrigin+'/office',{signal:AbortSignal.timeout(2500)});if(response.ok)initial=await response.json();}catch{}
const host=createWorldHost({seed,saved:saved.sessions??[]});
if(initial)try{host.layout(initial);}catch(error){console.error('Office layout rejected:',(error as Error).message);}
await import('./build.js');
const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.wav':'audio/wav'};
function cookie(req:Request){const value=req.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith('thegame_engine_session='))?.slice(23);return value&&/^[0-9a-f]{64}$/.test(value)?value:null;}
function cors(req:Request):Record<string,string>{const origin=req.headers.get('origin');return origin&&allowedOrigins.has(origin)?{'access-control-allow-origin':origin,'access-control-allow-credentials':'true','vary':'Origin'}:{};}
function response(req:Request,value:unknown,status=200):Response{return Response.json(value,{status,headers:{...cors(req),'cache-control':'no-store'}});}
function loopback(ip:string|undefined):boolean{return !ip||ip==='127.0.0.1'||ip==='::1'||ip==='::ffff:127.0.0.1';}
const server=Bun.serve({port,hostname:process.env.HOST??'0.0.0.0',
 async fetch(req,server){const url=new URL(req.url),origin=req.headers.get('origin'),localOrigin=origin===url.origin,allowed=!origin||localOrigin||allowedOrigins.has(origin),local=loopback(server.requestIP(req)?.address);
  if(req.method==='OPTIONS'){if(!allowed)return new Response('Origin rejected',{status:403});return new Response(null,{status:204,headers:{...cors(req),'access-control-allow-methods':'GET, POST, OPTIONS','access-control-allow-headers':'Content-Type'}});}
  if(url.pathname==='/api/session'){if(!allowed)return response(req,{error:'Origin rejected'},403);try{const {session,fresh}=host.session(cookie(req));return Response.json({ok:true,revision:host.world.binding.revision},{headers:{...cors(req),'cache-control':'no-store',...(fresh?{'set-cookie':`thegame_engine_session=${session.secret}; HttpOnly; Path=/; SameSite=Strict; Max-Age=31536000${url.protocol==='https:'?'; Secure':''}`}:{})}});}catch{return response(req,{error:'Session limit'},429);}}
  if(url.pathname==='/api/health')return response(req,{ok:true,...host.inspect(),engine:'The Engine / Scene / WebGPURenderer'});
  if(url.pathname==='/api/office/layout'){
   if(req.method!=='POST')return response(req,{error:'POST required'},405);const trusted=req.headers.get('x-thegame-editor')===editorToken;if(!trusted&&(!local||!allowed||origin&&!editorOrigins.has(origin)))return response(req,{error:'Local editor required'},403);
   try{const text=await req.text();if(text.length>750000)throw new Error('Layout size limit');const body=JSON.parse(text),state=body.state??body,layoutRevision=await host.queueLayout(state);return response(req,{ok:true,revision:state.revision,layoutRevision});}catch(error){return response(req,{error:(error as Error).message},409);}
  }
  if(url.pathname==='/world'){
   if(!allowed)return new Response('Origin rejected',{status:403});const secret=cookie(req);if(!secret)return new Response('Session required',{status:401});const {session,fresh}=host.session(secret);if(fresh)return new Response('Session expired',{status:401});
   if(server.upgrade(req,{data:{session,editor:local&&!!origin&&editorOrigins.has(origin)}}))return;return new Response('WebSocket required',{status:426});
  }
  if(req.method!=='GET'&&req.method!=='HEAD')return new Response('Method not allowed',{status:405});
  try{
   const pathname=decodeURIComponent(url.pathname);if(pathname.includes('\\')||pathname.split('/').some(s=>s.startsWith('.')))return new Response('Invalid path',{status:400});
   const asset=pathname.startsWith('/assets/'),base=asset?resolve(root,'assets'):resolve(root,'public'),path=resolve(base,'.'+(asset?pathname.slice(7):pathname==='/'?'/index.html':pathname));
   if(!path.startsWith(base+sep))return new Response('Forbidden',{status:403});const body=await readFile(path);return new Response(req.method==='HEAD'?null:body,{headers:{'content-type':mime[extname(path)]??'application/octet-stream','cache-control':'no-cache','x-content-type-options':'nosniff'}});
  }catch{return new Response('Not found',{status:404});}
 },
 websocket:{maxPayloadLength:750000,idleTimeout:20,backpressureLimit:128*1024,closeOnBackpressureLimit:true,perMessageDeflate:false,
  open(ws){host.open(ws,ws.data.session,ws.data.editor);},message(ws,data){host.message(ws,typeof data==='string'?data:new TextDecoder().decode(data));},close(ws){host.close(ws);},drain(ws){host.drain(ws);}},
});
const clock=new FixedClock(1000/60,250,8);clock.reset(performance.now());const timer=setInterval(()=>clock.advance(performance.now(),()=>host.step()),4);
let saving=false;async function checkpoint(){if(saving)return;saving=true;try{await mkdir(data,{recursive:true});await writeFile(statePath+'.tmp',JSON.stringify({sessions:host.checkpoint(),layout:host.world.layout}));await rename(statePath+'.tmp',statePath);}finally{saving=false;}}
const checkpointTimer=setInterval(()=>void checkpoint().catch(e=>console.error('Checkpoint failed:',e.message)),10000);
let stopping=false;async function stop(){if(stopping)return;stopping=true;clearInterval(timer);clearInterval(checkpointTimer);await checkpoint();host.dispose();server.stop(true);}
process.once('SIGINT',()=>void stop());process.once('SIGTERM',()=>void stop());
console.log(`The Game + The Office — http://127.0.0.1:${server.port} — ${host.world.binding.revision}`);
