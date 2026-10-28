import test from 'node:test';
import assert from 'node:assert/strict';
import {SolidBody,SolidWorld} from '../dist/physics/compound.js';

const sheet=()=>[{triangle:[[0,0,0],[.5,0,0],[0,.5,0]],half:[.25,.25,.0004],offset:[.25,.25,0],thickness:.0008,geometryNodes:[0,1,2]},{triangle:[[.5,0,0],[.5,.5,0],[0,.5,0]],half:[.25,.25,.0004],offset:[.25,.25,0],thickness:.0008,geometryNodes:[1,3,2]}];
function frozen(prism){for(const value of [prism,prism.triangle,...prism.triangle,prism.vertices,...prism.vertices,prism.normals,...prism.normals,prism.edgeDirections,...prism.edgeDirections,prism.planes,...prism.planes,...prism.planes.map(p=>p.n),prism.bounds,prism.center])assert.ok(Object.isFrozen(value));}
function withFreezeLog(run){const original=Object.freeze,prisms=[];Object.freeze=function(value){if(value?.triangle&&value?.vertices&&value?.halfThickness!==undefined)prisms.push(value);return original(value);};try{return run(prisms);}finally{Object.freeze=original;}}

test('private steps never freeze unexposed owned prisms; first public exposure freezes shared directions and old snapshots remain unchanged',()=>withFreezeLog(log=>{
 const world=new SolidWorld({gravity:[0,0,0]}),body=world.add(new SolidBody({p:[0,0,0],shapes:sheet(),mass:4}));body.v=[.1,0,0];try{world.step(1/120);world.step(1/120);assert.equal(log.length,0);const boxes=body.boxes(),old=boxes[0].triangle,saved=JSON.stringify(old);for(const box of boxes)frozen(box.triangle);assert.equal(log.length,2);
  world.step(1/120);assert.equal(log.length,2);const translated=body.boxes();assert.equal(translated[0].triangle.normals,old.normals);for(const box of translated)frozen(box.triangle);assert.equal(JSON.stringify(old),saved);assert.equal(log.length,4);
  body.shapes[1].triangle[1][2]=.02;world.step(1/120);assert.equal(log.length,4);const bent=body.boxes();for(const box of bent)frozen(box.triangle);assert.equal(JSON.stringify(old),saved);
 }finally{for(const b of [...world.bodies])world.remove(b);}
}));

test('terrain callback sees every frozen adjacency neighbour before reentrant public query and can retain all old geometry',()=>{
 const world=new SolidWorld({gravity:[0,0,0]}),body=world.add(new SolidBody({p:[0,0,0],shapes:sheet(),mass:4})),retained=[];body.v=[.05,0,0];let reads=0,calls=0;
 Object.defineProperty(world,'terrainContacts',{get(){reads++;return function(owner,boxes){assert.equal(this,world);assert.equal(owner,body);calls++;for(const box of boxes){frozen(box.triangle);for(const list of [...box.triangleAdjacency.edges,...box.triangleAdjacency.vertices])for(const prism of list)frozen(prism);}retained.push({prism:boxes[0].triangle,json:JSON.stringify(boxes[0].triangle)});assert.ok(world.ray([.1,.1,1],[0,0,-1],2));};}});
 try{for(let i=0;i<3;i++){world.step(1/120);body.shapes[1].triangle[1][2]+=.003;}assert.equal(reads,calls);assert.equal(calls,3);for(const old of retained){frozen(old.prism);assert.equal(JSON.stringify(old.prism),old.json);}}finally{for(const b of [...world.bodies])world.remove(b);}
});

test('custom public boxes retain their triangle getter contract at the terrain callback boundary',()=>{
 const world=new SolidWorld({gravity:[0,0,0]}),body=world.add(new SolidBody({p:[0,0,0],shapes:sheet(),mass:4})),builtin=body.boxes;let reads=0,calls=0;body.boxes=function(){return builtin.call(this).map(box=>{const prism=box.triangle;Object.defineProperty(box,'triangle',{get(){reads++;return prism;}});return box;});};world.terrainContacts=()=>{calls++;assert.equal(reads,0);};
 try{world.step(1/120);assert.equal(calls,1);}finally{for(const b of [...world.bodies])world.remove(b);}
});

