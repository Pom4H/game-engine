import test from 'node:test';
import assert from 'node:assert/strict';
import {SpatialHash,SPATIAL_QUERY_CAPACITY,SPATIAL_QUERY_REFERENCES,SolidWorld} from '../dist/index.js';
import {SpatialHash as BeforeSpatialHash} from './fixtures/spatial-hash-before-owned-fill.mjs';

const members=()=>Array.from({length:96},(_,id)=>({id,x:(id*37)%149-74,z:(id*53)%157-78,r:id%11===0?130:id%7===0?15:1}));
function pair(items=members(),options={cellOrder:true}){
 const before=new BeforeSpatialHash(12,options),after=new SpatialHash(12,options);
 for(const item of items){before.add(item,item.r);after.add(item,item.r);}return {before,after,items};
}
function same(pair,x,z,r,enclosing=r){
 const old=pair.before.near(x,z,r,[],enclosing),out=[{id:-999}];assert.equal(pair.after.nearOwned(x,z,r,out,enclosing),out);assert.deepEqual(out,old);
 assert.deepEqual(pair.after.near(x,z,r,undefined,enclosing),pair.before.near(x,z,r,undefined,enclosing));assert.deepEqual(pair.after.diagnostics,pair.before.diagnostics);
 out.reverse();out.length=0;return old;
}

test('owned scratch matches frozen complete query order/cache under turnover, bounds and empty results',()=>{
 const p=pair();let seed=0x2468ace;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(let i=0;i<1200;i++)same(p,random()*480-240,random()*480-240,[0,.1,4,15][i%4],[20,40,80][i%3]);
 for(const item of p.items.filter((_,i)=>i%5===0)){assert.equal(p.before.remove(item),p.after.remove(item));item.x+=120;p.before.add(item,item.r);p.after.add(item,item.r);}
 for(let i=0;i<100;i++)same(p,i*12-600,4,.2,40);
 p.before.beginBatch();p.after.beginBatch();for(const item of p.items.slice(0,8)){p.before.remove(item);p.after.remove(item);}p.before.endBatch();p.after.endBatch();same(p,0,0,24,40);
 assert.ok(p.after.diagnostics.cachedQueries<=SPATIAL_QUERY_CAPACITY);assert.ok(p.after.diagnostics.cachedReferences<=SPATIAL_QUERY_REFERENCES);
 p.before.clear();p.after.clear();assert.deepEqual(same(p,-0,-0,0),[]);
 const plain=pair([{id:1,x:4,z:4,r:.1}],{});same(plain,4,4,.1);same(plain,80,80,.1);assert.equal(plain.after.diagnostics.cachedQueries,0);
});

test('public outputs retain custom push/Proxy trap traces, fresh arrays and invalid-call behavior',()=>{
 const p=pair([{id:1,x:4,z:4,r:.1},{id:2,x:5,z:5,r:.1}]);
 function observed(index){const trace=[],target=[p.items[0]],out=new Proxy(target,{get(array,key,receiver){trace.push(['get',String(key)]);return Reflect.get(array,key,receiver);},set(array,key,value,receiver){trace.push(['set',String(key),typeof value==='object'?value.id:value]);return Reflect.set(array,key,value,receiver);}});assert.equal(index.near(4,4,1,out),out);return {trace,values:[...target]};}
 assert.deepEqual(observed(p.after),observed(p.before));
 function customPush(index){const calls=[],out=[];out.push=function(...items){calls.push(items);return Array.prototype.push.apply(this,items);};index.near(4,4,1,out);return {calls,values:Array.from(out)};}
 assert.deepEqual(customPush(p.after),customPush(p.before));
 const first=p.after.near(4,4,1),again=p.after.near(4,4,1);assert.notEqual(first,again);first.pop();assert.deepEqual(p.after.near(4,4,1),again);
 for(const query of [[NaN,0,1],[0,Infinity,1],[0,0,-1],[0,0,1,[],.1]]){const a=[p.items[0]],b=[p.items[0]];assert.throws(()=>p.after.near(...query.slice(0,3),a,...query.slice(4)));assert.throws(()=>p.before.near(...query.slice(0,3),b,...query.slice(4)));assert.deepEqual(a,b);}
 const out=[p.items[0]];assert.throws(()=>p.after.nearOwned(0,0,-1,out));assert.deepEqual(out,[p.items[0]]);
});

