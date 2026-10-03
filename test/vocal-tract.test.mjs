import test from 'node:test';
import assert from 'node:assert/strict';
import {synthesizeIAmAlive,vocalAreaFunction,articulatorAreaFunction,VOCAL_ARTICULATOR_PRESETS,iAmAliveVocalScore,iAmAliveArticulatorScore} from '../dist/index.js';

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


test('I am alive primary score is articulator motion, not a phoneme area lookup',()=>{
  const score=iAmAliveArticulatorScore();
  assert.ok(score.length>=10);
  assert.ok(score.some(g=>g.from.velumOpen===1));
  assert.ok(score.some(g=>g.from.labiodental>.8));
  assert.ok(score.some(g=>g.to&&g.from.tonguePosition<g.to.tonguePosition));
});

test('articulator geometry continuously changes tube area',()=>{
  const a=VOCAL_ARTICULATOR_PRESETS.a,i=VOCAL_ARTICULATOR_PRESETS.i;
  const mid={};for(const key of Object.keys(a))mid[key]=(a[key]+i[key])*.5;
  const A=articulatorAreaFunction(a),M=articulatorAreaFunction(mid),I=articulatorAreaFunction(i);
  assert.notDeepEqual(A,M);assert.notDeepEqual(M,I);
  assert.ok(M.every(v=>v>0&&Number.isFinite(v)));
});


test('final silence has no frication hiss and output is audibly strong',()=>{
  const result=synthesizeIAmAlive({sampleRate:48000,seed:11}),audio=result.audio.left,rate=result.audio.sampleRate;
  const rms=(from,to)=>{let e=0,n=0;for(let i=Math.floor(from*rate);i<Math.floor(to*rate);i++){e+=audio[i]**2;n++;}return Math.sqrt(e/Math.max(1,n));};
  const voiced=rms(.15,1.65),tail=rms(1.84,1.98);
  assert.ok(voiced>.06, 'voice RMS should not be quiet');
  assert.ok(tail<voiced*.015, 'silent tail must not hiss after /v/');
});
