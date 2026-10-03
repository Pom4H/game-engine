import test from 'node:test';
import assert from 'node:assert/strict';
import {ProceduralAudio} from '../dist/audio/browser.js';
import {BrowserRuntime} from '../dist/runtime/browser.js';
import {WebGPURenderer} from '../dist/render/webgpu.js';
function parameter(value=0){return{value,setTargetAtTime(v){this.value=v;},setValueAtTime(v){this.value=v;},exponentialRampToValueAtTime(v){this.value=v;}};}
function webAudio(t){
 const original={AudioContext:globalThis.AudioContext,addEventListener:globalThis.addEventListener,removeEventListener:globalThis.removeEventListener},listeners=new Map(),contexts=[];
 class Node {constructor(){this.gain=parameter();this.frequency=parameter();this.pan=parameter();this.Q=parameter();this.delayTime=parameter();this.links=[];this.starts=[];this.stops=0;this.disconnects=0;this.onended=null;this.loop=false;}connect(n){this.links.push(n);return n;}disconnect(){this.disconnects++;}start(...args){this.starts.push(args);}stop(){this.stops++;}}
 class Context {constructor(){this.state='running';this.currentTime=10;this.sampleRate=8000;this.destination={};this.sources=[];this.filters=[];this.panners=[];this.delays=[];this.closed=0;contexts.push(this);}createGain(){return new Node();}createDelay(){const n=new Node();this.delays.push(n);return n;}createBiquadFilter(){const n=new Node();this.filters.push(n);return n;}createStereoPanner(){const n=new Node();this.panners.push(n);return n;}createOscillator(){return new Node();}createBufferSource(){const n=new Node();this.sources.push(n);return n;}createBuffer(channels,count,rate){const data=Array.from({length:channels},()=>new Float32Array(count));return{sampleRate:rate,getChannelData(i){return data[i];}};}async resume(){this.state='running';}async close(){this.closed++;this.state='closed';}}
 globalThis.AudioContext=Context;globalThis.addEventListener=(type,fn)=>listeners.set(type,fn);globalThis.removeEventListener=(type,fn)=>{if(listeners.get(type)===fn)listeners.delete(type);};
 t.after(()=>Object.assign(globalThis,original));return{contexts,listeners};
}
const camera={position:[0,1,0],target:[0,1,5]},contact={time:1,position:[2,0,4],sequence:1,depth:.02};

test('live footsteps synthesize stereo contact sound, preserve elapsed timing and suppress stale catch-up history',async t=>{
 const mock=webAudio(t),audio=new ProceduralAudio();audio.playFootsteps([contact],camera,1);assert.equal(mock.contexts.length,0);
 await audio.unlock();const context=mock.contexts[0],initial=context.sources.length;
 audio.playFootsteps([contact],camera,1.05);assert.equal(context.sources.length,initial+1);const voice=context.sources.at(-1);
 assert.ok(Math.abs(voice.starts[0][1]-.05)<1e-9);assert.equal(voice.starts[0][0],10);assert.ok(voice.buffer.getChannelData(0).some(v=>v!==0));assert.notDeepEqual(voice.buffer.getChannelData(0),voice.buffer.getChannelData(1));
 audio.playFootsteps([{...contact,time:0}],camera,1);assert.equal(context.sources.length,initial+1);assert.equal(audio.inspect().voices,1);
 voice.onended();assert.equal(audio.inspect().voices,0);assert.equal(voice.disconnects,1);audio.dispose();assert.equal(mock.listeners.size,0);assert.equal(context.closed,1);
});

test('live wet tyre path uses contact wetness and two low-pass stages; voices and gesture listeners release on disposal',async t=>{
 const mock=webAudio(t),audio=new ProceduralAudio();await audio.unlock();const context=mock.contexts[0];
 audio.updateAmbient({windSpeed:0,snowfall:1,trafficCount:4,trafficSpeed:3,roadWetness:1,slush:0,contactWetness:0,trafficGain:.5,trafficPan:.4});
 assert.ok(context.filters.every(f=>f.type==='lowpass'));assert.ok(context.filters.some(f=>f.frequency.value===950));assert.ok(context.filters.some(f=>f.frequency.value===700));assert.equal(context.panners[0].pan.value,.4);
 const water=context.filters.find(f=>f.frequency.value===950),waterGain=water.links[0].links[0];assert.equal(waterGain.gain.value,0);
 audio.updateAmbient({windSpeed:0,snowfall:0,trafficCount:4,trafficSpeed:3,roadWetness:0,slush:0,contactWetness:1});assert.ok(waterGain.gain.value>0);
 audio.playFootsteps(Array.from({length:70},(_,sequence)=>({...contact,sequence})),camera,1);assert.equal(audio.inspect().voices,48);
 audio.dispose();audio.dispose();assert.equal(audio.inspect().voices,0);assert.equal(mock.listeners.size,0);assert.equal(context.closed,1);assert.ok(context.sources.every(s=>s.stops===1));
});

