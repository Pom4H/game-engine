import test from 'node:test';
import assert from 'node:assert/strict';
import {SpatialHash,SPATIAL_MAX_ITEM_CELLS,SPATIAL_QUERY_REFERENCES,SolidWorld,SolidBody} from '../dist/index.js';
import {SpatialHash as DenseSpatialHash} from './fixtures/spatial-hash-before-cached-bounds.mjs';

function fixture(cellOrder=true,grouped=false){
 const index=new SpatialHash(8,{cellOrder}),records=new Map();let serial=0;const groups=[{active:true},{active:true}];
 const add=(item,r,group)=>{index.add(item,r,group);records.delete(item);const minX=Math.floor((item.x-r)/8),maxX=Math.floor((item.x+r)/8),minZ=Math.floor((item.z-r)/8),maxZ=Math.floor((item.z+r)/8);records.set(item,{minX,maxX,minZ,maxZ,serial:++serial,oversized:maxX-minX+1>SPATIAL_MAX_ITEM_CELLS/(maxZ-minZ+1),group});};
 for(let id=0;id<120;id++){const item={id,x:(id*137)%3001-1500,z:(id*79)%2903-1451};add(item,id%17===0?1200:id%7===0?13:.25,grouped?groups[id%2]:undefined);}
 // This is deliberately a cell broad phase: square-corner members must remain.
 add({id:120,x:2296,z:2296},.25,grouped?groups[0]:undefined);
 const expected=(x,z,r,orderRadius=r)=>{const loX=Math.floor((x-r)/8),hiX=Math.floor((x+r)/8),loZ=Math.floor((z-r)/8),hiZ=Math.floor((z+r)/8),orderX=Math.floor((x-orderRadius)/8),orderZ=Math.floor((z-orderRadius)/8),eligible=[...records].filter(([,b])=>b.group?.active!==false&&b.minX<=hiX&&b.maxX>=loX&&b.minZ<=hiZ&&b.maxZ>=loZ),sort=(a,b,ox,oz)=>Math.max(a[1].minX,ox)-Math.max(b[1].minX,ox)||Math.max(a[1].minZ,oz)-Math.max(b[1].minZ,oz)||a[1].serial-b[1].serial;if(cellOrder)return eligible.sort((a,b)=>sort(a,b,orderX,orderZ)).map(([item])=>item);return[...eligible.filter(([,b])=>!b.oversized).sort((a,b)=>sort(a,b,loX,loZ)),...eligible.filter(([,b])=>b.oversized)].map(([item])=>item);};
 return{index,records,groups,add,expected};
}
function boundedReads(index,operation){const buckets=index.groupedBuckets??index.buckets,get=buckets.get.bind(buckets),maximum=buckets.size;let reads=0;buckets.get=key=>{assert.ok(++reads<=maximum,'large query must not probe empty cell keys beyond occupied bucket count');return get(key);};try{return{result:operation(),reads,maximum};}finally{delete buckets.get;}}

for(const cellOrder of [false,true])for(const grouped of [false,true])test(`huge finite query visits occupied buckets and preserves exact cell/insertion order (ordered=${cellOrder}, groups=${grouped})`,()=>{
 const f=fixture(cellOrder,grouped);for(const [x,z,r]of [[0,0,2290.11],[132.4,-112.3,1e12],[1e8,1e8,1]]){const {result,reads,maximum}=boundedReads(f.index,()=>f.index.nearOwned(x,z,r,[]));assert.deepEqual(result,f.expected(x,z,r));assert.ok(reads<=maximum);const cached=f.index.diagnostics;assert.deepEqual(f.index.near(x,z,r),result);assert.equal(f.index.diagnostics.cacheHits,cached.cacheHits+1);}
 if(grouped){f.index.beginBatch();f.groups[0].active=false;f.index.invalidateGroup();assert.deepEqual(boundedReads(f.index,()=>f.index.near(0,0,1e12)).result,f.expected(0,0,1e12));f.index.endBatch();const item=[...f.records].find(([,r])=>r.group===f.groups[0])[0];while(!f.index.removeReference(item)){}assert.deepEqual(f.index.near(0,0,1e12),f.expected(0,0,1e12));}
 const item=[...f.records.keys()][3];f.index.beginBatch();f.index.remove(item);f.records.delete(item);item.x=-4000;f.add(item,2,grouped?f.groups[1]:undefined);f.index.endBatch();assert.deepEqual(f.index.near(0,0,1e12),f.expected(0,0,1e12));f.index.clear();assert.deepEqual(f.index.near(0,0,1e12),[]);
});

test('small and large traversal agree with frozen dense enumeration, including an enclosing order and turnover',()=>{
 const f=fixture(),dense=new DenseSpatialHash(8,{cellOrder:true});for(const[item,b]of f.records)dense.add(item,b.oversized?1200:item.id%7===0?13:.25);
 for(const[x,z,r]of [[4,4,.1],[-12,27,3],[0,0,80],[22,-31,320],[0,0,2290.11]])for(const orderRadius of [r,Math.max(r,3000)])assert.deepEqual(f.index.near(x,z,r,undefined,orderRadius),dense.near(x,z,r,undefined,orderRadius));
 const wide=f.index.near(0,0,1e12),selected=new Set(f.index.near(0,0,320));assert.deepEqual(f.index.near(0,0,320,undefined,1e12),wide.filter(item=>selected.has(item)));
});

test('largest valid finite cell bounds remain complete without caching an over-budget result',()=>{
 const index=new SpatialHash(8,{cellOrder:true}),items=Array.from({length:SPATIAL_QUERY_REFERENCES+1},(_,id)=>({id,x:4,z:4}));for(const item of items)index.add(item,0);const edge={id:-1,x:Number.MAX_SAFE_INTEGER*8,z:0};index.add(edge,0);const result=boundedReads(index,()=>index.near(0,0,Number.MAX_SAFE_INTEGER*8)).result;assert.equal(result.length,items.length+1);assert.deepEqual(result,[...items,edge]);assert.equal(index.diagnostics.cachedQueries,0);assert.equal(index.diagnostics.cachedReferences,0);result.length=0;assert.equal(index.nearOwned(0,0,Number.MAX_SAFE_INTEGER*8,[]).length,items.length+1);
 const scratch=[edge];for(const[x,z,r]of [[NaN,0,1],[0,Infinity,1],[0,0,Infinity],[0,0,-1],[Number.MAX_VALUE,0,0]]){assert.throws(()=>index.nearOwned(x,z,r,scratch),RangeError);assert.deepEqual(scratch,[edge]);}
});

test('a huge ray query retains coplanar hit ties, groups and actual narrow-phase collisions',()=>{
 const world=new SolidWorld({gravity:[0,0,0]}),group=world.createStaticGroup();let first,second;world.withStaticGroup(group,()=>{first=world.addPlane({p:[4,0,4],hu:20,hv:20,tag:'first'});});second=world.addPlane({p:[4,0,4],hu:20,hv:20,tag:'second'});
 for(let id=0;id<80;id++)world.add(new SolidBody({p:[id*20,0,100],half:[1,1,1],tag:'off-ray'}));const origin=[4,2,4],direction=[Math.SQRT1_2,-Math.SQRT1_2,0],hit=boundedReads(world.staticIndex,()=>world.ray(origin,direction,1e12)).result;assert.equal(hit.tag,'first');assert.ok(Math.abs(hit.t-2*Math.SQRT2)<1e-12);world.retireStaticGroup(group);assert.equal(world.ray(origin,direction,1e12).tag,'second');second.enabled=false;assert.equal(world.ray(origin,direction,1e12),null);assert.equal(first.enabled,undefined);
});
