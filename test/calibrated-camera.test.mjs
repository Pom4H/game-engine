import test from 'node:test';
import assert from 'node:assert/strict';
import {cameraProjection} from '../dist/render/calibrated-camera.js';

test('calibrated intrinsics preserve principal point and focal geometry',()=>{
  const camera={position:[0,0,5],target:[0,0,0],intrinsics:{fx:500,fy:500,cx:600,cy:450,width:1000,height:1000}};
  const p=cameraProjection(camera,500,500);
  assert.equal(p.ray[0],1);assert.equal(p.ray[1],1);assert.ok(Math.abs(p.ray[2]-.2)<1e-12);assert.ok(Math.abs(p.ray[3]-.1)<1e-12);
  assert.ok(Math.abs(p.matrix[0]-1)<1e-7);
  assert.ok(Math.abs(p.matrix[5]-1)<1e-7);
  assert.ok(Math.abs(p.matrix[8]+.2)<1e-7);
  assert.ok(Math.abs(p.matrix[9]+.1)<1e-7);
});

test('calibrated camera rejects aspect drift',()=>{
  const camera={position:[0,0,5],target:[0,0,0],intrinsics:{fx:500,fy:500,cx:500,cy:500,width:1000,height:1000}};
  assert.throws(()=>cameraProjection(camera,640,360),/aspect/);
});

test('authored fov remains symmetric',()=>{
  const p=cameraProjection({position:[0,0,5],target:[0,0,0],fov:90},200,100);
  assert.ok(Math.abs(p.ray[0]-.5)<1e-7);
  assert.ok(Math.abs(p.ray[1]-1)<1e-7);
  assert.equal(p.ray[2],0);assert.equal(p.ray[3],0);
});
