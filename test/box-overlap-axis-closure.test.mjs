import test from 'node:test';
import assert from 'node:assert/strict';
import {boxesPenetrate as before} from './fixtures/box-overlap-before-axis-closure.mjs';
import {boxesPenetrate as actual} from '../dist/physics/box-overlap.js';
import {SolidWorld,SolidBody,Qeuler} from '../dist/physics/compound.js';
const unit=[[1,0,0],[0,1,0],[0,0,1]];
const box=(p,half,axes=unit)=>({p,half,axes});
function rng(){let seed=0x781b1d;return()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/4294967296;};}

test('occupancy SAT matches frozen arithmetic for 12,081 rotated, skew and nonfinite cases',()=>{
 const special=[0,-0,1e-12,-1e-12,1,-1,Infinity,-Infinity,NaN];let cases=0;
 for(const n of special)for(const depth of [undefined,-.1,-0,0,.012,1,NaN,Infinity,-Infinity]){
  const a=box([n,0,0],[1,1,1]),b=box([2,0,0],[1,1,1]);assert.equal(actual(a,b,depth),before(a,b,depth));cases++;
 }
 const random=rng();for(let i=0;i<12000;i++){
  const yaw=(random()-.5)*Math.PI*2,c=Math.cos(yaw),s=Math.sin(yaw),axes=[[c,0,s],[0,1,0],[-s,0,c]];
  if(i%9===0)axes[0][1]=(random()-.5)*.01;
  const a=box([(random()-.5)*8,(random()-.5)*3,(random()-.5)*8],[random()*2,random()*3,random()*2],axes);
  const b=box([(random()-.5)*8,(random()-.5)*3,(random()-.5)*8],[random()*2,random()*3,random()*2]);
  const depth=i%7===0?0:i%11===0?-.012:.012;assert.equal(actual(a,b,depth),before(a,b,depth));cases++;
 }
 assert.equal(cases,12081);
});

function runObservable(subject,throwAfter=Infinity,reentrant=false,mutating=false){
 const trace=[],objects={};let reads=0,nested=false;
 const log=value=>{trace.push(value);if(++reads===throwAfter)throw new Error('read '+throwAfter);};
 const vector=(name,value)=>new Proxy(value,{get(target,key,receiver){log(name+'.'+String(key));return Reflect.get(target,key,receiver);}});
 for(const name of ['a','b']){
  let axisReads=0;const axes=[vector(name+'.u',[1,0,0]),vector(name+'.v',[0,1,0]),vector(name+'.w',[0,0,1])];
  const vectors={p:vector(name+'.p',name==='a'?[0,0,0]:[.5,.2,.3]),half:vector(name+'.half',[1,1,1])};
  objects[name]={get p(){log(name+'.p');return vectors.p;},get half(){log(name+'.half');return vectors.half;},get axes(){
   log(name+'.axes');axisReads++;
   if(reentrant&&!nested){nested=true;trace.push('nested:'+subject(box([0,0,0],[1,1,1]),box([5,0,0],[1,1,1])));}
   if(mutating&&axisReads===3)vectors.half[0]=.2;
   return new Proxy(axes,{get(target,key,receiver){log(name+'.axesArray.'+String(key));return Reflect.get(target,key,receiver);}});
  }};
 }
 try{return{value:subject(objects.a,objects.b),trace};}catch(error){return{error:String(error),trace};}
}
test('all 388 getter, iterator, mutation, reentry and abrupt-completion traces match frozen SAT',()=>{
 let cases=0;for(const reentrant of [false,true])for(const mutating of [false,true]){
  assert.deepEqual(runObservable(actual,Infinity,reentrant,mutating),runObservable(before,Infinity,reentrant,mutating));cases++;
  for(let throwAt=1;throwAt<=96;throwAt++){assert.deepEqual(runObservable(actual,throwAt,reentrant,mutating),runObservable(before,throwAt,reentrant,mutating));cases++;}
 }assert.equal(cases,388);
});

function observeDepth(subject,mode){
 const a=box([0,0,0],[1,1,1]),b=box([.1,.2,.3],[1,1,1]),trace=[];let calls=0;
 const depth={[Symbol.toPrimitive](hint){trace.push(hint+':'+(++calls));if(calls===1&&mode==='reentry')trace.push('nested:'+subject(box([0,0,0],[1,1,1]),box([5,0,0],[1,1,1])));if(calls===2&&mode==='mutation')a.half[2]=.02;if(calls===3&&mode==='throw')throw new Error('depth rejected');return.012;}};
 try{return{value:subject(a,b,depth),trace,half:a.half};}catch(error){return{error:String(error),trace,half:a.half};}
}
test('depth coercion remains after each complete axis read including mutation, reentry and throw',()=>{
 for(const mode of ['normal','mutation','reentry','throw'])assert.deepEqual(observeDepth(actual,mode),observeDepth(before,mode));
});

function oldOverlapsBox(world,p,half,ignore){
 const shape=box(p,half),radius=Math.hypot(...half),candidates=world.candidates(p,radius);
 for(const body of candidates){
  if(body.plane||!body.enabled||body===ignore)continue;
  const dx=body.p[0]-p[0],dy=body.p[1]-p[1],dz=body.p[2]-p[2];
  if(dx*dx+dy*dy+dz*dz>=(body.radius+radius)*(body.radius+radius))continue;
  if((body.cachedBoxes||body.boxes()).some(other=>before(shape,other,.012)))return true;
 }
 for(const body of world.bodies){
  if(body.plane||!body.enabled||body===ignore)continue;
  const dx=body.p[0]-p[0],dy=body.p[1]-p[1],dz=body.p[2]-p[2];
  if(dx*dx+dy*dy+dz*dz>=(body.radius+radius)*(body.radius+radius))continue;
  if((body.cachedBoxes||body.boxes()).some(other=>before(shape,other,.012)))return true;
 }return false;
}
test('actual SolidWorld occupancy keeps frozen SAT results across mutable multi-shape statics and dynamic bodies',()=>{
 const world=new SolidWorld({gravity:[0,0,0]}),random=rng(),bodies=[];
 for(let i=0;i<48;i++)bodies.push(world.add(new SolidBody({p:[(random()-.5)*20,random()*4,(random()-.5)*20],half:[.2+random(),.2+random(),.2+random()],q:Qeuler(random(),random()*.3),mass:i%7===0?10:0,shapes:[{half:[.3,.6,.4],offset:[0,.2,0]},{half:[.6,.2,.3],offset:[.3,-.1,.4],q:Qeuler(.4)}]})));
 world.addPlane({p:[0,0,0],hu:20,hv:20});
 for(let i=0;i<1000;i++){
  if(i%71===0){const body=bodies[i%bodies.length];body.enabled=!body.enabled;}
  if(i%103===0){const body=bodies[(i+3)%bodies.length];body.shapes[0].half[1]=.1+random();}
  const p=[(random()-.5)*22,random()*5,(random()-.5)*22],half=[.1+random()*.6,.2+random(),.1+random()*.6],ignore=i%9===0?bodies[i%bodies.length]:null;
  assert.equal(world.overlapsBox(p,half,ignore),oldOverlapsBox(world,p,half,ignore));
 }
});
