import test from 'node:test';
import assert from 'node:assert/strict';
import {ProbeCapture} from '../dist/render/probe-capture.js';

const spec=(position=[0,1,0],facesPerFrame=1,key='car')=>({position,facesPerFrame,key,radius:45,boxHalfExtents:[8,3,5]});

test('every face budget publishes only complete sweeps without mixing two origins',()=>{
 for(let budget=1;budget<=6;budget++){
  const capture=new ProbeCapture();let published=0;
  for(let sweep=0;sweep<3;sweep++){
   const origin=[sweep*2,1,0],faces=[];
   for(let frame=0;frame<Math.ceil(6/budget);frame++){
    const batch=capture.plan(spec([origin[0]+frame*.1,1,0],budget));
    assert.deepEqual(batch.position,origin);faces.push(...batch.faces);
    assert.ok(batch.faces.length<=budget);
    assert.equal(batch.complete,frame===Math.ceil(6/budget)-1);
    assert.equal(capture.published?.position[0]??-1,published?(sweep-1)*2:-1,'partial replacement keeps its previous image origin');
    capture.commit(batch);
    if(batch.complete){published++;assert.equal(capture.published,batch);}
   }
   assert.deepEqual(faces,[0,1,2,3,4,5]);assert.equal(capture.face,0);
  }
  assert.equal(published,3);
 }
});

test('slow movement cannot silently move the origin or parallax bounds of a completed image',()=>{
 const capture=new ProbeCapture(),position=[0,1,0],first=capture.plan(spec(position,6));
 capture.commit(first);position[0]=1;
 const next=capture.plan(spec(position,1));capture.commit(next);
 assert.deepEqual(capture.published.position,[0,1,0]);assert.deepEqual(next.position,[1,1,0]);
 position[0]=2;const another=capture.plan(spec(position,1));
 assert.deepEqual(another.position,[1,1,0]);assert.deepEqual(capture.published.boxHalfExtents,[8,3,5]);
});

test('teleports and changed probe identities discard partial faces and old parallax metadata',()=>{
 const capture=new ProbeCapture();let batch=capture.plan(spec([0,1,0],6));capture.commit(batch);
 batch=capture.plan(spec([0,1,0],2));capture.commit(batch);assert.equal(capture.face,2);
 batch=capture.plan(spec([20,1,0],2));assert.deepEqual(batch.faces,[0,1]);assert.equal(capture.published,null);capture.commit(batch);
 batch=capture.plan(spec([20,1,0],2,'other'));assert.deepEqual(batch.faces,[0,1]);assert.deepEqual(batch.position,[20,1,0]);
 capture.reset();assert.equal(capture.face,0);assert.equal(capture.published,null);
});
