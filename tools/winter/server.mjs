import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve,relative,extname,isAbsolute} from 'node:path';

const root=fileURLToPath(new URL('../../',import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png'};
export async function startWinterServer(port=4173,{verification=false}={}){
 const server=createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,'http://localhost');
   const pathname=decodeURIComponent(url.pathname);
   if(verification&&req.method==='POST'&&/^\/__verify\/(courtyard|footprints|wet-tyres|finish|report)\.(png|json)$/.test(pathname)){
    if(req.headers.origin!==`http://${req.headers.host}`){res.writeHead(403);res.end();return;}
    const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>8_000_000){res.writeHead(413);res.end();return;}chunks.push(chunk);}
    const directory=resolve(root,'artifacts/winter/latest');await mkdir(directory,{recursive:true});
    await writeFile(resolve(directory,pathname.split('/').at(-1)),Buffer.concat(chunks));res.writeHead(204);res.end();return;
   }
   if(req.method!=='GET'){res.writeHead(405);res.end();return;}
   const base=pathname.startsWith('/tools/')?resolve(root,'tools'):pathname.startsWith('/dist/')?resolve(root,'dist'):pathname.startsWith('/assets/')?resolve(root,'tools/promo/assets'):resolve(root,'tools/winter');
   const name=pathname==='/'?(url.searchParams.has('courtyard')||url.searchParams.has('verify')?'index.html':'traffic.html'):pathname.replace(/^\/(?:tools\/|dist\/|assets\/)?/,'');
   const path=resolve(base,name),inside=relative(base,path);
   if(inside.startsWith('..')||isAbsolute(inside)){res.writeHead(403);res.end();return;}
   const data=await readFile(path);res.writeHead(200,{'content-type':mime[extname(path)]??'application/octet-stream','cache-control':'no-store'});res.end(data);
  }catch(error){res.writeHead(error.code==='ENOENT'?404:500);res.end('Unable to load this file');}
 });
 await new Promise((done,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',done);});
 return{url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(done=>{server.closeAllConnections();server.close(done);})};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const server=await startWinterServer(Number(process.env.PORT??4173),{verification:process.argv.includes('--verify')});console.log(`Winter courtyard: ${server.url}${process.argv.includes('--verify')?'/?verify=1':''}`);
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await server.close();process.exit(0);});
}
