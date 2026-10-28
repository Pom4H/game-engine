import test from 'node:test';
import assert from 'node:assert/strict';
import {SolidBody,Qrotate} from '../dist/physics/compound.js';
import {rotationAxesBefore,boxesBefore,QrotateBefore} from './fixtures/rotation-axes-before-scalar.mjs';

const bytes=values=>Buffer.from(new Float64Array(values.flat(Infinity)).buffer).toString('hex');
const axesActual=q=>{const body=new SolidBody();body.q=q;return body.axes();};
function random(seed=0x534812ad){return()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/4294967296;};}

test('actual body axes match frozen Float64 bytes for1097 finite, extreme, nonunit and nonfinite quaternions',()=>{
 const special=[0,-0,1,-1,.5,-.5,Number.MIN_VALUE,-Number.MIN_VALUE,Number.MAX_VALUE,-Number.MAX_VALUE,1e-300,-1e-300,1e150,-1e150,Infinity,-Infinity,NaN];
 const cases=[[0,0,0,1],[0,0,0,0],[-0,-0,-0,-0],[.1,.2,.3,.4],[1,2,3,4]];
 for(let index=0;index<4;index++)for(const value of special){const q=[.125,-.25,.5,1];q[index]=value;cases.push(q);}
 const next=random();for(let i=0;i<1024;i++){const scale=i%5===0?1e150:i%5===1?1e-150:i%5===2?10:1;cases.push(Array.from({length:4},()=>((next()-.5)*2)*scale));}
 for(const q of cases)assert.equal(bytes(axesActual(q)),bytes(rotationAxesBefore(q)));
 assert.equal(cases.length,1097);
});

function observable(rotate,kind,failAt=Infinity){
 const trace=[];let event=0,nested=false;
 const record=value=>{trace.push(value);if(++event===failAt)throw new Error('abort-event-'+event);};
 const values=[.125,-.25,.5,.75],reads=[0,0,0,0],objects=values.map(value=>({value}));
 for(const [index,object]of objects.entries()){
  const convert=hint=>{record(`coerce:${index}:${hint}:${object.value}`);if(index===0)objects[1].value+=.03125;if(kind==='reentry'&&!nested){nested=true;record('nested:begin');record('nested:bytes:'+bytes(rotate([-.125,.25,-.5,1])));nested=false;}return object.value;};
  if(kind==='valueOf')Object.defineProperty(object,'valueOf',{get(){record('valueOf:get:'+index);return()=>convert('valueOf');}});else object[Symbol.toPrimitive]=convert;
 }
 const target=[];for(let index=0;index<4;index++)Object.defineProperty(target,String(index),{enumerable:true,configurable:true,get(){record(`get:${index}:${reads[index]}`);reads[index]++;if(index===3)objects[0].value-=.0625;return kind==='getter'?values[index]+reads[index]*.015625:objects[index];}});
 const q=kind==='proxy'?new Proxy(target,{get(target,key,receiver){record('proxy:get:'+String(key));return Reflect.get(target,key,receiver);},getOwnPropertyDescriptor(target,key){record('proxy:descriptor:'+String(key));return Reflect.getOwnPropertyDescriptor(target,key);},ownKeys(target){record('proxy:keys');return Reflect.ownKeys(target);}}):target;
 try{return{trace,bytes:bytes(rotate(q)),error:null};}catch(error){return{trace,bytes:null,error:{name:error.name,message:error.message}};}
}

test('actual axes preserve all getter, proxy, coercion and reentrant events and every throw prefix',()=>{
 let scenarios=0,throws=0;
 for(const kind of ['getter','coercion','valueOf','reentry','proxy']){
  const before=observable(rotationAxesBefore,kind),actual=observable(axesActual,kind);assert.deepEqual(actual,before);scenarios++;
  for(let failAt=1;failAt<=before.trace.length;failAt++){assert.deepEqual(observable(axesActual,kind,failAt),observable(rotationAxesBefore,kind,failAt));throws++;}
 }
 assert.equal(scenarios,5);assert.equal(throws,387);
});

test('body quaternion reads once and same-body reentry keeps its captured outer quaternion',()=>{
 function run(frozen){
  const body=new SolidBody(),trace=[];if(frozen)body.axes=function(){return rotationAxesBefore(this.q);};
  const raw=[.125,-.25,.5,.75];let nested=false;
  const q=new Proxy(raw,{get(target,key,receiver){trace.push('get:'+String(key));if(key==='0'&&!nested){nested=true;body.q=[-.125,.25,-.5,1];trace.push('inner:'+bytes(body.axes()));body.q=q;nested=false;}return Reflect.get(target,key,receiver);}});
  body.q=q;const output=body.axes();return{trace,bytes:bytes(output),retainsQuaternion:body.q===q};
 }
 assert.deepEqual(run(false),run(true));
 for(const subject of [rotationAxesBefore,axesActual]){
  const trace=[],q=[.1,.2,.3,.4],body=new SolidBody();Object.defineProperty(body,'q',{get(){trace.push('body.q');return q;}});
  const axes=subject===axesActual?body.axes():subject(body.q);assert.equal(bytes(axes),bytes(rotationAxesBefore(q)));assert.deepEqual(trace,['body.q']);
 }
});

