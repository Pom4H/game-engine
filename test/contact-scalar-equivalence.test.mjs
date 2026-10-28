import test from 'node:test';
import assert from 'node:assert/strict';
import {SolidBody,SolidWorld,Qeuler,Qrotate} from '../dist/physics/compound.js';
import {StructuralBody} from '../dist/physics/structure.js';
import {StructuralSolidContactSolver} from '../dist/physics/structural-solid-contact.js';
import {solveContact as beforeContact} from './fixtures/contact-before-scalar.mjs';
import {StructuralSolidContactSolver as BeforeProjection} from './fixtures/structural-contact-before-broad-bounds.mjs';
test('scalar contact impulses exactly retain the frozen normal/restitution/friction iterations',()=>{
 for(let i=0;i<200;i++){
  const run=before=>{const world=new SolidWorld(),a=new SolidBody({mass:100,half:[.6,.12,.9],q:Qeuler(i*.03,i*.05,i*.1)}),b=i%3?new SolidBody({p:[.2,1,.1],mass:75,q:Qeuler(-i*.03,.1,.2)}):null;a.v=[Math.sin(i)*10,-4,3];a.w=[.5,-.3,.2];if(b){b.v=[-.2,1,-3];b.w=[-.1,.4,.2];}const p=[.3,1.1,-.4],n=Qrotate(Qeuler(i*.05),[0,.8,.6]),c={a,b,p,n,depth:.02,tag:'test',kn:world.effective(a,b,p,n),jn:0,jt:[0,0,0],target:i%2?.5:0,mu:.1+(i%8)*.1,approach:4,projected:i%7===0};for(let k=0;k<10;k++)(before?beforeContact:world.solveContact).call(world,c);return[...a.v,...a.w,...(b?[...b.v,...b.w]:[]),c.jn,...c.jt];};assert.deepEqual(run(false),run(true));
 }
});
test('reused sample coordinates exactly retain swept projection across sequential boxes and planes',()=>{
 const definition={nodes:Array.from({length:32},(_,i)=>({position:[Math.sin(i)*2,Math.cos(i*.7)*1.5,Math.sin(i*.3)*2],mass:1})),constraints:[{kind:'distance',a:28,b:29,areaM2:.001,material:{youngModulusPa:1e6,yieldStressPa:1e5,failureStrain:1,plasticity:0}}]},a=new StructuralBody(definition),b=new StructuralBody(definition),edges=Array.from({length:23},(_,i)=>({a:i,b:i+1})),spheres=[{node:27,radius:.2}],sections=[{a:28,b:29,radius:.03,constraint:0}],current=new StructuralSolidContactSolver(24,edges,spheres,sections),before=new BeforeProjection(24,edges,spheres,sections),world=new SolidWorld();
 const boxes=Array.from({length:12},(_,i)=>new SolidBody({p:[Math.sin(i)*2,.2,Math.cos(i)*2],q:Qeuler(i*.3,i*.05,.1),half:[.2,.5,.35]}).boxes()[0]),planes=[world.addPlane({p:[0,-.4,0],hu:20,hv:20})];
 for(let tick=0;tick<50;tick++){for(const body of [a,b]){body.previous.set(body.position);for(let i=0;i<body.position.length;i++)body.position[i]+=Math.sin(i+tick)*.015;body.broken[0]=tick>25?1:0;}current.project(a,boxes,planes);before.project(b,boxes,planes);assert.deepEqual(a.position,b.position);}
});
