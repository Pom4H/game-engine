/** Same AuthoritySession/Projection as the editor, with a fixed game recipe instead of remote source execution. */
import {parentPort,workerData} from 'node:worker_threads';
import {CarBallArena,arenaProjection,arenaDatagram,ARENA_DT} from '../../dist/examples/car-ball.js';
import {AuthoritySession} from '../../dist/network/authority.js';
let arena=new CarBallArena(),epoch=workerData.epoch,session,last=performance.now(),debt=0;
const seats=[null,null],peers=new Set();let published=-1;
function install(){session=new AuthoritySession(arena,arenaProjection,++epoch,()=>false,ARENA_DT);session.paused=false;debt=0;published=-1;last=performance.now();}
install();
const publish=(bootstrap=false)=>{const p=session.publish(),packet=workerData.datagrams?arenaDatagram.encode(p.frame):null;published=arena.tick;parentPort.postMessage({kind:'frame',...(packet?{packet}:{text:p.text()}),epoch,tick:arena.tick,paused:session.paused});return bootstrap&&packet?arenaDatagram.decode(packet):p.frame;};
parentPort.on('message',m=>{
 try{
  const seat=seats.indexOf(m.peer);let result;
  if(m.action==='join'){
   if(peers.size>=8)throw Error('Room full');peers.add(m.peer);const free=seats.indexOf(null);if(free>=0)seats[free]=m.peer;
   result={epoch,seat:free,frame:publish(true),sequence:free<0?0:arena.ack[free],jumpSerial:free<0?0:arena.cars[free].input.jumpSerial};
  }else{
   if(!peers.has(m.peer))throw Error('Unknown peer');
   if(m.action==='leave'){peers.delete(m.peer);if(seat>=0){arena.release(seat);seats[seat]=null;}result={left:true};}
   else if(m.action==='input'){
    if(seat<0||m.epoch!==epoch)throw Error('Not current driver');
    result={accepted:arena.input(seat,m.sequence,m.controls),sequence:arena.ack[seat],tick:arena.tick,epoch};
   }else if(m.action==='replay'){if(m.epoch!==epoch)throw Error('Stale epoch');result={epoch,frames:session.history.exportRange(m.from,m.to)};}
   else if(m.action==='restart'){
    if(seat!==0)throw Error('Only first driver may restart this private room');arena.dispose();arena=new CarBallArena();install();result={epoch,frame:publish(true)};
   }else if(m.action==='ping')result={epoch,tick:arena.tick};
   else throw Error('Unknown operation');
  }
  parentPort.postMessage({id:m.id,text:JSON.stringify(result)});
 }catch(error){parentPort.postMessage({id:m.id,error:String(error.message??error)});}
});
setInterval(()=>{
 const now=performance.now();debt=Math.min(.25,debt+Math.max(0,(now-last)/1000));last=now;
 const steps=Math.min(8,Math.floor(debt/ARENA_DT));if(!steps||session.paused)return;
 try{session.advance(steps);debt-=steps*ARENA_DT;if(arena.tick-published>=(workerData.datagrams?2:4))publish();}
 catch(error){session.paused=true;parentPort.postMessage({kind:'error',error:String(error.stack??error)});}
},4);
