import {LatestStateOutbox} from '../../engine/network/projection.js';
import {WORLD_REVISION} from '../../engine/games/thegame/world.js';
// The render thread receives only a requested latest snapshot, not a packet backlog.
let socket,welcome=null,status='idle',reason='',rtt=0,lastReceive=0;
const incoming=new LatestStateOutbox();let received=0,bytes=0;
self.onmessage=({data})=>{
 if(data.type==='connect'){
  socket?.close();incoming.clear();welcome=null;status='connecting';reason='';
  const current=new WebSocket(data.url);socket=current;
  current.onopen=()=>current.send(JSON.stringify({type:'join',version:WORLD_REVISION,name:data.name,resume:data.resume}));
  current.onmessage=event=>{
   if(socket!==current)return;
   try{if(typeof event.data!=='string'||event.data.length>65_536)throw Error('Packet limit');const packet=JSON.parse(event.data);received++;bytes+=event.data.length;lastReceive=performance.now();
    if(packet.type==='welcome'){welcome=packet;status='connected';}
    else if(packet.type==='state')incoming.offer(packet);
    else if(packet.type==='pong'&&Number.isFinite(packet.at))rtt=performance.now()-packet.at;
    else throw Error('Unknown server message');
   }catch(error){reason=String(error);current.close(1002,'Invalid server packet');}
  };
  current.onclose=event=>{if(socket===current){status='closed';reason=event.reason||'Соединение закрыто';incoming.clear();}};
  current.onerror=()=>{if(socket===current)reason='Сервер недоступен';};
 }else if(data.type==='pump'){
  let sent=data.sent;
  if(socket?.readyState===WebSocket.OPEN&&socket.bufferedAmount<4096&&data.items.length){socket.send(JSON.stringify({type:'input',items:data.items}));sent=data.items.at(-1).seq;}
  const packet=incoming.take();self.postMessage({type:'pump',welcome,packet,status,reason,sent,rtt,age:lastReceive?performance.now()-lastReceive:0,received,bytes,replaced:incoming.replaced,buffered:socket?.bufferedAmount??0});welcome=null;
 }else if(data.type==='close'){socket?.close(1000,'Page inactive');status='closed';incoming.clear();}
};
setInterval(()=>{if(socket?.readyState===WebSocket.OPEN&&socket.bufferedAmount<1024)socket.send(JSON.stringify({type:'ping',at:performance.now()}));},1000);
