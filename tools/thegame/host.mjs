import {randomUUID} from 'node:crypto';
import {ThegameAuthority,worldSignature} from '../../dist/games/thegame/session.js';
import {WORLD_REVISION} from '../../dist/games/thegame/world.js';
import {FixedClock} from '../../dist/core/fixed-clock.js';
import {LatestStateOutbox} from '../../dist/network/projection.js';
/** Platform adapter: Bun owns sockets, the engine owns simulation. Tests use the same host. */
export function createThegameHost(config,{profile=false,now=()=>performance.now(),epoch=Date.now(),population=()=>[]}={}){
 const game=new ThegameAuthority(config,epoch,profile),clock=new FixedClock(1000/60,2000,12),sockets=new Map(),sessions=new Map();
 let identities=0;const stats={bytes:0,messages:0,replaced:0,backpressure:0,timeouts:0,populationErrors:0};
 function send(socket,data){const c=sockets.get(socket);if(!c)return;const text=typeof data==='string'?data:JSON.stringify(data);const result=socket.send(text);stats.bytes+=Buffer.byteLength(text);stats.messages++;if(result===-1){c.blocked=true;c.blockedAt=now();stats.backpressure++;}else if(result===0)socket.close(1011,'Connection unavailable');}
 function flush(socket){const c=sockets.get(socket);if(!c||c.blocked)return;const next=c.outbox.take();if(next!==undefined)send(socket,next);}
 function close(socket){const c=sockets.get(socket);if(!c)return;sockets.delete(socket);if(c.id){const peer=game.peers.get(c.id),session=sessions.get(c.token);if(peer&&session){session.state={...peer.state};session.discovered=peer.discovered;session.residentId=peer.residentId;session.active=false;session.expires=now()+30_000;}game.leave(c.id);}c.outbox.clear();}
 return {
  game,stats,
  open(socket){if(sockets.size>=32){socket.close(1013,'Room full');return;}sockets.set(socket,{id:null,token:null,last:now(),bucket:120,bucketAt:now(),blocked:false,blockedAt:0,outbox:new LatestStateOutbox()});},
  message(socket,text){const c=sockets.get(socket);if(!c)return;
   try{
    const at=now();c.bucket=Math.min(120,c.bucket+(at-c.bucketAt)*.12);c.bucketAt=at;if(--c.bucket<0)throw Error('Message rate limit');
    if(typeof text!=='string'||text.length>8192||Buffer.byteLength(text)>8192)throw Error('Text messages up to 8192 bytes only');
    const data=JSON.parse(text);if(!data||typeof data!=='object'||Array.isArray(data))throw Error('Invalid message');
    if(data.type==='join'){
     if(c.id||data.version!==WORLD_REVISION||typeof data.name!=='string'||data.name.length>48)throw Error('Incompatible client');
     const prior=typeof data.resume==='string'?sessions.get(data.resume):null,saved=prior&&!prior.active&&prior.expires>at?prior:null;
     // A copied tab does not take ownership of another live player.
     c.id=saved?.id??'p'+(++identities).toString(36);c.token=saved?data.resume:randomUUID();
     const peer=game.join(c.id,data.name,saved??undefined);
     for(const [key,s] of sessions)if(!s.active&&s.expires<=at)sessions.delete(key);
     if(sessions.size>=64){const unused=[...sessions].find(([,s])=>!s.active);if(unused)sessions.delete(unused[0]);else throw Error('Session capacity');}
     sessions.set(c.token,{id:c.id,residentId:peer.residentId,active:true,expires:Infinity,state:{...peer.state},discovered:peer.discovered});
     send(socket,{type:'welcome',version:WORLD_REVISION,world:worldSignature(game.config),config:game.config,epoch:game.epoch,id:c.id,token:c.token,resident:game.resident(c.id),self:{ack:0,state:peer.state,discovered:peer.discovered}});
    }else if(data.type==='input'){
     if(!c.id)throw Error('Join first');game.enqueue(c.id,data.items);
    }else if(data.type==='ping'){
     if(!c.id||typeof data.at!=='number'||!Number.isFinite(data.at))throw Error('Invalid ping');if(!c.blocked)send(socket,{type:'pong',at:data.at});
    }else throw Error('Unknown message');
    c.last=at;
   }catch(error){socket.close(1008,String(error.message).slice(0,100));close(socket);}
  },
  drain(socket){const c=sockets.get(socket);if(c){c.blocked=false;flush(socket);}},
  close,
  advance(at=now()){
   for(const [socket,c] of sockets)if(at-c.last>(c.id?5000:3000)||c.blocked&&at-c.blockedAt>2000){stats.timeouts++;socket.close(1013,'Connection stalled');close(socket);}
   for(const [key,s] of sessions)if(!s.active&&s.expires<=at)sessions.delete(key);
   const before=game.tick,steps=clock.advance(at,()=>game.step());
   // Catch up bounded simulation debt, but publish only the newest state once.
   // Scheduler jitter therefore cannot turn into a catch-up packet burst.
   if(steps&&Math.floor(game.tick/3)>Math.floor(before/3)){
    let populationFrames=[];try{const value=population();if(!Array.isArray(value)||value.length>64)throw Error('Population projection budget');populationFrames=value;}catch{stats.populationErrors++;}
    game.setPopulation(populationFrames);
    for(const [socket,c] of sockets)if(c.id){if(c.outbox.size)stats.replaced++;const state=game.snapshot(c.id,populationFrames);c.outbox.offer(populationFrames.length?{...state,population:populationFrames}:state);flush(socket);}
   }
   return steps;
  },
  inspect(){return {...game.inspect(),transport:{...stats,sockets:sockets.size,sessions:sessions.size,unsent:[...sockets.values()].reduce((n,c)=>n+c.outbox.size,0)},droppedSimulationMs:clock.droppedMs};},
  dispose(){for(const socket of sockets.keys()){socket.close(1001,'Server shutdown');close(socket);}sessions.clear();game.dispose();},
 };
}
