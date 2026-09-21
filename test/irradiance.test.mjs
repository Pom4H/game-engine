import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDiffuseIrradianceSH,evaluateDiffuseIrradianceSH} from '../dist/render/irradiance.js';

test('diffuse irradiance SH integrates a constant environment to pi L',()=>{
  const radiance=[.25,.5,1];
  const sh=buildDiffuseIrradianceSH(()=>radiance,8192);
  assert.equal(sh[3],1);
  for(const normal of [[1,0,0],[0,1,0],[0,0,1],[-.577,.577,.577]]){
    const n=normal,scale=1/Math.hypot(...n),irr=evaluateDiffuseIrradianceSH(sh,[n[0]*scale,n[1]*scale,n[2]*scale]);
    for(let channel=0;channel<3;channel++)assert.ok(Math.abs(irr[channel]-Math.PI*radiance[channel])<.006,`channel ${channel}: ${irr[channel]}`);
  }
});

test('diffuse irradiance SH preserves directional asymmetry',()=>{
  const sh=buildDiffuseIrradianceSH(direction=>direction[1]>0?[2,1,.5]:[0,0,0],8192);
  const up=evaluateDiffuseIrradianceSH(sh,[0,1,0]),down=evaluateDiffuseIrradianceSH(sh,[0,-1,0]);
  assert.ok(up[0]>down[0]*8);
  assert.ok(up[1]>down[1]*8);
});
