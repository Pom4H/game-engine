import test from 'node:test';
import assert from 'node:assert/strict';
import {EFFECTS_SHADER} from '../dist/render/lighting.js';

test('effects pass contains bounded screen-space diffuse bounce',()=>{
  assert.match(EFFECTS_SHADER,/var indirect=vec3<f32>\(0\);var indirectWeight=0\.0/);
  assert.match(EFFECTS_SHADER,/let giWorldRadius=1\.15/);
  assert.match(EFFECTS_SHADER,/for\(var k=0;k<8;k\+\+\)/);
  assert.match(EFFECTS_SHADER,/radiance=min\(textureLoad\(hdr,q,0\)\.rgb,vec3<f32>\(4\.0\)\)/);
  assert.match(EFFECTS_SHADER,/color\+=gi\*\(\.035\+\.055\*smoothstep\(\.22,\.88,rough\)\)/);
});
