/* Network parsing off the render thread. One transferred frame + one replaceable pending frame. */
import {sceneMotion} from './engine/network/scene-view.js';
let stream=null,pending=null,busy=false,serial=0,clip=null,clipSerial=0;
function clipNext(){if(!clip)return;if(!clip.length){clip=null;postMessage({kind:'clip-end',serial});return;}postMessage({kind:'clip-chunk',frames:clip.splice(0,4),serial});}let stats={received:0,replaced:0,malformed:0};
function offer(frame){if(pending)stats.replaced++;pending=frame;flush();}
function flush(){if(busy||!pending)return;busy=true;const frame=pending;pending=null;postMessage({kind:'frame',frame,serial,stats:{...stats}});}
onmessage=({data})=>{
 if(data.kind==='connect'){
  stream?.close();serial=data.serial;pending=null;busy=false;stream=new EventSource('/debug-network/events');
  stream.onmessage=e=>{try{const frame=sceneMotion.decode(e.data);stats.received++;offer(frame);}catch(error){stats.malformed++;postMessage({kind:'error',error:String(error),serial});}};
  stream.onerror=()=>postMessage({kind:'status',status:'Ожидание сети · последняя поза сохранена',serial});
 }else if(data.kind==='replay'){
  const request=++clipSerial,connection=serial;clip=null;
  (async()=>{try{const r=await fetch('/debug-network/replay',{method:'POST',headers:{'content-type':'application/json','x-debug-token':data.token},body:JSON.stringify({epoch:data.epoch,from:data.from,to:data.to})});const text=await r.text();if(text.length>48_000_000)throw Error('Replay size budget');const result=JSON.parse(text);if(!r.ok)throw Error(result.error);if(request!==clipSerial||connection!==serial)return;if(!Array.isArray(result.frames)||result.frames.length>600)throw Error('Replay frame budget');clip=result.frames.map(f=>sceneMotion.read(f));postMessage({kind:'clip-start',serial});clipNext();}catch(error){postMessage({kind:'error',error:String(error),serial:connection});}})();
 }else if(data.kind==='clip-ack'&&data.serial===serial){clipNext();
 }else if(data.kind==='ack'&&data.serial===serial){busy=false;flush();}
 else if(data.kind==='stop'){stream?.close();stream=null;pending=null;busy=false;clip=null;clipSerial++;serial++;}
};
