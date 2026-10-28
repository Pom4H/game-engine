import test from 'node:test';
import assert from 'node:assert/strict';
import {StructuralBody} from '../dist/physics/structure.js';
import {StructuralSolidContactSolver} from '../dist/physics/structural-solid-contact.js';
import {StructuralSolidContactSolver as Before} from './fixtures/structural-material-before-compiled.mjs';

const material={youngModulusPa:190e9,yieldStressPa:1e15,failureStressPa:1e16,failureStrain:1e4,plasticity:0,brittle:false};
function fixture(projective=false){const nodes=[];for(let k=0;k<2;k++)for(let j=0;j<3;j++)for(let i=0;i<3;i++)nodes.push({position:[(i-1)*.2,(j-1)*.1,k*.02],mass:1});const constraints=[];for(let a=0;a<nodes.length;a++)for(let b=a+1;b<nodes.length;b++)constraints.push({kind:'distance',a,b,areaM2:.00001,material});const c=new StructuralBody({nodes,constraints,projectiveDistances:projective,iterations:10,plasticityMode:'stress',internalDamping:0,sleepDelay:10});c.wake();return c;}
const plane=(height=0,filter=null)=>({plane:true,p:[0,height,0],n:[0,1,0],u:[1,0,0],v:[0,0,1],hu:5,hv:5,filter});
const bits=value=>Buffer.from(value.buffer,value.byteOffset,value.byteLength);

test('compiled material sums preserve frozen-source order, zero terms, exact bits and immediate one-ulp public edits',()=>{
 const c=fixture(),nodes=Array.from({length:18},(_,i)=>i),weights=nodes.map(i=>i===0?-0:i===1?.125:i<16?.0625:i===16?-.125:.125),solver=new StructuralSolidContactSolver(0,[],[],[],[{nodes,weights,radius:0}]),owned=solver.materialSamples[0],original=solver.samplePoint;let calls=0;
 assert.ok(Object.isFrozen(owned));assert.ok(Object.isFrozen(owned.nodes));assert.ok(Object.isFrozen(owned.weights));assert.ok(Object.is(owned.weights[0],-0));assert.ok(!Object.getOwnPropertyNames(solver).includes('materialMath'));
 solver.samplePoint=function(body,sample,previous){assert.ok(sample.nodes instanceof Float64Array);assert.ok(sample.weights instanceof Float64Array);assert.notEqual(sample.nodes,owned.nodes);assert.notEqual(sample.weights,owned.weights);const expected=new Float64Array(3),p=previous?body.previous:body.position;for(let i=0;i<owned.nodes.length;i++){const j=owned.nodes[i]*3,w=owned.weights[i];expected[0]+=p[j]*w;expected[1]+=p[j+1]*w;expected[2]+=p[j+2]*w;}const actual=original.call(this,body,sample,previous);assert.ok(bits(actual).equals(bits(expected)));calls++;return actual;};
 try{c.position.fill(0);c.previous.fill(-0);c.position[3]=.5;c.previous[3]=.25;for(let i=0;i<18;i++){c.position[i*3+1]=(i%2?-1:1)*2**(i%12);c.position[i*3+2]=[1e16,1,-1e16][i%3];}nodes.fill(999);weights.fill(999);solver.project(c,[],[]);const before=c.position[3];c.position[3]+=Number.EPSILON/2;assert.notEqual(c.position[3],before);solver.project(c,[],[]);assert.equal(calls,4);}finally{c.disposeNumericalResources();}
});

test('compiled indices do not truncate a safe integer outside the actual owner range',()=>{
 const c=fixture(),solver=new StructuralSolidContactSolver(0,[],[],[],[{nodes:[0,2**32],weights:[.5,.5],radius:0}]);try{assert.throws(()=>solver.project(c,[],[]),/exceeds its structural owner/);}finally{c.disposeNumericalResources();}
});

function callbackRun(Solver,projective){const c=fixture(projective),trace=[],nodes=[0,1,4,5,9,10,13,14],weights=[.125,-.125,.25,.25,.125,.125,.125,.125],sample={nodes,weights,radius:.0004,support(normal,body){trace.push(['support',...normal,body.position[0],body.previous[0]]);body.position[3]+=Number.EPSILON/2;return .0004;},enabled(body){assert.ok(Object.isFrozen(this));assert.ok(Object.isFrozen(this.nodes));assert.ok(Object.isFrozen(this.weights));trace.push(['enabled',body.position[3],body.previous[3]]);body.previous[3]+=Number.EPSILON/2;return true;}},solver=new Solver(0,[],[],[],[sample]),ground=plane(.04,p=>{trace.push(['filter',...p]);c.position[0]+=Number.EPSILON;c.previous[0]-=Number.EPSILON;return true;});
 try{for(let i=0;i<c.nodeCount;i++)c.velocity[i*3+1]=-1;c.predictStep(1/240,[0,0,0]);for(let step=0;step<3;step++)solver.project(c,[],[ground]);c.detachNode(4);solver.project(c,[],[ground]);return{trace,position:c.position.slice(),previous:c.previous.slice(),velocity:c.velocity.slice(),mass:c.mass.slice(),force:c.force.slice(),external:c.projective?.external.slice()};}finally{c.disposeNumericalResources();}}
test('callbacks retain exact order and observe direct position/previous edits; retiring a signed stencil unloads the identical prior row',()=>{
 for(const projective of [false,true])assert.deepEqual(callbackRun(StructuralSolidContactSolver,projective),callbackRun(Before,projective));
});
