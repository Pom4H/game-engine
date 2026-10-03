import test from 'node:test';
import assert from 'node:assert/strict';
import {AcousticWaveField,applyPressureLoad,material,StructuralBody} from '../dist/index.js';

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
