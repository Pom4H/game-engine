import test from 'node:test';
import assert from 'node:assert/strict';
import {SolidBody,SolidWorld,Qeuler,intersectBoxes3,rayBox3,solidInside} from '../dist/physics/compound.js';
import {castRoundedBox} from '../dist/physics/rounded-query.js';
import {trianglePrism,closestTrianglePoint,closestPrismPoint,castRoundedTrianglePrism} from '../dist/physics/triangle-prism.js';
import {StructuralBody} from '../dist/physics/structure.js';
import {StructuralSolidContactSolver} from '../dist/physics/structural-solid-contact.js';
const surface=()=>({half:[1,1,.01],offset:[1,1,0],triangle:[[0,0,0],[2,0,0],[0,2,0]],thickness:.0008,structureNodes:[0,1,2]});
const near=(a,b,t=1e-9)=>assert.ok(Math.abs(a-b)<=t,`${a} != ${b}`);

test('material bounds do not become a filled AABB in SAT, ray, sphere or occupancy',()=>{
 const shape=surface(),body=new SolidBody({p:[0,0,0],mass:10,shapes:[shape]}),box=body.boxes()[0],ghost=new SolidBody({p:[1.8,1.8,0],half:[.05,.05,.05]}).boxes()[0];
 assert.equal(intersectBoxes3(box,ghost),null);assert.equal(intersectBoxes3(ghost,box),null);assert.equal(solidInside([1.8,1.8,0],box),false);
 assert.equal(rayBox3([1.8,1.8,1],[0,0,-1],box,2),null);assert.equal(castRoundedBox([1.8,1.8,1],[0,0,-1],2,.2,box),null);
 const world=new SolidWorld();world.add(body);assert.equal(world.overlapsBox([1.8,1.8,0],[.05,.05,.05]),false);
 const hit=rayBox3([.4,.5,1],[0,0,-1],box,2);near(hit.t,.9996);assert.deepEqual(hit.n,[0,0,1]);
 const sphere=castRoundedBox([.4,.5,1],[0,0,-1],2,.1,box);near(sphere.t,.8996);near(sphere.p[2],.0004);
 const solid=new SolidBody({p:[.4,.5,.0002],half:[.05,.05,.05]}).boxes()[0],contact=intersectBoxes3(box,solid);assert.ok(contact&&contact.depth>0);assert.ok(contact.points.every(p=>closestPrismPoint(p,box.triangle).distance<=1e-9));
});

test('rounded prism edge and vertex features are finite and Euclidean, including tiny material patches',()=>{
 for(const size of [2,.002,.000002]){
  const prism=trianglePrism([[0,0,0],[size,0,0],[0,size,0]],size/2500),radius=size*.05;
  // Past the diagonal edge: the sphere touches its actual rounded feature.
  const o=[size*.55,size*.55,size],edgeOffset=size*.1/Math.SQRT2,normalZ=Math.sqrt(radius*radius-edgeOffset*edgeOffset);
  assert.equal(castRoundedTrianglePrism(o,[0,0,-1],size*2,radius,prism),null);
  const p=[size*.515,size*.515,size],d=size*.03/Math.SQRT2,hit=castRoundedTrianglePrism(p,[0,0,-1],size*2,radius,prism);
  assert.ok(hit);near(hit.t,size-prism.halfThickness-Math.sqrt(radius*radius-d*d),size*1e-7);near(hit.p[0]+hit.p[1],size,size*1e-7);assert.ok(hit.n[0]>0&&hit.n[1]>0&&hit.n[2]>0);
  // AABB-expanded corner would report a hit, but the rounded corner is farther.
  assert.equal(castRoundedTrianglePrism([-radius*.9,-radius*.9,size],[0,0,-1],size*2,radius,prism),null);
  const corner=castRoundedTrianglePrism([-radius*.5,-radius*.5,size],[0,0,-1],size*2,radius,prism);assert.ok(corner);near(corner.t,size-prism.halfThickness-radius/Math.SQRT2,size*1e-7);
 }
});

