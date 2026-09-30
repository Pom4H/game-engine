import {createServer} from 'node:http';
import {staticSite} from '../site.mjs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(fileURLToPath(new URL('../..',import.meta.url)),process.env.DOCS_OUT??'.site');
const network=process.env.NETWORK_DEBUG==='1'?(await import('./network-host.mjs')).debugNetworkHost():null;
if(network&&!['127.0.0.1','localhost','::1'].includes(process.env.HOST??'127.0.0.1'))throw new Error('Debug network must bind to loopback');
const useDatagrams=process.env.ARENA_TRANSPORT!=='sse';
const arena=process.env.ARENA==='1'?(await import('./network-host.mjs')).debugNetworkHost({arena:true,publicOrigin:process.env.ARENA_PUBLIC_ORIGIN,datagrams:useDatagrams}):null;
let quic=null;
if(arena&&useDatagrams){quic=await (await import('../transport/server.mjs')).startArenaQuic(arena,{port:Number(process.env.ARENA_QUIC_PORT??4433),url:process.env.ARENA_QUIC_URL,certPath:process.env.ARENA_TLS_CERT,keyPath:process.env.ARENA_TLS_KEY});arena.configureTransport(quic);}
const home=arena?'/games/':'/',serve=staticSite(root,{home,connectOrigins:quic?[new URL(quic.config.url).origin]:[]});
const server=createServer(async(req,res)=>{
 if(network&&await network.handle(req,res))return;
 if(arena&&await arena.handle(req,res))return;
 await serve(req,res);
});
server.listen(Number(process.env.PORT??4173),process.env.HOST??'127.0.0.1',()=>console.log(`http://${process.env.HOST??'127.0.0.1'}:${server.address().port}${home}`));

for(const event of ['SIGINT','SIGTERM'])process.on(event,()=>{network?.dispose();arena?.dispose();server.close(()=>process.exit());});
