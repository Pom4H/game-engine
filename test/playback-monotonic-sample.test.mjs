import test from 'node:test';
import assert from 'node:assert/strict';
import {PlaybackClock,Replica,projection,vector3} from '../dist/network/index.js';
import {PlaybackClock as BeforeClock} from './fixtures/playback-clock-before-monotonic-sample.mjs';

const bits=values=>Buffer.from(Float64Array.from(values).buffer).toString('hex');
function run(Clock,timestamps){const clock=new Clock(.1);clock.observe(1,0);return timestamps.map(now=>clock.sample(now));}
// Diagnostic counters are additive; the retained clock and interpolation state
// must still match the frozen reference bit for bit on admitted timestamps.
function retainedClock(clock){const {heldSince,advancing,...state}=clock;return state;}

test('a stale playback sample does not consume its interval again on the next frame',()=>{
 const control=run(BeforeClock,[0,.02,.03]),before=run(BeforeClock,[0,.02,.01,.03]),actual=run(PlaybackClock,[0,.02,.01,.03]);
 assert.equal(before[2],before[1],'the old clock already held its value for stale callbacks');
 assert.equal(before[3],.943312,'the old callback nevertheless moved its host baseline backwards');
 assert.equal(control[2],.932856);
 assert.equal(actual[2],actual[1]);
 assert.equal(actual[3],control[2]);
 assert.notEqual(actual[3],before[3]);
});

test('ordinary increasing/equal playback timelines retain exact frozen clock state and values',()=>{
 for(const delay of[0,.1,.3,2]){
  const before=new BeforeClock(delay),actual=new PlaybackClock(delay);let simulation=0,lastObserved=0;
  for(let i=0;i<1800;i++){
   if(i===900){before.reset();actual.reset();simulation=0;lastObserved=0;}
   const j=i%900,now=j/120+(j>650?3:0);
   if(j>2&&j%3===0){simulation+=(now-lastObserved)*(j<300?.55:j<600?.85:1.1);lastObserved=now;before.observe(simulation,now);actual.observe(simulation,now);}
   const expected=before.sample(now),value=actual.sample(now);
   assert.equal(bits([value]),bits([expected]));assert.deepEqual(retainedClock(actual),{...before});
   assert.equal(bits([actual.sample(now)]),bits([before.sample(now)]));
   assert.deepEqual(retainedClock(actual),{...before});
  }
 }
});

test('held presentation duration is observable without advancing past the newest cause and resets cleanly',()=>{
 const clock=new PlaybackClock(0);clock.observe(1,0);assert.equal(clock.sample(0),1);clock.sample(.1);clock.sample(.35);
 assert.equal(clock.inspect(.35).heldMs,350);assert.equal(clock.inspect(.35).heldFrames,2);
 clock.observe(2,.4);assert.ok(clock.sample(.4)>1);assert.equal(clock.inspect(.4).heldMs,0);
 clock.reset();assert.deepEqual(clock.inspect(1),{playbackRate:1,advancingFrames:0,heldFrames:0,heldMs:0});
});

const schema=projection('playback-stale-timestamp/v1',{position:vector3()});
function replica(Clock=PlaybackClock){
 const r=new Replica(schema,1);if(Clock!==PlaybackClock)Object.defineProperty(r,'clock',{value:new Clock(.1)});
 for(const[tick,time]of[[48,.8],[60,1]])r.receive(schema.capture({epoch:1,sequence:tick,tick,time,paused:false},[{id:'body',data:{position:[time*10,0,0]}}]),0);
 return r;
}
const point=r=>({time:r.sample.time,x:r.sample.rows[0].values[0],alpha:r.sample.alpha,from:r.sample.fromTick,to:r.sample.toTick});

test('actual Replica retains coherent visible interpolation after a stale host timestamp',()=>{
 const actual=replica(),control=replica(BeforeClock),before=replica(BeforeClock);
 for(const now of[0,.02])for(const r of[actual,control,before])r.present(now);
 const shown=point(actual);actual.present(.01);before.present(.01);assert.deepEqual(point(actual),shown);
 for(const r of[actual,control,before])r.present(.03);
 assert.deepEqual(point(actual),point(control));
 assert.equal(point(actual).x,9.32856);assert.equal(point(before).x,9.43312);
 assert.notDeepEqual(point(actual),point(before));
});

test('timestamp validation, equal-time new causes, packet gaps, resets and explicit reverse seeks remain supported',()=>{
 for(const Clock of[BeforeClock,PlaybackClock]){
  const c=new Clock();assert.equal(c.sample(100),0);
  for(const value of[NaN,Infinity,-Infinity])assert.throws(()=>c.sample(value),/Invalid presentation timestamp/);
  c.observe(1,0);const first=c.sample(0);c.observe(1.05,0);assert.equal(c.sample(0),first);
  assert.equal(c.sample(10),1.05);assert.equal(c.sample(9),1.05);
  c.reset();assert.equal(c.sample(100),0);c.observe(.2,0);assert.equal(c.sample(0),.1);
  assert.equal(c.rate,1);assert.equal(c.heldFrames,0);
 }
 const r=replica();r.present(100);assert.equal(r.at(.9).rows[0].values[0],9);assert.equal(r.at(.8).rows[0].values[0],8);
 r.reset(2);assert.equal(r.present(0).rows.length,0);assert.equal(r.clock.sample(0),0);
});
