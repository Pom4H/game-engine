import test from 'node:test';
import assert from 'node:assert/strict';
import {SolidBody,SolidWorld,Qeuler,Qrotate,intersectBoxes3,rayBox3} from '../dist/physics/compound.js';
import {castRoundedBox} from '../dist/physics/rounded-query.js';
import {oldMaterialBoxes} from './fixtures/world-triangle-before-local-cache.mjs';

const near=(a,b,t=1e-8)=>assert.ok(Math.abs(a-b)<=t,`${a} != ${b} (tolerance ${t})`);
const vector=(a,b,t=1e-8)=>{assert.equal(a.length,b.length);for(let k=0;k<a.length;k++)near(a[k],b[k],t);};
const face=(size=1)=>({half:[size,size,.001],offset:[size*.4,size*.4,0],triangle:[[0,0,0],[size*1.7,.03*size,0],[.1*size,size*1.5,.04*size]],thickness:Math.min(.0008,size*.03),structureNodes:[1,5,9]});
function compareHit(a,b,t=1e-8){assert.equal(!!a,!!b);if(a&&b){near(a.t,b.t,t);vector(a.p,b.p,t);vector(a.n,b.n,t);}}

test('cached local material prisms preserve predecessor SAT/ray/rounded queries through rotations, translations and shape edits',()=>{
 let state=31;const random=()=>((state=Math.imul(state,1664525)+1013904223>>>0)/4294967296);
 for(const size of [1,.002,.000002]){
  const shape=face(size),body=new SolidBody({shapes:[shape],mass:12});
  for(let sample=0;sample<80;sample++){
   body.p=[(random()-.5)*2000,(random()-.5)*2000,(random()-.5)*2000];body.q=Qeuler(random()*5,random()*5,random()*5);
   if(sample%8===0){shape.triangle[1][2]=(random()-.5)*size*.1;shape.thickness=Math.min(.0008,size*.03)*(1+random());shape.structureNodes[1]=sample+20;}
   const actual=body.boxes()[0],expected=oldMaterialBoxes(body)[0];assert.equal(!!actual.triangle,!!expected.triangle);assert.deepEqual(actual.structureNodes,expected.structureNodes);
   if(!actual.triangle)continue;for(let i=0;i<6;i++)vector(actual.triangle.vertices[i],expected.triangle.vertices[i]);vector(actual.bounds,expected.bounds);
   for(const point of [[.3,.3,1],[1.5,1.5,1],[-.1,-.1,1]]){
    const origin=body.point(point.map(v=>v*size)),direction=Qrotate(body.q,[0,0,-1]);compareHit(rayBox3(origin,direction,actual,size*3),rayBox3(origin,direction,expected,size*3));compareHit(castRoundedBox(origin,direction,size*3,size*.12,actual),castRoundedBox(origin,direction,size*3,size*.12,expected));
   }
   for(const local of [[.3,.3,.0001],[1.5,1.5,0]]){
    const obstacle=new SolidBody({p:body.point(local.map(v=>v*size)),q:body.q,half:[size*.04,size*.04,size*.04]}).boxes()[0],a=intersectBoxes3(actual,obstacle),b=intersectBoxes3(expected,obstacle);assert.equal(!!a,!!b);if(a&&b){near(a.depth,b.depth);vector(a.n,b.n);assert.equal(a.points.length,b.points.length);for(const p of a.points)assert.ok(b.points.some(q=>Math.hypot(...p.map((v,k)=>v-q[k]))<1e-7));}
   }
  }
 }
});

