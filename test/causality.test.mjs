import test from 'node:test';
import assert from 'node:assert/strict';
import {causalFingerprint,classifyEvidence,parseCausalCommit,validateCausalCommit} from '../tools/causality/protocol.mjs';

const valid=`render(reality): test a roughness cause\n\nCausal-Experiment: stanford-orb\nCausal-Observation: held-out highlights are too sharp\nCausal-Hypothesis: the clearcoat lobe is too narrow\nCausal-Intervention: broaden only the clearcoat roughness response\nCausal-Prediction: held-out RealityGap decreases while the 60 fps guard stays green\nCausal-Guard: completedFps >= 59\nCausal-Guard: gpuP95Ms <= 16.67`;

test('causal commit trailers round-trip into a machine-readable declaration',()=>{
  const parsed=parseCausalCommit(valid);
  assert.equal(parsed.experiment,'stanford-orb');
  assert.equal(parsed.guards.length,2);
  assert.deepEqual(validateCausalCommit(parsed),[]);
});

test('WIP and missing causal fields are rejected',()=>{
  const parsed=parseCausalCommit('WIP: tweak renderer\n\nCausal-Experiment: stanford-orb');
  const errors=validateCausalCommit(parsed);
  assert.ok(errors.some(error=>error.includes('WIP')));
  assert.ok(errors.some(error=>error.includes('Causal-Hypothesis')));
});

test('causal fingerprint ignores prose casing and whitespace but keeps the intervention',()=>{
  const a=parseCausalCommit(valid),b={...a,hypothesis:'  THE CLEARCOAT LOBE IS TOO NARROW  '};
  assert.equal(causalFingerprint(a),causalFingerprint(b));
  assert.notEqual(causalFingerprint(a),causalFingerprint({...a,intervention:'change exposure'}));
});

test('Stanford evidence respects the baseline tolerance and runtime guards',()=>{
  const jobs={reality:'success',visualFast:'success',performance1080:'success'};
  assert.equal(classifyEvidence({experiment:'stanford-orb',jobs,reality:{baseline:{delta:-0.004,tolerance:0.003},regressions:[]}}),'accepted');
  assert.equal(classifyEvidence({experiment:'stanford-orb',jobs,reality:{baseline:{delta:0.0027,tolerance:0.003},regressions:[]}}),'neutral');
  assert.equal(classifyEvidence({experiment:'stanford-orb',jobs,reality:{baseline:{delta:0.004,tolerance:0.003},regressions:[]}}),'rejected');
  assert.equal(classifyEvidence({experiment:'stanford-orb',jobs:{...jobs,performance1080:'failure'},reality:{baseline:{delta:-0.01,tolerance:0.003},regressions:[]}}),'rejected');
});

test('generic causal changes are observed without pretending unrelated gates prove causation',()=>{
  assert.equal(classifyEvidence({experiment:'development-loop',jobs:{visualFast:'failure'}}),'observed');
});
