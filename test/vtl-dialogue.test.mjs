import test from 'node:test';
import assert from 'node:assert/strict';
import {planVtlDialogue,VTL_EXTERNAL_BACKEND} from '../dist/audio/vtl-external.js';

const speakers=()=>[
  {id:'a',name:'A',anatomy:null,pan:-.2},
  {id:'b',name:'B',anatomy:{ageMonths:300,isMale:false},pan:.2},
];
const turn=()=>({id:'reply',speakerId:'b',text:'La?',startS:1.25,
  segments:[{phone:'',durationS:.1},{phone:'l',durationS:.12},{phone:'a',durationS:.4},{phone:'',durationS:.2}],
  pitch:[{timeS:0,hz:180},{timeS:.6,hz:240}],
  pressure:[{timeS:0,pa:800},{timeS:.6,pa:700}],
});

test('dialogue preserves independent local motor time, global placement and speaker anatomy',()=>{
  const input=turn(),voices=speakers(),plan=planVtlDialogue(voices,[input]);
  assert.equal(plan.sampleRate,44100);
  assert.equal(plan.turns[0].startS,1.25);
  assert.equal(plan.turns[0].pitch[0].timeS,0);
  assert.equal(plan.turns[0].pitch[1].hz,240);
  assert.equal(plan.speakers[1].anatomy.isMale,false);
  input.pitch[1].hz=99;voices[1].anatomy.ageMonths=12;
  assert.equal(plan.turns[0].pitch[1].hz,240);
  assert.equal(plan.speakers[1].anatomy.ageMonths,300);
  assert.equal(VTL_EXTERNAL_BACKEND.upstreamCommit,'df30392f18dc5e175b577c3ba734caaa65a3927f');
});
test('unknown phones cannot silently turn into neutral or unrelated gestures',()=>{
  const input=turn();input.segments[1].phone='unsupported';
  assert.throws(()=>planVtlDialogue(speakers(),[input]),/Unsupported VTL phone/);
});
test('worker target limits reject unphysical units and impossible pitch ramps',()=>{
  for(const pitch of [NaN,Infinity,0,513]){
    const input=turn();input.pitch[0].hz=pitch;
    assert.throws(()=>planVtlDialogue(speakers(),[input]),/pitch/);
  }
  const pressure=turn();pressure.pressure[0].pa=8000;
  assert.throws(()=>planVtlDialogue(speakers(),[pressure]),/pressure/);
  const slope=turn();slope.pitch[1]={timeS:.001,hz:360};
  assert.throws(()=>planVtlDialogue(speakers(),[slope]),/slope/);
});
test('local contours cannot run backwards, outlive articulation or start in the middle',()=>{
  for(const pitch of [[],[{timeS:.1,hz:180}],[{timeS:0,hz:180},{timeS:0,hz:180}],[{timeS:0,hz:180},{timeS:3,hz:180}]]){
    assert.throws(()=>planVtlDialogue(speakers(),[{...turn(),pitch}]),/contour/);
  }
});
test('speaker and output identities cannot collide or escape the output directory',()=>{
  for(const id of ['../outside','reply.wav',''])assert.throws(()=>planVtlDialogue(speakers(),[{...turn(),id}]),/turn ID/);
  assert.throws(()=>planVtlDialogue(speakers(),[turn(),turn()]),/duplicate/);
  assert.throws(()=>planVtlDialogue(speakers(),[{...turn(),speakerId:'missing'}]),/Unknown VTL speaker/);
});
