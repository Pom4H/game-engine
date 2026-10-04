import test from 'node:test';
import assert from 'node:assert/strict';
import {
  storyControlForVowel,
  storyExtractFormants,
  synthesizeStoryFormantMama,
} from '../dist/index.js';

test('MRI Story area function yields separated low vocal-tract resonances',()=>{
  const aa=storyExtractFormants(storyControlForVowel('aa'),4);
  assert.equal(aa.formants.length,4);
  for(let i=1;i<aa.formants.length;i++)assert.ok(aa.formants[i].hz>aa.formants[i-1].hz+150);
  assert.ok(aa.formants[0].hz>300&&aa.formants[0].hz<1100,'F1 outside plausible open-vowel range: '+aa.formants[0].hz);
  assert.ok(aa.formants[1].hz>700&&aa.formants[1].hz<2200,'F2 outside plausible open-vowel range: '+aa.formants[1].hz);
});

test('Story MRI formant projection produces deterministic mama audio',()=>{
  const a=synthesizeStoryFormantMama(44100),b=synthesizeStoryFormantMama(44100);
  assert.equal(a.phrase,'mama');
  assert.deepEqual(a.audio.left,b.audio.left);
  assert.ok(a.audio.left.some(v=>Math.abs(v)>.02));
});
