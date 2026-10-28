import test from 'node:test';
import assert from 'node:assert/strict';
import {SpatialHash,SPATIAL_MAX_ITEM_CELLS,SPATIAL_QUERY_CAPACITY,SPATIAL_QUERY_REFERENCES,PhysicsWorld,RigidBody} from '../dist/index.js';

test('bounded large members preserve row-major cell and insertion order for sequential contact solvers',()=>{
 const index=new SpatialHash(8,{cellOrder:true}),buckets=new Map(),members=Array.from({length:80},(_,i)=>({x:(i*37)%99-49,z:(i*53)%97-48,r:i%5===0?50:2}));
 const cell=n=>Math.floor(n/8),add=item=>{index.add(item,item.r);for(let x=cell(item.x-item.r);x<=cell(item.x+item.r);x++)for(let z=cell(item.z-item.r);z<=cell(item.z+item.r);z++){const key=x+','+z,list=buckets.get(key)??[];if(!buckets.has(key))buckets.set(key,list);list.push(item);}};
 for(const item of members)add(item);
 const compare=()=>{for(let x=-60;x<=60;x+=13)for(let z=-60;z<=60;z+=17){const seen=new Set(),r=7;for(let ix=cell(x-r);ix<=cell(x+r);ix++)for(let iz=cell(z-r);iz<=cell(z+r);iz++)for(const item of buckets.get(ix+','+iz)??[])seen.add(item);assert.deepEqual(index.near(x,z,r),[...seen]);assert.deepEqual(index.near(x,z,r),[...seen],'cached order stays identical');}};
 compare();const item=members[0];index.remove(item);for(const list of buckets.values()){const i=list.indexOf(item);if(i>=0)list.splice(i,1);}add(item);compare();assert.ok(index.diagnostics.oversizedItems>0);
});

test('large colliders stay visible across cells without occupying every bucket',()=>{
  const index=new SpatialHash(8),floor={x:0,z:0},box={x:2,z:3};
  index.add(floor,100);index.add(box,.5);
  assert.equal(index.diagnostics.oversizedItems,1);
  assert.ok(index.diagnostics.cells<SPATIAL_MAX_ITEM_CELLS);
  assert.deepEqual(new Set(index.near(2,3,1)),new Set([floor,box]));
  assert.deepEqual(new Set(index.near(-96,0,1)),new Set([floor]));
  assert.deepEqual(index.near(150,0,1),[]);
  index.near(0,0,12);index.near(0,0,12);
  floor.x=200;index.add(floor,100);
  assert.equal(index.near(0,0,12).includes(floor),false);
  assert.equal(index.near(200,0,1).includes(floor),true);
  assert.equal(index.remove(floor),true);
  assert.equal(index.near(200,0,1).includes(floor),false);
  index.clear();assert.equal(index.diagnostics.oversizedItems,0);
});

test('broad-phase candidates conservatively cover all overlapping cell rectangles',()=>{
  const index=new SpatialHash(8);
  const items=Array.from({length:90},(_,i)=>({x:(i*37)%241-120,z:(i*53)%237-120,r:i%7===0?94:i%5===0?17:.5}));
  const compare=()=>{
    for(let x=-144;x<=144;x+=13)for(let z=-144;z<=144;z+=19){
      const r=(Math.abs(x+z)%17)+.5;
      const cell=value=>Math.floor(value/8);
      const expected=items.filter(item=>
        cell(item.x-item.r)<=cell(x+r)&&cell(item.x+item.r)>=cell(x-r)&&
        cell(item.z-item.r)<=cell(z+r)&&cell(item.z+item.r)>=cell(z-r));
      assert.deepEqual(new Set(index.near(x,z,r)),new Set(expected));
    }
  };
  for(const item of items)index.add(item,item.r);
  compare();
  for(let i=1;i<items.length;i+=4){const item=items[i];item.x+=60;index.add(item,item.r)}
  compare();
});