test('triangle/prism SAT respects rotated frames, surface overlap and retired degenerate faces',()=>{
 for(const q of [[0,0,0,1],Qeuler(.6,.4,-.2)]){
  const a=new SolidBody({p:[4,3,-2],q,shapes:[surface()]}),inside=a.point([.4,.6,0]),outside=a.point([1.8,1.8,0]),box=a.boxes()[0];
  assert.ok(intersectBoxes3(box,new SolidBody({p:inside,half:[.02,.02,.02]}).boxes()[0]));
  assert.equal(intersectBoxes3(box,new SolidBody({p:outside,half:[.02,.02,.02]}).boxes()[0]),null);
  const b=new SolidBody({p:a.point([.1,.1,.0002]),q,shapes:[surface()]}).boxes()[0],contact=intersectBoxes3(box,b);assert.ok(contact&&contact.depth>0&&contact.points.length<=4);
 }
 const s=surface();s.triangle=[[0,0,0],[0,0,0],[0,0,0]];const box=new SolidBody({shapes:[s]}).boxes()[0];assert.equal(box.triangle,null);assert.equal(intersectBoxes3(box,new SolidBody({half:[10,10,10]}).boxes()[0]),null);assert.equal(rayBox3([1,1,1],[0,0,-1],box,2),null);assert.equal(castRoundedBox([1,1,1],[0,0,-1],2,1,box),null);
});

test('query cache follows in-place material coordinates, thickness and contact node ownership',()=>{
 const world=new SolidWorld(),shape=surface(),body=world.add(new SolidBody({p:[0,0,0],mass:1,shapes:[shape]})),query=()=>world.ray([.4,.5,1],[0,0,-1],3);
 const first=body.boxes()[0],second=body.boxes()[0];assert.notEqual(first,second);assert.equal(first.triangle,second.triangle);assert.ok(Object.isFrozen(first.triangle.vertices[0]));
 near(query().t,.9996);const old=world.rayBoxCache.get(body).boxes;query();assert.equal(world.rayBoxCache.get(body).boxes,old);
 for(const p of shape.triangle)p[2]=.2;near(query().t,.7996);assert.notEqual(world.rayBoxCache.get(body).boxes,old);
 shape.thickness=.02;near(query().t,.79);shape.structureNodes[1]=23;query();assert.equal(world.rayBoxCache.get(body).boxes[0].structureNodes[1],23);
 for(const p of shape.triangle)p[0]+=4;assert.equal(query(),null);
});

test('a swept node hits both true sheet faces but a corner in the old filled cell remains free',()=>{
 const box=new SolidBody({p:[0,0,0],shapes:[surface()]}).boxes()[0],make=p=>new StructuralBody({nodes:[{position:p,mass:1},{position:[10,10,10],mass:1}],constraints:[{kind:'distance',a:0,b:1,areaM2:.0001,material:{youngModulusPa:1e7,yieldStressPa:1e7,failureStrain:1,plasticity:0,brittle:false}}]}),solver=new StructuralSolidContactSolver(1);
 for(const side of [-1,1]){
  const b=make([.4,.5,side]);b.previous.set(b.position);b.position[2]=-side;solver.project(b,[box],[]);near(b.position[2],side*.0064);
 }
 const free=make([1.8,1.8,1]);free.previous.set(free.position);free.position[2]=-1;solver.project(free,[box],[]);assert.deepEqual([...free.position.subarray(0,3)],[1.8,1.8,-1]);
 const sphereSolver=new StructuralSolidContactSolver(0,[],[{node:0,radius:.1}]),sphere=make([.4,.5,1]);sphere.previous.set(sphere.position);sphere.position[2]=-.5;sphereSolver.project(sphere,[box],[]);near(sphere.position[2],.1064);
});

