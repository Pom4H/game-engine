import test from 'node:test';
import assert from 'node:assert/strict';
import {SpatialAudio} from '../dist/audio/spatial.js';

function browserAudio(t){
 const names=['AudioContext','AudioWorkletNode','MediaStream','WebSocket','document'],original=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)])),contexts=[],sockets=[],playouts=[];
 const parameter=(value=0)=>({value,setTargetAtTime(v){this.value=v;}});
 class Node {
  constructor(){this.links=[];this.disconnects=0;this.gain=parameter();this.frequency=parameter();this.positionX=parameter();this.positionY=parameter();this.positionZ=parameter();this.stops=0;this.onended=null;}
  connect(node){this.links.push(node);return node;}
  disconnect(){this.links=[];this.disconnects++;}
  start(){this.started=true;}
  stop(){this.stops++;this.onended?.();}
 }
 class Track extends EventTarget {
  constructor(id='voice'){super();this.id=id;this.kind='audio';this.readyState='live';this.enabled=true;this.muted=false;this.stops=0;}
  stop(){this.stops++;this.end();}
  end(){this.readyState='ended';this.dispatchEvent(new Event('ended'));}
  mute(){this.muted=true;this.dispatchEvent(new Event('mute'));}
 }
 class Stream extends EventTarget {
  constructor(tracks=[]){super();this.tracks=[...tracks];}
  getAudioTracks(){return this.tracks.filter(track=>track.kind==='audio');}
  removeTrack(track){this.tracks=this.tracks.filter(value=>value!==track);const event=new Event('removetrack');event.track=track;this.dispatchEvent(event);}
 }
 class Context {
  constructor(){this.state='suspended';this.currentTime=10;this.sampleRate=48000;this.destination=new Node();this.sources=[];this.streams=[];this.gains=[];this.panners=[];this.filters=[];this.analysers=[];this.worklets=[];this.closed=0;this.audioWorklet={addModule:async()=>{}};this.listener=Object.fromEntries(['positionX','positionY','positionZ','forwardX','forwardY','forwardZ','upX','upY','upZ'].map(key=>[key,parameter()]));contexts.push(this);}
  createGain(){const n=new Node();this.gains.push(n);return n;}
  createPanner(){const n=new Node();this.panners.push(n);return n;}
  createBiquadFilter(){const n=new Node();this.filters.push(n);return n;}
  createBufferSource(){const n=new Node();this.sources.push(n);return n;}
  createMediaStreamSource(stream){const n=new Node();n.stream=stream;this.streams.push(n);return n;}
  createAnalyser(){const n=new Node();n.amplitude=0;n.getFloatTimeDomainData=samples=>samples.fill(n.amplitude);this.analysers.push(n);return n;}
  async decodeAudioData(){return{duration:1};}
  async resume(){this.state='running';}
  async close(){this.closed++;this.state='closed';}
 }
 class Worklet extends Node {constructor(context){super();this.port={onmessage:null};context.worklets.push(this);}}
 class Socket {
  static OPEN=1;
  constructor(url){this.url=url;this.readyState=1;this.bufferedAmount=0;this.sent=[];sockets.push(this);setTimeout(()=>{this.onmessage?.({data:'ready'});const worklet=contexts.at(-1).worklets.at(-1);worklet.port.onmessage?.({data:new ArrayBuffer(4)});worklet.port.onmessage?.({data:new ArrayBuffer(4)});},0);}
  send(data){this.sent.push(data);}
  close(){this.readyState=3;this.onclose?.();}
 }
 const document={createElement(tag){assert.equal(tag,'audio');const element={muted:false,autoplay:false,srcObject:null,plays:0,pauses:0,play(){this.plays++;return Promise.resolve();},pause(){this.pauses++;}};playouts.push(element);return element;}};
 Object.assign(globalThis,{AudioContext:Context,AudioWorkletNode:Worklet,MediaStream:Stream,WebSocket:Socket,document});
 t.after(()=>{for(const [name,descriptor]of original){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}});
 return {contexts,sockets,playouts,Track,Stream};
}
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-6,`${actual} != ${expected}`);

test('remote playout starts muted and releases only its own media element without stopping caller tracks',async t=>{
 const mock=browserAudio(t),audio=new SpatialAudio();await audio.unlock();
 const first=new mock.Track('first'),second=new mock.Track('second'),detach=audio.attachStream('visitor',new mock.Stream([first]),[0,1,0]);
 const old=mock.playouts[0];assert.equal(old.muted,true);assert.equal(old.autoplay,true);assert.equal(old.plays,1);assert.deepEqual(old.srcObject.getAudioTracks(),[first]);
 audio.attachStream('visitor',new mock.Stream([second]),[0,1,0]);const current=mock.playouts[1];
 assert.equal(old.pauses,1);assert.equal(old.srcObject,null);assert.equal(first.stops,0);detach();assert.equal(current.pauses,0);assert.deepEqual(current.srcObject.getAudioTracks(),[second]);
 audio.dispose();audio.dispose();assert.equal(current.pauses,1);assert.equal(current.srcObject,null);assert.equal(second.stops,0);
});

