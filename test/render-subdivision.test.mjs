import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSmoothSubdivisionPlan,smoothCoincidentNormals,subdivideSmoothTriangleMesh} from '../dist/vehicles/render-subdivision.js';

test('smooth duplicated source edge gets one canonical curved midpoint',()=>{
  const z0=Math.sqrt(1-.18*.18),z1=Math.sqrt(1-.18*.18-.08*.08);
  const mesh={
    kind:'triangle-mesh',
    // Two triangles share A-B geometrically but use duplicated imported vertices.
    // Endpoint normals bend in opposite X directions, so PN curvature is observable;
    // the duplicate triangle adds a small Y tilt to model imported normal drift.
    positions:[
      0,0,0, 1,0,0, 0,1,.25,
      1,0,0, 0,0,0, 0,-1,-.25,
    ],
    normals:[
      .18,0,z0, -.18,0,z0, 0,0,1,
      -.18,.08,z1, .18,.08,z1, 0,.08,Math.sqrt(1-.08*.08),
    ],
    indices:[0,1,2, 3,4,5],
  };
  const plan=buildSmoothSubdivisionPlan(mesh,35,.05);
  assert.equal(plan.smoothEdges[0][0],true);
  assert.equal(plan.smoothEdges[1][0],true);
  const refined=subdivideSmoothTriangleMesh(mesh,plan);
  const firstMidpoint=refined.positions.slice(3*3,3*4);
  const secondMidpoint=refined.positions.slice(9*3,10*3);
  const firstNormal=refined.normals.slice(3*3,3*4);
  const secondNormal=refined.normals.slice(9*3,10*3);
  assert.deepEqual(secondMidpoint,firstMidpoint,'a shared smooth edge must not split spatially when imported normals differ');
  assert.deepEqual(secondNormal,firstNormal,'a shared smooth edge must publish one canonical midpoint normal');
  assert.notDeepEqual(firstMidpoint,[.5,0,0],'the smooth edge should still receive PN curvature');
});

test('coincident smoothing is invariant to uneven triangle tessellation',()=>{
  const tilted=[0,.5,Math.sqrt(.75)];
  const mesh={
    kind:'triangle-mesh',
    positions:[
      0,0,0, 10,0,0, 0,10,0,
      0,0,0, .1,0,0, 0,.1,0,
    ],
    normals:[
      0,0,1, 0,0,1, 0,0,1,
      ...tilted, ...tilted, ...tilted,
    ],
    indices:[0,1,2, 3,4,5],
  };
  const smoothed=smoothCoincidentNormals(mesh,52);
  const a=smoothed.normals.slice(0,3),duplicate=smoothed.normals.slice(9,12);
  assert.deepEqual(duplicate,a,'coincident vertices in one smooth cluster must publish one normal');
  assert.ok(Math.abs(a[1])<.001,'tiny tessellation patches must not steer a large panel normal');
  assert.ok(a[2]>.999999,'large-area authored normal should dominate the coincident cluster');
});