test('world material snapshots own support IDs and remain immutable across reentrant queries and in-place edits',()=>{
 const shape=face(),body=new SolidBody({p:[4,3,-2],shapes:[shape]}),world=new SolidWorld();world.add(body);
 const before=body.boxes()[0],saved=JSON.stringify(before.triangle),nodes=[...before.structureNodes],oldNormals=before.triangle.normals;
 body.p[0]+=1;const translated=body.boxes()[0];assert.equal(translated.triangle.normals,oldNormals);assert.notEqual(translated.triangle,before.triangle);assert.ok(Object.isFrozen(before.structureNodes));
 let nested=false;const origin=body.point([.3,.3,1]),direction=Qrotate(body.q,[0,0,-1]);
 const hit=world.ray(origin,direction,3,null,()=>{if(!nested){nested=true;body.q=Qeuler(.1,.2,.3);shape.structureNodes[1]=77;shape.triangle[0][1]=.1;world.ray(body.point([.3,.3,1]),Qrotate(body.q,[0,0,-1]),3);}return true;});assert.ok(hit);assert.equal(world.candidateState().depth,0);assert.equal(JSON.stringify(before.triangle),saved);assert.deepEqual(before.structureNodes,nodes);assert.deepEqual(body.boxes()[0].structureNodes,[1,77,9]);
 for(const value of [before.triangle,...before.triangle.triangle,...before.triangle.vertices,...before.triangle.normals,...before.triangle.edgeDirections,...before.triangle.planes,before.triangle.bounds,before.triangle.center])assert.ok(Object.isFrozen(value));
 shape.triangle[1].splice(0,3,...shape.triangle[0]);shape.triangle[2].splice(0,3,...shape.triangle[0]);assert.equal(body.boxes()[0].triangle,null);assert.equal(JSON.stringify(before.triangle),saved);
});

test('custom point transforms, unnormalized poses and world-space precision collapse retain the predecessor path',()=>{
 const shape=face(),body=new SolidBody({shapes:[shape]});body.q=[.2,.3,.4,1.7];const actual=body.boxes()[0].triangle,expected=oldMaterialBoxes(body)[0].triangle;assert.deepEqual(actual,expected);
 body.q=[0,0,0,1];body.p=[1e20,1e20,1e20];assert.equal(body.boxes()[0].triangle,null);assert.equal(oldMaterialBoxes(body)[0].triangle,null);
 body.p=[0,0,0];let shift=0;const builtin=body.point;body.point=p=>[p[0]+shift,p[1]*2,p[2]];const old=body.boxes()[0].triangle;shift=3;const next=body.boxes()[0].triangle;near(next.triangle[0][0]-old.triangle[0][0],3);assert.equal(old.triangle[0][0],0);assert.notEqual(next,old);body.point=builtin;const restored=body.boxes()[0].triangle;near(restored.triangle[0][0],0);near(restored.triangle[2][1],shape.triangle[2][1]);assert.notEqual(restored,next);
});

test('a real rotated sheet impact retains predecessor motion/contact work and cannot gain kinetic energy',()=>{
 function run(predecessor){const world=new SolidWorld({gravity:[0,0,0]}),q=Qeuler(.3,.4,.2),normal=Qrotate(q,[0,0,1]),fixed=world.add(new SolidBody({p:[0,0,0],q,shapes:[face()],mass:0,restitution:0,friction:0})),moving=world.add(new SolidBody({p:normal.map(n=>n*.3),q,shapes:[face()],mass:12,restitution:0,friction:0}));if(predecessor)for(const b of [fixed,moving])b.boxes=()=>oldMaterialBoxes(b);moving.v=normal.map(n=>-n*2);let maximumKineticJ=0,contacts=0;
  for(let i=0;i<180;i++){world.step(1/120);contacts+=world.contacts.length;const momentum=moving.angularMomentum(),energy=.5*moving.mass*moving.v.reduce((sum,v)=>sum+v*v,0)+.5*moving.w.reduce((sum,w,k)=>sum+w*momentum[k],0);maximumKineticJ=Math.max(maximumKineticJ,energy);}
  return{p:[...moving.p],q:[...moving.q],v:[...moving.v],w:[...moving.w],maximumKineticJ,contacts};
 }
 const before=run(true),after=run(false);assert.ok(after.contacts>0);assert.equal(after.contacts,before.contacts);near(after.maximumKineticJ,24);assert.ok(after.maximumKineticJ<=24+1e-9);for(const field of ['p','q','v','w'])vector(after[field],before[field],1e-9);
});
