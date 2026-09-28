/** Same native QUIC boundary as thegame, without its car-specific wire protocol.
 * Only hello/ack is reliable here; live input/state are datagrams, never TCP fallbacks. */
import {createServer} from '@webtransport-bun/webtransport';
import {createSocket} from 'node:dgram';
import {readFile,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {X509Certificate} from 'node:crypto';
import {resolve} from 'node:path';
import {DatagramOutbox} from '../../dist/network/datagram.js';
import {decodeArcadeInput} from '../../dist/network/arcade-wire.js';
import {arenaDatagram} from '../../dist/examples/car-ball.js';

async function hello(stream){
 const reader=stream.readable.getReader(),chunks=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>4096)throw Error('Hello budget');chunks.push(value);}
  const all=new Uint8Array(size);let offset=0;for(const part of chunks){all.set(part,offset);offset+=part.length;}
  if(size<4||new DataView(all.buffer).getUint32(0,true)!==size-4)throw Error('Truncated hello');
  return JSON.parse(new TextDecoder().decode(all.subarray(4)));
 }finally{reader.releaseLock();}
}
export async function startArenaQuic(host,{port=4433,url,certPath,keyPath}={}){
 if(!Number.isInteger(port)||port<0||port>65535)throw Error('Invalid QUIC port');
 // Provider 0.3.0 exposes the requested port, not the OS-selected port when passed zero.
 // Pick an ephemeral UDP port before opening the native listener; bind failure remains fatal.
 if(port===0){const probe=createSocket('udp4');try{await new Promise((resolve,reject)=>{probe.once('error',reject);probe.bind(0,'127.0.0.1',resolve);});port=probe.address().port;}finally{await new Promise(resolve=>probe.close(resolve));}}
 const local=!url,dir=resolve('.local/arena-quic');let cert=certPath,key=keyPath;
 if(!cert||!key){
  if(!local)throw Error('Public QUIC endpoint requires TLS certificate and key');await mkdir(dir,{recursive:true});cert=resolve(dir,'cert.pem');key=resolve(dir,'key.pem');
  // Short-lived P-256 cert pinned by localhost bootstrap. Never disable TLS verification.
  let valid=false;try{const x=new X509Certificate(await readFile(cert));valid=Date.parse(x.validTo)>Date.now()+86400000;}catch{}
  if(!valid){const openssl=process.env.OPENSSL_PATH??(process.platform==='win32'&&existsSync('C:/Program Files/Git/usr/bin/openssl.exe')?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl');execFileSync(openssl,['req','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:P-256','-nodes','-days','10','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1','-keyout',key,'-out',cert],{stdio:'ignore'});}
 }
 const certPem=await readFile(cert,'utf8'),keyPem=await readFile(key,'utf8'),fingerprint=new X509Certificate(certPem).fingerprint256.replaceAll(':','');
 const active=new Map();let closed=false;
 const stats={accepted:0,rejected:0,received:0,stale:0,malformed:0};
 const server=createServer({host:local?'127.0.0.1':process.env.ARENA_QUIC_HOST??'0.0.0.0',port,tls:{certPem,keyPem},
  log:event=>{if(event.level==='error'||event.level==='warn')stats.lastTransportError=String(event.msg).slice(0,512);},
  limits:{maxSessions:8,maxHandshakesInFlight:4,maxStreamsPerSessionBidi:1,maxStreamsPerSessionUni:0,maxStreamsGlobal:8,maxDatagramSize:1200,maxQueuedBytesGlobal:65536,maxQueuedBytesPerSession:8192,maxQueuedBytesPerStream:4096,backpressureTimeoutMs:500,handshakeTimeoutMs:5000,idleTimeoutMs:10000},
  rateLimits:{handshakesPerSec:4,handshakesBurst:8,datagramsPerSec:160,datagramsBurst:32,streamsPerSec:8,streamsBurst:8},
  async onSession(session){
   let binding=null,queue=null,unwatch=()=>{},done=false,timer,streams;
   const stop=()=>{if(done)return;done=true;clearTimeout(timer);queue?.close();unwatch();if(binding){active.delete(binding.token);binding.release();}void streams?.cancel().catch(()=>{});try{session.close({code:0,reason:'Closed'});}catch{}};
   timer=setTimeout(stop,5000);void session.closed.then(stop,stop);
   try{
    streams=session.incomingBidirectionalStreams.getReader();const first=await streams.read();if(first.done)throw Error('Hello stream missing');
    const value=await hello(first.value);
    if(done||closed||value.schema!==arenaDatagram.signature||!Number.isInteger(value.mtu)||value.mtu<arenaDatagram.size||value.mtu>65535||typeof value.token!=='string'||active.has(value.token))throw Error('Invalid/duplicate hello');
    binding=host.bindDatagrams(value.token);active.set(binding.token,{stop,get queue(){return queue;}});
    queue=new DatagramOutbox(bytes=>session.sendDatagram(bytes),()=>performance.now(),50,error=>{stats.lastError=String(error.message??error).slice(0,512);stop();});
    const writer=first.value.writable.getWriter();await writer.write(new TextEncoder().encode(JSON.stringify({ok:true,schema:arenaDatagram.signature,mtu:1200})));await writer.close();writer.releaseLock();
    if(done)return;clearTimeout(timer);stats.accepted++;void streams.read().then(next=>{if(!next.done)stop();},stop);
    unwatch=binding.subscribe(packet=>queue.offer(packet));
    let sequence=0,epoch=0,at=performance.now(),credit=24,busy=false,pending=null;
    const submit=async()=>{if(busy||done)return;busy=true;try{while(pending&&!done){const m=pending;pending=null;await binding.input(m);}}catch(error){stats.lastError=String(error.message??error).slice(0,512);stop();}finally{busy=false;}};
    for await(const bytes of session.incomingDatagrams()){
     if(done)break;const now=performance.now();credit=Math.min(24,credit+(now-at)*.12);at=now;if(--credit<0)throw Error('Input rate exceeded');
     let message;try{message=decodeArcadeInput(bytes);}catch{stats.malformed++;continue;}
     if(message.epoch!==binding.epoch||message.epoch<epoch||message.epoch===epoch&&message.sequence<=sequence){stats.stale++;continue;}
     epoch=message.epoch;sequence=message.sequence;stats.received++;pending=message;void submit();
    }
   }catch(error){stats.rejected++;stats.lastError=String(error.message??error);}finally{stop();}
  },
 });
 return {config:{mode:'webtransport',url:url??`https://127.0.0.1:${server.address.port}/arena`,schema:arenaDatagram.signature,...(local?{certificateHash:fingerprint}:{})},
  inspect:()=>({...stats,port:server.address.port,sessions:active.size,native:server.metricsSnapshot(),outboxes:[...active.values()].map(s=>s.queue?{queued:s.queue.queued,...s.queue.stats}:null)}),
  async close(){closed=true;for(const a of active.values())a.stop();active.clear();await server.close();}};
}
