import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STORY_SECTIONS,STORY_NOMINAL_TRACT_LENGTH_CM,
  STORY_VOWELS,STORY_CONSONANTS,
  storyVowel,storyArea,storyControlForConsonant,
  storyLengthVector,synthesizeStoryMama,
} from '../dist/index.js';

test('Story tier I reproduces MRI-calibrated 44-section vowel substrate',()=>{
  const i=storyVowel('i'),aa=storyVowel('aa'),schwa=storyVowel('schwa');
  assert.equal(i.length,STORY_SECTIONS);
  assert.equal(aa.length,STORY_SECTIONS);
  assert.equal(schwa.length,STORY_SECTIONS);
  assert.notDeepEqual([...i],[...aa]);
  assert.notDeepEqual([...i],[...schwa]);
  assert.deepEqual(STORY_VOWELS.i,{q1:-5.176,q2:-2.556});
  assert.deepEqual(STORY_VOWELS.aa,{q1:.981,q2:1.043});
  assert.ok(i.every(v=>v>0&&Number.isFinite(v)));
});

test('Story tier II places published stop and nasal constrictions',()=>{
  const p=storyArea(storyControlForConsonant('p'));
  const m=storyArea(storyControlForConsonant('m'));
  const t=storyArea(storyControlForConsonant('t'));
  const k=storyArea(storyControlForConsonant('k'));
  assert.ok(p.at(-1)<.01,'/p/ must occlude at lips');
  assert.ok(m.at(-1)<.01,'/m/ must occlude at lips');
  assert.ok(t[38]<.01,'/t/ must occlude near Story section 39');
  assert.ok(k[29]<.01,'/k/ must occlude near Story section 30');
  assert.equal(STORY_CONSONANTS.m.nasalPortAreaCm2,1.04);
});

test('Story tier III nominal length is the published adult-male tract length',()=>{
  const L=storyLengthVector();
  const total=[...L].reduce((a,b)=>a+b,0);
  assert.ok(Math.abs(total-STORY_NOMINAL_TRACT_LENGTH_CM)<1e-9);
  const protruded=storyLengthVector(0,2,8);
  assert.ok([...protruded].reduce((a,b)=>a+b,0)>total+1.5);
});

test('Story mama renders through MRI-calibrated area frames',()=>{
  const result=synthesizeStoryMama({controlRateHz:120});
  assert.equal(result.diagnostics.geometryDriven,true);
  assert.equal(result.diagnostics.phrase,'mama');
  assert.equal(result.audio.sampleRate,44100);
  assert.equal(result.diagnostics.sections,44);
  assert.ok(result.audio.left.some(v=>Math.abs(v)>.02));
  assert.ok(result.diagnostics.minAreaCm2>0);
});


test('LF source follows VTL-style pulse controls and closes each cycle',async()=>{
  const {lfPulseCycle,LfGlottalSource}=await import('../dist/index.js');
  const pulse=lfPulseCycle(2048,{amplitudeCm3S:300,openQuotient:.5,speedQuotient:3,returnPhase:.02,voiced:1});
  assert.ok(Math.max(...pulse)>250,'LF flow peak is too small');
  assert.ok(pulse[0]<1e-6,'LF cycle must begin closed');
  assert.ok(pulse.at(-1)<5,'LF return phase must approach closure by cycle end');
  assert.ok(pulse.every(v=>Number.isFinite(v)&&v>=0));
  const source=new LfGlottalSource(44100);
  let peak=0;
  for(let i=0;i<44100/110;i++){
    const s=source.step({f0Hz:110,amplitudeCm3S:300,voiced:1});
    peak=Math.max(peak,s.flowCm3S);
    assert.ok(Number.isFinite(s.derivativeCm3S2));
  }
  assert.ok(peak>200);
});
