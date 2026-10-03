import test from 'node:test';
import assert from 'node:assert/strict';
import {RUSSIAN_MOUTH_PHRASE,russianMouthArticulatorScore,synthesizeRussianMouthPhrase} from '../dist/index.js';

const rms=(x,from,to,fs)=>{let e=0,n=0;for(let i=Math.floor(from*fs);i<Math.floor(to*fs);i++){e+=x[i]**2;n++;}return Math.sqrt(e/Math.max(1,n));};

test('Russian mouth phrase uses articulatory consonants and vowels',()=>{
  const score=russianMouthArticulatorScore();
  assert.ok(score.length>25);
  assert.ok(score.some(g=>g.from.tongueTip>.85&&g.voiced<.1),'needs voiceless alveolar constriction');
  assert.ok(score.some(g=>g.from.labiodental>.8&&g.voiced>.8),'needs voiced labiodental /v/');
  assert.ok(score.some(g=>g.from.tongueHeight>.95&&g.from.tonguePosition<.3),'needs dorsal /k/ closure');
  assert.ok(score.some(g=>g.from.lipRound>.8),'needs rounded /u/');
});

test('Russian phrase is deterministic and ends without hiss',()=>{
  const a=synthesizeRussianMouthPhrase({sampleRate:24000,seed:2026}),b=synthesizeRussianMouthPhrase({sampleRate:24000,seed:2026});
  assert.equal(a.diagnostics.phrase,RUSSIAN_MOUTH_PHRASE);
  assert.deepEqual(a.audio.left,b.audio.left);
  const fs=a.audio.sampleRate,d=a.diagnostics.durationS;
  assert.ok(rms(a.audio.left,.1,d-.3,fs)>.04);
  assert.ok(rms(a.audio.left,d-.12,d-.02,fs)<.002);
});
