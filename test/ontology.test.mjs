import test from 'node:test';
import assert from 'node:assert/strict';
import {STATE,channelsOverlap,ModuleScheduler} from '../dist/index.js';

test('ontology parent channels overlap deeper facts',()=>{
  assert.equal(channelsOverlap(STATE.entity.motion,'entity.motion.velocity'),true);
  assert.equal(channelsOverlap(STATE.entity.motion,STATE.entity.transform),false);
  assert.equal(channelsOverlap('*',STATE.surface.state),true);
});

test('scheduler detects hazards across ontology depth',()=>{
  const scheduler=new ModuleScheduler();
  scheduler.use({id:'velocity',phase:'simulate',rateHz:60,reads:[],writes:['entity.motion.velocity']});
  scheduler.use({id:'motion',phase:'simulate',rateHz:60,reads:[STATE.entity.motion],writes:[STATE.entity.transform]});
  assert.throws(()=>scheduler.plan(0),/Ambiguous resource hazard/);
});
