import test from 'node:test';
import assert from 'node:assert/strict';
import {renderAudio,synthesizeEvent,wavBytes} from '../dist/index.js';

const event=(overrides={})=>({
  type:'mechanism',id:17,time:.2,point:[-3,0,0],mechanism:'suspension',
  energy:5,speed:.4,size:.8,...overrides,
});

test('the same engine event trace renders bit-identical PCM',()=>{
  const events=[event(),event({id:18,time:.55,point:[4,0,0],mechanism:'door-latch',energy:12})];
  const a=renderAudio(events,1,16000),b=renderAudio(events,1,16000);
  assert.deepEqual(a.left,b.left);
  assert.deepEqual(a.right,b.right);
  assert.deepEqual(wavBytes(a),wavBytes(b));
});

test('stable event identity participates in deterministic synthesis',()=>{
  const a=synthesizeEvent(event({id:100}),16000),b=synthesizeEvent(event({id:101}),16000);
  assert.notDeepEqual(a.left,b.left);
  assert.deepEqual(synthesizeEvent(event({id:100}),16000).left,a.left);
});

test('spatial source position changes stereo projection without changing event semantics',()=>{
  const left=synthesizeEvent(event({point:[-20,0,0]}),16000);
  const right=synthesizeEvent(event({point:[20,0,0]}),16000);
  const energy=x=>x.reduce((sum,v)=>sum+v*v,0);
  assert.ok(energy(left.left)>energy(left.right));
  assert.ok(energy(right.right)>energy(right.left));
});

test('rendering a replay window reproduces the matching full-render samples exactly',()=>{
  const sampleRate=16000,events=[
    event({id:1,time:.45,mechanism:'door-latch',energy:9}),
    event({id:2,time:.72,point:[2,0,0],mechanism:'panel-flex',energy:4}),
  ];
  const full=renderAudio(events,1,sampleRate,0);
  const start=.5,duration=.5,window=renderAudio(events,duration,sampleRate,start);
  const offset=Math.round(start*sampleRate);
  assert.deepEqual(window.left,full.left.slice(offset,offset+window.left.length));
  assert.deepEqual(window.right,full.right.slice(offset,offset+window.right.length));
});

test('audio is silent when the physical/semantic trace has no events',()=>{
  const audio=renderAudio([],1,16000);
  assert.ok(audio.left.every(v=>v===0));
  assert.ok(audio.right.every(v=>v===0));
});
