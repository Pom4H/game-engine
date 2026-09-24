import test from 'node:test';
import assert from 'node:assert/strict';
import {ExperimentSession,VEHICLE_EXPERIMENT} from '../dist/index.js';

test('vehicle experiment records deterministic frames and seeks without re-running physics',()=>{
  const session=new ExperimentSession(VEHICLE_EXPERIMENT,{scenario:'front',energyJ:45000,effectiveMassKg:450,radiusM:.45,thicknessM:.0008});
  const initial=structuredClone(session.frame);
  session.step(12);
  const recorded=structuredClone(session.frames[6]);
  const count=session.frames.length;
  session.seek(6);
  assert.equal(session.frames.length,count);
  assert.deepEqual(session.frame,recorded);
  session.seek(0);
  assert.deepEqual(session.frame,initial);
  session.dispose();
});

test('vehicle experiment presets reuse one generic control schema',()=>{
  const session=new ExperimentSession(VEHICLE_EXPERIMENT);
  session.applyPreset('side');
  assert.equal(session.values.scenario,'side');
  assert.equal(session.values.energyJ,28000);
  assert.equal(session.frames.length,1);
  session.step(1);
  assert.ok(session.frame.time>0);
  session.dispose();
});

test('vehicle experiment CSV derives from immutable recording',()=>{
  const session=new ExperimentSession(VEHICLE_EXPERIMENT);
  session.step(3);
  const csv=session.csv((frame,index)=>({frame:index,time:frame.time,crush:frame.maxDisplacementM}));
  assert.match(csv,/frame,time,crush/);
  assert.equal(csv.trim().split('\n').length,5);
  session.dispose();
});