test('fresh mutable axes survive direct in-place and replacement quaternion changes',()=>{
 const body=new SolidBody();body.q=[.1,.2,.3,.4];const first=body.axes(),second=body.axes();
 assert.notEqual(first,second);for(let i=0;i<3;i++){assert.notEqual(first[i],second[i]);for(let j=0;j<i;j++)assert.notEqual(first[i],first[j]);}
 first[0][0]=900;assert.equal(bytes(second),bytes(rotationAxesBefore(body.q)));assert.equal(bytes(body.axes()),bytes(second));
 body.q[1]=-.6;assert.equal(bytes(body.axes()),bytes(rotationAxesBefore(body.q)));body.q=[-.3,.2,.1,-.4];assert.equal(bytes(body.axes()),bytes(rotationAxesBefore(body.q)));
});

const boxSignature=boxes=>boxes.map(box=>({body:box.body,tag:box.tag,structureNode:box.structureNode,structureBeam:box.structureBeam,geometry:bytes([box.p,box.axes,box.half,box.bounds])}));
test('real compound shape composition and bounds match frozen bytes through pose and local-shape changes',()=>{
 const next=random(0x487253a),body=new SolidBody({mass:10,tag:'chassis'});
 for(let i=0;i<160;i++){
  body.p=[(next()-.5)*10,(next()-.5)*10,(next()-.5)*10];body.q=Array.from({length:4},()=>((next()-.5)*2)*(i%9===0?3:1));
  body.shapes=[{half:[.7,.4,1.2],offset:[0,0,0]},{half:[.4,.3,.6],offset:[1,.4,0],q:[.1,-.2,.3,.4],tag:'door',structureNode:3,structureBeam:5},{half:[.2,.3,.4]}];
  if(i%4===0)body.shapes[1].q[1]=i%8===0?-0:Infinity;
  assert.deepEqual(boxSignature(body.boxes()),boxSignature(boxesBefore(body)));
 }
 body.q=[.1,.2,.3,.4];const a=body.boxes(),b=body.boxes();assert.notEqual(a,b);assert.notEqual(a[0],b[0]);assert.notEqual(a[0].p,b[0].p);assert.notEqual(a[0].axes,b[0].axes);assert.notEqual(a[0].bounds,b[0].bounds);
 assert.equal(a[0].axes,a[2].axes);assert.notEqual(a[0].axes,a[1].axes);assert.equal(a[0].half,body.shapes[0].half);assert.equal(a[1].half,body.shapes[1].half);
 a[0].axes[0][0]=900;a[0].p[0]=900;assert.deepEqual(boxSignature(body.boxes()),boxSignature(boxesBefore(body)));
 body.shapes[1].q=[-.2,.1,.3,1];body.shapes[0].half[0]+=.2;body.shapes[2].offset=[.3,-.2,.1];assert.deepEqual(boxSignature(body.boxes()),boxSignature(boxesBefore(body)));
});

test('custom public axis and point overrides remain observable and public Qrotate is unchanged',()=>{
 const body=new SolidBody({shapes:[{half:[1,1,1]},{half:[.2,.3,.4],q:[0,0,0,1]}]}),axes=[[1,0,0],[0,1,0],[0,0,1]],trace=[];
 body.axes=function(){trace.push('axes');return axes;};body.point=function(p){trace.push('point:'+p.join(','));return [7,8,9];};
 const boxes=body.boxes();assert.deepEqual(trace,['axes','point:0,0,0','point:0,0,0']);assert.equal(boxes[0].axes,axes);assert.notEqual(boxes[1].axes,axes);assert.deepEqual(boxes.map(box=>box.p),[[7,8,9],[7,8,9]]);
 // Unchanged public math can emit different NaN sign/payload bits after JIT
 // warmup (ECMAScript NumericToRawBytes). Keep all other component bits exact;
 // the changed private axes/boxes assertions above remain fully bitwise.
 for(const q of [[0,0,0,1],[.1,.2,.3,.4],[0,-0,0,1],[.5,.5,.5,Number.MAX_VALUE],[-0,Infinity,-1,NaN]])for(const v of [[1,0,0],[.2,-.3,.4],[-0,0,-0],[2,0,0]]){
  const actual=Qrotate(q,v),before=QrotateBefore(q,v);
  for(let i=0;i<3;i++)if(Number.isNaN(before[i]))assert.ok(Number.isNaN(actual[i]));else assert.equal(bytes([actual[i]]),bytes([before[i]]));
 }
});
