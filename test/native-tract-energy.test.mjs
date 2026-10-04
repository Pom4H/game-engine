import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeVocalTract,NativeSpeechMotor,createVocalMotorFrame,nativeSpeechPlan} from '../dist/audio/native-speech.js';
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
