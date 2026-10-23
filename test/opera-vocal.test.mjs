import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DiaphragmBreathSupport,Scene,VocalFaceRig,vocalFaceSceneSpec,
  originalOperaScore,sampleArticulatorScore,synthesizeOriginalOpera,
} from '../dist/index.js';

const rms=(x,a,b,fs)=>{let e=0,n=0;for(let i=Math.floor(a*fs);i<Math.floor(b*fs);i++){e+=x[i]**2;n++;}return Math.sqrt(e/Math.max(1,n));};

test('diaphragm support builds and releases pressure without discontinuities',()=>{
  const fs=48000,support=new DiaphragmBreathSupport(fs);
  let previous=0,maxStep=0,peak=0;
  for(let i=0;i<fs*.7;i++){
    const target=i<fs*.5?1500:0;
    const sample=support.step({targetPressurePa:target,glottalFlowM3S:.00016});
    maxStep=Math.max(maxStep,Math.abs(sample.pressurePa-previous));previous=sample.pressurePa;peak=Math.max(peak,sample.pressurePa);
  }
  assert.ok(peak>1000);
  assert.ok(maxStep<5);
  assert.ok(previous<500);
});

test('opera score uses sustained pressure and tension vibrato',()=>{
  const score=originalOperaScore();
  assert.ok(score.some(g=>(g.lungPressurePa??0)>=1500));
  assert.ok(score.some(g=>(g.vibratoHz??0)>5&&(g.vibratoSemitones??0)>.3));
  assert.ok(score.some(g=>(g.pitchHz??0)>=293));
});

test('opera face keeps teeth apart and lips soft over the full performance',()=>{
  const scene=new Scene(vocalFaceSceneSpec()),rig=new VocalFaceRig(scene),score=originalOperaScore();
  const dt=1/240,duration=score.at(-1).endS;
  let minClearance=Infinity,maxLipSpeed=0;
  for(let t=0;t<=duration+1e-9;t+=dt){
    const sample=sampleArticulatorScore(score,Math.min(t,duration));
    const pose=rig.step(sample.articulators,dt);
    minClearance=Math.min(minClearance,pose.toothClearanceM);
    maxLipSpeed=Math.max(maxLipSpeed,Math.abs(pose.lipGapVelocityMps));
  }
  assert.ok(minClearance>.0034,'teeth approach too closely: '+minClearance);
  assert.ok(maxLipSpeed<=.2201,'lip motion snaps at '+maxLipSpeed+' m/s');
});

test('original opera renders a strong sustained physical voice and clean release',()=>{
  const result=synthesizeOriginalOpera({sampleRate:24000,seed:77}),x=result.audio.left,fs=result.audio.sampleRate,d=result.diagnostics.durationS;
  assert.ok(d>5);
  assert.ok(rms(x,.5,d-.5,fs)>.06);
  assert.ok(rms(x,d-.15,d-.02,fs)<.003);
  assert.ok(x.every(Number.isFinite));
});
