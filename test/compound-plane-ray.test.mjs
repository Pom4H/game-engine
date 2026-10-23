import test from 'node:test';
import assert from 'node:assert/strict';
import {planeRayBefore,planeRayBeforeWorld} from './fixtures/compound-plane-ray-before.mjs';
const {SolidWorld,Qeuler,Qrotate}=await import(process.env.COMPOUND_RAY_SOURCE?'../src/physics/compound.ts':'../dist/physics/compound.js');
const unit=values=>{const length=Math.hypot(...values)||1;return values.map(value=>value/length);};
function compare(actual,expected,planes){
 assert.equal(!!actual,!!expected);
 if(!actual)return;
 assert.equal(actual.t,expected.t);assert.deepEqual(actual.p,expected.p);assert.equal(actual.n,expected.n);assert.equal(actual.body,null);assert.equal(actual.tag,expected.tag);assert.equal(actual.plane,expected.plane);
 assert.ok(planes.includes(actual.plane));assert.equal(actual.n,actual.plane.n);
}
test('plane rays match the frozen vector oracle exactly across random rotations, directions and finite bounds',()=>{
 let seed=0xdecafbad;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 const world=new SolidWorld(),planes=[];
 for(let index=0;index<80;index++){
  const q=Qeuler(random()*6-3,random()*1.5-.75,random()*1.5-.75);
  planes.push(world.addPlane({p:[random()*40-20,random()*8-4,random()*40-20],n:Qrotate(q,[0,1,0]),u:Qrotate(q,[1,0,0]),v:Qrotate(q,[0,0,1]),hu:random()*8+.1,hv:random()*8+.1,tag:'plane-'+index}));
 }
 for(let sample=0;sample<3000;sample++){
  const origin=[random()*50-25,random()*12+2,random()*50-25],direction=unit([random()*2-1,-random()-.01,random()*2-1]),maxDistance=random()*40+.01;
  compare(world.ray(origin,direction,maxDistance),planeRayBeforeWorld(world,origin,direction,maxDistance),planes);
 }
});

test('plane rays preserve exact t, facing thresholds, signed-zero coordinates, bounds margins and equal-distance ties',()=>{
 const world=new SolidWorld(),planes=[world.addPlane({p:[0,0,0],hu:1,hv:1,tag:'first'}),world.addPlane({p:[0,0,0],hu:1,hv:1,tag:'tie'})];world.candidates=()=>planes;
 const queries=[];
 for(const x of [-1.0010000000000001,-1.001,-1,-0,0,1,1.001,1.0010000000000001])for(const z of [-1.001,0,1.001])for(const max of [0,.9999999999999999,1,1.0000000000000002])queries.push([[x,1,z],[-0,-1,0],max]);
 for(const facing of [-1e-8,-1.0000000000000002e-8,-.9999999999999999e-8,0,1e-8])queries.push([[0,1,0],[0,facing,-0],2e8]);
 queries.push([[-0,0,-0],[-0,-1,-0],0],[[0,-1,0],[0,-1,0],2]);
 for(const query of queries)compare(world.ray(...query),planeRayBefore(planes,...query),planes);
 assert.equal(world.ray([0,1,0],[0,-1,0],1).plane,planes[0]);
});

test('filters receive fresh point arrays after bounds and retain mutable hit/normal/plane/tag identities',()=>{
 function run(reference){
  const world=new SolidWorld(),origin=[0,5,0],direction=[0,-1,0],calls=[],planes=[];
  planes.push(world.addPlane({p:[8,4,0],hu:.1,hv:.1,tag:'out-of-bounds',filter:p=>{throw Error('bounds must reject before filter');}}));
  planes.push(world.addPlane({p:[0,3,0],hu:10,hv:10,tag:'reject',filter:p=>{calls.push({tag:'reject',point:p,before:[...p]});origin[0]=2;direction[2]=.1;planes[2].p[1]=2.25;return false;}}));
  planes.push(world.addPlane({p:[0,2,0],hu:10,hv:10,tag:'accepted',filter:p=>{calls.push({tag:'accepted',point:p,before:[...p]});p[0]+=100;planes[2].n=[0,2,0];planes[2].tag='changed-by-filter';return true;}}));
  planes.push(world.addPlane({p:[0,1,0],hu:10,hv:10,tag:'behind-best',filter:p=>{throw Error('t cutoff must reject before filter');}}));
  world.candidates=()=>planes;
  const hit=reference?planeRayBefore(planes,origin,direction,10):world.ray(origin,direction,10);
  assert.equal(calls.length,2);assert.notEqual(calls[0].point,calls[1].point);assert.equal(hit.p,calls[1].point);assert.equal(hit.n,planes[2].n);assert.equal(hit.plane,planes[2]);assert.equal(hit.tag,'changed-by-filter');
  return{t:hit.t,p:hit.p,n:hit.n,tag:hit.tag,calls:calls.map(call=>({tag:call.tag,before:call.before,after:[...call.point]})),origin,direction};
 }
 assert.deepEqual(run(false),run(true));
 const world=new SolidWorld(),points=[],plane=world.addPlane({p:[0,0,0],hu:2,hv:2,filter:p=>{points.push(p);return true;}});
 const first=world.ray([0,1,0],[0,-1,0],2),second=world.ray([0,1,0],[0,-1,0],2);
 assert.notEqual(first.p,second.p);assert.equal(first.p,points[0]);assert.equal(second.p,points[1]);assert.equal(first.n,plane.n);assert.equal(second.n,plane.n);
});

test('rejecting filters can retain and mutate earlier accepted points without any ray cache',()=>{
 function run(reference){
  const world=new SolidWorld(),points=[],planes=[];
  planes.push(world.addPlane({p:[0,1,0],hu:3,hv:3,filter:p=>{points.push(p);return true;}}));
  planes.push(world.addPlane({p:[0,2,0],hu:3,hv:3,filter:p=>{points.push(p);points[0][0]=123;return false;}}));world.candidates=()=>planes;
  const hit=reference?planeRayBefore(planes,[0,5,0],[0,-1,0],10):world.ray([0,5,0],[0,-1,0],10);
  assert.equal(hit.p,points[0]);assert.notEqual(points[0],points[1]);assert.equal(hit.p[0],123);return{t:hit.t,p:hit.p,points};
 }
 assert.deepEqual(run(false),run(true));
});
