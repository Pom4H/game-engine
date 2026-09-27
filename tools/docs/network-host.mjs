/** Opt-in loopback diagnostic host. Reliable SSE is a replaceable transport, NOT loss-free QUIC.
 * Physics/heap inspection runs in its own worker. Slow viewers retain one unsent absolute state. */
import {Worker} from 'node:worker_threads';
import {randomBytes} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {LatestStateOutbox} from '../../dist/network/projection.js';
export function debugNetworkHost({arena=false,publicOrigin}={}){
 const prefix=arena?'/arena-network/':'/debug-network/',peers=new Map();
 const token=randomBytes(32).toString('hex'),viewers=new Set(),pending=new Map();let worker=null,serial=0,latest=null,meta=null,closed=false;
 const stats={publications:0,replaced:0,viewers:0},heapPath=process.env.NETWORK_HEAP==='1'?resolve('artifacts/network-private/authority.heapsnapshot'):undefined;
 if(heapPath)mkdirSync(resolve('artifacts/network-private'),{recursive:true});
 function boot(){if(worker)return;worker=new Worker(new URL(arena?'./arena-authority.mjs':'./network-authority.mjs',import.meta.url),{workerData:{epoch:Date.now(),heapPath},resourceLimits:{maxOldGenerationSizeMb:512}});
  worker.on('message',m=>{if(m.kind==='frame'){latest=m;stats.publications++;for(const v of viewers){v.out.offer(m.text);flush(v);}return;}if(m.kind==='error'){for(const v of viewers)v.res.write(`event: fault\ndata: ${JSON.stringify(m.error)}\n\n`);return;}
   const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error(m.error)):p.resolve({text:m.text,ready:m.ready});});
  worker.on('error',error=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(error);}pending.clear();peers.clear();worker=null;latest=null;meta=null;for(const v of viewers)v.res.end();viewers.clear();});
 }
 function ask(value){if(closed)return Promise.reject(new Error('Host disposed'));if(pending.size>=8)return Promise.reject(new Error('Debug command queue full'));boot();return new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(new Error('Authority command timeout'));},value.action==='heap'?120000:15000);pending.set(id,{resolve,reject,timer});worker.postMessage({...value,id});});}
 function flush(v){if(v.blocked)return;const value=v.out.take();if(value!==undefined)v.blocked=!v.res.write(`data: ${value}\n\n`);}
 async function body(req){let size=0;const chunks=[];for await(const c of req){size+=c.length;if(size>(arena?4096:6_000_000))throw new Error('Request too large');chunks.push(c);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
 function raw(res,text,status=200){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(text);}
 function json(res,value,status=200){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(value));}
 const heartbeat=setInterval(()=>{if(arena)for(const [peer,p] of peers)if(Date.now()-p.at>10000){peers.delete(peer);for(const v of viewers)if(v.peer===peer)v.res.end();void ask({action:'leave',peer}).catch(()=>{});}for(const v of viewers)if(!v.blocked)v.blocked=!v.res.write(': heartbeat\n\n');},1000);
 return {
  async handle(req,res){
   const path=new URL(req.url,'http://localhost').pathname;if(!path.startsWith(prefix))return false;
   try{
    const remote=req.socket.remoteAddress;if(!publicOrigin&&!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote))throw new Error('Loopback only');
    const origin=req.headers.origin,expected=publicOrigin??`http://${req.headers.host}`;
    if(publicOrigin&&new URL(publicOrigin).host!==req.headers.host)throw new Error('Invalid arena host');
    if(!publicOrigin&&!['127.0.0.1','localhost','[::1]'].includes(new URL(expected).hostname))throw new Error('Invalid debug host');
    if(origin&&origin!==expected||req.headers['sec-fetch-site']==='cross-site')throw new Error('Cross-origin debug request denied');
    if(!arena&&path===prefix+'config'&&req.method==='GET'){json(res,{token,enabled:true});return true;}
    if(path===prefix+'status'&&req.method==='GET'){json(res,{epoch:latest?.epoch,tick:latest?.tick,paused:latest?.paused,...stats,viewers:viewers.size});return true;}
    if(!arena&&path===prefix+'manifest'&&req.method==='GET'){if(!meta)throw new Error('No debug session');raw(res,meta);return true;}
    if(path===prefix+'events'&&req.method==='GET'){
     if(arena&&!peers.has(req.headers['x-debug-token']))throw new Error('Join before watching');
     if(viewers.size>=8||!worker)throw new Error('No session or viewer capacity reached');
     res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store','connection':'keep-alive','x-accel-buffering':'no'});
     const v={res,peer:req.headers['x-debug-token'],out:new LatestStateOutbox(),blocked:false};viewers.add(v);res.on('drain',()=>{v.blocked=false;flush(v);});req.on('close',()=>{stats.replaced+=v.out.replaced;viewers.delete(v);});if(latest){v.out.offer(latest.text);flush(v);}return true;
    }
    if(arena){
     if(req.method!=='POST')throw new Error('POST required');
     const action=path.slice(prefix.length);
     if(action==='join'){
      if(peers.size>=8)throw new Error('Room full');
      const peer=randomBytes(24).toString('hex'),result=await ask({action:'join',peer});peers.set(peer,{at:Date.now()});
      json(res,{...JSON.parse(result.text),token:peer});return true;
     }
     const peer=req.headers['x-debug-token'],session=peers.get(peer);if(!session){json(res,{error:'Join required'},403);return true;}
     session.at=Date.now();
     if(!['input','leave','replay','restart','ping'].includes(action))throw new Error('Unknown arena command');
     const data=await body(req);const result=await ask({...data,action,peer});if(action==='leave'){peers.delete(peer);for(const v of viewers)if(v.peer===peer)v.res.end();}raw(res,result.text);return true;
    }
    if(req.method!=='POST'||req.headers['x-debug-token']!==token){json(res,{error:'Debug command denied'},403);return true;}
    const data=await body(req),action=path.slice(prefix.length);
    if(!['init','edit','pause','resume','step','dump','heap','replay'].includes(action))throw new Error('Unknown debug operation');
    const result=await ask({...data,action,peer:'owner'});
    if(result.ready)meta=result.text;
    raw(res,result.text);
   }catch(error){json(res,{error:String(error.message??error)},400);}
   return true;
  },
  dispose(){closed=true;clearInterval(heartbeat);for(const v of viewers)v.res.end();viewers.clear();for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('Host disposed'));}pending.clear();void worker?.terminate();},
 };
}