test('BrowserRuntime automatically consumes native snow contacts; seeking discards historical sounds',()=>{
 const spec={version:1,environment:{temperatureC:-3,snowfall:'none'},entities:[{id:'path',position:[0,0,0],mesh:{kind:'box',size:[10,.2,2]},environmental:{surfaceUse:'generic',snowDepthM:.06}},{id:'head'}]};
 const renderer={render(){},inspect(){return{};},resize(){},async flush(){},dispose(){}},runtime=new BrowserRuntime({},spec,renderer,{audio:false,autoplay:false});
 const played=[];runtime.audio={play(){},playFootsteps(events,camera,time){played.push({events,camera,time});},updateAmbient(){},dispose(){}};
 runtime.scene.contacts.addSnowSurface('path');runtime.scene.animation.addWalker({id:'walker',root:[-2,.14,0],speed:.6,bindings:[{entity:'head',joint:'head'}]});
 runtime.step(2);assert.ok(played[0].events.length>=1);assert.equal(played[0].time,runtime.scene.time);assert.equal(runtime.scene.contacts.drainFootsteps().length,0);
 const before=played.length;runtime.seek(1);assert.equal(played.length,before);assert.equal(runtime.scene.contacts.drainFootsteps().length,0);
 runtime.step();assert.equal(played.at(-1).events.length,0);runtime.dispose();
});


test('BrowserRuntime creation failure cleans allocated GPU/audio listeners and preserves an existing bridge',async t=>{
 const mock=webAudio(t),create=WebGPURenderer.create,previousBridge=globalThis.__GAME_ENGINE__,liveBridge={existing:true},error=new Error('material HTTP 404');let disposals=0,renders=0;
 globalThis.__GAME_ENGINE__=liveBridge;WebGPURenderer.create=async()=>({async prepareMaterials(){throw error;},render(){renders++;},inspect(){return{};},dispose(){disposals++;}});
 t.after(()=>{WebGPURenderer.create=create;if(previousBridge===undefined)delete globalThis.__GAME_ENGINE__;else globalThis.__GAME_ENGINE__=previousBridge;});
 await assert.rejects(BrowserRuntime.create({},{version:1,entities:[]},{autoplay:false}),e=>e===error);
 assert.equal(disposals,1);assert.equal(renders,0);assert.equal(mock.listeners.size,0);assert.equal(globalThis.__GAME_ENGINE__,liveBridge);
 await assert.rejects(BrowserRuntime.create({},{version:99,entities:[]},{autoplay:false}),/Unsupported scene version/);assert.equal(disposals,2);assert.equal(mock.listeners.size,0);assert.equal(globalThis.__GAME_ENGINE__,liveBridge);
});

test('disposing one BrowserRuntime never removes a newer runtime bridge and releases its renderer once',async t=>{
 const create=WebGPURenderer.create,previousBridge=globalThis.__GAME_ENGINE__,renderers=[];
 WebGPURenderer.create=async()=>{const renderer={disposals:0,async prepareMaterials(){},render(){},inspect(){return{};},dispose(){this.disposals++;}};renderers.push(renderer);return renderer;};
 t.after(()=>{WebGPURenderer.create=create;if(previousBridge===undefined)delete globalThis.__GAME_ENGINE__;else globalThis.__GAME_ENGINE__=previousBridge;});
 const a=await BrowserRuntime.create({},{version:1,entities:[]},{audio:false,autoplay:false}),first=globalThis.__GAME_ENGINE__;
 const b=await BrowserRuntime.create({},{version:1,entities:[]},{audio:false,autoplay:false}),second=globalThis.__GAME_ENGINE__;assert.notEqual(first,second);
 a.dispose();a.dispose();assert.equal(globalThis.__GAME_ENGINE__,second);assert.equal(renderers[0].disposals,1);
 b.dispose();assert.equal(globalThis.__GAME_ENGINE__,undefined);assert.equal(renderers[1].disposals,1);
});


test('control-rate acoustic transfer builds WebAudio delay/filter/reflection/reverb graph without wave stepping',async t=>{
 const mock=webAudio(t),audio=new ProceduralAudio();await audio.unlock();const context=mock.contexts[0],before=context.sources.length;
 const channels={left:new Float32Array([.3,.1,0,0]),right:new Float32Array([.3,.1,0,0]),sampleRate:8000};
 const transfer={direct:{delayS:.025,gain:.7,direction:[-1,0,0],lowpassHz:4200},reflections:[{delayS:.051,gain:.2,direction:[.4,0,-.9],lowpassHz:2800}],late:{gain:.12,rt60S:.8,damping:.35,diffusion:.7},diagnostics:{geometricDelayS:.02,sourcePeakPressurePa:1,emptyFieldPeakPressurePa:1,listenerPeakPressurePa:.7,extraDelayS:.005,sampleDtS:.001,samples:100}};
 audio.playAcoustic(channels,transfer,[1,0,0],.8);
 assert.equal(context.sources.length,before+1);assert.ok(context.delays.length>=6);
 assert.ok(context.delays.some(d=>Math.abs(d.delayTime.value-.025)<1e-9));assert.ok(context.delays.some(d=>Math.abs(d.delayTime.value-.051)<1e-9));
 assert.ok(context.filters.some(f=>f.frequency.value===4200));assert.ok(context.filters.some(f=>f.frequency.value===2800));
 const voice=context.sources.at(-1);voice.onended();assert.equal(audio.inspect().voices,0);audio.dispose();
});