test('conversation radius preserves audible speech from the orbit camera without changing clip or live-voice defaults',async t=>{
 const mock=browserAudio(t),audio=new SpatialAudio();await audio.unlock();const context=mock.contexts[0];
 audio.setListener([0,60,0],[0,0,0]);
 const speech=audio.play('agent',{duration:1},[0,1.65,0],1,{refDistance:35,rolloffFactor:.35});
 const cue=audio.play('cue',{duration:1},[0,1.65,0]);
 audio.attachStream('visitor',new mock.Stream([new mock.Track()]),[0,1.65,0]);
 const attenuation=(panner,gain)=>gain*panner.refDistance/(panner.refDistance+panner.rolloffFactor*(58.35-panner.refDistance));
 const spoken=attenuation(context.panners[0],context.gains[1].gain.value),original=attenuation(context.panners[1],context.gains[2].gain.value);
 assert.ok(spoken>.8);assert.ok(spoken/original>9);assert.equal(context.panners[0].panningModel,'HRTF');
 for(const panner of context.panners.slice(1)){assert.equal(panner.refDistance,5);assert.equal(panner.rolloffFactor,.65);}
 assert.equal(context.gains[1].gain.value,1);assert.equal(context.gains[2].gain.value,.7);
 for(const options of [{refDistance:0},{refDistance:Infinity},{rolloffFactor:-1},{rolloffFactor:NaN}])await assert.rejects(audio.play('bad',{duration:1},[0,1,0],1,options),/settings/);
 assert.equal(context.sources.length,2);context.currentTime+=1;for(const source of context.sources)source.onended();await Promise.all([speech,cue]);audio.dispose();
});

test('received live voice uses HRTF and measured speech with release, mute and track disable cleanup',async t=>{
 const mock=browserAudio(t),audio=new SpatialAudio(),speech=[],activity=[];audio.onSpeaking=value=>speech.push(value);audio.onActivity=value=>activity.push(value);await audio.unlock();
 const context=mock.contexts[0],track=new mock.Track('visitor'),stream=new mock.Stream([track]),detach=audio.attachStream('player:visitor',stream,[2,5,9]);
 const source=context.streams[0],analyser=context.analysers[0],filter=context.filters[0],gain=context.gains[1],panner=context.panners[0];
 assert.equal(source.stream.getAudioTracks()[0],track);assert.deepEqual(source.links,[analyser]);assert.deepEqual(analyser.links,[filter]);assert.deepEqual(filter.links,[gain]);assert.deepEqual(gain.links,[panner]);assert.deepEqual(panner.links,[context.gains[0]]);assert.equal(panner.panningModel,'HRTF');
 audio.position('player:visitor',[3,8,-2],1);assert.deepEqual([panner.positionX.value,panner.positionY.value,panner.positionZ.value],[3,8,-2]);assert.equal(filter.frequency.value,900);
 audio.setListener([1,8,0],[1,8,2]);assert.equal(context.listener.forwardZ.value,1);assert.equal(context.listener.positionY.value,8);
 assert.equal(audio.sampleActivity(1)[0].speaking,false);assert.deepEqual(activity,[]);
 analyser.amplitude=.05;near(audio.sampleActivity(2)[0].level,.05);assert.equal(audio.inspect().emitters[0].speaking,true);assert.deepEqual(activity,[true]);
 analyser.amplitude=0;assert.equal(audio.sampleActivity(2.1)[0].speaking,true);assert.equal(audio.sampleActivity(2.21)[0].speaking,false);assert.deepEqual(speech.map(value=>value.speaking),[true,false]);
 analyser.amplitude=.05;audio.sampleActivity(3);track.mute();assert.equal(audio.inspect().emitters[0].speaking,false);assert.equal(audio.inspect().emitters[0].level,0);assert.equal(audio.sampleActivity(3.01)[0].speaking,false);
 track.muted=false;audio.sampleActivity(4);track.enabled=false;assert.equal(audio.sampleActivity(4.01)[0].speaking,false);
 track.enabled=true;audio.sampleActivity(5);detach();assert.equal(audio.inspect().emitters.length,0);assert.equal(speech.at(-1).speaking,false);assert.equal(track.stops,0);assert.equal(source.disconnects,1);assert.equal(analyser.disconnects,1);audio.dispose();
});

