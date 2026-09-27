import {buildPlayground} from './build-playground.mjs';
import {resolve} from 'node:path';
const root=await buildPlayground(),port=Number(process.env.PORT??5173);
const server=Bun.serve({hostname:'127.0.0.1',port,fetch(request){
 const url=new URL(request.url),pathname=url.pathname.replace(/^\/(?:docs|playground)(?:\/|$)/,'/'),name=pathname==='/'?'index.html':pathname.slice(1);
 if(!['index.html','compiler.html','manifest.json'].includes(name))return new Response('Not found',{status:404});
 return new Response(Bun.file(resolve(root,name)),{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}});console.log(`DSL playground: http://127.0.0.1:${server.port}/`);
