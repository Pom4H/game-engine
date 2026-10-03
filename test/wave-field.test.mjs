import test from 'node:test';
import assert from 'node:assert/strict';
import {AcousticWaveField,applyPressureLoad,material,StructuralBody,Scene,syncSceneAcousticBoundaries} from '../dist/index.js';

const field=(size=[9,3,3])=>new AcousticWaveField({
  size,
  cellSizeM:1,
  waveSpeedMps:1,
  densityKgM3:1,
});

test('acoustic wave has finite grid propagation speed',()=>{
  const wave=field();
  wave.addPressureCell(2,1,1,100);
  wave.step(.5);
  assert.ok(wave.pressureAt(wave.cellCenter(3,1,1))>0);
  assert.equal(wave.pressureAt(wave.cellCenter(4,1,1)),0);
});

test('hard acoustic wall prevents transmission',()=>{
  const wave=field([11,3,3]);
  for(let y=0;y<3;y++)for(let z=0;z<3;z++)wave.setSolidCell(5,y,z);
  wave.addPressureCell(2,1,1,100);
  for(let i=0;i<12;i++)wave.step(.5);
  assert.equal(wave.pressureAt(wave.cellCenter(7,1,1)),0);
});

test('blast injection is normalized by initial compression energy',()=>{
  const wave=new AcousticWaveField({
    size:[11,11,11],
    cellSizeM:.5,
    waveSpeedMps:343,
    densityKgM3:1.225,
  });
  const source=wave.injectBlast({position:[2.75,2.75,2.75],acousticEnergyJ:125,radiusM:1});
  assert.ok(source.affectedCells>1);
  assert.ok(source.peakPressurePa>0);
  assert.ok(Math.abs(wave.compressionEnergyJ()-125)<1e-9);
});

test('pressure patch converts Pa m2 s to structural impulse without a damage bar',()=>{
  const wave=field([5,3,3]);
  wave.addPressureCell(2,1,1,1000);
  const steel=material('steel').mechanical;
  const point=wave.cellCenter(2,1,1);
  const body=new StructuralBody({
    nodes:[
      {position:point,mass:1},
      {position:[point[0]-1,point[1],point[2]],mass:1},
    ],
    constraints:[{kind:'distance',a:0,b:1,areaM2:.001,material:steel}],
  });
  const load=applyPressureLoad(wave,body,{point,outwardNormal:[1,0,0],areaM2:.2,impulseRadiusM:.25},.01);
  assert.equal(load.pressurePa,1000);
  assert.equal(load.forceN[0],-200);
  assert.ok(Math.abs(load.forceN[1])<1e-12);
  assert.ok(Math.abs(load.forceN[2])<1e-12);
  assert.equal(load.impulseNs[0],-2);
  assert.ok(Math.abs(load.impulseNs[1])<1e-12);
  assert.ok(Math.abs(load.impulseNs[2])<1e-12);
  const momentum=body.linearMomentum();
  assert.ok(Math.abs(momentum[0]+2)<1e-12);
  assert.ok(Math.abs(momentum[1])<1e-12);
  assert.ok(Math.abs(momentum[2])<1e-12);
  assert.equal(body.mode,'active');
});

test('acoustic step exposes linear work and rejects unstable dt',()=>{
  const wave=field([8,6,4]);
  const stats=wave.step(.5);
  assert.equal(stats.pressureCells,8*6*4);
  assert.equal(stats.velocityFaces,7*6*4+8*5*4+8*6*3);
  assert.equal(stats.courant,.5);
  assert.throws(()=>wave.step(.58),/CFL/);
});


test('scene collision geometry becomes acoustic boundary and a rotated door opens propagation',()=>{
  const scene=new Scene({
    version:1,
    ground:-100,
    entities:[
      {id:'wall-a',position:[6,2.5,1],mesh:{kind:'box',size:[.2,5,2]},body:{mass:0}},
      {id:'wall-b',position:[6,2.5,5.5],mesh:{kind:'box',size:[.2,5,3]},body:{mass:0}},
      {id:'door',position:[6,2.5,3],mesh:{kind:'box',size:[.2,5,2]},body:{mass:0}},
    ],
  });
  const wave=new AcousticWaveField({size:[24,10,14],cellSizeM:.5,waveSpeedMps:10,densityKgM3:1});
  const closed=syncSceneAcousticBoundaries(wave,scene.entities.values());
  assert.equal(closed.bodyObstacles,3);
  wave.injectBlast({position:[3,2.5,3],acousticEnergyJ:1,radiusM:.7});
  for(let i=0;i<36;i++)wave.step(.025);
  assert.equal(wave.pressureAt([9,2.5,3]),0);

  wave.clearWaveState();
  scene.entities.get('door').rotation[1]=Math.PI/2;
  const opened=syncSceneAcousticBoundaries(wave,scene.entities.values());
  assert.equal(opened.bodyObstacles,3);
  wave.injectBlast({position:[3,2.5,3],acousticEnergyJ:1,radiusM:.7});
  let transmitted=0;
  for(let i=0;i<36;i++){wave.step(.025);transmitted=Math.max(transmitted,Math.abs(wave.pressureAt([9,2.5,3])));}
  assert.ok(transmitted>1e-6);
});

test('renderMesh never changes acoustic boundary ownership',()=>{
  const wave=new AcousticWaveField({size:[8,8,8],cellSizeM:.5,waveSpeedMps:1,densityKgM3:1});
  const sceneA=new Scene({version:1,ground:-100,entities:[{
    id:'wall',position:[2,2,2],mesh:{kind:'box',size:[1,2,3]},renderMesh:{kind:'sphere',radius:20},
  }]});
  const a=syncSceneAcousticBoundaries(wave,sceneA.entities.values()).solidCells;
  const sceneB=new Scene({version:1,ground:-100,entities:[{
    id:'wall',position:[2,2,2],mesh:{kind:'box',size:[1,2,3]},renderMesh:{kind:'sphere',radius:.1},
  }]});
  const b=syncSceneAcousticBoundaries(wave,sceneB.entities.values()).solidCells;
  assert.equal(a,b);
});
