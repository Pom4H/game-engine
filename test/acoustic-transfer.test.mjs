import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AcousticWaveField,Scene,syncSceneAcousticBoundaries,traceAcousticTransfer,
  synthesizeEvent,renderAcousticTransfer,
} from '../dist/index.js';

const source=[3,2.25,3],listener=[9,2.25,3];
const frame=[
  {id:'bottom',position:[6,.5,3],mesh:{kind:'box',size:[.25,1,6]},body:{mass:0}},
  {id:'top',position:[6,4.25,3],mesh:{kind:'box',size:[.25,1.5,6]},body:{mass:0}},
  {id:'left',position:[6,2.25,.75],mesh:{kind:'box',size:[.25,2.5,1.5]},body:{mass:0}},
  {id:'right',position:[6,2.25,4.875],mesh:{kind:'box',size:[.25,2.5,2.25]},body:{mass:0}},
];
function observe(open){
  const scene=new Scene({version:1,ground:-100,entities:[...frame,{id:'door',position:[6,2.25,3],rotation:[0,open?Math.PI/2:0,0],mesh:{kind:'box',size:[.25,2.5,1.5]},body:{mass:0}}]});
  const field=new AcousticWaveField({size:[24,10,12],cellSizeM:.5,waveSpeedMps:343,densityKgM3:1.225,velocityDampingPerSecond:3});
  syncSceneAcousticBoundaries(field,scene.entities.values());
  return traceAcousticTransfer(field,source,listener,{durationS:.16,sourceRadiusM:.65,acousticEnergyJ:1,maxReflections:5});
}
test('wave observation converts geometry into delay occlusion and early reflections',()=>{
  const closed=observe(false),open=observe(true);
  assert.ok(open.direct.gain>closed.direct.gain*2+1e-5);
  assert.ok(open.direct.delayS>=open.diagnostics.geometricDelayS*.85);
  assert.ok(open.direct.lowpassHz>closed.direct.lowpassHz);
  assert.ok(open.reflections.length>=1);
  assert.ok(open.diagnostics.emptyFieldPeakPressurePa>0);
});
test('acoustic transfer extraction is deterministic',()=>assert.deepEqual(observe(true),observe(true)));
test('offline projection delays and filters the identical dry voice without wave-rate audio simulation',()=>{
  const transfer=observe(true),sampleRate=16000,dry=synthesizeEvent({type:'impact',id:44,time:0,point:source,normal:[1,0,0],a:'a',b:'ground',materialA:'steel',materialB:'default',energy:120,impulse:10,speed:8,size:.6},sampleRate);
  const wet=renderAcousticTransfer(dry,transfer,{outputDurationS:.8});
  const first=wet.left.findIndex((v,i)=>Math.abs(v)+Math.abs(wet.right[i])>1e-7);
  assert.ok(first>=Math.floor(transfer.direct.delayS*sampleRate)-2);
  assert.equal(wet.sampleRate,sampleRate);
  assert.ok(wet.left.some(v=>v!==0));
});
