import test from 'node:test';
import assert from 'node:assert/strict';
import {StructuralBody} from '../dist/physics/structure.js';
import {StructuralSolidContactSolver} from '../dist/physics/structural-solid-contact.js';
import {SolidBody,SolidWorld,Qeuler} from '../dist/physics/compound.js';
const material={youngModulusPa:1e7,yieldStressPa:1e7,failureStrain:1,plasticity:0,brittle:false};

test('a hard static sample loads the coupled elastic body rather than crushing an isolated stiff material cell',()=>{
 const nodes=[];for(const x of [-.02,.02])for(const y of [-.02,.02])for(const z of [-.02,.02])nodes.push({position:[x,y,z],mass:1});const constraints=[];for(let a=0;a<nodes.length;a++)for(let b=a+1;b<nodes.length;b++)constraints.push({kind:'distance',a,b,areaM2:.0004,material:{youngModulusPa:190e9,yieldStressPa:350e6,failureStressPa:700e6,failureStrain:.35,plasticity:.8,brittle:false}});
 const body=new StructuralBody({nodes,constraints,projectiveDistances:true,plasticityMode:'stress',iterations:10,internalDamping:0,sleepDelay:10}),world=new SolidWorld(),plane=world.addPlane({p:[0,0,.03],n:[0,0,-1],u:[1,0,0],v:[0,1,0],hu:10,hv:10}),solver=new StructuralSolidContactSolver(nodes.length);body.wake();for(let i=0;i<nodes.length;i++)body.velocity[i*3+2]=2;const K=body.kineticEnergy();let calls=0;const original=body.positionGradientConstraint.bind(body);body.positionGradientConstraint=(...args)=>{calls++;return original(...args);};
 for(let tick=0;tick<4;tick++)body.step(1/120,[0,0,0],b=>solver.project(b,[],[plane]));
 assert.equal(calls,4,'only the four contacted front samples allocate rows, and reuse them across all four steps');assert.equal(body.broken.reduce((s,b)=>s+b,0),0);assert.ok(body.kineticEnergy()+body.plasticWorkJ<=K+1e-8);assert.ok(Math.max(...nodes.map((_,i)=>body.position[i*3+2]))<=.024+1e-8);
 assert.ok(Math.min(...constraints.map((_,i)=>body.distanceRestScale(i)))>.99,'a hard sample cannot flatten a40mm stiff cell');
});

test('a retained pipe hits an obstacle between its end masses and stops colliding on fracture',()=>{
 const b=new StructuralBody({nodes:[{position:[-1,0,0],mass:1},{position:[1,0,0],mass:1}],constraints:[{kind:'distance',a:0,b:1,areaM2:1e-5,material}]}),solver=new StructuralSolidContactSolver(0,[],[],[{a:0,b:1,radius:.03,constraint:0}]),box=new SolidBody({p:[0,0,0],half:[.06,.06,.06]}).boxes()[0];
 solver.project(b,[box],[]);assert.ok(Math.abs((b.position[0]+b.position[3])*.5)>=.096-1e-9);
 b.position.set([-1,0,0,1,0,0]);b.previous.set(b.position);b.broken[0]=1;solver.project(b,[box],[]);assert.deepEqual([...b.position],[-1,0,0,1,0,0]);
});

