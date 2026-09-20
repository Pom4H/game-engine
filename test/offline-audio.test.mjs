import test from 'node:test';
import assert from 'node:assert/strict';
import {renderSceneAudio} from '../dist/audio/offline.js';
import {renderFootsteps} from '../dist/audio/footsteps.js';
import {synthesizeEvent} from '../dist/audio/synth.js';
import {Scene} from '../dist/scene/scene.js';

const walker=()=>({version:1,seed:719,ground:-10,camera:{position:[-2,1.5,2],target:[0,.5,0]},environment:{temperatureC:-3,sunlight:0,snowfall:'none'},entities:[
 {id:'path',position:[0,.05,0],mesh:{kind:'box',size:[10,.1,2]},environmental:{surfaceUse:'generic',snowDepthM:.06}},
 {id:'coat',mesh:{kind:'box',size:[.3,.6,.4]}},
],animation:{walkers:[{id:'person',root:[-1,.16,0],speed:.6,bindings:[{entity:'coat',joint:'pelvis'}]}]},surfaceContacts:{snow:[{surfaceId:'path',maxTiles:16,maxDetailedTiles:4}]}});
const peak=channel=>channel.reduce((max,value)=>Math.max(max,Math.abs(value)),0);

test('offline scene audio consumes the same native footprints as Scene.step and produces deterministic listener-relative stereo',()=>{
 const spec=walker(),saved=structuredClone(spec),first=renderSceneAudio(spec,1.5,{sampleRate:8000}),second=renderSceneAudio(spec,1.5,{sampleRate:8000});
 assert.deepEqual(spec,saved);assert.deepEqual(first,second);assert.equal(first.events.length,0);assert.ok(first.footsteps.length>=3);
 assert.equal(first.audio.left.length,12000);assert.equal(first.audio.sampleRate,8000);assert.equal(first.ticks,90);assert.ok(peak(first.audio.left)>.005);assert.notDeepEqual(first.audio.left,first.audio.right);
 const scene=new Scene(spec),contacts=[];for(let tick=0;tick<90;tick++){scene.step();contacts.push(...scene.contacts.drainFootsteps());}
 assert.deepEqual(first.footsteps,contacts.filter(e=>e.time<1.5));
 const reversed=walker();reversed.camera.target=[-4,2.5,4];const mirrored=renderSceneAudio(reversed,1.5,{sampleRate:8000});
 assert.deepEqual(mirrored.audio.left,first.audio.right);assert.deepEqual(mirrored.audio.right,first.audio.left);
});

test('a from cut retains already-started footstep and physics voices and exactly matches full-render samples',()=>{
 const footsteps=walker(),full=renderSceneAudio(footsteps,.5,{sampleRate:8000}),cut=renderSceneAudio(footsteps,.12,{sampleRate:8000,startTime:.08});
 assert.ok(cut.footsteps.some(event=>event.time<cut.startTime));assert.ok(peak(cut.audio.left)>.001);assert.deepEqual(cut.audio.left,full.audio.left.slice(640,1600));assert.deepEqual(cut.audio.right,full.audio.right.slice(640,1600));
 const impacts={version:1,seed:12,entities:[{id:'ball',position:[0,.30,0],mesh:{kind:'sphere',radius:.25},material:{kind:'steel'},body:{mass:2,restitution:0,velocity:[0,-2,0]}}]};
 const physicsFull=renderSceneAudio(impacts,.45,{sampleRate:8000}),physicsCut=renderSceneAudio(impacts,.10,{sampleRate:8000,startTime:.10});
 assert.ok(physicsCut.events.some(event=>event.time<.10));assert.ok(peak(physicsCut.audio.left)>.001);assert.deepEqual(physicsCut.audio.left,physicsFull.audio.left.slice(800,1600));assert.deepEqual(physicsCut.audio.right,physicsFull.audio.right.slice(800,1600));
 const fracture={version:1,gravity:[0,0,0],entities:[
  {id:'glass',position:[0,1,0],mesh:{kind:'box',size:[.01,1.4,1.2]},material:{kind:'glass'}},
  {id:'ball',position:[-1,1,0],mesh:{kind:'sphere',radius:.11},material:{kind:'steel'},body:{mass:3.8,velocity:[30,0,0]}},
 ]};
 const fracturedFull=renderSceneAudio(fracture,.55,{sampleRate:8000}),fracturedCut=renderSceneAudio(fracture,.06,{sampleRate:8000,startTime:.44});
 assert.ok(fracturedCut.events.some(event=>event.type==='fracture'&&event.time<.44-.38));assert.ok(peak(fracturedCut.audio.left)>1e-5);assert.deepEqual(fracturedCut.audio.left,fracturedFull.audio.left.slice(3520,4000));
});

test('offline recording handles silence and rejects invalid intervals and simulation/audio rates before allocating',()=>{
 const spec={version:1,entities:[]},silence=renderSceneAudio(spec,.001,{sampleRate:8000});assert.equal(silence.audio.left.length,8);assert.equal(peak(silence.audio.left),0);assert.deepEqual(silence.events,[]);assert.deepEqual(silence.footsteps,[]);
 for(const duration of [0,-1,NaN,Infinity,3601])assert.throws(()=>renderSceneAudio(spec,duration),RangeError);
 for(const options of [{startTime:-1},{startTime:NaN},{startTime:Infinity},{startTime:86399.5},{sampleRate:7999},{sampleRate:192001},{sampleRate:48000.5},{tickRate:0},{tickRate:3},{tickRate:241},{tickRate:59.5}])assert.throws(()=>renderSceneAudio(spec,1,options),RangeError);
});


test('physical snow state changes crunch spectrum without changing the contact API',()=>{
 const frames=[{time:0,listener:[0,1.6,2],target:[0,0,0],vehicle:[0,0,0],speedMps:0}];
 const base={time:.05,position:[0,0,0],sequence:7,depth:.025};
 const dry=renderFootsteps([{...base,wetness:.02,slush:0,temperatureC:-14}],frames,.45,16000);
 const wet=renderFootsteps([{...base,wetness:.95,slush:.75,temperatureC:1.5}],frames,.45,16000);
 const roughness=channel=>channel.slice(1).reduce((sum,value,index)=>sum+Math.abs(value-channel[index]),0);
 assert.ok(roughness(dry.left)>roughness(wet.left)*1.08);
 assert.notDeepEqual(dry.left,wet.left);
});

test('impact modal tail follows resonator geometry',()=>{
 const common={type:'impact',id:91,time:0,point:[0,0,0],normal:[0,1,0],a:'steel',b:'ground',materialA:'steel',materialB:'concrete',energy:12,impulse:4,speed:3,size:1};
 const panel=synthesizeEvent({...common,dimensionsA:[2,.018,1.2]},16000);
 const block=synthesizeEvent({...common,id:92,dimensionsA:[.18,.18,.18]},16000);
 const tail=channel=>channel.slice(Math.round(.08*16000)).reduce((sum,value)=>sum+Math.abs(value),0);
 assert.ok(tail(panel.left)>tail(block.left));
 assert.notDeepEqual(panel.left,block.left);
});