test('owned scratch does not expose cache arrays and truncates stale references at every size',()=>{
 const items=Array.from({length:140000},(_,id)=>({id,x:4,z:4,r:0})),p=pair(items,{}),out=[];
 assert.equal(p.after.nearOwned(4,4,0,out),out);assert.deepEqual(out,p.before.near(4,4,0));assert.equal(out.length,items.length);
 out[0]={id:-1};out.reverse();assert.deepEqual(p.after.nearOwned(4,4,0,out),items);assert.deepEqual(p.after.nearOwned(100,100,0,out),[]);assert.deepEqual(Object.keys(out),[]);
 const cached=pair();const original=cached.after.nearOwned(0,0,24,out,40).slice();out.fill({id:-1});assert.deepEqual(cached.after.nearOwned(0,0,24,out,40),original);
 const separate=[];cached.after.nearOwned(0,0,24,separate,40);assert.notEqual(out,separate);separate.pop();assert.deepEqual(cached.after.nearOwned(0,0,24,out,40),original);
});

test('native candidates preserve instance/prototype near instrumentation, subclasses and custom indices',()=>{
 const world=new SolidWorld(),a={id:1,x:4,z:4,enabled:true},b={id:2,x:4,z:4,enabled:false},global={id:3,enabled:true};world.staticIndex.add(a,.1);world.staticIndex.add(b,.1);world.globalPlanes.push(global);
 const original=world.staticIndex.near;let calls=0;world.staticIndex.near=function(...args){calls++;return original.apply(this,args);};assert.deepEqual(world.candidates([4,0,4],1),[global,a]);assert.equal(calls,1);
 delete world.staticIndex.near;const prototypeNear=SpatialHash.prototype.near;try{SpatialHash.prototype.near=function(...args){calls++;return prototypeNear.apply(this,args);};assert.deepEqual(world.candidates([4,0,4],1),[global,a]);assert.equal(calls,2);}finally{SpatialHash.prototype.near=prototypeNear;}
 class Instrumented extends SpatialHash{near(...args){calls++;return super.near(...args);}}const subclass=new Instrumented();subclass.add(a,.1);world.staticIndex=subclass;assert.deepEqual(world.candidates([4,0,4],1),[global,a]);assert.equal(calls,3);
 const accessorIndex=new SpatialHash();accessorIndex.add(a,.1);let reads=0;Object.defineProperty(accessorIndex,'near',{get(){reads++;assert.equal(reads,1,'public near getter is read once, matching the former direct call');return function(...args){calls++;assert.equal(this,accessorIndex);return original.apply(this,args);};}});world.staticIndex=accessorIndex;assert.deepEqual(world.candidates([4,0,4],1),[global,a]);assert.equal(reads,1);assert.equal(calls,4);
 world.staticIndex={near(x,z,r,out,enclosing){calls++;assert.deepEqual([x,z,r,enclosing],[4,4,1,5]);out.length=0;out.push(b,a);return out;}};assert.deepEqual(world.candidates([4,0,4],1,5),[global,a]);assert.equal(calls,5);
});

test('reentrant ordering callbacks retain independent outputs and original call/cache semantics',()=>{
 function query(Class,owned){const index=new Class(12,{cellOrder:true}),items=members(),trace=[],nested=[];for(const item of items)index.add(item,item.r);const get=index.orderBounds.get.bind(index.orderBounds);let entered=false;index.orderBounds.get=item=>{trace.push(item.id);if(!entered){entered=true;const out=[];nested.push(owned?index.nearOwned(60,60,1,out,60):index.near(60,60,1,out,60));entered=false;}return get(item);};const out=[];if(owned)index.nearOwned(0,0,1,out,60);else index.near(0,0,1,out,60);return {out:out.map(p=>p.id),trace,nested:nested.map(rows=>rows.map(p=>p.id)),diagnostics:index.diagnostics};}
 assert.deepEqual(query(SpatialHash,true),query(BeforeSpatialHash,false));
});
