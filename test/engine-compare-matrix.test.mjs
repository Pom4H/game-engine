import test from 'node:test';
import assert from 'node:assert/strict';
import {createMatrixPlan,validateMatrixPlan} from '../tools/engine-compare/matrix-plan.mjs';
import {createFixture,createMotion,hash} from '../tools/engine-compare/fixture.mjs';
import {auditProfile,commonBloomFeatures,sharedEffects} from '../tools/engine-compare/profiles.mjs';
import {requireParameters} from '../tools/engine-compare/parameters.mjs';
import {fixedEnvironmentRadiance} from '../tools/engine-compare/environment.mjs';
import {instanceUpdateRuns} from '../tools/engine-compare/instance-updates.mjs';

test('peer uploads coalesce dense changes without overwriting sparse gaps',()=>{
 assert.deepEqual(instanceUpdateRuns(Array.from({length:10000},(_,n)=>n)),[{start:0,count:10000}]);
 assert.deepEqual(instanceUpdateRuns([8,2,3,2,6,9]),[{start:2,count:2},{start:6,count:1},{start:8,count:2}]);
 assert.deepEqual(instanceUpdateRuns([]),[]);assert.throws(()=>instanceUpdateRuns([-1]),/Invalid instance/);
});

test('matrix covers independent count/resolution/effect/motion/visibility/instancing axes and rejects incomparable plans',()=>{
 const plan=createMatrixPlan();assert.equal(plan.expectedCases,159);assert.equal(new Set(plan.batches.map(b=>b.id)).size,9);
 assert.ok(plan.batches.some(b=>b.profile==='common-bloom'));assert.ok(plan.batches.some(b=>b.parameters.dirtyFraction===1));assert.ok(plan.batches.some(b=>!b.parameters.peerInstancing));
 for(const change of [b=>b.profile='native',b=>b.counts=[],b=>b.scenarios=['unknown'],b=>b.backends=['engine','engine'],b=>b.parameters.dirtyFraction=2,b=>b.frames=0]){const copy=structuredClone(plan);change(copy.batches[0]);assert.throws(()=>validateMatrixPlan(copy));}
 assert.throws(()=>requireParameters({engineVisibility:'fast'}));assert.throws(()=>requireParameters({peerInstancing:'false'}));
 assert.throws(()=>requireParameters({motionApi:'unknown'}));assert.equal(requireParameters().motionApi,'direct');
 for(const fraction of [.01,1])assert.ok(plan.batches.some(b=>b.parameters.motionApi==='visual-transform'&&b.parameters.dirtyFraction===fraction));
 assert.throws(()=>requireParameters({bloom:true}),/Unknown/);const unknown=structuredClone(plan);unknown.batches[0].shadows=false;assert.throws(()=>validateMatrixPlan(unknown),/Unknown/);
});

test('fixed HDR is finite, deterministic and part of each engine fixture input',async()=>{
 const radiance=fixedEnvironmentRadiance();assert.equal(fixedEnvironmentRadiance(),radiance);const bytes=Buffer.from(radiance.rgb16fBase64,'base64');assert.equal(bytes.length,radiance.width*radiance.height*6);
 for(let n=0;n<bytes.length;n+=2)assert.notEqual(bytes.readUInt16LE(n)&0x7c00,0x7c00);
 const a=await createFixture(8,{environmentMode:'fixed'}),b=await createFixture(8,{environmentMode:'fixed'}),old=await createFixture(8);assert.equal(a.sourceHash,b.sourceHash);assert.notEqual(a.sourceHash,old.sourceHash);assert.equal(a.geometryHash,old.geometryHash);assert.ok(a.scene.spec.rendering.environmentRadiance);
 const plan=createMatrixPlan();plan.batches[0].parameters.environmentMode='scene-derived';assert.throws(()=>validateMatrixPlan(plan),/fixed environment/);
});

