import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Scene,SoftVocalFaceRig,softVocalFaceSceneSpec,
  VOCAL_ARTICULATOR_PRESETS,physicalDialogueScoreA,sampleArticulatorScore,
} from '../dist/index.js';

test('soft mouth is a structural body, not two rigid lip primitives',()=>{
  const scene=new Scene(softVocalFaceSceneSpec()),rig=new SoftVocalFaceRig(scene);
  const d=rig.mouth.diagnostics;
  assert.ok(d.nodes>=64);
  assert.ok(d.constraints>d.nodes*3);
  assert.equal(d.brokenConstraints,0);
  const upper=scene.entities.get('vocal-face-upper-lip'),lower=scene.entities.get('vocal-face-lower-lip');
  assert.ok(upper.scale[0]<.01&&lower.scale[0]<.01,'legacy rigid lips must be hidden');
  const soft=scene.entities.get('vocal-face-soft-mouth');
  assert.equal(soft.mesh.kind,'triangle-mesh');
  assert.ok(soft.mesh.positions.length>rig.mouth.structure.position.length);
});

test('soft mouth follows a sudden closure with inertia instead of teleporting',()=>{
  const scene=new Scene(softVocalFaceSceneSpec()),rig=new SoftVocalFaceRig(scene),dt=1/240;
  for(let i=0;i<120;i++)rig.step(VOCAL_ARTICULATOR_PRESETS.a,dt);
  const before=rig.mouth.diagnostics.mouthGapM;
  const first=rig.step(VOCAL_ARTICULATOR_PRESETS.m,dt).mouth.mouthGapM;
  assert.ok(before>.02);
  assert.ok(first>before*.55,'one frame must not slam the soft lips shut');
  let after=first;
  for(let i=0;i<180;i++)after=rig.step(VOCAL_ARTICULATOR_PRESETS.m,dt).mouth.mouthGapM;
  assert.ok(after<before*.8,'muscle drive should eventually close the mouth');
});

test('soft mouth stays finite, unbroken and outside teeth through dialogue articulation',()=>{
  const scene=new Scene(softVocalFaceSceneSpec()),rig=new SoftVocalFaceRig(scene),score=physicalDialogueScoreA(),dt=1/240,duration=score.at(-1).endS;
  let maxPen=0,maxKinetic=0;
  for(let t=0;t<=duration+1e-9;t+=dt){
    const sample=sampleArticulatorScore(score,Math.min(t,duration)),state=rig.step(sample.articulators,dt).mouth;
    maxPen=Math.max(maxPen,state.maxContactPenetrationM);maxKinetic=Math.max(maxKinetic,state.kineticEnergyJ);
    assert.equal(state.brokenConstraints,0,'broken soft-mouth constraint at t='+t.toFixed(4)+'s jaw='+sample.articulators.jawOpen.toFixed(3)+' closure='+sample.articulators.lipClosure.toFixed(3)+' round='+sample.articulators.lipRound.toFixed(3));
    assert.ok(Number.isFinite(state.mouthGapM));
  }
  assert.ok(maxPen<.008,'tooth contact projection allowed excessive penetration: '+maxPen);
  assert.ok(maxKinetic<2,'soft mouth became numerically explosive: '+maxKinetic);
});
