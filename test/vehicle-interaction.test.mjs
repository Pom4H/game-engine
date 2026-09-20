import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DoorHinge,ElasticPlasticPanelResponse,FourCornerSuspension,M3InteractionRig,
  StructuralBody,material,renderAudio,thermalLinearScale,
} from '../dist/index.js';

test('cold steel contracts the stress-free XPBD rest geometry without creating plastic work',()=>{
  const steel=material('steel').mechanical,body=new StructuralBody({
    nodes:[{position:[-2.4,0,0],mass:1},{position:[2.4,0,0],mass:1}],
    constraints:[{kind:'distance',a:0,b:1,areaM2:1e-3,material:steel}],
  });
  const scale=thermalLinearScale('steel',-15,20);
  assert.ok(Math.abs(scale-.9995765)<1e-10,scale);
  body.setThermalScale(scale);
  assert.equal(body.stats.mode,'dormant');
  const length=body.position[3]-body.position[0];
  assert.ok(Math.abs(length-4.8*scale)<1e-9,{length,scale});
  assert.equal(body.plasticWorkJ,0);
});

test('thin steel panel returns after sub-yield hand tap but retains a dent after enough energy',()=>{
  const panel=new ElasticPlasticPanelResponse(),point=[0,1,0],normal=[0,1,0];
  const light=panel.impact({point,normal,energyJ:2,radiusM:.18,thicknessM:.0008,material:'steel'});
  assert.equal(light.plasticEnergyJ,0);
  assert.equal(panel.maxPermanentDepthM,0);
  assert.ok(panel.maxElasticDepthM>0);
  for(let i=0;i<360;i++)panel.step(1/240);
  assert.ok(panel.maxElasticDepthM<1e-4,panel.maxElasticDepthM);
  const hard=panel.impact({point,normal,energyJ:160,radiusM:.22,thicknessM:.0008,material:'steel'});
  assert.ok(hard.plasticEnergyJ>0,hard);
  assert.ok(panel.maxPermanentDepthM>.0002,panel.maxPermanentDepthM);
});

test('glass hand tap remains elastic, finite at 120 Hz, and produces no plastic dent',()=>{
  const panel=new ElasticPlasticPanelResponse();
  const result=panel.impact({point:[0,1,0],normal:[0,0,1],energyJ:.7,radiusM:.08,thicknessM:.004,material:'glass'});
  assert.equal(result.plasticEnergyJ,0);
  assert.equal(panel.maxPermanentDepthM,0);
  for(let i=0;i<300;i++)panel.step(1/120);
  assert.ok(Number.isFinite(panel.maxElasticDepthM),panel.maxElasticDepthM);
  assert.ok(panel.maxElasticDepthM<1e-4,panel.maxElasticDepthM);
});

test('four-corner suspension rolls under alternating left/right hood loads and emits damper events',()=>{
  const suspension=new FourCornerSuspension(1700,2.837,1.574);
  let maxRoll=0;
  for(let tick=0;tick<180;tick++){
    const phase=Math.floor(tick/30)%2===0?-1:1;
    suspension.applyLoad([1.15,0,phase*.55],1_900);
    suspension.step(1/120);
    maxRoll=Math.max(maxRoll,Math.abs(suspension.pose.roll));
  }
  assert.ok(maxRoll>.002,{maxRoll});
  assert.ok(suspension.drainEvents().length>0);
});

test('door hinge distinguishes gentle latch from a hard slam',()=>{
  const gentle=new DoorHinge(),hard=new DoorHinge();
  for(let i=0;i<100;i++){gentle.drive(1.0,18);gentle.step(1/120);}
  for(let i=0;i<160;i++){gentle.drive(0,5);gentle.step(1/120);}
  const gentleEvents=gentle.drainEvents().filter(event=>event.mechanism==='door-latch');
  for(let i=0;i<100;i++){hard.drive(1.0,28);hard.step(1/120);}
  hard.addAngularImpulse(-18);
  for(let i=0;i<160;i++)hard.step(1/120);
  const hardEvents=hard.drainEvents().filter(event=>event.mechanism==='door-latch');
  assert.ok(hardEvents.length>0);
  assert.ok(hardEvents.at(-1).energy>(gentleEvents.at(-1)?.energy??0),{gentle:gentleEvents,hard:hardEvents});
});

test('M3 interaction rig combines thermal contraction, reversible flex, plastic dent and suspension motion',()=>{
  const rig=new M3InteractionRig();
  rig.setTemperatureC(-15);
  assert.ok(rig.state.thermalScale<1);
  const before=rig.state.panelPermanentDepthM;
  rig.impact({time:0,point:[1.2,.95,-.72],normal:[0,1,0],energyJ:2.5,radiusM:.18,thicknessM:.0008,effectiveMassKg:2});
  for(let i=0;i<240;i++)rig.step(1/240);
  assert.equal(rig.state.panelPermanentDepthM,before);
  rig.impact({time:1.1,point:[-.2,1.42,0],normal:[0,1,0],energyJ:180,radiusM:.24,thicknessM:.00075,effectiveMassKg:38});
  for(let i=0;i<100;i++){rig.applyBodyLoad([-.2,0,-.45],i%24<12?1_600:300);rig.step(1/120);}
  assert.ok(rig.state.panelPermanentDepthM>0,rig.state);
  assert.ok(Math.abs(rig.state.suspension.roll)>1e-5||Math.abs(rig.state.suspension.heave)>1e-5,rig.state.suspension);
  assert.ok(rig.shellPositions().every(Number.isFinite));
});

test('mechanism audio is deterministic and non-silent',()=>{
  const events=[
    {type:'mechanism',id:1,time:.1,point:[0,0,0],mechanism:'door-latch',energy:9,speed:1.8,size:1.1},
    {type:'mechanism',id:2,time:.5,point:[0,0,0],mechanism:'suspension',energy:2,speed:.18,size:.55},
  ];
  const a=renderAudio(events,1,16000),b=renderAudio(events,1,16000);
  assert.deepEqual(a.left,b.left);
  assert.ok(a.left.some(sample=>Math.abs(sample)>.001));
});
