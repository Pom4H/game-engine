import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene,VocalFaceRig,vocalFaceSceneSpec,vocalFaceCollisionDiagnostics,VOCAL_ARTICULATOR_PRESETS,sampleArticulatorScore,iAmAliveArticulatorScore,russianMouthArticulatorScore} from '../dist/index.js';

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


test('face has an explicit nose bridge wings and nostrils',()=>{
  const scene=new Scene(vocalFaceSceneSpec());
  for(const id of ['vocal-face-nose-bridge','vocal-face-nose-dorsum','vocal-face-nose-tip','vocal-face-nose-left-ala','vocal-face-nose-right-ala','vocal-face-left-nostril','vocal-face-right-nostril'])assert.ok(scene.entities.has(id),id);
});


test('TMJ hinge keeps teeth apart and limits closing speed across the Russian phrase',()=>{
  const scene=new Scene(vocalFaceSceneSpec()),rig=new VocalFaceRig(scene),score=russianMouthArticulatorScore();
  const dt=1/240,duration=score.at(-1).endS;
  let minClearance=Infinity,maxClosingSpeed=0,previousClearance=null;
  for(let time=0;time<=duration+1e-9;time+=dt){
    const sample=sampleArticulatorScore(score,Math.min(time,duration));
    const pose=rig.step(sample.articulators,dt);
    const diagnostic=vocalFaceCollisionDiagnostics(scene);
    assert.ok(!diagnostic.teethColliding,'teeth collision at '+time.toFixed(4)+'s');
    minClearance=Math.min(minClearance,diagnostic.toothClearanceM,pose.toothClearanceM);
    if(previousClearance!==null){
      const closingSpeed=Math.max(0,(previousClearance-diagnostic.toothClearanceM)/dt);
      maxClosingSpeed=Math.max(maxClosingSpeed,closingSpeed);
    }
    previousClearance=diagnostic.toothClearanceM;
  }
  assert.ok(minClearance>=.0034,'minimum tooth clearance '+minClearance);
  assert.ok(maxClosingSpeed<.65,'jaw closes too abruptly: '+maxClosingSpeed+' m/s');
});
