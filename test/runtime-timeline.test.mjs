import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Scene,beginRuntimeSpan,endRuntimeSpan,recordRuntimeEvent,runtimeTimelineSnapshot,
  eventAudioDuration,synthesizeEvent,
} from '../dist/index.js';

test('runtime timeline preserves lifetime cause refs and declared capabilities',()=>{
  const root=beginRuntimeSpan({owner:'test',kind:'entity',name:'timeline-root',at:1,refs:['root'],capabilities:[{id:'inspect',label:'Inspect'}],data:{role:'root'}});
  const child=recordRuntimeEvent({owner:'test',kind:'event',name:'timeline-child',at:1.25,cause:root,refs:['root'],capabilities:[{id:'rewind',label:'Rewind'}],data:{energy:4}});
  endRuntimeSpan(root,2);
  const rows=runtimeTimelineSnapshot(),r=rows.find(row=>row.id===root),c=rows.find(row=>row.id===child);
  assert.equal(r?.start,1);assert.equal(r?.end,2);assert.deepEqual(r?.refs,['root']);
  assert.equal(c?.cause,root);assert.equal(c?.end,1.25);assert.equal(c?.capabilities[0]?.id,'rewind');
});

test('scene projects entity and mesh lifetimes into the same causal timeline',()=>{
  const id='__timeline:test:entity',scene=new Scene({version:1,ground:-100,entities:[{id,mesh:{kind:'box',size:[1,1,1]},material:{kind:'steel'}}]});
  let rows=runtimeTimelineSnapshot().filter(row=>row.refs.includes(id)),entity=rows.find(row=>row.kind==='entity'),mesh=rows.find(row=>row.kind==='mesh');
  assert.ok(entity&&mesh);assert.equal(mesh.cause,entity.id);assert.equal(entity.end,null);assert.equal(mesh.data.primitive,'box');
  scene.step(1/60);scene.remove(id);
  rows=runtimeTimelineSnapshot().filter(row=>row.refs.includes(id));entity=rows.find(row=>row.id===entity.id);mesh=rows.find(row=>row.id===mesh.id);
  assert.equal(entity?.end,scene.time);assert.equal(mesh?.end,scene.time);
});

test('audio timeline duration can use the exact synthesis cause',()=>{
  const event={type:'impact',id:917,time:.5,point:[0,0,0],normal:[0,1,0],a:'a',b:'ground',materialA:'steel',materialB:'concrete',energy:12,impulse:3,speed:2,size:1};
  const duration=eventAudioDuration(event),audio=synthesizeEvent(event,8000);
  assert.equal(audio.left.length,Math.ceil(duration*8000));
  assert.equal(audio.right.length,audio.left.length);
});
