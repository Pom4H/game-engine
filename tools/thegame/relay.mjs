/** Loopback-only acceptance fixture. Delays real websocket messages in both directions.
 * Preserves TCP ordering; drops 5% of replaceable application snapshots (not TCP packets).
 * This is intentionally not part of the production server. */
const upstream=process.env.THEGAME_UPSTREAM;if(!upstream||!/^http:\/\/127\.0\.0\.1:\d+$/.test(upstream))throw Error('Loopback QA upstream required');
let sequence=0;const connections=new Map(),stats={forwarded:0,snapshotDrops:0,maxQueued:0};
const queue=(c,target,text,direction)=>{
 if(direction===1&&String(text).includes('"type":"state"')&&++c.snapshots%20===0){stats.snapshotDrops++;return;}
 if(c.queue.length>=64||text.length>65536){c.down.close(1013,'QA queue cap');c.up.close();return;}
 const now=performance.now(),lag=50+(((++sequence*37)%61)-30),due=Math.max(now+lag,c.last[direction]+.1);c.last[direction]=due;
 c.queue.push({target,text,due});stats.maxQueued=Math.max(stats.maxQueued,c.queue.length);
};
const server=Bun.serve({hostname:'127.0.0.1',port:Number(process.env.PORT??4191),async fetch(req,server){const url=new URL(req.url);if(url.pathname==='/thegame/socket')return server.upgrade(req)?undefined:new Response('',{status:426});if(url.pathname==='/relay/health')return Response.json({...stats,connections:connections.size});return fetch(upstream+url.pathname+url.search,{method:req.method});},websocket:{maxPayloadLength:65536,open(down){const up=new WebSocket(upstream.replace('http:','ws:')+'/thegame/socket'),c={down,up,queue:[],last:[0,0],snapshots:0};connections.set(down,c);up.onmessage=e=>queue(c,down,String(e.data),1);up.onclose=()=>down.close();up.onerror=()=>down.close();},message(down,text){const c=connections.get(down);if(c)queue(c,c.up,String(text),0);},close(down){const c=connections.get(down);connections.delete(down);c?.up.close();if(c)c.queue.length=0;}}});
const timer=setInterval(()=>{const now=performance.now();for(const c of connections.values())for(let i=0;i<c.queue.length;){const item=c.queue[i];if(item.due>now||item.target===c.up&&c.up.readyState===0){i++;continue;}c.queue.splice(i,1);try{item.target.send(item.text);stats.forwarded++;}catch{c.down.close();c.up.close();}}},2);
function stop(){clearInterval(timer);for(const c of connections.values()){c.down.close();c.up.close();}server.stop(true);}process.on('SIGTERM',stop);process.on('SIGINT',stop);console.log('Thegame network fixture :'+server.port);
