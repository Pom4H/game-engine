import {hostname} from 'node:os';
import {AuthorityShardLease} from '../../src/network/shard-authority.ts';
import {populationProjection} from '../../src/network/population.ts';
import {THEGAME_REGION_CAPABILITY,ThegameRegionAuthority,readThegameRegionSpec} from '../../src/games/thegame/region.ts';

const raw=process.env.MESHWORK_BROKER??'http://127.0.0.1:8787';
const url=new URL(raw);
url.protocol=url.protocol==='https:'?'wss:':url.protocol==='http:'?'ws:':url.protocol;
if(url.protocol!=='ws:'&&url.protocol!=='wss:')throw Error('MESHWORK_BROKER must be http(s) or ws(s)');
if(!url.pathname.endsWith('/ws'))url.pathname=url.pathname.replace(/\/$/,'')+'/ws';
const workerId=process.env.THEGAME_REGION_WORKER_ID??`${hostname()}-region-${process.pid}`;
let socket,active,reconnect;

const send=message=>{if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(message));};
function stopActive(reason='stopped'){
 if(!active)return;
 clearInterval(active.stepTimer);clearInterval(active.heartbeatTimer);
 active.world.dispose();active=undefined;
 if(reason!=='reconnect')console.log('region shard '+reason);
}
function fail(error){
 const current=active;
 if(current)send({type:'shard.error',shardId:current.assignment.shard.id,leaseId:current.assignment.leaseId,epoch:current.assignment.shard.epoch,tick:current.world.tick,error:String(error).slice(0,500)});
 stopActive('failed: '+String(error));
}
function start(assignment){
 if(active)throw Error('Worker already owns a shard');
 if(assignment.shard.capability!==THEGAME_REGION_CAPABILITY)throw Error('Unsupported shard capability');
 const spec=readThegameRegionSpec(assignment.shard.input);
 const world=new ThegameRegionAuthority(spec,assignment.resumeTick);
 const lease=new AuthorityShardLease(workerId,assignment,world,populationProjection,{stepSeconds:spec.stepSeconds});
 const publishEvery=Math.max(1,Math.round(1/spec.stepSeconds));
 active={assignment,spec,world,lease,publishEvery,stepTimer:undefined,heartbeatTimer:undefined};
 send(lease.publish());
 active.heartbeatTimer=setInterval(()=>{try{send(lease.heartbeat());}catch(error){fail(error);}},4000);
 active.stepTimer=setInterval(()=>{
  try{lease.advance();if(world.tick%publishEvery===0)send(lease.publish());}
  catch(error){fail(error);}
 },Math.max(10,spec.stepSeconds*1000));
 console.log(`world.region.v1 ${assignment.shard.id} epoch=${assignment.shard.epoch} tick=${assignment.resumeTick} population=${spec.population}`);
}
function connect(){
 clearTimeout(reconnect);
 socket=new WebSocket(url);
 socket.addEventListener('open',()=>{
  send({type:'worker.hello',worker:{id:workerId,name:workerId,platform:process.platform,capabilities:[THEGAME_REGION_CAPABILITY]}});
  console.log('TheGame region worker connected to '+url.origin);
 });
 socket.addEventListener('message',event=>{
  try{
   const message=JSON.parse(String(event.data));
   if(message.type==='shard.assign')start(message);
   else if(message.type==='shard.revoke'&&active?.lease.revoke(message))stopActive('revoked: '+message.reason);
  }catch(error){fail(error);}
 });
 socket.addEventListener('close',()=>{stopActive('reconnect');reconnect=setTimeout(connect,1000);});
 socket.addEventListener('error',()=>{});
}
connect();
function stop(){clearTimeout(reconnect);stopActive('shutdown');socket?.close();}
process.once('SIGINT',stop);process.once('SIGTERM',stop);
