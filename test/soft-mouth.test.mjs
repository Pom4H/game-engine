import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Scene,SoftVocalFaceRig,softVocalFaceSceneSpec,
  VOCAL_ARTICULATOR_PRESETS,physicalDialogueScoreA,sampleArticulatorScore,sampleSoftMouthMotorPlan,SOFT_MOUTH_MOTOR_LEAD_S,
} from '../dist/index.js';

const LIP_CONTACT_TEST_MAX_GAP=.0062;
const LIP_CONTACT_TEST_ZONE=.0121;

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
  let after=first,maxClosingSpeed=0,maxContactForce=0;
  for(let i=0;i<220;i++){
    const mouth=rig.step(VOCAL_ARTICULATOR_PRESETS.m,dt).mouth;
    after=mouth.mouthGapM;
    maxClosingSpeed=Math.max(maxClosingSpeed,mouth.maxLipClosingSpeedMps);
    maxContactForce=Math.max(maxContactForce,mouth.maxLipContactForceN);
  }
  assert.ok(after<LIP_CONTACT_TEST_MAX_GAP,'sustained /m/ must reach soft contact zone, gap='+after);
  assert.ok(after>=.0010,'lip surfaces must contact rather than cross');
  assert.ok(maxClosingSpeed<=.181,'soft lips still approach with a clap-like speed: '+maxClosingSpeed);
  assert.ok(maxContactForce<.0451,'lip contact force exceeded compliant contact cap: '+maxContactForce);
});

test('perioral volume stays finite, attached, unbroken and outside teeth through dialogue articulation',()=>{
  const scene=new Scene(softVocalFaceSceneSpec()),rig=new SoftVocalFaceRig(scene),score=physicalDialogueScoreA(),dt=1/240,duration=score.at(-1).endS;
  let maxPen=0,maxPenAt='',maxRemaining=0,maxKinetic=0,maxGap=0,minGap=Infinity,maxLipClosingSpeed=0,maxLipContactForce=0,maxLipContactPairs=0;
  for(let t=0;t<=duration+1e-9;t+=dt){
    const sample=sampleArticulatorScore(score,Math.min(t,duration)),plan=sampleSoftMouthMotorPlan(score,Math.min(t,duration),SOFT_MOUTH_MOTOR_LEAD_S),state=rig.step(sample.articulators,dt,plan).mouth;
    if(state.maxContactPenetrationM>maxPen){maxPen=state.maxContactPenetrationM;maxPenAt='t='+t.toFixed(4)+' jaw='+sample.articulators.jawOpen.toFixed(3)+' closure='+sample.articulators.lipClosure.toFixed(3)+' labio='+sample.articulators.labiodental.toFixed(3)+' tip='+sample.articulators.tongueTip.toFixed(3)+' box='+(state.deepestContactBox??'?')+' point='+JSON.stringify(state.deepestContactPoint??null);}
    maxRemaining=Math.max(maxRemaining,state.remainingToothPenetrationM);
    maxKinetic=Math.max(maxKinetic,state.kineticEnergyJ);maxLipClosingSpeed=Math.max(maxLipClosingSpeed,state.maxLipClosingSpeedMps);maxLipContactForce=Math.max(maxLipContactForce,state.maxLipContactForceN);maxLipContactPairs=Math.max(maxLipContactPairs,state.lipContactPairs);
    maxGap=Math.max(maxGap,state.mouthGapM);minGap=Math.min(minGap,state.mouthGapM);
    if(state.brokenConstraints){
      const broken=[];
      for(let i=0;i<rig.mouth.structure.broken.length;i++)if(rig.mouth.structure.broken[i])broken.push(rig.mouth.structure.definition.constraints[i]?.kind+'#'+i);
      assert.fail('broken perioral constraints '+broken.join(',')+' at t='+t.toFixed(4)+'s');
    }
    assert.ok(Number.isFinite(state.mouthGapM));
  }
  assert.ok(maxPen<.010,'tooth contact projection allowed excessive trial penetration: '+maxPen+' at '+maxPenAt);
  assert.ok(maxRemaining<1e-8,'tooth penetration remained after projection: '+maxRemaining);
  assert.ok(maxKinetic<2,'soft face became numerically explosive: '+maxKinetic);
  assert.ok(maxLipClosingSpeed<=.181,'lip closing speed remained clap-like: '+maxLipClosingSpeed);
  assert.ok(maxLipContactForce<.0451,'lip contact force exceeded compliant cap: '+maxLipContactForce);
  assert.ok(minGap>=.0010,'lips crossed');
  assert.ok(minGap<LIP_CONTACT_TEST_ZONE,'dialogue never enters compliant bilabial contact zone: '+minGap);
  assert.ok(maxLipContactPairs>0,'anticipatory motor plan never creates compliant lip contact pairs');
  assert.ok(maxGap>.080,'open vowels do not open the mouth enough: '+maxGap);
});


