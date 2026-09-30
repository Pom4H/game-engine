import {fileURLToPath} from 'node:url';
import {resolve,extname,sep} from 'node:path';
import {realpath,stat,readFile} from 'node:fs/promises';
import {createThegameHost} from './host.mjs';
import definition from '../../examples/thegame/project.ts';
if(typeof Bun==='undefined')throw Error('Run with Bun: bun tools/thegame/server.mjs');
const root=resolve(process.env.THEGAME_SITE??fileURLToPath(new URL('../../.site',import.meta.url)));
const config=definition.check(process.env.THEGAME_PRESET).modules[0].config;
const host=createThegameHost(config,{profile:process.env.THEGAME_PROFILE==='1'});
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.cjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.ts':'text/plain; charset=utf-8','.png':'image/png','.webp':'image/webp'};
const directory=await realpath(root),extraOrigins=(process.env.THEGAME_ORIGINS??'').split(',').map(v=>v.trim()).filter(Boolean);
const server=Bun.serve({hostname:process.env.HOST??'0.0.0.0',port:Number(process.env.PORT??4173),
 async fetch(req,server){
  const url=new URL(req.url);
  if(url.pathname==='/thegame/socket'){
   const origin=req.headers.get('origin');if(origin&&origin!==url.origin&&!extraOrigins.includes(origin))return new Response('Origin denied',{status:403});
   if(server.pendingWebSockets>=32)return new Response('Room full',{status:503});
   return server.upgrade(req)?undefined:new Response('WebSocket required',{status:426});
  }
  if(url.pathname==='/thegame/health')return Response.json(host.inspect(),{headers:{'cache-control':'no-store'}});
  if(req.method!=='GET'&&req.method!=='HEAD')return new Response('Method not allowed',{status:405});
  try{
   const path=decodeURIComponent(url.pathname);if(path.includes('\\')||path.includes('\0')||path.split('/').some(p=>p.startsWith('.')))throw Error('Path');
   if(path==='/'&&!url.searchParams.has('site'))return Response.redirect(new URL('/games/thegame/',url),302);
   if(!/^\/(games|engine|shared|product|docs|modules)(\/|$)/.test(path)&&path!=='/build.json'&&path!=='/')throw Error('Mount');
   let file=resolve(root,'.'+(path==='/'?'/index.html':path));if((await stat(file)).isDirectory()){if(!path.endsWith('/'))return Response.redirect(new URL(path+'/'+url.search,url),308);file=resolve(file,'index.html');}
   file=await realpath(file);if(!file.startsWith(directory+sep))throw Error('Outside site');
   const compiler=path==='/shared/game-compiler.js'||path==='/docs/compiler-worker.js';
   return new Response(req.method==='HEAD'?null:await readFile(file),{headers:{'content-type':mime[extname(file)]??'application/octet-stream','cache-control':'no-cache','x-content-type-options':'nosniff','content-security-policy':`default-src 'none'; script-src 'self'${compiler||path.startsWith('/docs/')?" 'unsafe-eval'":''}; style-src 'self'; img-src 'self' data: blob:; worker-src 'self'; connect-src ${compiler?"'none'":"'self'"}; base-uri 'none'; frame-ancestors 'none'`}});
  }catch{return new Response('Not found',{status:404});}
 },
 websocket:{maxPayloadLength:8192,idleTimeout:10,backpressureLimit:65_536,closeOnBackpressureLimit:true,perMessageDeflate:false,open:ws=>host.open(ws),message:(ws,text)=>host.message(ws,text),drain:ws=>host.drain(ws),close:ws=>host.close(ws)},
});
const timer=setInterval(()=>host.advance(),4);
function stop(){clearInterval(timer);host.dispose();server.stop(true);}
process.once('SIGINT',stop);process.once('SIGTERM',stop);
console.log(`Thegame: http://127.0.0.1:${server.port}/games/thegame/ — share this host's address with other players.`);
