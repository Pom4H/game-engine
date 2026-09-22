import test from 'node:test';
import assert from 'node:assert/strict';
import {InterestPlanner,WorldMailbox} from '../dist/index.js';

test('interest search returns exact nearest distance for many observers and a moving observer',()=>{
  const planner=new InterestPlanner({downgradeTicks:1});
  const subjects=Array.from({length:600},(_,i)=>({id:`place-${i}`,x:(i*53)%3000-1500,z:(i*97)%3000-1500,radius:i%9}));
  const observers=Array.from({length:128},(_,i)=>({x:(i*379)%3000-1500,z:(i*997)%3000-1500}));
  for(let tick=0;tick<3;tick++){
    observers[0].x+=40;
    const result=planner.plan(tick,subjects,observers);
    for(const decision of result){
      const subject=subjects.find(item=>item.id===decision.id);
      const expected=Math.min(...observers.map(observer=>Math.max(0,Math.hypot(observer.x-subject.x,observer.z-subject.z)-subject.radius)));
      assert.ok(Math.abs(decision.distance-expected)<1e-10,`nearest distance for ${decision.id}`);
    }
  }
});

test('mailbox drains only the target location and preserves fencing and deterministic order',()=>{
  const mailbox=new WorldMailbox(16);
  const source={locationId:'source',ownerId:'a',epoch:1};
  const a={locationId:'a',ownerId:'a',epoch:1},b={locationId:'b',ownerId:'b',epoch:1};
  const put=(id,target,tick,sequence)=>mailbox.enqueue({id,source,target,tick,sequence,type:'event',payload:{id}},source,target);
  put('a2',a,2,2);put('b1',b,1,1);put('a1',a,1,2);put('a0',a,1,1);
  assert.deepEqual(mailbox.drain(a,2,2).map(message=>message.id),['a0','a1']);
  assert.equal(mailbox.size,2);
  assert.deepEqual(mailbox.drain(b,2).map(message=>message.id),['b1']);
  assert.equal(put('a2',a,2,2),'duplicate');
  assert.deepEqual(mailbox.drain({...a,ownerId:'next',epoch:2},2),[]);
  assert.equal(mailbox.size,0,'stale target epoch must release its pending message');
});