test('a large static floor still supports a falling rigid body',()=>{
  const world=new PhysicsWorld([0,-9.81,0],-100,8);
  world.add(new RigidBody({id:'floor',position:[0,-.2,0],shape:{kind:'box',half:[80,.2,80]}}));
  const body=world.add(new RigidBody({id:'body',position:[2,1.5,3],mass:80,shape:{kind:'box',half:[.6,.5,.4]}}));
  let supported=false;
  for(let i=0;i<50;i++){world.step(1/60);supported ||=world.contacts.some(contact=>contact.a==='body'&&contact.b==='floor')}
  assert.equal(world.index.diagnostics.oversizedItems,1);
  assert.equal(supported,true);
  assert.ok(body.position[1]>=.5-1e-3);
});

test('a narrow query retains the original enclosing query order, including cache reuse and oversized members',()=>{
 const index=new SpatialHash(10,{cellOrder:true}),items=[{x:0,z:-9,r:10},{x:-9,z:0,r:10},{x:1,z:1,r:120}];
 for(let i=0;i<80;i++)items.push({x:(i%10)*13-60,z:Math.floor(i/10)*17-55,r:i%12+1});
 for(const item of items)index.add(item,item.r);
 const scratch=[];
 for(const [x,z,r]of [[1,1,0],[-7,11,2],[17,-24,6],[.1,.1,10]])for(const enclosing of [12,35,100]){
  const selected=new Set(index.near(x,z,r)),expected=index.near(x,z,enclosing).filter(item=>selected.has(item));
  for(let i=0;i<2;i++){assert.equal(index.near(x,z,r,scratch,enclosing),scratch);assert.deepEqual(scratch,expected);}
 }
 assert.throws(()=>index.near(0,0,10,undefined,1),/enclose/);
 assert.throws(()=>new SpatialHash(10).near(0,0,1,undefined,10),/cellOrder/);
});

test('repeated single-cell roof and wheel queries sort once per cell and enclosing order',()=>{
 const index=new SpatialHash(8,{cellOrder:true}),items=Array.from({length:64},(_,i)=>({x:4+(i%5)*.2,z:4+(i%7)*.2,r:i%9===0?80:2}));
 for(const item of items)index.add(item,item.r);
 const wide=index.near(4,4,50),selected=new Set(index.near(4,4,.5)),expected=wide.filter(item=>selected.has(item));
 const orderGet=index.orderBounds.get.bind(index.orderBounds);let comparisons=0;
 index.orderBounds.get=item=>{comparisons++;return orderGet(item);};
 const scratch=[];index.near(4,4,.5,scratch,50);const initialComparisons=comparisons;
 assert.ok(initialComparisons>0);assert.deepEqual(scratch,expected);
 const diagnostics=index.diagnostics;
 for(let n=0;n<512;n++){index.near(4+(n%3)*.01,4,.5,scratch,50);assert.deepEqual(scratch,expected);scratch.reverse();}
 assert.equal(comparisons,initialComparisons,'repeated rays in the same cell cannot repeat ordering work');
 assert.equal(index.diagnostics.cacheHits-diagnostics.cacheHits,512);
 const extra={x:4,z:4,r:1};index.add(extra,extra.r);assert.ok(index.near(4,4,.5,undefined,50).includes(extra));
 assert.ok(comparisons>initialComparisons,'a changed index invalidates the cached ray ordering');index.remove(extra);
 assert.deepEqual(index.near(4,4,.5,undefined,50),expected);
 for(let cell=0;cell<400;cell++)index.near(cell*8+4,4,.5,undefined,50);
 assert.ok(index.diagnostics.cachedQueries<=SPATIAL_QUERY_CAPACITY);assert.ok(index.diagnostics.cachedReferences<=SPATIAL_QUERY_REFERENCES);
});

test('single-cell oversized cache invalidates batched changes and keeps returned arrays independent',()=>{
 const index=new SpatialHash(8),large={x:4,z:4},small={x:4,z:4};index.add(large,80);index.add(small,.2);
 const expected=new Set([large,small]),first=index.near(4,4,.5);assert.deepEqual(new Set(first),expected);first.length=0;
 assert.deepEqual(new Set(index.near(4,4,.5)),expected);
 index.beginBatch();large.x=200;index.add(large,80);index.endBatch();assert.deepEqual(index.near(4,4,.5),[small]);
 index.clear();assert.deepEqual(index.near(4,4,.5),[]);
});

