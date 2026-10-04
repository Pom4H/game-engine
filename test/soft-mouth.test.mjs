import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Scene,SoftVocalFaceRig,softVocalFaceSceneSpec,
  VOCAL_ARTICULATOR_PRESETS,physicalDialogueScoreA,sampleArticulatorScore,
} from '../dist/index.js';

test('perioral face is one structural soft-tissue volume with a real oral aperture',()=>{
  const scene=new Scene(softVocalFaceSceneSpec()),rig=new SoftVocalFaceRig(scene),d=rig.mouth.diagnostics;
  assert.ok(d.nodes>=200,'perioral cage should extend beyond the lip rim');
  assert.ok(d.constraints>d.nodes*4);
  assert.ok(d.surfaceVertices>d.nodes);
  assert.ok(d.apertureBoundaryNodes>=40);
  assert.ok(d.cheekNodes>0&&d.chinNodes>0);
  assert.equal(d.brokenConstraints,0);

  const upper=scene.entities.get('vocal-face-upper-lip'),lower=scene.entities.get('vocal-face-lower-lip');
  assert.ok(upper.scale[0]<.01&&lower.scale[0]<.01,'legacy rigid lips must be hidden');

  const soft=scene.entities.get('vocal-face-soft-perioral');
  assert.equal(soft.mesh.kind,'triangle-mesh');
  assert.ok(soft.mesh.colors?.length===soft.mesh.positions.length/3*4,'skin/lip/mucosa colors should belong to one mesh');

  const p=soft.mesh.positions,idx=soft.mesh.indices;
  for(let i=0;i<idx.length;i+=3){
    const ids=[idx[i],idx[i+1],idx[i+2]],zs=ids.map(v=>p[v*3+2]);
    if(Math.min(...zs)<.585)continue;
    const x=ids.reduce((s,v)=>s+p[v*3],0)/3,y=ids.reduce((s,v)=>s+p[v*3+1],0)/3;
    const q=(x/.16)**2+((y-1.365)/.014)**2;
    assert.ok(q>.72,'front skin triangle spans the oral hole');
  }
});

test('soft perioral tissue follows a sudden closure with inertia instead of teleporting',()=>{
  const scene=new Scene(softVocalFaceSceneSpec()),rig=new SoftVocalFaceRig(scene),dt=1/240;
  for(let i=0;i<120;i++)rig.step(VOCAL_ARTICULATOR_PRESETS.a,dt);
  const before=rig.mouth.diagnostics.mouthGapM;
  const first=rig.step(VOCAL_ARTICULATOR_PRESETS.m,dt).mouth.mouthGapM;
  assert.ok(before>.02);
  assert.ok(first>before*.55,'one frame must not slam the soft lips shut');
  let after=first;
  for(let i=0;i<220;i++)after=rig.step(VOCAL_ARTICULATOR_PRESETS.m,dt).mouth.mouthGapM;
  assert.ok(after<before*.45,'orbicularis drive should eventually bring the lips together');
  assert.ok(after>=.0013,'lip surfaces must contact rather than cross');
});

test('perioral volume stays finite, attached, unbroken and outside teeth through dialogue articulation',()=>{
  const scene=new Scene(softVocalFaceSceneSpec()),rig=new SoftVocalFaceRig(scene),score=physicalDialogueScoreA(),dt=1/240,duration=score.at(-1).endS;
  let maxPen=0,maxRemaining=0,maxKinetic=0,maxGap=0,minGap=Infinity;
  for(let t=0;t<=duration+1e-9;t+=dt){
    const sample=sampleArticulatorScore(score,Math.min(t,duration)),state=rig.step(sample.articulators,dt).mouth;
    maxPen=Math.max(maxPen,state.maxContactPenetrationM);
    maxRemaining=Math.max(maxRemaining,state.remainingToothPenetrationM);
    maxKinetic=Math.max(maxKinetic,state.kineticEnergyJ);
    maxGap=Math.max(maxGap,state.mouthGapM);minGap=Math.min(minGap,state.mouthGapM);
    if(state.brokenConstraints){
      const broken=[];
      for(let i=0;i<rig.mouth.structure.broken.length;i++)if(rig.mouth.structure.broken[i])broken.push(rig.mouth.structure.definition.constraints[i]?.kind+'#'+i);
      assert.fail('broken perioral constraints '+broken.join(',')+' at t='+t.toFixed(4)+'s');
    }
    assert.ok(Number.isFinite(state.mouthGapM));
  }
  assert.ok(maxPen<.010,'tooth contact projection allowed excessive trial penetration: '+maxPen);
  assert.ok(maxRemaining<1e-8,'tooth penetration remained after projection: '+maxRemaining);
  assert.ok(maxKinetic<2,'soft face became numerically explosive: '+maxKinetic);
  assert.ok(minGap>=.0013,'lips crossed');
  assert.ok(maxGap>minGap*4,'mouth aperture did not articulate');
});