test('suspended playback and a reset presentation clock cannot keep or revive a stale speaker indicator',async t=>{
 const mock=browserAudio(t),audio=new SpatialAudio();await audio.unlock();const context=mock.contexts[0];audio.attachStream('visitor',new mock.Stream([new mock.Track()]),[0,1,0]);const analyser=context.analysers[0];
 analyser.amplitude=.1;audio.sampleActivity(10);analyser.amplitude=0;assert.equal(audio.sampleActivity(1)[0].speaking,false);assert.equal(audio.sampleActivity(10.1)[0].speaking,false);
 analyser.amplitude=.1;audio.sampleActivity(11);context.state='suspended';assert.equal(audio.sampleActivity(11.01)[0].speaking,false);assert.equal(audio.inspect().emitters[0].level,0);context.state='running';analyser.amplitude=0;assert.equal(audio.sampleActivity(11.02)[0].speaking,false);audio.dispose();
});

test('stream replacement owns its cleanup and end/removal never stop caller tracks',async t=>{
 const mock=browserAudio(t),audio=new SpatialAudio();await audio.unlock();const context=mock.contexts[0],first=new mock.Track('first'),second=new mock.Track('second'),firstStream=new mock.Stream([first]),secondStream=new mock.Stream([second]);
 const oldDetach=audio.attachStream('visitor',firstStream,[0,1,0]);context.analysers[0].amplitude=.1;audio.sampleActivity(1);
 audio.attachStream('visitor',secondStream,[0,4,0]);assert.equal(context.streams[0].disconnects,1);oldDetach();assert.equal(context.streams[1].disconnects,0);assert.equal(audio.inspect().emitters.length,1);
 first.end();assert.equal(audio.inspect().emitters.length,1);secondStream.removeTrack(second);assert.equal(audio.inspect().emitters.length,0);assert.equal(context.streams[1].disconnects,1);
 const third=new mock.Track('third');audio.attachStream('visitor',new mock.Stream([third]),[0,7,0]);third.end();assert.equal(audio.inspect().emitters.length,0);assert.equal(context.streams[2].disconnects,1);
 const fourth=new mock.Track('fourth');audio.attachStream('visitor',new mock.Stream([fourth]),[0,10,0]);audio.dispose();audio.dispose();assert.equal(fourth.stops,0);assert.equal(context.closed,1);assert.ok(context.streams.every(node=>node.disconnects===1));assert.ok(context.analysers.every(node=>node.disconnects===1));
});

test('live and clip audio enter one stereo echo-reference mix and silent streams do not hold clip activity open',async t=>{
 const mock=browserAudio(t),audio=new SpatialAudio(),activity=[];audio.onActivity=value=>activity.push(value);await audio.unlock();await audio.connectReference('ws://localhost/office-audio-reference');
 const context=mock.contexts[0],mix=context.gains[0],reference=context.worklets[0];assert.deepEqual(mix.links,[reference]);assert.deepEqual(reference.links,[context.destination]);assert.equal(audio.inspect().reference,'streaming');assert.equal(mock.sockets[0].sent.length,2);
 const track=new mock.Track();audio.attachStream('visitor',new mock.Stream([track]),[1,1.6,0]);const clip=audio.play('guide',{duration:1},[0,1.6,0]);
 assert.ok(context.panners.every(node=>node.links[0]===mix));assert.deepEqual(activity,[true]);context.currentTime+=1;context.sources[0].onended();await clip;assert.deepEqual(activity,[true,false]);assert.equal(audio.inspect().emitters.length,1);
 context.analysers[0].amplitude=.1;audio.sampleActivity(1);assert.deepEqual(activity,[true,false,true]);audio.stop();assert.deepEqual(activity,[true,false,true,false]);assert.equal(track.stops,0);audio.dispose();assert.equal(mock.sockets[0].readyState,3);
});

test('clip completion, interruption and replacement preserve settled promises alongside live streams',async t=>{
 const mock=browserAudio(t),audio=new SpatialAudio();await audio.unlock();const context=mock.contexts[0];
 const first=audio.play('speaker',{duration:1},[0,1,0]),firstRejected=assert.rejects(first,{name:'AbortError'});
 const track=new mock.Track();audio.attachStream('speaker',new mock.Stream([track]),[0,1,0]);await firstRejected;assert.equal(context.sources[0].stops,1);assert.equal(context.sources[0].disconnects,1);
 const second=audio.play('speaker',{duration:1},[0,1,0]);assert.equal(context.streams[0].disconnects,1);context.currentTime+=1;context.sources[1].onended();await second;assert.equal(audio.inspect().emitters.length,0);assert.equal(track.stops,0);
 const third=audio.play('speaker',{duration:1},[0,1,0]),thirdRejected=assert.rejects(third,{name:'AbortError'});audio.stop('speaker');await thirdRejected;assert.equal(context.sources[2].disconnects,1);audio.dispose();
});

