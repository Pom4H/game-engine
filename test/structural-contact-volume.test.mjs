import test from 'node:test';
import assert from 'node:assert/strict';
import {StructuralBody} from '../dist/physics/structure.js';
import {StructuralSolidContactSolver} from '../dist/physics/structural-solid-contact.js';
import {SolidBody,SolidWorld} from '../dist/physics/compound.js';

const bodyAt=(p)=>new StructuralBody({nodes:[{position:p,mass:20},{position:[0,3,0],mass:1}],constraints:[{kind:"distance",a:0,b:1,areaM2:.0001,material:{youngModulusPa:1e6,yieldStressPa:1e6,failureStressPa:2e6,failureStrain:2,plasticity:0,brittle:false}}]});
test('an oriented tyre volume uses radial and axial extent against the same road plane',()=>{
 const world=new SolidWorld(),plane=world.addPlane({p:[0,0,0]});
 for(const axis of [[1,0,0],[0,1,0],[Math.SQRT1_2,Math.SQRT1_2,0]]){
  const body=bodyAt([0,-.1,0]),support=n=>.34*Math.sqrt(Math.max(0,1-(n[0]*axis[0]+n[1]*axis[1]+n[2]*axis[2])**2))+.12*Math.abs(n[0]*axis[0]+n[1]*axis[1]+n[2]*axis[2]);
  new StructuralSolidContactSolver(0,[],[{node:0,radius:Math.hypot(.34,.12),support}]).project(body,[],[plane]);
  assert.ok(Math.abs(body.position[1]-support([0,1,0])-.006)<1e-10);
 }
});
test('an oriented tyre sweeps its sidewall through a thin wall without using the tread radius axially',()=>{
 const body=bodyAt([.4,0,0]);body.previous.set([-.6,0,0]);
 const wall=new SolidBody({p:[0,0,0],half:[.01,2,2],mass:0});
 new StructuralSolidContactSolver(0,[],[{node:0,radius:.37,support:n=>.34*Math.sqrt(1-n[0]**2)+.12*Math.abs(n[0])}]).project(body,wall.boxes(),[]);
 assert.ok(Math.abs(body.position[0]+.136)<1e-10);
});
test('a reduced corner has no second structural tyre contact until its ownership changes',()=>{
 const world=new SolidWorld(),plane=world.addPlane({p:[0,0,0]}),body=bodyAt([0,-.1,0]);let articulated=false;
 const solver=new StructuralSolidContactSolver(0,[],[{node:0,radius:.34,enabled:()=>articulated}]);
 solver.project(body,[],[plane]);assert.equal(body.position[1],-.1);articulated=true;solver.project(body,[],[plane]);assert.ok(Math.abs(body.position[1]-.346)<1e-10);
});

test('reduced support ownership keeps finite lateral tyre contact on both box and plane walls',()=>{
 for(const primitive of ['box','plane']){
  const world=new SolidWorld(),road=world.addPlane({p:[0,0,0]}),body=bodyAt([0,.3,-.3]);let articulated=false;
  const solver=new StructuralSolidContactSolver(0,[],[{node:0,radius:.34,normalEnabled:n=>articulated||n[1]<=.2}]);
  const wall=new SolidBody({p:[0,0,0],half:[2,2,.01],mass:0}),vertical=world.addPlane({p:[0,0,0],n:[0,0,-1],u:[1,0,0],v:[0,1,0]});
  solver.project(body,primitive==='box'?wall.boxes():[],primitive==='plane'?[road,vertical]:[road]);
  assert.ok(Math.abs(body.position[1]-.3)<1e-12,'the reduced tyre still owns road support');
  assert.ok(Math.abs(body.position[2]+(primitive==='box'?.356:.346))<1e-10,'the intact tyre meets the lateral wall');
  articulated=true;solver.project(body,[],[road]);assert.ok(Math.abs(body.position[1]-.346)<1e-10);
  assert.equal(body.totalMass,21);
 }
});

test('an upward box deck uses the same reduced support owner as a road plane',()=>{
 const body=bodyAt([0,.3,0]),deck=new SolidBody({p:[0,-.5,0],half:[2,.5,2],mass:0});let articulated=false;
 const solver=new StructuralSolidContactSolver(0,[],[{node:0,radius:.34,normalEnabled:n=>articulated||n[1]<=.2}]);
 solver.project(body,deck.boxes(),[]);assert.equal(body.position[1],.3);
 articulated=true;solver.project(body,deck.boxes(),[]);assert.ok(Math.abs(body.position[1]-.346)<1e-10);
});
