import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VisibilityInterest,geometricHorizonDistance,InfiniteWorld,
  worldTileBounds
} from '../dist/index.js';

const observer=(height,extra={})=>({
  position:[0,height,0],
  forward:[0,0,1],
  groundY:0,
  verticalFovDeg:55,
  aspect:16/9,
  ...extra,
});

const isAncestor=(coarse,fine)=>{
  if(coarse.lod<=fine.lod)return false;
  const scale=2**(coarse.lod-fine.lod);
  return Math.floor(fine.x/scale)===coarse.x&&Math.floor(fine.z/scale)===coarse.z;
};

test('altitude expands the render horizon while keeping the tile plan bounded',()=>{
  const visibility=new VisibilityInterest();
  const ground=visibility.plan(observer(2));
  const aircraft=visibility.plan(observer(1000));
  assert.ok(ground.horizonDistanceM>4_900&&ground.horizonDistanceM<5_200,ground);
  assert.ok(aircraft.horizonDistanceM>112_000&&aircraft.horizonDistanceM<114_000,aircraft);
  assert.ok(aircraft.horizonDistanceM>ground.horizonDistanceM*20);
  assert.ok(aircraft.demands.length<700,aircraft.demands.length);
  assert.ok(aircraft.demands.some(tile=>tile.id.lod>=7),'far horizon should use coarse hierarchical tiles');
  assert.ok(aircraft.demands.some(tile=>tile.id.lod===0),'near world must remain full detail');
});

test('visibility quadtree has no ancestor/descendant overlap',()=>{
  const plan=new VisibilityInterest().plan(observer(2000));
  for(let i=0;i<plan.demands.length;i++)for(let j=i+1;j<plan.demands.length;j++){
    const a=plan.demands[i].id,b=plan.demands[j].id;
    assert.equal(isAncestor(a,b)||isAncestor(b,a),false,plan.demands[i].key+' overlaps '+plan.demands[j].key);
  }
});

test('far visibility follows camera cone while safety tiles remain around the observer',()=>{
  const plan=new VisibilityInterest().plan(observer(1000));
  let farAhead=0,farBehind=0,nearBehind=0;
  for(const tile of plan.demands){
    const b=worldTileBounds(128,tile.id),cz=(b.minZ+b.maxZ)/2;
    if(tile.distanceM>10_000&&cz>0)farAhead++;
    if(tile.distanceM>10_000&&cz<0)farBehind++;
    if(tile.distanceM<384&&cz<0)nearBehind++;
  }
  assert.ok(farAhead>0);
  assert.equal(farBehind,0,'far tiles behind the camera should not be streamed');
  assert.ok(nearBehind>0,'the local safety ring must survive camera direction');
});

test('weather caps visible distance and velocity adds bounded lookahead',()=>{
  const visibility=new VisibilityInterest();
  const fog=visibility.plan(observer(2000,{atmosphericVisibilityM:3_000}));
  assert.equal(fog.horizonDistanceM,3_000);
  const moving=visibility.plan(observer(2,{velocity:[0,0,80]}));
  const still=visibility.plan(observer(2));
  assert.ok(moving.planningDistanceM>still.planningDistanceM);
  assert.ok(moving.planningDistanceM<=visibility.config.maxDistanceM);
});

test('earthlike horizon helper matches kilometre-scale flight geometry',()=>{
  const distance=geometricHorizonDistance(1000);
  assert.ok(distance>112_000&&distance<114_000,distance);
});

test('InfiniteWorld bounds concurrent generation, residency and eviction',async()=>{
  const plan=new VisibilityInterest({maxDistanceM:6_000,maxTiles:512}).plan(observer(10));
  const generated=[],installed=[],uninstalled=[],errors=[];
  const world=new InfiniteWorld({
    generate:async(demand,signal)=>{
      assert.equal(signal.aborted,false);
      generated.push(demand.key);
      await Promise.resolve();
      return{key:demand.key};
    },
    install:(demand)=>installed.push(demand.key),
    uninstall:(demand)=>uninstalled.push(demand.key),
    onError:(demand,error)=>errors.push([demand.key,error]),
  },{maxResident:16,maxConcurrent:2,retainUpdates:0});
  const initial=world.update(plan.demands);
  assert.equal(initial.wanted,16);
  assert.ok(initial.deferred>0);
  assert.ok(initial.pending<=2);
  await world.flush();
  const loaded=world.inspect();
  assert.equal(loaded.resident,16);
  assert.equal(loaded.pending,0);
  assert.equal(generated.length,16);
  assert.equal(installed.length,16);
  assert.deepEqual(errors,[]);
  world.update([]);
  assert.equal(world.inspect().resident,0);
  assert.equal(uninstalled.length,16);
  world.dispose();
});

test('InfiniteWorld prioritises admission and flushes synchronous generators across batches',async()=>{
  const demands=[['far',1,100],['near',3,10],['middle',2,20],['close',3,5]].map(([key,priority,distanceM])=>({key,priority,distanceM,id:{x:0,z:0,lod:0}}));
  const generated=[],world=new InfiniteWorld({generate:d=>{generated.push(d.key);return d.key;}},{maxResident:3,maxConcurrent:1});
  try{
    world.update(demands);await world.flush();
    assert.deepEqual(generated,['close','near','middle']);
    assert.equal(world.inspect().resident,3);assert.equal(world.inspect().pending,0);
  }finally{world.dispose();}
});

test('InfiniteWorld reports synchronous generation failure once and retries on the next update',async()=>{
  const demand={key:'broken',priority:1,distanceM:0,id:{x:0,z:0,lod:0}},errors=[];let attempts=0;
  const world=new InfiniteWorld({generate:()=>{if(++attempts===1)throw new Error('missing tile');return 'recovered';},onError:(_d,e)=>errors.push(e.message)},{maxResident:1,maxConcurrent:1});
  try{
    world.update([demand]);await world.flush();assert.equal(attempts,1);assert.deepEqual(errors,['missing tile']);
    world.update([demand]);await world.flush();assert.equal(world.value('broken'),'recovered');assert.equal(attempts,2);
  }finally{world.dispose();}
});
