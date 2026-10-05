import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeSpeechPlan,createVocalMotorFrame,NativeSpeechMotor,NativeVocalTract,NativeSpeechStream,scatterNativeJunction,renderNativeSpeech} from '../dist/audio/native-speech.js';
const voice={id:'a',name:'A',tractLengthM:.175,pan:0};
const make=(phone='a',pressure=800)=>nativeSpeechPlan([voice],[{id:'one',speakerId:'a',text:'A',startS:.1,segments:[{phone:'',durationS:.06},{phone,durationS:.4},{phone:'',durationS:.25}],pitch:[{timeS:0,hz:125}],pressure:[{timeS:0,pa:pressure}]}]);
const rms=a=>Math.sqrt(a.reduce((s,v)=>s+v*v,0)/Math.max(1,a.length));

test('all junctions conserve wave power including a closed nasal port',()=>{
 for(let k=0;k<70;k++){
  const a=Float64Array.from([.3+k*.03,2.5-k*.02,k%2?.9:0]),p=Float64Array.from([Math.sin(k)*100,Math.cos(k)*30,14]),out=new Float64Array(3);
  scatterNativeJunction(p,a,out);const before=a.reduce((s,v,i)=>s+v*p[i]**2,0),after=a.reduce((s,v,i)=>s+v*out[i]**2,0);
  assert.ok(Math.abs(before-after)<1e-8,{before,after});
 }
});
test('the native glottis receives energy from breath pressure, never a recorded waveform',()=>{
 const plan=make('a',0),stream=new NativeSpeechStream(plan,'a'),pcm=new Float32Array(44100);stream.render(pcm);
 assert.ok(pcm.every(v=>v===0));
 const speaking=new NativeSpeechStream(make(),'a'),out=new Float32Array(44100);speaking.render(out);
 assert.ok(out.every(Number.isFinite)&&rms(out)>.001);
 assert.ok(rms(out.subarray(38000))<rms(out.subarray(10000,18000))*.01,'release must decay without hiss');
});
test('tube length changes the propagation clock, not the speed of sound',()=>{
 for(const length of [.14,.175,.21]){
  const tube=new NativeVocalTract(length),frame=createVocalMotorFrame(length);frame.oralAreaCm2.fill(1);frame.voicing=1;frame.lungPressurePa=0;tube.setGeometry(frame);tube.injectPressure(0,1);
  let first=-1;
  for(let i=0;i<46;i++){if(Math.abs(tube.forward[43])>1e-15&&first<0)first=i;tube.step(frame,{...voice,tractLengthM:length});}
  assert.equal(first,43);assert.ok(Math.abs(tube.internalRate*length/44-343)<1e-10);
 }
});
test('the visible elliptical aperture and acoustic terminal area are the same quantity',()=>{
 for(const phone of ['a','i:','u:','m','p','f','s','n','r']){
  const motor=new NativeSpeechMotor(make(phone),'a'),state=motor.sample(.3);
  assert.ok(Math.abs(Math.PI/4*state.lipWidthM*state.lipGapM-state.oralAreaCm2[43]*1e-4)<1e-12);
  assert.ok(state.oralAreaCm2.every(a=>a>0&&Number.isFinite(a)));
  if(phone==='m')assert.ok(state.lipGapM<.00001&&state.nasalPortAreaCm2>.5);
 }
});
test('streaming block boundaries do not restart voice phase, noise or articulation',()=>{
 const plan=make('s'),a=new NativeSpeechStream(plan,'a',24000,19),b=new NativeSpeechStream(plan,'a',24000,19),whole=new Float32Array(22000),chunked=new Float32Array(22000);a.render(whole);
 for(let at=0;at<chunked.length;at+=137)b.render(chunked.subarray(at,Math.min(chunked.length,at+137)));
 assert.deepEqual(whole,chunked);
});
test('plan owns an independent copy and rejects unsupported phonemes and overlapping voice turns',()=>{
 const p=make(),motor=new NativeSpeechMotor(p,'a'),before=motor.sample(.3).oralAreaCm2.slice();p.turns[0].segments[1].phone='i:';
 assert.deepEqual(motor.sample(.3).oralAreaCm2,before);
 assert.throws(()=>make('invalid'),/target/);
 assert.throws(()=>nativeSpeechPlan([voice],[...make().turns,{...make().turns[0],id:'two'}]),/overlap/);
 assert.throws(()=>nativeSpeechPlan([{...voice,tractLengthM:NaN}],make().turns),/length/);
 assert.throws(()=>nativeSpeechPlan([voice],[{...make().turns[0],pressure:[{timeS:0,pa:Infinity}]}]),/pressure/);
});
test('offline mix is deterministic, finite, bounded and explicitly identifies the native backend',()=>{
 const plan=make(),a=renderNativeSpeech(plan,{sampleRate:24000}),b=renderNativeSpeech(plan,{sampleRate:24000});
 assert.deepEqual(a.audio.left,b.audio.left);assert.equal(a.diagnostics.backend,'native-typescript');
 assert.ok(a.audio.left.every(v=>Number.isFinite(v)&&Math.abs(v)<=.921));
});
