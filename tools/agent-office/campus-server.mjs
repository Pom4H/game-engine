#!/usr/bin/env node
/** Minimal loopback server for the engine's causal campus walkthrough. */
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,dirname,extname,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
 '.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8',
 '.css':'text/css; charset=utf-8','.png':'image/png'};
export async function startCampusServer({port=4182}={}){
 if(!Number.isSafeInteger(port)||port<0||port>65535)throw new RangeError('Invalid port');
 const server=createServer(async(req,res)=>{
  try{
   const pathname=new URL(req.url??'/','http://localhost').pathname;
   if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405,{allow:'GET, HEAD'});res.end();return;}
   const requested=pathname==='/'?'/tools/agent-office/campus.html':
    pathname==='/data/replay.json'?'/examples/agent-office/campus-replay.json':decodeURIComponent(pathname);
   const prefix=['/tools/agent-office/','/dist/','/examples/agent-office/'].find(p=>requested.startsWith(p));
   if(!prefix){res.writeHead(404);res.end('Not found');return;}
   const allowed=resolve(root,'.'+prefix),path=resolve(root,'.'+requested);
   if(!path.startsWith(allowed+sep)){res.writeHead(403);res.end('Forbidden');return;}
   const body=await readFile(path);
   res.writeHead(200,{'content-type':mime[extname(path)]??'application/octet-stream',
    'cache-control':'no-store','x-content-type-options':'nosniff'});
   res.end(req.method==='HEAD'?undefined:body);
  }catch(error){res.writeHead(error.code==='ENOENT'?404:500);res.end('Not found');}
 });
 await new Promise((yes,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',yes);});
 return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const server=await startCampusServer({port:Number(process.env.PORT??4182)});
 console.log('Agent Campus — http://127.0.0.1:'+server.address().port);
}
