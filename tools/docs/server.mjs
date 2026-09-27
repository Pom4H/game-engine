import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(fileURLToPath(new URL('../..',import.meta.url)),process.env.DOCS_OUT??'.site');
const mime={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.cjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.ts':'text/plain; charset=utf-8','.png':'image/png'};
const server=createServer(async(req,res)=>{
 try{
  let pathname=decodeURIComponent(new URL(req.url??'/','http://local').pathname);
  if(pathname==='/') {res.writeHead(302,{location:'/docs/'});res.end();return;}
  if(pathname==='/docs'){res.writeHead(302,{location:'/docs/'});res.end();return;}
  if(!pathname.startsWith('/docs/')){res.writeHead(404);res.end('Not found');return;}
  pathname=pathname.slice(6)||'index.html';
  const file=resolve(root,pathname);if(!file.startsWith(root+sep))throw new Error('Invalid path');
  const headers={'content-type':mime[extname(file)]??'application/octet-stream','cache-control':'no-cache','x-content-type-options':'nosniff'};
  // Compiler executes LOCAL authored code in a killable worker. Not an authority/security sandbox.
  // No networking from compiler code. Dynamic imports of local engine modules use script-src.
  headers['content-security-policy']="default-src 'none'; script-src 'self' 'unsafe-eval'; style-src 'self'; img-src 'self' blob: data:; worker-src 'self'; connect-src "+(pathname==='compiler-worker.js'?"'none'":"'self'")+"; media-src blob:; base-uri 'none'; frame-ancestors 'none'";
  const body=await readFile(file);res.writeHead(200,headers);res.end(body);
 }catch{res.writeHead(404,{'content-type':'text/plain'});res.end('Not found');}
});
server.listen(Number(process.env.PORT??4173),process.env.HOST??'127.0.0.1',()=>console.log(`http://${process.env.HOST??'127.0.0.1'}:${server.address().port}/docs/`));
for(const event of ['SIGINT','SIGTERM'])process.on(event,()=>server.close(()=>process.exit()));
