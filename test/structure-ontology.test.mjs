import test from 'node:test';
import assert from 'node:assert/strict';
import {AdaptiveStructuralController,StructuralBody,material} from '../dist/index.js';

test('one structure preserves its reduced projection across representation changes',()=>{
  const steel=material('steel').mechanical;
  const structure=new StructuralBody({
    nodes:[
      {position:[-1,0,0],mass:1},
      {position:[1,0,0],mass:1},
    ],
    constraints:[{kind:'distance',a:0,b:1,areaM2:1e-3,material:steel}],
    sleepDelay:10,
  });
  const adaptive=new AdaptiveStructuralController(structure,2,{specificEnergyJkg:0,minimumEnergyJ:0});
  const reduced={
    mass:2,
    centerOfMass:[0,0,0],
    linearVelocity:[3,-1,.5],
    angularVelocity:[0,0,0],
  };

  assert.equal(adaptive.projection(),undefined);
  assert.equal(adaptive.activate(reduced,{point:[0,0,0],impulse:[0,0,0],normalEnergyJ:1}),true);
  assert.equal(adaptive.representation,'structural');

  const active=adaptive.projection();
  assert.equal(active.mass,2);
  assert.ok(Math.abs(active.linearVelocity[0]-3)<1e-12);
  assert.ok(Math.abs(active.linearVelocity[1]+1)<1e-12);
  assert.ok(Math.abs(active.linearVelocity[2]-.5)<1e-12);

  const baked=adaptive.bakeNow();
  assert.ok(baked);
  assert.equal(adaptive.representation,'reduced');
  assert.deepEqual(adaptive.projection(),{
    mass:baked.mass,
    centerOfMass:baked.centerOfMass,
    linearVelocity:baked.linearVelocity,
    angularVelocity:baked.angularVelocity,
  });
  assert.equal(baked.mass,2);
});

test('structural projection is immutable and derives from nodal state',()=>{
  const steel=material('steel').mechanical;
  const structure=new StructuralBody({
    nodes:[{position:[-1,0,0],mass:2},{position:[1,0,0],mass:2}],
    constraints:[{kind:'distance',a:0,b:1,areaM2:1e-3,material:steel}],
  });
  structure.activateFromRigid([0,0,0],[2,3,4],[0,0,0]);
  const projection=structure.projectReduced();
  assert.equal(projection.mass,4);
  assert.deepEqual(projection.centerOfMass,[0,0,0]);
  assert.deepEqual(projection.linearVelocity,[2,3,4]);
  assert.equal(Object.isFrozen(projection),true);
  assert.equal(Object.isFrozen(projection.linearVelocity),true);
});
