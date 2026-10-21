import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene} from '../dist/scene/scene.js';

// Camera backdrop is a render projection; diffuse irradiation is independently
// authored, with no new physics or environment authority.
test('ambient irradiance and explicit background are validated scene descriptors',()=>{
  const spec={version:1,entities:[],seed:7,
    rendering:{skyColor:[0,0,0],backgroundColor:[0,0,0],
      ambientIrradiance:[.45,.45,.45]}};
  const scene=new Scene(spec);
  assert.deepEqual(scene.spec.rendering.backgroundColor,[0,0,0]);
  assert.deepEqual(scene.spec.rendering.ambientIrradiance,[.45,.45,.45]);
  assert.equal(scene.entities.size,0);
});

test('radiance and background reject malformed/negative vectors',()=>{
  for(const key of ['ambientIrradiance','backgroundColor']){
    assert.throws(()=>new Scene({
      version:1,entities:[],rendering:{[key]:[-1,0,0]}
    }),/rendering\./);
    assert.throws(()=>new Scene({
      version:1,entities:[],rendering:{[key]:[1,2]}
    }),/rendering\./);
  }
});
