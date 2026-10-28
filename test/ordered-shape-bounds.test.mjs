import test from 'node:test';
import assert from 'node:assert/strict';
import {OrderedShapeBoundsIndex} from '../dist/physics/ordered-shape-bounds.js';
import {boxBoundsOverlap} from '../dist/physics/box-overlap.js';
import {SolidBody,SolidWorld,Qeuler} from '../dist/physics/compound.js';

const bounds=(x,y,z,h=.02)=>({bounds:[x-h,y-h,z-h,x+h,y+h,z+h]});
const exhaustive=(boxes,query,margin)=>boxes.flatMap((box,i)=>boxBoundsOverlap(query,box,margin)?[i]:[]);

test('ordered range branches preserve every exact padded AABB candidate in source order, including touching and negative margins',()=>{
 const boxes=Array.from({length:137},(_,i)=>bounds(((i*47)%137)*.025,(i%7)*.03,(i%3)*.02)),index=new OrderedShapeBoundsIndex(boxes),out=[];
 for(const margin of [-.02,0,.006,.04])for(let i=0;i<160;i++){const query=bounds((i%41)*.08,(i%13)*.02,(i%11)*.015,.03);assert.deepEqual(index.candidates(query,margin,out),exhaustive(boxes,query,margin));}
 const edge={bounds:[.04,-.02,-.02,.08,.02,.02]},touch=new OrderedShapeBoundsIndex([bounds(0,0,0),edge]);assert.deepEqual(touch.candidates(bounds(.04,0,0),0,out),[0,1]);
 assert.deepEqual(new OrderedShapeBoundsIndex([]).candidates(bounds(0,0,0),.006,out),[]);
});

test('a fresh phase sees in-place bounds changes while an owned old snapshot and nested output arrays stay independent',()=>{
 const boxes=Array.from({length:33},(_,i)=>bounds(i*.1,0,0)),index=new OrderedShapeBoundsIndex(boxes),query=bounds(0,0,0),outer=index.candidates(query,.006,[]),saved=[...outer];
 for(const id of outer){const nested=index.candidates(boxes[20],.02,[]);assert.ok(nested.includes(20));assert.deepEqual(outer,saved);assert.equal(id,0);}
 boxes[0].bounds[0]=9;boxes[0].bounds[3]=10;boxes[30].bounds.splice(0,6,...query.bounds);const next=new OrderedShapeBoundsIndex(boxes);assert.deepEqual(index.candidates(query,.006,[]),saved);assert.deepEqual(next.candidates(query,.006,[]),[30]);
});

test('custom accessors and degenerate/nonfinite bounds conservatively retain original enumeration without reading getters',()=>{
 let reads=0;const custom={get bounds(){reads++;return[-1,-1,-1,1,1,1];}},query=bounds(20,20,20),shapes=[bounds(0,0,0),custom,bounds(10,0,0)];assert.deepEqual(new OrderedShapeBoundsIndex(shapes).candidates(query,.006,[]),[0,1,2]);assert.equal(reads,0);
 const entries=[bounds(0,0,0)];Object.defineProperty(entries,0,{get(){reads++;return bounds(0,0,0);}});assert.deepEqual(new OrderedShapeBoundsIndex(entries).candidates(query,.006,[]),[0]);assert.equal(reads,0);
 assert.deepEqual(new OrderedShapeBoundsIndex([bounds(0,0,0),null]).candidates(query,.006,[]),[0,1]);
 const vector=[0,0,0,1,1,1];Object.defineProperty(vector,2,{get(){reads++;return 0;}});assert.deepEqual(new OrderedShapeBoundsIndex([{bounds:vector}]).candidates(query,.006,[]),[0]);assert.equal(reads,0);
 for(const invalid of [[0,0,0,Infinity,1,1],[0,0,0,NaN,1,1],[2,0,0,1,1,1]])assert.deepEqual(new OrderedShapeBoundsIndex([{bounds:invalid}]).candidates(query,.006,[]),[0]);
 const ordinary=new OrderedShapeBoundsIndex([bounds(0,0,0),bounds(1,1,1)]);for(const margin of [Infinity,NaN])assert.deepEqual(ordinary.candidates(query,margin,[]),[0,1]);assert.deepEqual(ordinary.candidates(custom,.006,[]),[0,1]);assert.equal(reads,0);
});

