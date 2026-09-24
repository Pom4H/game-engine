import test from 'node:test';
import assert from 'node:assert/strict';
import {StructuralBody,material,M3InteractionRig} from '../dist/index.js';

test('finite-duration structural impulse delivers momentum over multiple ticks',()=>{
  const steel=material('steel').mechanical;
  const body=new StructuralBody({
    nodes:[{position:[-1,0,0],mass:1},{position:[1,0,0],mass:1}],
    constraints:[{kind:'distance',a:0,b:1,areaM2:1e-3,material:steel}],
    sleepDelay:10,
  });
  body.scheduleImpulse({point:[0,0,0],impulse:[12,0,0],radius:2,durationSeconds:.12});
  assert.equal(body.pendingImpulsePulses,1);
  body.step(.02,[0,0,0]);
  const p1=body.linearMomentum()[0];
  assert.ok(p1>0&&p1<12,'first tick must carry only part of the impulse, got '+p1);
  for(let i=0;i<5;i++)body.step(.02,[0,0,0]);
  const p2=body.linearMomentum()[0];
  assert.ok(Math.abs(p2-12)<1e-8,'full pulse must conserve total impulse, got '+p2);
  assert.equal(body.pendingImpulsePulses,0);
});

test('M3 crash structure crumples progressively instead of in the impact call',()=>{
  const rig=new M3InteractionRig(1700);
  const before=new Float64Array(rig.structure.position);
  rig.impact({time:0,point:[2.0,.72,0],normal:[1,0,0],energyJ:45_000,radiusM:.45,thicknessM:.0008,effectiveMassKg:450});
  assert.equal(rig.structure.pendingImpulsePulses,1);
  assert.deepEqual([...rig.structure.position],[...before],'impact schedules load but does not teleport the cage');

  rig.step(1/120);
  const first=maxDelta(before,rig.structure.position);
  assert.ok(first>0,'first physical tick starts crumple');
  assert.equal(rig.structure.pendingImpulsePulses,1,'contact still has temporal extent after one tick');

  for(let i=0;i<30;i++)rig.step(1/120);
  const later=maxDelta(before,rig.structure.position);
  assert.ok(later>first*1.01,'crumple should continue after the first tick: '+first+' -> '+later);
  assert.equal(rig.structure.pendingImpulsePulses,0);
});

function maxDelta(a,b){
  let max=0;
  for(let i=0;i<a.length;i++)max=Math.max(max,Math.abs(a[i]-b[i]));
  return max;
}