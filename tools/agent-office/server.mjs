#!/usr/bin/env node
/** Loopback-only observatory. Agent actions arrive as facts from the real
 * orchestrator; the viewer cannot start jobs or control an agent. */
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,dirname,extname,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {timingSafeEqual} from 'node:crypto';
import {ActivityJournal} from '../../dist/observability/activity.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8'};
function authorized(request,token){
  if(!token)return true;
  const supplied=request.headers.authorization??'',expected='Bearer '+token;
  const a=Buffer.from(supplied),b=Buffer.from(expected);
  return a.length===b.length&&timingSafeEqual(a,b);
}
async function body(request){
  const chunks=[];let total=0;
  for await(const chunk of request){
    total+=chunk.length;
    if(total>65536)throw new RangeError('Event payload exceeds 64 KiB');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
const send=(res,status,payload)=>{res.writeHead(status,{'content-type':mime['.json'],'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(payload));};

export async function startServer({port=4176,host='127.0.0.1',mode='demo',token=process.env.AGENT_OFFICE_TOKEN??''}={}){
  if(!['127.0.0.1','::1'].includes(host))throw new TypeError('Office viewer must stay on loopback; use an SSH tunnel for remote access');
  if(!['demo','live'].includes(mode))throw new TypeError('Office mode must be demo or live');
  if(!Number.isInteger(port)||port<0||port>65535)throw new RangeError('Invalid office port');
  const journal=new ActivityJournal(),clients=new Set();
  if(mode==='demo'){
    const source=JSON.parse(await readFile(resolve(root,'examples/agent-office/replay.json'),'utf8'));
    journal.ingestMany(source.events);
  }
  const server=createServer(async(req,res)=>{
    try{
      const url=new URL(req.url??'/','http://localhost'),pathname=url.pathname;
      if(pathname==='/api/snapshot'&&req.method==='GET'){
        send(res,200,{schema:'engine.office.v1',mode,events:journal.snapshot(),stats:journal.stats});return;
      }
      if(pathname==='/api/stream'&&req.method==='GET'){
        if(clients.size>=16){send(res,503,{error:'Too many viewers'});return;}
        res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-cache, no-transform','connection':'keep-alive','x-accel-buffering':'no'});
        res.write(': office events\n\n');clients.add(res);
        req.on('close',()=>clients.delete(res));return;
      }
      if(pathname==='/api/events'&&req.method==='POST'){
        if(mode!=='live'){send(res,409,{error:'Demo replay is read-only'});return;}
        if(!authorized(req,token)){send(res,401,{error:'Unauthorized'});return;}
        const raw=await body(req),input=Array.isArray(raw)?raw:[raw];
        if(input.length>128)throw new RangeError('At most 128 events per ingest');
        if(input.some(fact=>fact?.origin!=='observed'))throw new TypeError('Live events must declare origin=observed');
        const received=journal.ingestMany(input);
        for(const fact of received){
          const packet='data: '+JSON.stringify(fact)+'\n\n';
          for(const client of clients){
            if(client.destroyed||client.writableLength>262144){clients.delete(client);client.end();continue;}
            client.write(packet);
          }
        }
        send(res,202,{accepted:received.length,stats:journal.stats});return;
      }
      if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405,{allow:'GET, HEAD'});res.end();return;}
      const requested=pathname==='/'?'/tools/agent-office/index.html':decodeURIComponent(pathname);
      const prefix=['/tools/agent-office/','/dist/'].find(p=>requested.startsWith(p));
      if(!prefix){res.writeHead(404);res.end('Not found');return;}
      const allowed=resolve(root,'.'+prefix),path=resolve(root,'.'+requested);
      if(!path.startsWith(allowed+sep)){res.writeHead(403);res.end('Forbidden');return;}
      const bytes=await readFile(path);
      res.writeHead(200,{'content-type':mime[extname(path)]??'application/octet-stream','cache-control':'no-store','x-content-type-options':'nosniff'});
      res.end(req.method==='HEAD'?undefined:bytes);
    }catch(error){
      const invalid=error instanceof SyntaxError||error instanceof TypeError||error instanceof RangeError;
      send(res,invalid?400:error.code==='ENOENT'?404:500,{error:error.message??'Office server error'});
    }
  });
  await new Promise((yes,no)=>{server.once('error',no);server.listen(port,host,yes);});
  server.on('close',()=>{for(const client of clients)client.end();clients.clear();});
  return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const mode=process.argv.includes('--live')?'live':'demo';
  const server=await startServer({port:Number(process.env.PORT??4176),mode});
  console.log('The Engine / Agent Office '+mode+': http://127.0.0.1:'+server.address().port);
}