test('authored sparse/dense motion is deterministic, changes the same matrices and restores physical replay',async()=>{
 const a=await createFixture(20),b=await createFixture(20),before=await hash(a.scene.snapshot());
 const x=createMotion(a,'camera-object-motion',.1),y=createMotion(b,'camera-object-motion',.1);assert.equal(x.selected.length,2);
 const initialModels=a.groups.map(g=>g.models.slice());x.update(81);y.update(81);assert.deepEqual(a.groups.map(g=>g.models),initialModels,'Authored pose update must not redundantly compose matrices for Engine');x.syncModels();y.syncModels();assert.deepEqual(a.groups.map(g=>g.models),b.groups.map(g=>g.models));assert.notEqual(await hash(a.scene.snapshot()),before);
 x.restore();y.restore();assert.equal(await hash(a.scene.snapshot()),before);assert.deepEqual(a.groups.map(g=>g.models),b.groups.map(g=>g.models));
 const all=createMotion(a,'object-motion',1);assert.equal(all.selected.length,20);all.update(120);all.restore();assert.equal(await hash(a.scene.snapshot()),before);
 const none=createMotion(a,'camera-motion',1);assert.equal(none.selected.length,0);none.update(2);assert.equal(await hash(a.scene.snapshot()),before);
});

test('visual-transform control matches direct poses while registering only selected movers',async()=>{
 for(const fraction of [0,.1,1]){
  const direct=await createFixture(20),visual=await createFixture(20),before=await hash(visual.scene.snapshot());
  const a=createMotion(direct,'object-motion',fraction,'direct'),b=createMotion(visual,'object-motion',fraction,'visual-transform');
  const rotations=visual.groups.flatMap(g=>g.objects.map(o=>[...o.entity.rotation])),scales=visual.groups.flatMap(g=>g.objects.map(o=>[...o.entity.scale]));
  for(const frame of [0,81,120]){a.update(frame);b.update(frame);a.syncModels();b.syncModels();assert.deepEqual(direct.groups.map(g=>g.models),visual.groups.map(g=>g.models));}
  assert.equal(a.describe().registeredMovingObjects,0);assert.equal(b.describe().registeredMovingObjects,b.selected.length);
  assert.deepEqual(visual.groups.flatMap(g=>g.objects.map(o=>o.entity.rotation)),rotations);assert.deepEqual(visual.groups.flatMap(g=>g.objects.map(o=>o.entity.scale)),scales);
  a.restore();b.restore();assert.equal(await hash(visual.scene.snapshot()),before);assert.deepEqual(direct.groups.map(g=>g.models),visual.groups.map(g=>g.models));
 }
 const fixture=await createFixture(20),camera=createMotion(fixture,'camera-motion',1,'visual-transform');camera.update(3);assert.equal(camera.describe().registeredMovingObjects,0);
 assert.throws(()=>createMotion(fixture,'object-motion',.1,'unknown'),/Invalid motion/);
});

test('common bloom must execute on each backend and forbidden AA/reflection passes fail',()=>{
 const measured={pipeline:{features:commonBloomFeatures,presentSource:'effects'},visibility:{reflection:{batches:0}},preparation:{visibilityPlan:{passes:{reflection:{tests:0}}}}};
 auditProfile('common-bloom','engine',measured,{'render:render.bloom.downsample':{},'render:render.effects':{}});
 assert.throws(()=>auditProfile('common-bloom','engine',measured,{}),/never executed/);
 assert.throws(()=>auditProfile('common-bloom','engine',measured,{'render:render.taa':{}}),/Disabled/);
 for(const backend of ['three','babylon']){const p={comparisonEffects:sharedEffects('common-bloom'),bloomExecutions:12};auditProfile('common-bloom',backend,p,{});assert.throws(()=>auditProfile('common-bloom',backend,{...p,bloomExecutions:0},{}),/never executed/);assert.throws(()=>auditProfile('common-bloom',backend,{...p,comparisonEffects:{...p.comparisonEffects,samples:4}},{}),/mismatch/);}
});
