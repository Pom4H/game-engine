import test from 'node:test';
import assert from 'node:assert/strict';
import {
  russianTextToNpcPhones,
  planNpcRussianSpeech,
  synthesizeNpcRussianSpeech,
} from '../dist/index.js';

test('Russian NPC G2P preserves pronounceable structure and soft consonants',()=>{
  const phones=russianTextToNpcPhones('Привет, я говорю своим голосом.');
  const names=phones.filter(p=>p.phone!=='silence').map(p=>p.phone);
  for(const expected of ['p','r','i','v','e','t','j','a','g','o','v','l','s','m'])assert.ok(names.includes(expected),expected);
  assert.ok(phones.some(p=>p.soft),'Russian soft consonants were lost');
  assert.ok(phones.some(p=>p.phone==='silence'&&(p.pauseS??0)>.08),'punctuation pause missing');
});

test('NPC speech planner emits continuous physical motor score',()=>{
  const score=planNpcRussianSpeech('Привет. Я говорю своим голосом.');
  assert.ok(score.length>20);
  assert.equal(score[0].startS,0);
  for(let i=1;i<score.length;i++)assert.ok(Math.abs(score[i].startS-score[i-1].endS)<1e-9);
  assert.ok(score.some(g=>g.from.lipClosure>.95),'bilabial closure missing');
  assert.ok(score.some(g=>g.from.tongueTip>.9),'alveolar closure missing');
  assert.ok(score.some(g=>g.from.tongueHeight>.95&&g.from.tonguePosition<.3),'dorsal closure missing');
});

test('generic NPC text renders through soft geometry rather than legacy area lookup',()=>{
  const result=synthesizeNpcRussianSpeech('Привет. Я говорю своим голосом.',{sampleRate:16000,controlRateHz:120});
  assert.equal(result.diagnostics.geometryDriven,true);
  assert.ok(result.diagnostics.durationS>2);
  let energy=0,peak=0;
  for(const v of result.audio.left){energy+=v*v;peak=Math.max(peak,Math.abs(v));}
  assert.ok(Math.sqrt(energy/result.audio.left.length)>.035);
  assert.ok(peak>.15);
});


test('English NPC seed planner preserves I am alive motor structure',async()=>{
  const {englishTextToNpcPhones,planNpcEnglishSpeech,synthesizeNpcEnglishSpeech}=await import('../dist/index.js');
  const phones=englishTextToNpcPhones('I am alive').map(p=>p.phone);
  for(const expected of ['a','i','ae','m','schwa','l','v'])assert.ok(phones.includes(expected),expected);
  const score=planNpcEnglishSpeech('I am alive');
  assert.ok(score.length>=9);
  assert.ok(score.some(g=>g.from.lipClosure>.95),'English /m/ bilabial closure missing');
  assert.ok(score.some(g=>g.from.labiodental>.8),'English /v/ labiodental constriction missing');
  const result=synthesizeNpcEnglishSpeech('I am alive',{sampleRate:16000,controlRateHz:120});
  assert.equal(result.diagnostics.geometryDriven,true);
  assert.ok(result.audio.left.some(v=>Math.abs(v)>.02));
});


test('ASR-calibrated English motor skill stays on the physical soft-airway path',async()=>{
  const {npcEnglishAsrMotorSkill,synthesizeNpcEnglishAsrSkill}=await import('../dist/index.js');
  const skill=npcEnglishAsrMotorSkill('yeah');
  assert.equal(skill.text,'yeah');
  assert.ok(skill.score.length>=10);
  const result=synthesizeNpcEnglishAsrSkill('yeah',{sampleRate:16000,controlRateHz:120});
  assert.equal(result.diagnostics.geometryDriven,true);
  assert.equal(result.diagnostics.phrase,'yeah');
  assert.ok(result.audio.left.some(v=>Math.abs(v)>.02));
});


test('external VTL backend keeps GPL synthesis behind a process boundary',async()=>{
  const {VTL_EXTERNAL_BACKEND,planVtlNpcSpeech,serializeVtlSegmentSequence}=await import('../dist/index.js');
  assert.equal(VTL_EXTERNAL_BACKEND.kind,'external-process');
  assert.equal(VTL_EXTERNAL_BACKEND.license,'GPL-3.0');
  const plan=planVtlNpcSpeech('la la');
  assert.equal(plan.backend,'vocaltractlab-external');
  assert.equal(plan.sampleRate,44100);
  assert.deepEqual(plan.segments.map(s=>s.phone),['','l','a','l','a','']);
  assert.deepEqual(plan.segments.map(s=>s.durationS),[.12,.18,.30,.18,.30,.18]);
  const seg=serializeVtlSegmentSequence(plan);
  assert.match(seg,/name = l; duration_s = 0\.180000;/);
  assert.match(seg,/name = a; duration_s = 0\.300000;/);
});