test('live voice validates settings, bounds graph size and ignores ended tracks when selecting audio',async t=>{
 const mock=browserAudio(t),audio=new SpatialAudio(),track=new mock.Track(),stream=new mock.Stream([track]);assert.throws(()=>audio.attachStream('visitor',stream,[0,0,0]),/Включи звук/);await audio.unlock();
 const context=mock.contexts[0];assert.throws(()=>audio.attachStream('visitor',new mock.Stream(),[0,0,0]),/active audio track/);
 for(const options of [{volume:NaN},{volume:-1},{speakingThreshold:0},{releaseSeconds:Infinity}])assert.throws(()=>audio.attachStream('visitor',stream,[0,0,0],options),/settings/);
 assert.throws(()=>audio.attachStream('visitor',stream,[0,Infinity,0]),/settings/);assert.equal(context.streams.length,0);
 const ended=new mock.Track();ended.end();audio.attachStream('visitor',new mock.Stream([ended,track]),[0,0,0],{volume:0});assert.equal(context.streams[0].stream.getAudioTracks()[0],track);context.analysers[0].amplitude=.5;assert.equal(audio.sampleActivity(1)[0].speaking,false);
 for(let i=1;i<16;i++)audio.attachStream('visitor'+i,new mock.Stream([new mock.Track(String(i))]),[0,0,0]);assert.throws(()=>audio.attachStream('overflow',stream,[0,0,0]),/Too many/);assert.equal(audio.inspect().emitters.length,16);assert.equal(context.streams.length,16);
 audio.attachStream('visitor',stream,[1,0,0]);assert.equal(audio.inspect().emitters.length,16);assert.equal(context.streams[0].disconnects,1);audio.dispose();
});

test('echo-reference transport survives a delayed worklet burst and stops voices when congestion stays excessive',async t=>{
 const mock=browserAudio(t),audio=new SpatialAudio();let lost=0;audio.onReferenceDisconnect=()=>lost++;
 await audio.unlock();await audio.connectReference('ws://localhost/office-audio-reference');
 const context=mock.contexts[0],socket=mock.sockets[0],reference=context.worklets[0];
 const clip=audio.play('guide',{duration:1},[0,1,0]),interrupted=assert.rejects(clip,{name:'AbortError'});
 socket.bufferedAmount=96000;reference.port.onmessage({data:new ArrayBuffer(886)});
 assert.equal(lost,0);assert.equal(audio.inspect().reference,'streaming');assert.equal(context.sources[0].stops,0);
 socket.bufferedAmount=262145;reference.port.onmessage({data:new ArrayBuffer(886)});
 await interrupted;assert.equal(lost,1);assert.equal(audio.inspect().reference,'disconnected');assert.equal(context.sources[0].stops,1);audio.dispose();
});

test('an already spatialized Game bus shares the speech context, reference tap and mute lifecycle',async t=>{
 const mock=browserAudio(t),audio=new SpatialAudio(),activity=[];audio.onActivity=value=>activity.push(value);await audio.unlock();let stopped=0;const bus=audio.createBus('thegame',()=>stopped++),context=mock.contexts[0];assert.equal(bus.context,context);assert.equal(mock.contexts.length,1);assert.equal(bus.input.gain.value,0);bus.setActive(true);assert.deepEqual(activity,[true]);await audio.connectReference('ws://localhost/office-audio-reference');assert.equal(bus.input.links[0].links[0],context.worklets[0]);audio.stop('absent');assert.equal(bus.input.gain.value,1);audio.stop();assert.equal(stopped,1);assert.equal(bus.input.gain.value,0);assert.equal(context.closed,0);assert.deepEqual(activity,[true,false]);bus.dispose();assert.equal(context.closed,0);audio.dispose();assert.equal(context.closed,1);
});

test('a refused initial reference handshake cannot cancel guarded playback or claim a lost established session',async t=>{
 const mock=browserAudio(t),audio=new SpatialAudio();await audio.unlock();let lost=0;audio.onReferenceDisconnect=()=>lost++;const pending=audio.connectReference('ws://localhost/office-audio-reference');await Promise.resolve();await Promise.resolve();const socket=mock.sockets.at(-1);assert.ok(socket);const rejected=assert.rejects(pending,/закрылась/);socket.close();await rejected;const bus=audio.createBus('thegame');bus.setActive(true);await new Promise(r=>setTimeout(r,5));assert.equal(lost,0);assert.equal(audio.inspect().reference,'disconnected');assert.equal(bus.input.gain.value,1);bus.dispose();audio.dispose();
});