test('visible dental arch replaces slab teeth in the soft-face scene',()=>{
  const scene=new Scene(softVocalFaceSceneSpec()),rig=new SoftVocalFaceRig(scene);
  rig.step(VOCAL_ARTICULATOR_PRESETS.a,1/240);
  assert.ok(scene.entities.get('vocal-face-upper-teeth').scale[0]<.01);
  assert.ok(scene.entities.get('vocal-face-lower-teeth').scale[0]<.01);
  for(const arch of ['upper','lower'])for(let i=0;i<8;i++){
    const tooth=scene.entities.get('vocal-face-visible-'+arch+'-tooth-'+i);
    assert.ok(tooth?.mesh?.kind==='sphere',arch+' tooth '+i);
    assert.ok(tooth.scale[0]>.02&&tooth.scale[0]<.04);
  }
});


test('anticipatory motor planner catches short bilabial events without point-sampling misses',()=>{
  const score=physicalDialogueScoreA(),dt=.006;
  let found=false;
  for(let t=0;t<score.at(-1).endS-SOFT_MOUTH_MOTOR_LEAD_S;t+=dt){
    const now=sampleArticulatorScore(score,t).articulators;
    const plan=sampleSoftMouthMotorPlan(score,t,SOFT_MOUTH_MOTOR_LEAD_S);
    if(now.lipClosure<.25&&plan.lipClosure>.9){found=true;break;}
  }
  assert.ok(found,'planner never anticipates a future bilabial closure');
});


test('soft tongue stays inside oral floor and never exits through the chin during dialogue',()=>{
  const scene=new Scene(softVocalFaceSceneSpec()),rig=new SoftVocalFaceRig(scene),score=physicalDialogueScoreA(),dt=1/240,duration=score.at(-1).endS;
  let minY=Infinity,maxZ=-Infinity,maxKinetic=0,maxPen=0;
  for(let t=0;t<=duration+1e-9;t+=dt){
    const sample=sampleArticulatorScore(score,Math.min(t,duration));
    const plan=sampleSoftMouthMotorPlan(score,Math.min(t,duration),SOFT_MOUTH_MOTOR_LEAD_S);
    const state=rig.step(sample.articulators,dt,plan).tongue;
    minY=Math.min(minY,state.minNodeY);maxZ=Math.max(maxZ,state.maxNodeZ);maxKinetic=Math.max(maxKinetic,state.kineticEnergyJ);maxPen=Math.max(maxPen,state.maxTrialPenetrationM);
    assert.equal(state.brokenConstraints,0,'tongue structural failure at t='+t.toFixed(4));
    assert.ok(Number.isFinite(state.tipPosition[1])&&Number.isFinite(state.tipPosition[2]));
  }
  assert.ok(minY>=1.215,'tongue escaped below floor of mouth into chin: '+minY);
  assert.ok(maxZ<.72,'tongue escaped through lips/front of face: '+maxZ);
  assert.ok(maxKinetic<2,'tongue became numerically explosive: '+maxKinetic);
  assert.ok(maxPen<.03,'tongue trial contact penetration too deep: '+maxPen);
  const rigid=scene.entities.get('vocal-face-tongue');
  assert.ok(rigid.scale[0]<.01,'legacy rigid tongue must stay hidden');
});