test('a shared material corner has one plane reaction across both faces and adjacent triangles',()=>{
 const world=new SolidWorld({gravity:[0,0,0]}),first=surface(),second={...surface(),triangle:[[2,0,0],[2,2,0],[0,2,0]],structureNodes:[1,3,2]},body=world.add(new SolidBody({p:[0,0,0],mass:4,shapes:[first,second]})),bindings=[];
 body.deformable={active:false,bindMaterialContact:(point,nodes,weights)=>bindings.push({point,nodes,weights})};
 world.addPlane({p:[0,0,-.0002],n:[0,0,1],u:[1,0,0],v:[0,1,0],hu:5,hv:5});world.step(1/120);
 assert.equal(world.contacts.length,4);assert.equal(bindings.length,12);assert.ok(world.contacts.every(c=>c.materialA&&c.materialA.weights.some(w=>w===1)));assert.ok(world.contacts.every(c=>Math.abs(c.depth-.0002)<1e-12));
});

test('contact material barycentrics survive dynamic manifold and copied positional anchor keys',()=>{
 const world=new SolidWorld({gravity:[0,0,0],iterations:2}),all=[];
 function patch(z){
  const shape=surface(),body=world.add(new SolidBody({p:[0,0,z],mass:3,half:[2,2,.01],shapes:[shape]})),points=shape.triangle.map(p=>body.point(p)),bindings=new WeakMap(),calls=[];
  const weights=p=>{const b=bindings.get(p);assert.ok(b,'contact point lost its exact material binding');return b;},velocity=[0,0,0];
  const deformable={active:true,solverIterations:2,pointVelocity:()=>[...velocity],pointVelocityInto:(_p,out)=>{out.set?.(velocity);for(let i=0;i<3;i++)out[i]=velocity[i];},inverseEffectiveMass:(p)=>weights(p).reduce((s,w)=>s+w*w,0),impulse:()=>{},force:()=>{},torque:()=>{},advance:()=>{},beginAdvance:()=>{},projectAdvance:()=>{},endAdvance:()=>{},
   bindMaterialContact:(p,ids,w)=>{assert.deepEqual(ids,[0,1,2]);near(w.reduce((s,n)=>s+n,0),1);bindings.set(p,[...w]);calls.push({p,ids:[...ids],weights:[...w]});},
   positionAnchor:p=>{const w=weights(p);return{point:out=>{for(let k=0;k<3;k++)out[k]=points.reduce((s,p,i)=>s+p[k]*w[i],0);},inverseMass:()=>w.reduce((s,w)=>s+w*w,0),displace:(n,l)=>points.forEach((p,i)=>p.forEach((_,k)=>p[k]+=n[k]*l*w[i]))};}
  };body.deformable=deformable;all.push({points,calls});return body;
 }
 patch(0);patch(.0003);world.step(1/120);assert.ok(world.contacts.length>0);assert.ok(world.contacts.every(c=>c.materialA&&c.materialB&&c.projected));
 assert.ok(all.every(p=>p.calls.length>world.contacts.length),'the separate positional sample keys were rebound');
 const averageZ=p=>p.points.reduce((s,p)=>s+p[2]/3,0);assert.ok(averageZ(all[1])-averageZ(all[0])>=.0008-1e-8,'actual mid-surface separation lost the sheet thickness');
 for(const p of all)for(const call of p.calls)assert.ok(call.weights.every(w=>w>=0&&w<=1));
});

test('pre-prediction static refinement ignores repeated gravity support but retains a new real approach',()=>{
 const world=new SolidWorld(),body=world.add(new SolidBody({p:[0,.106,0],mass:1,half:[.1,.1,.1],restitution:0})),refinements=[];body.deformable={active:false,refineStaticsBeforePrediction:true};body.contactRefinement=(_p,_n,speed,dt)=>refinements.push({speed,dt});world.addPlane({p:[0,0,0],hu:5,hv:5});
 for(let tick=0;tick<240;tick++)world.step(1/120);
 assert.ok(refinements.every(r=>r.speed<.05),'a support gravity increment must not become a new material impact');assert.ok(body.sleeping);body.impulse([0,-1,0],body.p);world.step(1/120);assert.ok(refinements.some(r=>r.speed>.9),'a real post-sleep impact must still refine before prediction');
});