test('public static/sleeping caches remain frozen while ray hits publish values without publishing the private prism',()=>withFreezeLog(log=>{
 const world=new SolidWorld({gravity:[0,0,0]}),fixed=world.add(new SolidBody({p:[3,0,0],shapes:sheet()})),moving=world.add(new SolidBody({p:[0,0,0],shapes:sheet(),mass:4}));try{for(const box of fixed.cachedBoxes)frozen(box.triangle);const start=log.length;moving.v=[.05,0,0];world.step(1/120);assert.equal(log.length,start);assert.ok(world.ray([.1,.1,1],[0,0,-1],2));assert.equal(log.length,start);for(const box of moving.boxes())frozen(box.triangle);assert.ok(log.length>start);
  const resting=world.add(new SolidBody({p:[8,.0004,0],half:[.3,.0004,.3],mass:4,shapes:[{triangle:[[-.3,0,-.3],[.3,0,-.3],[-.3,0,.3]],half:[.3,.0004,.3],offset:[0,0,0],thickness:.0008}]}));world.addPlane({p:[0,0,0],hu:20,hv:20});resting.sleepTime=2;world.step(1/120);assert.equal(resting.sleeping,true);for(const box of resting.sleepBoxes)frozen(box.triangle);
 }finally{for(const b of [...world.bodies])world.remove(b);}
}));

test('public and nested rounded-hit normals cannot corrupt a private cached prism or the next physical contact',()=>{
 function run(mutate){const world=new SolidWorld({gravity:[0,0,0]}),body=world.add(new SolidBody({p:[0,0,0],shapes:sheet(),mass:4})),probe=world.add(new SolidBody({p:[.12,.12,.008],half:[.015,.015,.015],mass:1}));try{const hit=world.sphereCast([.1,.1,1],[0,0,-1],2,.02,probe,raw=>{if(mutate){raw.n[0]=123;raw.n[1]=-456;const nested=world.sphereCast([.1,.1,1],[0,0,-1],2,.02,probe);assert.deepEqual(nested.n,[0,0,1]);nested.n[2]=-99;}return raw;});assert.ok(hit);if(mutate){hit.n[0]=999;const ray=world.ray([.1,.1,1],[0,0,-1],2,probe);ray.n[2]=222;}
   const boxes=body.boxes();for(const box of boxes){frozen(box.triangle);const normal=box.triangle.normals[0];assert.equal(Math.abs(normal[0]),0);assert.equal(Math.abs(normal[1]),0);assert.equal(normal[2],1);}probe.v=[0,0,-.1];world.step(1/120);return{body:{p:body.p,q:body.q,v:body.v,w:body.w},probe:{p:probe.p,q:probe.q,v:probe.v,w:probe.w},contacts:world.contacts.map(c=>({p:c.p,n:c.n,depth:c.depth,jn:c.jn}))};}finally{for(const b of [...world.bodies])world.remove(b);}}
 assert.deepEqual(run(true),run(false));
});

test('one-ulp material motion reuses immutable IDs while in-place ID edits own new independent copies',()=>{
 const source=sheet();source[0].structureNodes=[5,6,7];const body=new SolidBody({p:[0,0,0],shapes:source}),old=body.boxes()[0];source[0].triangle[1][0]+=Number.EPSILON/2;const moved=body.boxes()[0];assert.notEqual(moved.triangle,old.triangle);assert.equal(moved.structureNodes,old.structureNodes);assert.equal(moved.geometryNodes,old.geometryNodes);source[0].structureNodes[1]=77;source[0].geometryNodes[0]=8;const edited=body.boxes()[0];assert.notEqual(edited.structureNodes,old.structureNodes);assert.notEqual(edited.geometryNodes,old.geometryNodes);assert.deepEqual(old.structureNodes,[5,6,7]);assert.deepEqual(old.geometryNodes,[0,1,2]);assert.deepEqual(edited.structureNodes,[5,77,7]);assert.deepEqual(edited.geometryNodes,[8,1,2]);assert.ok(Object.isFrozen(edited.structureNodes));assert.ok(Object.isFrozen(edited.geometryNodes));
});

test('rounded vertex points are owned before a public refinement callback can mutate or retain them',()=>{
 const world=new SolidWorld({gravity:[0,0,0]}),body=world.add(new SolidBody({p:[0,0,0],shapes:sheet().slice(0,1),mass:4})),origin=[-.2,-.2,.5],direction=[0,0,-1];let retained;
 try{const first=world.sphereCast(origin,direction,1,.3,null,hit=>{retained=hit;assert.deepEqual(hit.p.slice(0,2),[0,0]);assert.ok(Math.abs(hit.p[2]-.0004)<1e-15);const time=hit.t;hit.p[0]=99;hit.n[1]=88;const nested=world.sphereCast(origin,direction,1,.3);assert.equal(nested.t,time);assert.deepEqual(nested.p.slice(0,2),[0,0]);return hit;});assert.equal(first,retained);const prism=body.boxes()[0].triangle;for(const p of prism.vertices)assert.ok(Math.abs(p[0])<1&&Math.abs(p[1])<1);frozen(prism);}
 finally{for(const b of [...world.bodies])world.remove(b);}
});
