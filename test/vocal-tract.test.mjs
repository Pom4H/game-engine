import test from 'node:test';
import assert from 'node:assert/strict';
import {synthesizeIAmAlive,vocalAreaFunction,iAmAliveVocalScore} from '../dist/index.js';

const energy=data=>data.reduce((sum,v)=>sum+v*v,0);

test('vocal tract area functions stay physical and phonemes change geometry',()=>{
  const a=vocalAreaFunction('a'),i=vocalAreaFunction('i'),m=vocalAreaFunction('m');
  assert.equal(a.length,24);assert.ok(a.every(v=>v>0));assert.ok(i.every(v=>v>0));
  assert.notDeepEqual(a,i);assert.ok(m.at(-1)<.1);assert.ok(a.at(-1)>1);
});

test('I am alive is deterministic physical waveguide audio',()=>{
  const a=synthesizeIAmAlive({sampleRate:24000,seed:7}),b=synthesizeIAmAlive({sampleRate:24000,seed:7});
  assert.deepEqual(a.audio.left,b.audio.left);assert.deepEqual(a.audio.right,b.audio.right);
  assert.equal(a.diagnostics.phrase,'I am alive!');
  assert.ok(a.audio.left.length>40000);assert.ok(energy(a.audio.left)>1);
  assert.ok(a.audio.left.every(Number.isFinite));
  assert.ok(a.diagnostics.maxAbsReflection<1);
});

test('tract discretization is close to acoustic propagation distance per sample',()=>{
  const result=synthesizeIAmAlive({sampleRate:48000,seed:1});
  const expected=343/result.audio.sampleRate;
  assert.ok(Math.abs(result.diagnostics.sectionLengthM-expected)<.0015);
  assert.ok(result.diagnostics.sections>=20&&result.diagnostics.sections<=28);
  assert.ok(result.diagnostics.minAreaCm2>0);
});

test('phrase score includes nasal and fricative physics instead of spelling-to-audio lookup',()=>{
  const score=iAmAliveVocalScore();
  assert.ok(score.some(g=>g.from==='m'&&g.nasal===1));
  assert.ok(score.some(g=>g.from==='v'&&g.frication>0));
  assert.ok(score.some(g=>g.from==='a'&&g.to==='i'));
});
