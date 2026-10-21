import test from 'node:test';
import assert from 'node:assert/strict';
import {SpatialHash,SolidWorld,SPATIAL_QUERY_CAPACITY,SPATIAL_QUERY_REFERENCES} from '../dist/index.js';
import {SpatialHash as BeforeSpatialHash} from './fixtures/spatial-hash-before-cached-bounds.mjs';

const members=()=>Array.from({length:180},(_,id)=>({id,x:(id*37)%149-74,z:(id*53)%157-78,r:id%11===0?130:id%7===0?15:1,enabled:true}));
function pair(items=members(),options={cellOrder:true}){const before=new BeforeSpatialHash(12,options),after=new SpatialHash(12,options);for(const p of items){before.add(p,p.r);after.add(p,p.r);}return{before,after,items};}
function same(p,x,z,r,orderRadius=r){const a=p.before.nearOwned(x,z,r,[],orderRadius),b=p.after.nearOwned(x,z,r,[],orderRadius);assert.deepEqual(b,a);assert.deepEqual(p.after.diagnostics,p.before.diagnostics);assert.ok(p.after.diagnostics.cachedQueries<=SPATIAL_QUERY_CAPACITY);assert.ok(p.after.diagnostics.cachedReferences<=SPATIAL_QUERY_REFERENCES);return b;}

test('numeric cache access matches frozen order and metrics for exact/moved bounds, misses and turnover',()=>{
 const p=pair();let seed=0x2468ace;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(let i=0;i<1000;i++){const x=random()*480-240,z=random()*480-240,r=[0,.1,4,15][i%4],order=[20,40,80][i%3];same(p,x,z,r,order);same(p,x,z,r,order);same(p,x+.001,z+.001,r,order);}
 for(const item of p.items.slice(0,12)){assert.equal(p.after.remove(item),p.before.remove(item));item.x+=30;p.before.add(item,item.r);p.after.add(item,item.r);}same(p,0,0,1,40);same(p,0,0,1,40);
 same(p,12*(Number.MAX_SAFE_INTEGER-8),0,0);p.before.clear();p.after.clear();assert.deepEqual(same(p,-0,-0,0),[]);
});

test('quick hits retain FIFO eviction and do not retain storage beyond the existing cache limits',()=>{
 const p=pair();for(let i=0;i<128;i++)same(p,i*40,4,.1,40);
 const first=p.before.queries.keys().next().value;assert.equal(p.after.queries.keys().next().value,first);
 same(p,0,4,.1,40);same(p,0,4,.1,40);same(p,128*40,4,.1,40);
 assert.equal(p.before.queries.has(first),false);assert.equal(p.after.queries.has(first),false,'last-query hits must not promote FIFO entries');
 const huge=pair(Array.from({length:16400},(_,id)=>({id,x:4,z:4,r:.01})));same(huge,4,4,1,40);same(huge,4,4,1,40);assert.equal(huge.after.diagnostics.cachedQueries,0);assert.equal(huge.after.diagnostics.cacheMisses,2);
});

test('batched cached membership remains stale until outer endBatch while plain buckets remain live',()=>{
 const item={id:1,x:4,z:4,r:.1},p=pair([item]);same(p,4,4,1,40);p.before.beginBatch();p.after.beginBatch();p.before.beginBatch();p.after.beginBatch();p.before.remove(item);p.after.remove(item);
 assert.deepEqual(same(p,4,4,1,40),[item]);p.before.endBatch();p.after.endBatch();assert.deepEqual(same(p,4,4,1,40),[item]);p.before.endBatch();p.after.endBatch();assert.deepEqual(same(p,4,4,1,40),[]);
 const plain=pair([],{});plain.before.beginBatch();plain.after.beginBatch();plain.before.add(item,.1);plain.after.add(item,.1);assert.deepEqual(same(plain,4,4,.1),[item]);plain.before.remove(item);plain.after.remove(item);assert.deepEqual(same(plain,4,4,.1),[]);assert.equal(plain.after.diagnostics.cachedQueries,0);
});