function sheet(){const shapes=[],N=5,point=(i,j)=>[(i-N/2)*.12,(j-N/2)*.12,0];for(let j=0;j<N;j++)for(let i=0;i<N;i++){const a=point(i,j),b=point(i+1,j),c=point(i,j+1),d=point(i+1,j+1),id=(x,y)=>y*(N+1)+x;for(const [triangle,nodes]of [[[a,b,c],[id(i,j),id(i+1,j),id(i,j+1)]],[[b,d,c],[id(i+1,j),id(i+1,j+1),id(i,j+1)]]]){const min=[0,1,2].map(k=>Math.min(...triangle.map(p=>p[k]))),max=[0,1,2].map(k=>Math.max(...triangle.map(p=>p[k])));shapes.push({triangle,geometryNodes:nodes,thickness:.0008,offset:min.map((x,k)=>(x+max[k])/2),half:min.map((x,k)=>(max[k]-x)/2+.0004)});}}return shapes;}
function trajectory(linear,custom=false){
 const method=OrderedShapeBoundsIndex.prototype.candidates;let indexedQueries=0;if(linear)OrderedShapeBoundsIndex.prototype.candidates=function(_q,_m,out){out.length=0;for(let i=0;i<this.length;i++)out.push(i);return out;};else OrderedShapeBoundsIndex.prototype.candidates=function(...args){indexedQueries++;return method.apply(this,args);};
 const world=new SolidWorld({gravity:[0,0,0]}),a=world.add(new SolidBody({p:[0,0,-.025],shapes:sheet(),half:[.4,.4,.002],mass:20,tag:'A',restitution:0})),b=world.add(new SolidBody({p:[.025,.02,.025],q:Qeuler(.025,.015,.01),shapes:sheet(),half:[.4,.4,.002],mass:20,tag:'B',restitution:0})),rows=[],callbacks=[];a.v=[0,0,2];b.v=[0,0,-2];let getterReads=0;
 for(const body of [a,b])body.contactRefinement=(p,n,approach,h)=>callbacks.push([body.tag,...p,...n,approach,h]);
 if(custom){const builtin=b.boxes;b.boxes=function(){const boxes=builtin.call(this);for(const box of boxes){const value=box.bounds;Object.defineProperty(box,'bounds',{get(){getterReads++;return value;}});}return boxes;};}
 try{for(let step=0;step<16;step++){a.shapes[0].triangle[0][2]=step*.00001;world.step(1/120);rows.push({a:{p:[...a.p],q:[...a.q],v:[...a.v],w:[...a.w]},b:{p:[...b.p],q:[...b.q],v:[...b.v],w:[...b.w]},contacts:world.contacts.map(c=>({a:c.a.tag,b:c.b?.tag,n:c.n,p:c.p,depth:c.depth,jn:c.jn})),substeps:world.metrics.substeps});}assert.ok(rows.some(r=>r.contacts.length));assert.ok(callbacks.length);if(!linear)assert.equal(indexedQueries>0,!custom);return{rows,callbacks,getterReads};}
 finally{OrderedShapeBoundsIndex.prototype.candidates=method;for(const body of [...world.bodies])world.remove(body);}
}
test('compound dynamic discovery and first closing refinement keep exact trajectory/contact/callback order against exhaustive enumeration',()=>{
 assert.deepEqual(trajectory(false),trajectory(true));
 const custom=trajectory(false,true),linear=trajectory(true,true);assert.ok(custom.getterReads>0);assert.deepEqual(custom,linear);
});
test('custom boxes iterables retain their original iterator contract without added length/property reads',()=>{
 const world=new SolidWorld({gravity:[0,0,0]}),a=world.add(new SolidBody({p:[0,0,0],shapes:sheet(),mass:10})),b=world.add(new SolidBody({p:[0,0,.02],shapes:sheet(),mass:10})),builtin=b.boxes;let iterations=0;
 b.boxes=function(){const boxes=builtin.call(this);return new Proxy(boxes,{get(source,key,receiver){if(key==='length')throw Error('Custom snapshot length must not be read outside its iterator');if(key===Symbol.iterator)return function(){iterations++;return source[Symbol.iterator]();};return Reflect.get(source,key,receiver);}});};
 try{world.step(1/120);assert.ok(iterations>0);}finally{for(const body of [...world.bodies])world.remove(body);}
});
