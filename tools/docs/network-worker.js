/* Network parsing off the render thread. One transferred frame + one replaceable pending frame. */
import {sceneMotion} from './engine/network/scene-view.js';
let schema=sceneMotion,endpoint='/debug-network/',connectionToken='';
let stream=null,pending=null,busy=false,serial=0,clip=null,clipSerial=0;
function clipNext(){if(!clip)return;if(!clip.length){clip=null;postMessage({kind:'clip-end',serial});return;}postMessage({kind:'clip-chunk',frames:clip.splice(0,4),serial});}let stats={received:0,replaced:0,malformed:0};
function offer(frame){if(pending)stats.replaced++;pending=frame;flush();}
function flush(){if(busy||!pending)return;busy=true;const frame=pending;pending=null;postMessage({kind:'frame',frame,serial,stats:{...stats}});}
onmessage=({data})=>{
 if(data.kind==='connect'){
  stream?.abort();serial=data.serial;pending=null;busy=false;endpoint=data.arena?'/arena-network/':'/debug-network/';connectionToken=data.token??'';
  const controller=new AbortController();stream=controller;const current=serial;
  (async()=>{
   schema=data.arena?(await import('./engine/examples/car-ball.js')).arenaProjection:sceneMotion;
   while(!controller.signal.aborted&&current===serial){
    try{
     const r=await fetch(endpoint+'events',{headers:connectionToken?{'x-debug-token':connectionToken}:{},signal:controller.signal});
     if(!r.ok||!r.body)throw Error('Stream '+r.status);
     const reader=r.body.getReader(),decoder=new TextDecoder();let buffer='';
     try{for(;;){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});
      let index;while((index=buffer.indexOf('\n\n'))>=0){if(index>schema.maxBytes+1024)throw Error('SSE event budget');const event=buffer.slice(0,index);buffer=buffer.slice(index+2);const text=event.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');if(!text)continue;
       if(event.includes('event: fault'))throw Error(text);const frame=schema.decode(text);stats.received++;if(current===serial)offer(frame);
      }
      if(buffer.length>schema.maxBytes+1024)throw Error('SSE buffer budget');
     }}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
    }catch(error){if(controller.signal.aborted)break;stats.malformed++;postMessage({kind:'status',status:String(error),serial:current});}
    if(!controller.signal.aborted){postMessage({kind:'status',status:'Ожидание сети · последняя поза сохранена',serial:current});await new Promise(r=>setTimeout(r,500));}
   }
  })().catch(error=>postMessage({kind:'error',error:String(error),serial:current}));
 }else if(data.kind==='replay'){
  const request=++clipSerial,connection=serial;clip=null;
  (async()=>{try{const r=await fetch(endpoint+'replay',{method:'POST',headers:{'content-type':'application/json','x-debug-token':data.token},body:JSON.stringify({epoch:data.epoch,from:data.from,to:data.to})});const text=await r.text();if(text.length>48_000_000)throw Error('Replay size budget');const result=JSON.parse(text);if(!r.ok)throw Error(result.error);if(request!==clipSerial||connection!==serial)return;if(!Array.isArray(result.frames)||result.frames.length>600)throw Error('Replay frame budget');clip=result.frames.map(f=>schema.read(f));postMessage({kind:'clip-start',serial,epoch:result.epoch});clipNext();}catch(error){postMessage({kind:'error',error:String(error),serial:connection});}})();
 }else if(data.kind==='cancel-replay'){clip=null;clipSerial++;
 }else if(data.kind==='clip-ack'&&data.serial===serial){clipNext();
 }else if(data.kind==='ack'&&data.serial===serial){busy=false;flush();}
 else if(data.kind==='stop'){stream?.abort();stream=null;pending=null;busy=false;clip=null;clipSerial++;serial++;}
};
