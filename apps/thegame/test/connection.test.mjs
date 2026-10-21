import test from 'node:test';
import assert from 'node:assert/strict';
import {GameConnection} from '../client/connection.ts';
import {WorldVoice} from '../client/voice.ts';
import {bindingFor,actorsProjection,vehiclesProjection,serverWeather} from '../shared.ts';
import {BuildingWorld} from '../building.ts';
import {createWorldHost} from '../host.ts';
import {characterState,stepCharacter,idleCharacterInput} from '../../../src/runtime/character-motor.ts';

const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
function browser(t){
 const keys=['fetch','WebSocket','performance','navigator','MediaStream','RTCPeerConnection'],original=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)])),sockets=[],requests=[],pcs=[],clock={ms:0},microphones=[];
 class Track extends EventTarget {constructor(id='audio'){super();this.id=id;this.kind='audio';this.readyState='live';this.muted=false;this.enabled=true;this.stops=0;}stop(){this.stops++;this.readyState='ended';this.dispatchEvent(new Event('ended'));}}
 class Stream extends EventTarget {constructor(tracks=[]){super();this.tracks=[...tracks];}getAudioTracks(){return this.tracks.filter(track=>track.kind==='audio');}getTracks(){return this.tracks;}}
 const transceiver=()=>({direction:'sendrecv',receiver:{track:new Track('receiver')},sender:{track:null,async replaceTrack(track){this.track=track;}}});
 class PC {
  constructor(){this.connectionState='new';this.signalingState='stable';this.localDescription=null;this.remoteDescription=null;this.transceivers=[];this.added=0;this.offers=0;this.answers=0;this.closed=0;this.candidates=[];pcs.push(this);}
  addTransceiver(){this.added++;const value=transceiver();this.transceivers.push(value);return value;}
  getTransceivers(){return this.transceivers;}
  async createOffer(){this.offers++;if(this.offerGate)return this.offerGate.promise;return{type:'offer',sdp:'m=audio 9 UDP/TLS/RTP/SAVPF 111'};}
  async createAnswer(){this.answers++;return{type:'answer',sdp:'m=audio 9 UDP/TLS/RTP/SAVPF 111'};}
  async setLocalDescription(value){this.localDescription=value;this.signalingState=value.type==='offer'?'have-local-offer':'stable';}
  async setRemoteDescription(value){if(this.remoteGate)await this.remoteGate.promise;this.remoteDescription=value;if(value.type==='offer'&&!this.transceivers.length)this.transceivers.push(transceiver());this.signalingState=value.type==='offer'?'have-remote-offer':'stable';}
  async addIceCandidate(value){assert.ok(this.remoteDescription);this.candidates.push(value);}
  close(){this.closed++;this.connectionState='closed';}
 }
 class Socket {
  static OPEN=1;
  constructor(url){this.url=url;this.readyState=0;this.bufferedAmount=0;this.sent=[];sockets.push(this);}
  open(){this.readyState=1;this.onopen?.();}
  send(text){this.sent.push(JSON.parse(text));}
  message(packet){this.onmessage?.({data:JSON.stringify(packet)});}
  close(){this.readyState=3;this.onclose?.();}
 }
 const media={getUserMedia:async constraints=>{microphones.push(constraints);if(media.pending)return media.pending.promise;return new Stream([new Track('microphone')]);}};
 const values={fetch:async(url,options)=>{requests.push({url:String(url),options});return{ok:true,status:200};},WebSocket:Socket,performance:{now:()=>clock.ms},navigator:{mediaDevices:media},MediaStream:Stream,RTCPeerConnection:PC};
 for(const [key,value]of Object.entries(values))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
 t.after(()=>{for(const [key,descriptor]of original){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
 return{clock,sockets,requests,pcs,microphones,media,Track,Stream};
}
function packet({tick=0,time=tick/60,x=0,self,epoch=1}={}){
 const binding=bindingFor(29,epoch),stamp={epoch,sequence:tick+1,tick,time,paused:false};
 return{type:'world',binding,tick,time,worldMinute:480+time,actors:actorsProjection.capture(stamp,[{id:'r1',data:{position:[x,0,0],yaw:0,phase:0,speed:0,kind:0}}]),vehicles:vehiclesProjection.capture(stamp,[{id:'bus1',data:{position:[x*2,0,0],yaw:0,speed:0,mode:1,doors:0}}]),names:[{id:'r1',residentId:'r1',name:'Игрок'}],lift:{floor:2,target:2,elevation:6.6,door:1,velocity:0,phase:'idle'},weather:serverWeather(480+time,29),layoutRevision:0,...(self?{self}:{})};
}
const self=(state=characterState(0,0,0),ack=0)=>({id:'r1',position:[state.x,state.y,state.z],yaw:state.yaw,ack,state:{...state}});
async function connected(t,mock,options={}){const connection=new GameConnection({url:'ws://localhost:4317/world',role:'observer',entry:'office',...options});t.after(()=>connection.dispose());connection.connect();await flush();const socket=mock.sockets.at(-1);socket.open();socket.message({type:'welcome',binding:bindingFor(),layout:null,controlling:options.role==='player',actorId:options.role==='player'?'r1':undefined,inputSequence:0});return{connection,socket};}

test('connection bootstraps an HttpOnly session without URL tokens and observes one causal presentation time',async t=>{
 const mock=browser(t),{connection,socket}=await connected(t,mock);assert.equal(mock.requests[0].url,'http://localhost:4317/api/session');assert.equal(mock.requests[0].options.credentials,'include');assert.equal(new URL(socket.url).search,'');assert.deepEqual(socket.sent[0],{type:'hello',role:'observer',entry:'office',name:'Игрок'});
 socket.message(packet({tick:0,time:0,x:0}));mock.clock.ms=1000;socket.message(packet({tick:60,time:1,x:10}));const frame=connection.present(1);assert.ok(Math.abs(frame.actors[0].position[0]-9)<1e-8);assert.equal(frame.vehicles[0].position[0],frame.actors[0].position[0]*2);assert.equal(frame.time,.9);assert.equal(frame.connected,true);
 socket.message({type:'layout',layout:null,layoutRevision:0});socket.message({type:'pong'});socket.message({type:'voice',enabled:false});socket.message({type:'error',message:'Test rejection'});assert.equal(connection.status.message,'Test rejection');
 socket.close();const held=connection.present(100);assert.equal(held.connected,false);assert.equal(held.actors[0].position[0],10);assert.equal(held.vehicles[0].position[0],20);assert.notEqual(connection.status.state,'connected');assert.equal(mock.microphones.length,0);
});

test('fixed controls remain bounded during backpressure and replay only after executed self ACK',async t=>{
 const mock=browser(t),{connection,socket}=await connected(t,mock,{role:'player',entry:'street'}),initial=characterState(0,0,0),input={...idleCharacterInput(0),forward:1};socket.message(packet({self:self(initial)}));connection.input(input);
 socket.bufferedAmount=70000;mock.clock.ms=100;connection.pump();assert.equal(socket.sent.filter(value=>value.type==='input').length,0);assert.equal(connection.inspect().pendingInputs,6);
 socket.bufferedAmount=0;mock.clock.ms=110;connection.pump();const sent=socket.sent.find(value=>value.type==='input');assert.deepEqual(sent.items.map(value=>value.seq),[1,2,3,4,5,6]);assert.ok(sent.items.every(value=>!('position' in value)&&!('dt' in value)&&Object.keys(value.input).length===5));
 const authoritative={...initial},world=new BuildingWorld();for(let i=0;i<2;i++)stepCharacter(authoritative,input,world);socket.message(packet({tick:2,self:self(authoritative,2)}));assert.equal(connection.inspect().ack,2);assert.equal(connection.inspect().pendingInputs,4);assert.deepEqual(connection.authoritativeSelf.state,authoritative);
 const predicted={...authoritative};for(let i=0;i<4;i++)stepCharacter(predicted,input,world);assert.deepEqual(connection.present(.11).self.state,predicted);world.dispose();
});

test('the controlled elevator rider and rendered cabin share one presentation cause',async t=>{
 const mock=browser(t),{connection,socket}=await connected(t,mock,{role:'player'}),rider=(y,tick,time)=>{
  const state=characterState(-224,y,-41.4),value=packet({tick,time,self:self(state)}),stamp={epoch:1,sequence:tick+1,tick,time,paused:false};value.actors=actorsProjection.capture(stamp,[{id:'r1',data:{position:[state.x,y,state.z],yaw:0,phase:0,speed:0,kind:0}}]);value.lift={...value.lift,elevation:y,target:3,phase:'moving',door:0,velocity:1};return value;
 };
 socket.message(rider(6.6,0,0));mock.clock.ms=1000;socket.message(rider(7.6,60,1));const frame=connection.present(1);assert.equal(frame.self.position[1],frame.actors[0].position[1]);assert.equal(frame.self.position[1],frame.lift.elevation);assert.ok(Math.abs(frame.lift.elevation-7.5)<1e-9);assert.equal(connection.authoritativeSelf.position[1],7.6);
});

test('controller handoff takes an explicit server baseline and queued lift commands resolve on execution or disconnect',async t=>{
 const mock=browser(t),{connection,socket}=await connected(t,mock);connection.control(true);assert.deepEqual(socket.sent.at(-1),{type:'control',enabled:true});socket.message({type:'control',controlling:true,inputSequence:7,actorId:'r1'});socket.message(packet({tick:1,self:self(characterState(0,0,0),7)}));assert.equal(connection.status.controlling,true);assert.equal(connection.inspect().sequence,7);
 let finished=false;const command=connection.lift(3).then(value=>{finished=true;return value;});const sent=socket.sent.at(-1);assert.equal(sent.type,'lift');assert.equal(sent.floor,3);await flush();assert.equal(finished,false);socket.message({type:'command',commandId:sent.commandId,ok:true});assert.deepEqual(await command,{ok:true});
 const pending=connection.lift(4);socket.close();assert.equal((await pending).ok,false);assert.equal(connection.inspect().pendingCommands,0);
});

test('an already-sent world packet cannot undo a local request to relinquish control',async t=>{
 const mock=browser(t),{connection,socket}=await connected(t,mock,{role:'player'});socket.message(packet({self:self()}));connection.control(false);assert.equal(connection.status.controlling,false);socket.message(packet({tick:1,self:self()}));assert.equal(connection.status.controlling,false);mock.clock.ms=100;connection.pump();assert.equal(socket.sent.filter(value=>value.type==='input').length,0);await assert.rejects(()=>connection.publishVoice(true),/общий мир/);
});

test('control requires valid bounded inputs and layout updates send canonical state without client collision overrides',async t=>{
 const mock=browser(t),{connection,socket}=await connected(t,mock);await assert.rejects(()=>connection.publishVoice(true),/общий мир/);assert.equal(mock.microphones.length,0);assert.throws(()=>connection.input({...idleCharacterInput(),forward:2}),/bounded/);
 const state={version:1,revision:2,floors:[{id:'floor-1',name:'Офис',wallpaper:'mint'}],objects:[],activeFloor:'floor-1',selection:null};connection.setLayout(state,[{arbitrary:'untrusted collider'}],[{secret:'do not send'}]);assert.deepEqual(socket.sent.at(-1),{type:'layout',state});
 assert.equal((await connection.lift(2)).ok,false);socket.message({type:'world',...packet(),binding:bindingFor(30)});assert.equal(connection.status.state,'error');assert.match(connection.status.message,/mismatch/);
});

test('early control and voice roster messages are safe before welcome and stale world snapshots never create motion',async t=>{
 const mock=browser(t),connection=new GameConnection({url:'ws://localhost:4317/world',role:'player',entry:'street'});t.after(()=>connection.dispose());connection.connect();await flush();const socket=mock.sockets[0];socket.open();socket.message({type:'control',controlling:true,inputSequence:0,actorId:'r1'});socket.message({type:'voice-peers',selfId:'c1',peers:[]});socket.message({type:'welcome',binding:bindingFor(),layout:null,controlling:true,inputSequence:0,actorId:'r1'});socket.message(packet({self:self()}));assert.equal(connection.status.state,'connected');
 mock.clock.ms=2100;connection.pump();assert.equal(connection.status.state,'closed');const frame=connection.present(2.1);assert.equal(frame.connected,false);assert.equal(frame.self.position[2],0);assert.equal(connection.inspect().pendingInputs,0);
});

test('a stalled ACK cannot grow input replay beyond its bounded window',async t=>{
 const mock=browser(t),{connection,socket}=await connected(t,mock,{role:'player'});socket.message(packet({self:self()}));connection.input({...idleCharacterInput(),forward:1});
 for(let i=1;i<=21;i++){mock.clock.ms=i*100;socket.message(packet({tick:i*3,self:self()}));connection.pump();if(connection.status.state!=='connected')break;assert.ok(connection.inspect().pendingInputs<=120);}
 assert.equal(connection.status.state,'closed');assert.match(connection.status.message,/Очередь управления/);assert.equal(connection.inspect().pendingInputs,0);assert.ok(socket.sent.filter(value=>value.type==='input').flatMap(value=>value.items).length<=120);
});

test('lift timeout expires a pending command without claiming server execution',async t=>{
 const mock=browser(t),{connection,socket}=await connected(t,mock,{role:'player'});socket.message(packet({self:self()}));
 const originalSet=globalThis.setTimeout,originalClear=globalThis.clearTimeout,pending=new Map();
 globalThis.setTimeout=(callback,delay,...args)=>{if(delay!==8000)return originalSet(callback,delay,...args);const timer={};pending.set(timer,()=>callback(...args));return timer;};globalThis.clearTimeout=timer=>{if(pending.has(timer))pending.delete(timer);else originalClear(timer);};
 t.after(()=>{globalThis.setTimeout=originalSet;globalThis.clearTimeout=originalClear;});
 const command=connection.lift(3);assert.equal(connection.inspect().pendingCommands,1);pending.values().next().value();const result=await command;assert.equal(result.ok,false);assert.match(result.error,/не подтвердил/);assert.equal(connection.inspect().pendingCommands,0);
});

test('the actual host and client agree on hello, control, null layout and executed input ACK',async t=>{
 const mock=browser(t),host=createWorldHost({epoch:1,now:()=>mock.clock.ms}),session=host.session(null).session,connection=new GameConnection({url:'ws://localhost:4317/world',role:'player',entry:'office'});t.after(()=>{connection.dispose();host.dispose();});connection.connect();await flush();const socket=mock.sockets[0],serverSocket={send:text=>{socket.message(JSON.parse(text));return 1;},close:()=>socket.close()};
 host.open(serverSocket,session,true);socket.send=text=>{socket.sent.push(JSON.parse(text));host.message(serverSocket,text);};socket.open();assert.equal(connection.status.state,'connected');assert.equal(connection.status.controlling,true);
 for(let i=0;i<3;i++)host.step();assert.ok(connection.authoritativeSelf);assert.equal(connection.inspect().ack,0);connection.input({...idleCharacterInput(),forward:1});mock.clock.ms=100;connection.pump();assert.equal(host.game.peers.get(session.id).received,6);assert.equal(host.game.peers.get(session.id).ack,0);
 for(let i=0;i<3;i++)host.step();assert.equal(connection.inspect().ack,3);assert.equal(connection.inspect().pendingInputs,3);assert.equal(connection.status.state,'connected');assert.equal(connection.present(.1).connected,true);
 connection.control(false);host.step();assert.equal(connection.status.controlling,false);assert.equal(connection.status.voice,false);assert.equal(host.game.peers.get(session.id).inputs.length,0);
});

test('WebRTC has one fixed offer initiator and queues ICE until the audio description is installed',async t=>{
 const mock=browser(t),sent=[],streams=[],voice=new WorldVoice({send:value=>{sent.push(value);return true;},onVoiceStream:value=>streams.push(value)});t.after(()=>voice.dispose());voice.setRoster([{id:'c1',actorId:'r1',publishing:true}],'c2');await flush();const pc=mock.pcs[0];assert.equal(pc.added,0);assert.equal(pc.offers,0);
 voice.receiveSignal('c1','r1',{candidate:{candidate:'candidate:1',sdpMid:'0',sdpMLineIndex:0}});await flush();assert.equal(pc.candidates.length,0);voice.receiveSignal('c1','r1',{description:{type:'offer',sdp:'m=audio 9 UDP/TLS/RTP/SAVPF 111'}});await flush();assert.equal(pc.added,0);assert.equal(pc.transceivers.length,1);assert.equal(pc.answers,1);assert.equal(pc.candidates.length,1);assert.equal(sent.filter(value=>value.value?.description?.type==='answer').length,1);assert.equal(mock.microphones.length,0);
 const track=new mock.Track('remote');pc.ontrack({track,streams:[]});assert.equal(streams.at(-1).actorId,'r1');assert.equal(streams.at(-1).stream.getAudioTracks()[0],track);voice.setRoster([{id:'c1',actorId:'r1',publishing:false}],'c2');assert.equal(streams.at(-1).stream,null);voice.setRoster([{id:'c1',actorId:'r1',publishing:true}],'c2');assert.equal(streams.at(-1).stream.getAudioTracks()[0],track);voice.setRoster([],'c2');assert.equal(streams.at(-1).stream,null);assert.equal(pc.closed,1);assert.equal(track.stops,0);
 const initiator=new WorldVoice({send:value=>{sent.push(value);return true;}});t.after(()=>initiator.dispose());initiator.setRoster([{id:'c2',actorId:'r2',publishing:true}],'c1');await flush();assert.equal(mock.pcs[1].added,1);assert.equal(mock.pcs[1].offers,1);assert.equal(mock.pcs[1].answers,0);
});

test('late microphone permissions are stopped after disable and server revocation does not echo a command loop',async t=>{
 const mock=browser(t),sent=[],states=[],voice=new WorldVoice({send:value=>{sent.push(value);return true;},onPublishing:value=>states.push(value)});t.after(()=>voice.dispose());mock.media.pending=deferred();const enabling=voice.publish(true);await voice.publish(false);const late=new mock.Track('late');mock.media.pending.resolve(new mock.Stream([late]));await enabling;assert.equal(late.stops,1);assert.equal(sent.some(value=>value.enabled===true),false);
 delete mock.media.pending;await voice.publish(true);assert.equal(states.at(-1),true);const before=sent.length;voice.permission(false);assert.equal(sent.length,before);assert.equal(states.at(-1),false);assert.equal(mock.microphones.length,2);
 mock.media.pending=deferred();const disposed=voice.publish(true);voice.dispose();const afterDispose=new mock.Track();mock.media.pending.resolve(new mock.Stream([afterDispose]));await disposed;assert.equal(afterDispose.stops,1);
});

test('mic disable stops capture immediately during pending SDP and negotiation uses the current track',async t=>{
 const mock=browser(t),sent=[],voice=new WorldVoice({send:value=>{sent.push(value);return true;}});t.after(()=>voice.dispose());voice.setRoster([{id:'c2',actorId:'r2',publishing:true}],'c1');const pc=mock.pcs[0];pc.offerGate=deferred();await flush();assert.equal(pc.offers,1);
 mock.media.pending=deferred();const enabling=voice.publish(true),track=new mock.Track('microphone');mock.media.pending.resolve(new mock.Stream([track]));await flush();await voice.publish(false);assert.equal(track.stops,1);assert.equal(sent.filter(value=>value.type==='voice').at(-1).enabled,false);
 pc.offerGate.resolve({type:'offer',sdp:'m=audio 9 UDP/TLS/RTP/SAVPF 111'});await enabling;await flush();assert.equal(pc.transceivers[0].sender.track,null);assert.equal(pc.offers,1);assert.equal(sent.filter(value=>value.value?.description?.type==='offer').length,1);
});

test('removing a peer during pending negotiation prevents late signalling and actor reassignment clears the old stream',async t=>{
 const mock=browser(t),sent=[],streams=[],voice=new WorldVoice({send:value=>{sent.push(value);return true;},onVoiceStream:value=>streams.push(value)});t.after(()=>voice.dispose());voice.setRoster([{id:'c1',actorId:'r1',publishing:true}],'c2');const pc=mock.pcs[0];pc.remoteGate=deferred();voice.receiveSignal('c1','r1',{description:{type:'offer',sdp:'m=audio 9 UDP/TLS/RTP/SAVPF 111'}});await flush();voice.setRoster([],'c2');pc.remoteGate.resolve();await flush();assert.equal(sent.length,0);assert.equal(pc.answers,0);
 voice.setRoster([{id:'c1',actorId:'r1',publishing:true}],'c2');const old=mock.pcs[1];old.ontrack({track:new mock.Track(),streams:[]});assert.equal(streams.at(-1).actorId,'r1');voice.setRoster([{id:'c1',actorId:'r2',publishing:true}],'c2');assert.deepEqual(streams.at(-1),{actorId:'r1',stream:null});assert.equal(old.closed,1);mock.pcs[2].ontrack({track:new mock.Track(),streams:[]});assert.equal(streams.at(-1).actorId,'r2');
});

test('injected audio sources bypass microphone capture and keep voice-owned track lifetime',async t=>{
 const mock=browser(t),track=new mock.Track('synthetic'),stream=new mock.Stream([track]);let calls=0,source=Promise.resolve(stream);
 const {connection}=await connected(t,mock,{role:'player',audioSource:()=>{calls++;return source;}});
 await connection.publishVoice(true);await connection.publishVoice(true);assert.equal(calls,1);assert.equal(mock.microphones.length,0);assert.equal(track.stops,0);assert.equal(connection.status.voice,true);
 await connection.publishVoice(false);assert.equal(track.stops,1);assert.equal(connection.status.voice,false);
 const pending=deferred();source=pending.promise;const enabling=connection.publishVoice(true);connection.dispose();const late=new mock.Track('late synthetic');pending.resolve(new mock.Stream([late]));await enabling;
 assert.equal(calls,2);assert.equal(mock.microphones.length,0);assert.equal(late.stops,1);assert.equal(connection.status.voice,false);
});