test('nodal swept contact cannot cross either face of a thin oriented wall, including a step starting on its face',()=>{
 for(const yaw of [0,.7])for(const sign of [-1,1]){
  const solid=new SolidBody({p:[0,0,0],q:Qeuler(yaw),half:[2,2,.05]}),box=solid.boxes()[0],normal=box.axes[2];
  const origin=normal.map(v=>v*-sign),b=new StructuralBody({nodes:[{position:origin,mass:1},{position:[origin[0],origin[1]+1,origin[2]],mass:1}],constraints:[{kind:'distance',a:0,b:1,areaM2:1e-5,material}],iterations:4,internalDamping:0,sleepDelay:10}),solver=new StructuralSolidContactSolver(2);
  b.wake();for(let i=0;i<2;i++)for(let k=0;k<3;k++)b.velocity[i*3+k]=normal[k]*sign*300;
  for(let i=0;i<4;i++){
   b.step(1/120,[0,0,0],body=>solver.project(body,[box],[]));
   const distance=b.position[0]*normal[0]+b.position[1]*normal[1]+b.position[2]*normal[2];
   assert.ok(distance*sign<=-.05599999,'crossed through wall');
  }
  assert.ok(b.kineticEnergy()<1e-12);
 }
});
test('a bound edge midpoint closes the gap between coarse body nodes against a pole',()=>{
 const b=new StructuralBody({nodes:[{position:[-1,0,0],mass:1},{position:[1,0,0],mass:1}],constraints:[{kind:'distance',a:0,b:1,areaM2:1e-5,material}],iterations:2,internalDamping:0}),solver=new StructuralSolidContactSolver(2,[{a:0,b:1}]);
 const box=new SolidBody({p:[0,0,0],half:[.1,.1,.1]}).boxes()[0];
 solver.project(b,[box],[]);
 assert.ok(Math.abs((b.position[0]+b.position[3])*.5)>=.106-1e-9);
});
test('broad-cell rejection retains oriented contact skin corners and refreshes moved solid bounds',()=>{
 const point=[Math.SQRT2*1.005,0,0],b=new StructuralBody({nodes:[{position:point,mass:1},{position:[0,10,0],mass:1}],constraints:[{kind:'distance',a:0,b:1,areaM2:1e-5,material}]}),solver=new StructuralSolidContactSolver(2);
 const box=new SolidBody({p:[20,0,0],q:Qeuler(Math.PI/4),half:[1,1,1]}).boxes()[0];
 solver.project(b,[box],[]);assert.deepEqual([...b.position.subarray(0,3)],point);
 box.p[0]=0;solver.project(b,[box],[]);
 assert.ok(b.position[0]>point[0],'rotated 6 mm contact skin corner was rejected');
});
test('an attached peripheral mass contacts the ground at its section radius, and a transferred mass stops projecting',()=>{
 const world=new SolidWorld(),floor=world.addPlane({p:[0,0,0],hu:10,hv:10});
 const b=new StructuralBody({nodes:[{position:[0,1,0],mass:10},{position:[0,-.08,0],mass:1}],constraints:[{kind:'distance',a:0,b:1,areaM2:1e-5,material}]});
 const solver=new StructuralSolidContactSolver(1,[],[{node:1,radius:.03}]);
 solver.project(b,[],[floor]);assert.ok(Math.abs(b.position[4]-.036)<1e-12);assert.equal(b.position[1],1);
 b.detachNode(1);b.position[4]=-.08;solver.project(b,[],[floor]);assert.equal(b.position[4],-.08);
});
test('peripheral sphere support retains swept contact with a rotated thin wall',()=>{
 const wall=new SolidBody({p:[0,0,0],q:Qeuler(.7),half:[2,2,.02]}).boxes()[0],n=wall.axes[2];
 const origin=n.map(x=>-x),b=new StructuralBody({nodes:[{position:origin,mass:1},{position:[origin[0],origin[1]+1,origin[2]],mass:1}],constraints:[{kind:'distance',a:0,b:1,areaM2:1e-5,material}],iterations:2,internalDamping:0}),solver=new StructuralSolidContactSolver(0,[],[{node:0,radius:.2},{node:1,radius:.2}]);
 b.wake();for(let node=0;node<2;node++)for(let k=0;k<3;k++)b.velocity[node*3+k]=n[k]*300;
 for(let step=0;step<4;step++){
  b.step(1/120,[0,0,0],core=>solver.project(core,[wall],[]));
  assert.ok(b.position[0]*n[0]+b.position[1]*n[1]+b.position[2]*n[2]<=-.226+1e-9);
 }
 assert.ok(b.kineticEnergy()<1e-12);
});
