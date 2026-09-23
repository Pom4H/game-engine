import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSmoothSubdivisionPlan,subdivideSmoothTriangleMesh} from '../dist/vehicles/render-subdivision.js';

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
