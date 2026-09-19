import test from 'node:test';
import assert from 'node:assert/strict';
import {EFFECTS_SHADER} from '../dist/render/lighting.js';

test('effects pass contains stochastic bounded screen-space diffuse bounce',()=>{
  assert.match(EFFECTS_SHADER,/var occlusion=0\.0;var indirect=vec3<f32>\(0\)/);
  assert.match(EFFECTS_SHADER,/for\(var k=0;k<12;k\+\+\)/);
  assert.match(EFFECTS_SHADER,/radiusM=mix\(\.10,1\.35,sqrt\(u\)\)/);
  assert.match(EFFECTS_SHADER,/f32\(k\)\*\.61803398875\+seed/);
  assert.match(EFFECTS_SHADER,/radiance=min\(textureLoad\(hdr,q,0\)\.rgb,vec3<f32>\(6\.0\)\)/);
  assert.match(EFFECTS_SHADER,/let gi=indirect\/12\.0/);
  assert.doesNotMatch(EFFECTS_SHADER,/indirect\/indirectWeight/);
});
