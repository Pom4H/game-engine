import test from 'node:test';import assert from 'node:assert/strict';
import {LAB_VOICES,SPEECH_LAB_CASES,speechLabPlan} from '../tools/speech-lab/corpus.mjs';
import {NativeSpeechMotor} from '../dist/audio/native-speech.js';
test('speech diagnostic corpus fixes all articulatory contrasts, voices and source controls before recognition',()=>{
 assert.equal(SPEECH_LAB_CASES.length,24);assert.equal(new Set(SPEECH_LAB_CASES.map(c=>c.id)).size,24);
 assert.equal(SPEECH_LAB_CASES.filter(c=>c.text).length,9);assert.equal(LAB_VOICES.length,2);
 for(const voice of LAB_VOICES)for(const item of SPEECH_LAB_CASES){
  const plan=speechLabPlan(voice.id,item.id);assert.equal(plan.turns.length,1);assert.equal(plan.turns[0].pressure[0].pa,800);assert.equal(plan.turns[0].pitch.length,1);
  const state=new NativeSpeechMotor(plan,voice.id).sample(.25);assert.ok(state.oralAreaCm2.every(Number.isFinite));
 }
 assert.throws(()=>speechLabPlan('mike','made-up'));assert.throws(()=>speechLabPlan('fake','tea'));
});
test('pa/ta/ka contrasts differ in closure place rather than pitch, gain or vowel; sa/sha keep distinct open jets',()=>{
 for(const voice of LAB_VOICES)for(const v of ['a','ilong','ulong']){
  const states=['p','t','k','s','sh'].map(c=>new NativeSpeechMotor(speechLabPlan(voice.id,c+'-'+v),voice.id).sample(.25));
  for(const [i,center] of [43,38,29].entries())assert.equal(states[i].oralAreaCm2[center],.0001,'published closure center');
  for(const s of states.slice(0,3))assert.equal(Math.min(...s.oralAreaCm2),.0001);
  assert.notEqual(states[3].constrictionSection,states[4].constrictionSection);
  assert.ok(states[3].frication===1&&states[4].frication===1);
  assert.ok(states.every(s=>s.pitchHz===states[0].pitchHz&&s.lungPressurePa===states[0].lungPressurePa));
 }
});
test('silent motor rest closes the actual lips without adding breath energy or a visual-only closure',()=>{
 const plan=speechLabPlan('mike','tea'),motor=new NativeSpeechMotor(plan,'mike');
 for(const t of [0,.1,1.4]){const f=motor.sample(t);assert.equal(f.active,0);assert.equal(f.lungPressurePa,0);assert.equal(f.closure,1);assert.ok(f.oralAreaCm2[43]<=.0001001);assert.ok(f.lipGapM<1e-6);}
});
