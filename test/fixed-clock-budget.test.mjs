// Promote-ready for Engine/test/. No source pins or ignored dependencies.
// continueCatchUp is a read-only, non-reentrant scheduling predicate: it must
// not reset/advance/mutate this clock. It is checked between completed steps.
import test from 'node:test';
import assert from 'node:assert/strict';
import {FixedClock} from '../dist/core/fixed-clock.js';

const debt=clock=>Reflect.get(clock,'debt');
const state=clock=>({debt:debt(clock),droppedMs:clock.droppedMs,delay:clock.delay});

test('read-only predicate is eligible only after a completed step when another duration is due below the cap',()=>{
 const clock=new FixedClock(10,250,6);let calls=0,steps=0;
 const proceed=()=>{calls++;return true;};
 assert.equal(clock.advance(0,()=>steps++,proceed),0);
 assert.equal(clock.advance(9,()=>steps++,proceed),0);
 assert.equal(calls,0);
 assert.equal(clock.advance(10,()=>steps++,proceed),1);
 assert.equal(calls,0,'no predicate after the final due duration');
 assert.equal(clock.advance(70,()=>steps++,proceed),6);
 assert.equal(calls,5,'no predicate beyond the original six-step cap');
 assert.equal(steps,7);assert.equal(debt(clock),0);
 const one=new FixedClock(10,250,1);one.reset(0);
 assert.equal(one.advance(100,()=>{},()=>{throw Error('one-step cap must prevent a predicate call');}),1);
});

test('false preserves the next duration and still permits one due step per advance',()=>{
 const clock=new FixedClock(10);clock.reset(0);let steps=0,predicates=0;
 assert.equal(clock.advance(50,()=>{steps++;return false;},()=>{predicates++;return false;}),1);
 assert.equal(steps,1);assert.equal(predicates,1);assert.equal(debt(clock),40);
 assert.equal(clock.advance(50,()=>steps++),4);
 assert.equal(steps,5);assert.equal(debt(clock),0);assert.equal(clock.delay,10);
 assert.equal(clock.advance(50,()=>{throw Error('nothing due');},()=>{throw Error('nothing due');}),0);
});

test('a thrown read-only predicate preserves its exact error and does not consume the next duration',()=>{
 const clock=new FixedClock(10),error=Object.create(null);clock.reset(0);let steps=0,caught;
 try{clock.advance(50,()=>steps++,()=>{throw error;});}catch(value){caught=value;}
 assert.equal(caught,error);assert.equal(steps,1);assert.equal(debt(clock),40);
 assert.equal(clock.advance(50,()=>steps++),4);
 assert.equal(steps,5);assert.equal(debt(clock),0);assert.equal(clock.droppedMs,0);
});

test('repeated budget yields at each fixed time conserve every due step and existing clamp debt versus default batches',()=>{
 const reference=new FixedClock(10),budgeted=new FixedClock(10);reference.reset(0);budgeted.reset(0);
 let expected=0,actual=0;
 for(const now of [70,75,180,180,190,510,510,520,530,700]){
  while(reference.advance(now,()=>expected++)){}
  while(budgeted.advance(now,()=>actual++,()=>false)){}
  assert.equal(actual,expected);assert.deepEqual(state(budgeted),state(reference));
  assert(Math.abs(now-actual*10-debt(budgeted)-budgeted.droppedMs)<1e-9);
 }
 assert.equal(budgeted.droppedMs,70,'the existing250ms clamp remains authoritative');
 assert.equal(actual,63);assert.equal(debt(budgeted),0);
});

test('a permissive read-only predicate retains the configured six-step catchup maximum',()=>{
 const clock=new FixedClock(10,250,6);clock.reset(0);let steps=0,predicates=0;
 assert.equal(clock.advance(250,()=>steps++,()=>{predicates++;return true;}),6);
 assert.equal(steps,6);assert.equal(predicates,5);assert.equal(debt(clock),190);assert.equal(clock.delay,0);
 assert.equal(clock.advance(250,()=>steps++,()=>true),6);assert.equal(steps,12);assert.equal(debt(clock),130);
});