test('public output traps and native override getter contract remain unchanged across quick hits',()=>{
 const p=pair();same(p,0,0,1,40);same(p,0,0,1,40);
 const observed=index=>{const trace=[],out=new Proxy([],{get(a,k,r){trace.push(['get',String(k)]);return Reflect.get(a,k,r);},set(a,k,v,r){trace.push(['set',String(k),typeof v==='object'?v.id:v]);return Reflect.set(a,k,v,r);}});index.near(0,0,1,out,40);return trace;};assert.deepEqual(observed(p.after),observed(p.before));
 const a=p.after.near(0,0,1,undefined,40),b=p.after.near(0,0,1,undefined,40);assert.notEqual(a,b);a.reverse();assert.deepEqual(p.after.near(0,0,1,undefined,40),b);
 const override=Class=>{const index=new Class(12,{cellOrder:true}),item={id:1,x:4,z:4};index.add(item,.1);index.nearOwned(4,4,1,[],40);const near=index.near;let reads=0,calls=0;Object.defineProperty(index,'near',{get(){reads++;return function(...args){calls++;assert.equal(this,index);return Reflect.apply(near,this,args);};}});const out=index.nearOwned(4,4,1,[],40);return{reads,calls,out,diagnostics:index.diagnostics};};assert.deepEqual(override(SpatialHash),override(BeforeSpatialHash));assert.equal(override(SpatialHash).reads,1);
});

test('validation and option getter mutation run before any shortcut with original read order',()=>{
 const p=pair();same(p,0,0,1,40);for(const args of [[NaN,0,1,1],[0,Infinity,1,1],[0,0,-1,-1],[0,0,1,.1],[Number.MAX_VALUE,0,1,1]]){const a=[p.items[0]],b=[p.items[0]];assert.throws(()=>p.before.nearOwned(args[0],args[1],args[2],a,args[3]));assert.throws(()=>p.after.nearOwned(args[0],args[1],args[2],b,args[3]));assert.deepEqual(a,b);assert.deepEqual(p.after.diagnostics,p.before.diagnostics);}
 const run=Class=>{let index,clearOnRead=false;const trace=[],options={get cellOrder(){trace.push('cellOrder');if(clearOnRead){clearOnRead=false;index.clear();}return true;}};index=new Class(12,options);index.add({id:1,x:4,z:4},.1);index.nearOwned(4,4,1,[],40);clearOnRead=true;trace.length=0;const out=index.nearOwned(4,4,1,[],40);return{trace,out,diagnostics:index.diagnostics};};assert.deepEqual(run(SpatialHash),run(BeforeSpatialHash));
});

test('reentrant sort queries preserve callback traces, independent output copies and cache metrics',()=>{
 const run=Class=>{const index=new Class(12,{cellOrder:true}),trace=[],nested=[];for(const p of members())index.add(p,p.r);const get=index.orderBounds.get.bind(index.orderBounds);let active=false;index.orderBounds.get=p=>{trace.push(p.id);if(!active){active=true;nested.push(index.nearOwned(60,60,1,[],60).map(q=>q.id));active=false;}return get(p);};const out=index.nearOwned(0,0,1,[],60),again=index.nearOwned(0,0,1,[],60);return{trace,nested,out:out.map(p=>p.id),again:again.map(p=>p.id),diagnostics:index.diagnostics};};assert.deepEqual(run(SpatialHash),run(BeforeSpatialHash));
});

test('actual ray plane order, enabled/geometry/filter mutation and nested-query results match frozen index',()=>{
 const run=Class=>{const world=new SolidWorld(),trace=[];world.staticIndex=new Class(12,{cellOrder:true});world.addPlane({p:[0,-2,0],hu:500,hv:500,tag:'ground'});const first=world.addPlane({p:[4,0,4],hu:3,hv:3,tag:'first'}),second=world.addPlane({p:[4,0,4],hu:3,hv:3,tag:'second'});let active=false;
 first.filter=p=>{trace.push(['first',...p]);if(!active){active=true;world.ray([60,2,60],[0,-1,0],4);active=false;}return true;};second.filter=p=>{trace.push(['second',...p]);return true;};const normalize=hit=>hit&&{t:hit.t,p:hit.p,n:hit.n,tag:hit.tag};
 const hits=[normalize(world.ray([4,2,4],[0,-1,0],4)),normalize(world.ray([4.001,2,4.001],[0,-1,0],4))];first.enabled=false;hits.push(normalize(world.ray([4,2,4],[0,-1,0],4)));second.enabled=false;hits.push(normalize(world.ray([4,2,4],[0,-1,0],4)));first.enabled=true;first.hu=.1;hits.push(normalize(world.ray([5,2,4],[0,-1,0],4)));first.hu=3;first.p[1]=.3;hits.push(normalize(world.ray([4,2,4],[0,-1,0],4)));return{hits,trace,diagnostics:world.staticIndex.diagnostics};};assert.deepEqual(run(SpatialHash),run(BeforeSpatialHash));
});
