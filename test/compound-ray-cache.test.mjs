import test from 'node:test';
import assert from 'node:assert/strict';
import {SolidWorld,SolidBody,Qeuler} from '../dist/physics/compound.js';

const signature=hit=>hit?{t:hit.t,p:hit.p,n:hit.n,body:hit.body,tag:hit.tag,plane:hit.plane?{p:hit.plane.p,n:hit.plane.n,tag:hit.plane.tag}:undefined}:null;
function fixture(){
 const cached=new SolidWorld(),uncached=new SolidWorld();uncached.rayBoxes=body=>body.boxes();
 const body=new SolidBody({mass:12,p:[.4,2,.3],q:Qeuler(.3,.1,-.2),half:[2,2,2],tag:'chassis',shapes:[{half:[.7,.4,1.2],offset:[0,0,0]},{half:[.4,.3,.6],offset:[1,.4,0],q:Qeuler(.2),tag:'door',structureNode:3}]});
 for(const world of [cached,uncached]){world.add(body);world.addPlane({p:[0,-3,0],hu:20,hv:20,tag:'floor'});}
 const rays=[];for(let x=-3;x<=3;x+=.6)for(let z=-2;z<=2;z+=.5)rays.push([[x,10,z],[0,-1,0],30]);
 for(let y=0;y<=4;y+=.5)rays.push([[-10,y,0],[1,0,0],30],[[0,y,10],[0,0,-1],30]);
 const compare=()=>{for(const ray of rays)assert.deepEqual(signature(cached.ray(...ray)),signature(uncached.ray(...ray)));};
 return{cached,uncached,body,compare};
}

test('cached compound ray geometry stays exact through direct pose, shape and metadata mutations',()=>{
 const {cached,body,compare}=fixture();compare();
 const changes=[
  ()=>{body.p[0]+=.3;},()=>{body.p=[-.3,1.6,.4];},()=>{body.q[1]+=.02;},()=>{body.q=Qeuler(-.3,.2,.1);},
  ()=>{body.shapes[0].half[0]+=.25;},()=>{body.shapes[1].offset[0]-=.3;},()=>{body.shapes[1].q[1]+=.05;},
  ()=>{body.shapes[0].offset=[.1,.2,-.2];},()=>{body.shapes[0].q=Qeuler(.7);},()=>{delete body.shapes[0].offset;},()=>{delete body.shapes[0].q;},
  ()=>{body.tag='loaded-chassis';},()=>{body.shapes[1].tag='loaded-door';},()=>{body.shapes[1].structureNode=7;body.shapes[1].structureBeam=5;},
  ()=>{body.shapes[1]={...body.shapes[1]};},()=>{body.shapes=[...body.shapes];},()=>{body.shapes.push({half:[.4,.4,.4],offset:[-.9,0,0],tag:'cargo'});},
  ()=>{body.shapes.reverse();},()=>{body.shapes.pop();},()=>{body.half[0]+=.1;},
 ];
 for(const mutate of changes){const before=cached.rayBoxCache.get(body).boxes;mutate();compare();assert.notEqual(cached.rayBoxCache.get(body).boxes,before,'each geometry cause must refresh the ray projection');}
 const door=cached.rayBoxCache.get(body).boxes.find(box=>box.tag==='loaded-door');assert.equal(door.structureNode,7);assert.equal(door.structureBeam,5);
});

test('shape-array replacement cannot leave cached geometry linked to an obsolete half vector',()=>{
 const {cached,body,compare}=fixture();compare();const oldHalf=body.shapes[0].half;
 body.shapes[0].half=[...oldHalf];compare();oldHalf[0]=20;compare();
 assert.equal(cached.rayBoxCache.get(body).boxes[0].half,body.shapes[0].half);
});

test('unchanged awake and sleeping bodies build query geometry once across many wheel rays',()=>{
 const world=new SolidWorld(),bodies=[];
 for(let i=0;i<64;i++)bodies.push(world.add(new SolidBody({mass:1,p:[i%8,2,Math.floor(i/8)],half:[3,2,3],shapes:Array.from({length:8},(_,n)=>({half:[.1,.2,.1],offset:[n*.1,0,0]}))})));
 world.ray([0,10,0],[0,-1,0],100);const initial=bodies.map(body=>world.rayBoxCache.get(body).boxes);
 for(let n=0;n<200;n++){for(const body of bodies)body.sleeping=!!(n%2);world.ray([n%8,10,(n*3)%8],[0,-1,0],100);}
 bodies.forEach((body,i)=>assert.equal(world.rayBoxCache.get(body).boxes,initial[i]));
 bodies[17].p[0]+=.25;world.ray([1,10,2],[0,-1,0],100);
 bodies.forEach((body,i)=>assert.equal(world.rayBoxCache.get(body).boxes===initial[i],i!==17));
 assert.ok(world.rayBoxCache instanceof WeakMap,'cache lifetime follows live physical bodies');
});

test('public geometry and ray results remain fresh and custom builders remain observable',()=>{
 const {cached,body,compare}=fixture();compare();const cachedBoxes=cached.rayBoxCache.get(body).boxes,publicBoxes=body.boxes();
 assert.notEqual(publicBoxes,body.boxes());assert.notEqual(publicBoxes,cachedBoxes);publicBoxes[0].p[0]=900;publicBoxes[0].axes[0][0]=900;compare();
 const hit=cached.ray([.4,10,.3],[0,-1,0],30);hit.p[0]=900;hit.n[0]=900;compare();assert.equal(cached.rayBoxCache.get(body).boxes,cachedBoxes);
 let builds=0;const original=body.boxes;body.boxes=function(){builds++;return original.call(this);};cached.ray([.4,10,.3],[0,-1,0],30);cached.ray([.4,10,.3],[0,-1,0],30);assert.equal(builds,2);
 body.boxes=original;const point=body.point;let shift=.2;body.point=function(p){const result=point.call(this,p);result[0]+=shift;return result;};compare();shift=-.3;compare();
});
