import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PHYSICAL_DIALOGUE_SCRIPT,DIALOGUE_VOICE_A,DIALOGUE_VOICE_B,
  Scene,VocalFaceRig,vocalFaceSceneSpec,sampleArticulatorScore,
  physicalDialogueScoreA,physicalDialogueScoreB,synthesizePhysicalDialogue,
} from '../dist/index.js';

test('dialogue has two distinct speakers, two stories, surprise and shared laughter',()=>{
  assert.equal(PHYSICAL_DIALOGUE_SCRIPT.length,7);
  assert.ok(PHYSICAL_DIALOGUE_SCRIPT[0].includes('чайник'));
  assert.ok(PHYSICAL_DIALOGUE_SCRIPT[3].includes('робот'));
  assert.ok(PHYSICAL_DIALOGUE_SCRIPT[4].includes('?!'));
  assert.notEqual(DIALOGUE_VOICE_A.tractLengthM,DIALOGUE_VOICE_B.tractLengthM);
  assert.notEqual(DIALOGUE_VOICE_A.basePitchHz,DIALOGUE_VOICE_B.basePitchHz);
});

test('dialogue scores are continuous and contain repeated laugh pressure pulses',()=>{
  for(const score of [physicalDialogueScoreA(),physicalDialogueScoreB()]){
    assert.ok(score.length>20);
    for(let i=1;i<score.length;i++)assert.ok(Math.abs(score[i].startS-score[i-1].endS)<1e-9);
    assert.ok(score.at(-1).endS>=18);
  }
  const tail=physicalDialogueScoreA().filter(g=>g.startS>=16);
  assert.ok(tail.filter(g=>(g.lungPressurePa??0)>700).length>=4);
  assert.ok(tail.filter(g=>(g.lungPressurePa??0)<400).length>=4);
});

test('dialogue renders deterministic stereo with speaker separation',()=>{
  const a=synthesizePhysicalDialogue(24000),b=synthesizePhysicalDialogue(24000);
  assert.deepEqual(a.audio.left,b.audio.left);
  assert.deepEqual(a.audio.right,b.audio.right);
  assert.equal(a.audio.sampleRate,24000);
  let diff=0,energy=0;
  for(let i=0;i<a.audio.left.length;i++){diff+=Math.abs(a.audio.left[i]-a.audio.right[i]);energy+=a.audio.left[i]**2+a.audio.right[i]**2;}
  assert.ok(energy>10);
  assert.ok(diff>10);
});

test('both dialogue faces keep teeth apart and lips speed-limited for the whole scene',()=>{
  const dt=1/240;
  for(const score of [physicalDialogueScoreA(),physicalDialogueScoreB()]){
    const scene=new Scene(vocalFaceSceneSpec()),rig=new VocalFaceRig(scene),duration=score.at(-1).endS;
    let minClearance=Infinity,maxLipSpeed=0;
    for(let t=0;t<=duration+1e-9;t+=dt){
      const sample=sampleArticulatorScore(score,Math.min(t,duration)),pose=rig.step(sample.articulators,dt);
      minClearance=Math.min(minClearance,pose.toothClearanceM);
      maxLipSpeed=Math.max(maxLipSpeed,Math.abs(pose.lipGapVelocityMps));
    }
    assert.ok(minClearance>.0034,'teeth too close: '+minClearance);
    assert.ok(maxLipSpeed<=.2201,'lip snap: '+maxLipSpeed);
  }
});
