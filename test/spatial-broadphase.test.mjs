import test from 'node:test';
import assert from 'node:assert/strict';
import {SpatialHash,SPATIAL_MAX_ITEM_CELLS,PhysicsWorld,RigidBody} from '../dist/index.js';

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

