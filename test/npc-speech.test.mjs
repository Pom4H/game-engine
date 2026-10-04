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
