import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene,VocalFaceRig,vocalFaceSceneSpec,VOCAL_ARTICULATOR_PRESETS,sampleArticulatorScore,iAmAliveArticulatorScore} from '../dist/index.js';

test('vocal face scene is renderable and rig maps articulators to visible geometry',()=>{
  const scene=new Scene(vocalFaceSceneSpec()),rig=new VocalFaceRig(scene);
  const open=rig.apply(VOCAL_ARTICULATOR_PRESETS.a);
  const jawOpenY=scene.entities.get('vocal-face-jaw').position[1],openGap=open.lipGapM;
  const closed=rig.apply(VOCAL_ARTICULATOR_PRESETS.m);
  const jawClosedY=scene.entities.get('vocal-face-jaw').position[1];
  assert.ok(openGap>closed.lipGapM);
  assert.ok(jawOpenY<jawClosedY);
  assert.ok(scene.renderMoverIds().has('vocal-face-lower-lip'));
  assert.ok(scene.renderMoverIds().has('vocal-face-tongue'));
});

test('face and voice sample the same continuous articulator score',()=>{
  const score=iAmAliveArticulatorScore(),sample=sampleArticulatorScore(score,.18);
  assert.ok(sample.articulators.tonguePosition>VOCAL_ARTICULATOR_PRESETS.a.tonguePosition);
  assert.ok(sample.articulators.tonguePosition<VOCAL_ARTICULATOR_PRESETS.i.tonguePosition);
  const scene=new Scene(vocalFaceSceneSpec()),pose=new VocalFaceRig(scene).apply(sample.articulators);
  assert.ok(pose.lipGapM>0);
  assert.ok(pose.tonguePosition[2]>.43);
});
