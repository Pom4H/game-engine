import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeVocalTract,NativeSpeechMotor,NativeSpeechStream,createVocalMotorFrame,nativeSpeechPlan} from '../dist/audio/native-speech.js';
import {NATIVE_VOWEL_REFERENCE,nativeVowelArea} from '../dist/audio/native-vowels.js';
import {nativeGlottalOpening} from '../dist/audio/native-tract.js';
test('geometry updates preserve power-normalised acoustic coordinates and a closed nose stays closed',()=>{
 const voice={id:'a',name:'A',tractLengthM:.175,pan:0};
 const tube=new NativeVocalTract(.175),frame=createVocalMotorFrame(.175);frame.voicing=1;
 frame.oralAreaCm2.fill(1);tube.setGeometry(frame);tube.injectPressure(8,80);
 const before=tube.measureEnergy();frame.oralAreaCm2[8]=.001;tube.setGeometry(frame);
 assert.ok(Math.abs(tube.measureEnergy()-before)<1e-15,'A*p² must be invariant under the quasi-static coordinate change');
 frame.oralAreaCm2[8]=5;tube.setGeometry(frame);assert.ok(Math.abs(tube.measureEnergy()-before)<1e-15);
 const plan=nativeSpeechPlan([voice],[{id:'m',speakerId:'a',text:'M',startS:.1,segments:[{phone:'',durationS:.06},{phone:'m',durationS:.4},{phone:'',durationS:.25}],pitch:[{timeS:0,hz:125}],pressure:[{timeS:0,pa:800}]}]);
 const motor=new NativeSpeechMotor(plan,'a');let maxOpen=0,maxClosing=0;
 for(let i=0;i<tube.internalRate*.85;i++){
  const t=i/tube.internalRate;motor.sample(t,frame);tube.setGeometry(frame);
  const value=Math.abs(tube.step(frame,voice));if(t>.3&&t<.58)maxOpen=Math.max(maxOpen,value);if(t>.58)maxClosing=Math.max(maxClosing,value);
 }
 assert.ok(maxClosing<1,{maxOpen,maxClosing});
});
test('MRI vowel area vectors preserve measured open airways, identity, units and immutable reference data',()=>{
 assert.equal(Object.keys(NATIVE_VOWEL_REFERENCE).length,11);
 for(const [name,ref] of Object.entries(NATIVE_VOWEL_REFERENCE)){
  const a=nativeVowelArea(name);assert.equal(a.length,44);assert.deepEqual([...a],ref.areaCm2);
  assert.ok(a.every(v=>v>=.13&&v<=9.59),name+' has a false occlusion or wrong area units');
  assert.ok(ref.lengthCm>=16&&ref.lengthCm<20);
  a.fill(0);assert.ok(nativeVowelArea(name).every(v=>v>0),'caller cannot mutate the shared measured reference');
 }
 assert.equal(nativeVowelArea('i')[43],.91);assert.equal(nativeVowelArea('u')[43],.16);
 assert.equal(Math.min(...nativeVowelArea('i')),.35);
});
test('high front vowel no longer becomes an almost silent occlusion at unchanged source pressure',()=>{
 const render=phone=>{
  const voice={id:'speaker',name:'Speaker',tractLengthM:.175,pan:0};
  const plan=nativeSpeechPlan([voice],[{id:'vowel',speakerId:'speaker',text:phone,startS:.05,segments:[{phone:'',durationS:.1},{phone,durationS:.5},{phone:'',durationS:.2}],pitch:[{timeS:0,hz:120}],pressure:[{timeS:0,pa:800}]}]);
  const stream=new NativeSpeechStream(plan,'speaker'),pcm=new Float32Array(44100);stream.render(pcm);
  const window=pcm.subarray(11025,24255);return Math.sqrt(window.reduce((s,x)=>s+x*x,0)/window.length);
 };
 const a=render('a'),i=render('i:');assert.ok(i>a*.1,{a,i});
});
test('prescribed glottal cycle retains closure contact without a spurious zero left-hand slope',()=>{
 const close=.65,peak=close*.65,epsilon=1e-7;
 assert.equal(nativeGlottalOpening(0),0);assert.equal(nativeGlottalOpening(peak),1);
 assert.equal(nativeGlottalOpening(close),0);assert.equal(nativeGlottalOpening(1),0);
 for(let i=0;i<=4096;i++){const p=i/4096,a=nativeGlottalOpening(p);assert.ok(Number.isFinite(a)&&a>=0&&a<=1);if(p>=close)assert.equal(a,0);}
 const left=(nativeGlottalOpening(close)-nativeGlottalOpening(close-epsilon))/epsilon;
 assert.ok(Math.abs(left+Math.PI/(2*(close-peak)))<1e-5,'closing velocity reaches contact, rather than fading to zero');
 // Integral follows analytically from the half-cosine opening and cosine closing.
 const n=32768;let integral=0;for(let i=0;i<n;i++)integral+=nativeGlottalOpening((i+.5)/n)/n;
 assert.ok(Math.abs(integral-(peak/2+2*(close-peak)/Math.PI))<1e-8);
 for(const p of [NaN,Infinity,-.001,1.001])assert.throws(()=>nativeGlottalOpening(p));
});
