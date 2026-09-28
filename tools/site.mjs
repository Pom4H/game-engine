import {readFile,realpath,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';

const mime={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.cjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.ts':'text/plain; charset=utf-8','.png':'image/png'};
/** One static mount for the development host and downloaded site. Games, docs and
 * shared modules have canonical URLs; no duplicate engine or legacy arena mount. */
export function staticSite(directory,{home='/docs/',connectOrigins=[]}={}){
 const root=resolve(directory),inside=path=>path.startsWith(root+sep);
 return async(req,res)=>{
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405,{allow:'GET, HEAD'});res.end();return;}
  try{
   const url=new URL(req.url??'/','http://local'),name=decodeURIComponent(url.pathname);
   if(name==='/'){res.writeHead(302,{location:home+url.search});res.end();return;}
   if(name.includes('\\')||name.includes('\0')||name.split('/').some(part=>part.startsWith('.')))throw Error('Invalid path');
   if(!/^\/(docs|games|engine|shared)(\/|$)/.test(name)&&name!=='/build.json')throw Error('Unknown mount');
   let file=resolve(root,'.'+name);if(!inside(file))throw Error('Invalid path');
   const info=await stat(file);
   if(info.isDirectory()){
    if(!name.endsWith('/')){res.writeHead(308,{location:url.pathname+'/'+url.search});res.end();return;}
    file=resolve(file,'index.html');
   }
   if(!(await realpath(file)).startsWith((await realpath(root))+sep))throw Error('Outside site');
   // Compiler code has no network access; game scripts do not need unsafe-eval.
   const compiler=name==='/docs/compiler-worker.js',scripts="'self'"+(name.startsWith('/docs/')?" 'unsafe-eval'":'');
   const connect=compiler?"'none'":"'self'"+(connectOrigins.length?' '+connectOrigins.join(' '):'');
   const headers={'content-type':mime[extname(file)]??'application/octet-stream','cache-control':'no-cache','x-content-type-options':'nosniff',
    'content-security-policy':`default-src 'none'; script-src ${scripts}; style-src 'self'; img-src 'self' blob: data:; worker-src 'self'; connect-src ${connect}; media-src blob:; base-uri 'none'; frame-ancestors 'none'`};
   const body=req.method==='HEAD'?undefined:await readFile(file);res.writeHead(200,headers);res.end(body);
  }catch{res.writeHead(404,{'content-type':'text/plain; charset=utf-8'});res.end('Not found');}
 };
}
