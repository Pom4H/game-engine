import test from 'node:test';
import assert from 'node:assert/strict';
import {SolidWorld,SolidBody} from '../dist/physics/compound.js';

const make=(world,tag,x,z,half=[1,1,1])=>world.add(new SolidBody({p:[x,1,z],half,tag}));
const tags=items=>items.map(item=>item.tag);
function sameQueries(a,b){for(const [x,z,r,order]of [[0,0,1,1],[0,0,20,20],[15,15,18,55],[-40,0,2,100],[80,0,100,100]])assert.deepEqual(tags(a.candidates([x,0,z],r,order)),tags(b.candidates([x,0,z],r,order)));for(const x of [-40,0,15,80]){const hit=world=>{const value=world.ray([x,40,0],[0,-1,0],80);return value&&{p:value.p,n:value.n,tag:value.tag};};assert.deepEqual(hit(a),hit(b));}}

test('legacy arrays retain own mutable storage until explicit group opt-in',()=>{
 const world=new SolidWorld(),array=world.statics;
 assert.ok(Object.getOwnPropertyDescriptor(world,'statics').value===array);
 const body=make(world,'body',0,0);assert.equal(world.statics,array);assert.equal(array[0],body);
 const planes=world.planes,globals=world.globalPlanes;world.removeStatics([body]);assert.equal(world.planes,planes);assert.equal(world.globalPlanes,globals);
 world.statics=[];assert.equal(world.statics.length,0);
});

test('group retirement preserves exact legacy contact/ray order and ordered public snapshots before cleanup',()=>{
 const old=new SolidWorld(),current=new SolidWorld();make(old,'hub',0,0);make(current,'hub',0,0);
 const a=current.createStaticGroup(),b=current.createStaticGroup(),oldA=[];
 const populate=(world,retired)=>{retired.push(make(world,'a-small',15,0));retired.push(make(world,'a-wide',-40,0,[150,1,150]));retired.push(world.addPlane({p:[0,5,0],hu:20,hv:20,tag:'a-plane'}));retired.push(world.addPlane({p:[0,-2,0],hu:400,hv:400,tag:'a-global'}));};
 populate(old,oldA);current.withStaticGroup(a,()=>populate(current,[]));
 make(old,'ungrouped-later',0,0);make(current,'ungrouped-later',0,0);
 make(old,'b',15,0);current.withStaticGroup(b,()=>make(current,'b',15,0));
 sameQueries(old,current);assert.deepEqual(tags(current.statics),tags(old.statics));assert.deepEqual(tags(current.planes),tags(old.planes));
 old.removeStatics(oldA);let calls=0;const remove=current.staticIndex.removeReference;current.staticIndex.removeReference=function(item){calls++;return Reflect.apply(remove,this,[item]);};
 current.retireStaticGroup(a);assert.equal(calls,0);assert.equal(a.active,false);sameQueries(old,current);
 assert.deepEqual(tags(current.statics),tags(old.statics));assert.deepEqual(tags(current.planes),tags(old.planes));assert.deepEqual(tags(current.globalPlanes),tags(old.globalPlanes));
 let done=false,steps=0;while(!done){const before=calls,result=current.cleanupStaticGroup(a,1);assert.ok(calls-before<=1);assert.ok(result.operations<=1);done=result.done;steps++;sameQueries(old,current);assert.ok(steps<100);}
 assert.ok(steps>8);assert.equal(b.active,true);assert.deepEqual(tags(current.statics),tags(old.statics));
});

test('one cleanup credit never scans a dense bucket, and hot collision queries never materialize snapshots',()=>{
 const world=new SolidWorld(),group=world.createStaticGroup();
 world.withStaticGroup(group,()=>{for(let i=0;i<2048;i++)make(world,'dense:'+i,0,0,[.01,.01,.01]);});
 const before=world.inspectStaticGroups().snapshotReads;
 assert.equal(world.candidates([0,1,0],1).length,2048);world.retireStaticGroup(group);assert.equal(world.candidates([0,1,0],1).length,0);
 let calls=0;const remove=world.staticIndex.removeReference;world.staticIndex.removeReference=function(item){calls++;return Reflect.apply(remove,this,[item]);};
 const first=world.cleanupStaticGroup(group,1);assert.equal(first.operations,1);assert.equal(first.done,false);assert.equal(calls,1);
 for(let i=0;i<20;i++){world.candidates([0,1,0],1);world.ray([0,4,0],[0,-1,0],8);const result=world.cleanupStaticGroup(group,1);assert.equal(result.operations,1);}
 assert.equal(world.inspectStaticGroups().snapshotReads,before);
 assert.deepEqual(world.statics,[]);
 let done=false;while(!done)done=world.cleanupStaticGroup(group,128).done;
 assert.equal(world.staticIndex.diagnostics.cells,0);
});

test('cleanup of an old lifetime cannot unlink a re-admitted object in a new lifetime',()=>{
 const world=new SolidWorld(),old=world.createStaticGroup(),next=world.createStaticGroup();let body;
 world.withStaticGroup(old,()=>body=make(world,'shared-source-body',0,0));world.retireStaticGroup(old);
 world.withStaticGroup(next,()=>world.add(body));while(!world.cleanupStaticGroup(old,1).done){}
 assert.deepEqual(world.statics,[body]);assert.deepEqual(world.candidates([0,0,0],1),[body]);
});

test('repeated interior removal releases active lifetime ownership immediately, not only on whole-chunk retirement',()=>{
 const world=new SolidWorld(),group=world.createStaticGroup();
 for(let round=0;round<1000;round++){let body;world.withStaticGroup(group,()=>body=make(world,'level:'+round,0,0));assert.equal(world.inspectStaticGroups().groupMemberships,1);world.removeStatics([body]);assert.equal(world.inspectStaticGroups().groupMemberships,0);}
 assert.equal(group.active,true);assert.equal(world.staticIndex.diagnostics.cells,0);world.retireStaticGroup(group);assert.deepEqual(world.cleanupStaticGroup(group,1),{done:true,operations:0});
});

test('a lifetime retirement invalidates cached eligibility immediately inside an ordinary membership batch',()=>{
 const world=new SolidWorld(),group=world.createStaticGroup();world.withStaticGroup(group,()=>make(world,'retired-in-batch',0,0));
 assert.equal(world.candidates([0,0,0],10).length,1);world.staticIndex.beginBatch();
 try{world.retireStaticGroup(group);assert.deepEqual(world.candidates([0,0,0],10),[]);assert.deepEqual(world.staticIndex.near(0,0,10),[]);}finally{world.staticIndex.endBatch();}
});
