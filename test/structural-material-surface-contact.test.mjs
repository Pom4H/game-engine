import test from 'node:test';
import assert from 'node:assert/strict';
import {StructuralBody} from '../dist/physics/structure.js';
import {StructuralSolidContactSolver,STRUCTURAL_CONTACT_SKIN} from '../dist/physics/structural-solid-contact.js';
import {SolidBody,Qaxis,Qrotate} from '../dist/physics/compound.js';
const material={youngModulusPa:190e9,yieldStressPa:1e15,failureStressPa:1e16,failureStrain:1e4,plasticity:0,brittle:false};
const local=[];for(const x of [-.5,.5])for(const y of [-.5,.5])for(const z of [-.5,.5])local.push([x,y,z]);
const add=(a,b)=>a.map((n,k)=>n+b[k]),dot=(a,b)=>a.reduce((s,n,k)=>s+n*b[k],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
function fixture(q=[0,0,0,1],shift=[0,0,0],projective=true){const constraints=[];for(let a=0;a<8;a++)for(let b=a+1;b<8;b++)constraints.push({kind:'distance',a,b,areaM2:.0001,material});const c=new StructuralBody({nodes:local.map(p=>({position:add(Qrotate(q,p),shift),mass:1})),constraints,projectiveDistances:projective,plasticityMode:'stress',iterations:10,internalDamping:0,sleepDelay:10});c.wake();return c;}
function plane(q,shift){return{plane:true,p:shift,n:Qrotate(q,[0,1,0]),u:Qrotate(q,[1,0,0]),v:Qrotate(q,[0,0,1]),hu:3,hv:3,filter:null};}
function point(c,s){return[0,1,2].map(k=>s.nodes.reduce((v,n,i)=>v+c.position[n*3+k]*s.weights[i],0));}
function ledger(c,h){let K=0,U=0;for(let i=0;i<c.nodeCount;i++)for(let k=0;k<3;k++)K+=.5*c.mass[i]*((c.position[i*3+k]-c.previous[i*3+k])/h)**2;for(let i=0;i<c.constraintCount;i++)if(!c.broken[i]){const s=c.definition.constraints[i],d=Math.hypot(...[0,1,2].map(k=>c.position[s.a*3+k]-c.position[s.b*3+k]))-c.rest[i];U+=.5*d*d/c.compliance[i];}return{K,U};}

test('only physical affine source points collide; auxiliary chart corners in phantom space remain unconstrained',()=>{
 for(const q of [[0,0,0,1],Qaxis([.2,.7,-.3],.8)]){const shift=[2,1,-3],c=fixture(q,shift),nodes=Array.from({length:8},(_,i)=>i),weights=local.map(p=>(1+3.2*p[1])/8);let calls=0,enabled=0;const sample={nodes,weights,radius:.0004,support:()=>{calls++;return .0004;},enabled:()=>{enabled++;return true;}},solver=new StructuralSolidContactSolver(0,[],[],[],[sample]);c.predictStep(1/240,[0,0,0]);const P=c.position.slice(),V=c.velocity.slice();nodes[0]=99;weights[0]=99;solver.project(c,[],[plane(q,shift)]);assert.deepEqual(c.position,P);assert.deepEqual(c.velocity,V);assert.equal(calls,0,'the declared radius rejects distant air without evaluating incident normals');assert.equal(enabled,0);assert.ok(local.some(p=>p[1]<0),'the chart itself crosses the plane');c.disposeNumericalResources();}
});

test('a swept physical sample meets the finite wall through its same affine Schur map without creating bar energy',()=>{
 for(const q of [[0,0,0,1],Qaxis([.3,.4,.2],.7)]){const shift=[2,3,-1],c=fixture(q,add(shift,Qrotate(q,[.1,0,0]))),sample={nodes:Array.from({length:8},(_,i)=>i),weights:Array(8).fill(1/8),radius:0},solver=new StructuralSolidContactSolver(0,[],[],[],[sample]),wall=new SolidBody({p:shift,q,half:[.01,2,2],mass:0}).boxes()[0],n=Qrotate(q,[1,0,0]),h=1/120;for(let i=0;i<8;i++)c.velocity.set(n.map(v=>-20*v),i*3);c.predictStep(h,[0,0,0],b=>solver.project(b,[wall],[]));for(let i=0;i<10;i++)c.projectStep(b=>solver.project(b,[wall],[]),i);const p=point(c,sample),gap=dot(p.map((v,k)=>v-shift[k]),n)-.01-STRUCTURAL_CONTACT_SKIN,E=ledger(c,h);assert.ok(gap>=-1e-9,`the actual source crossed the finite wall: ${gap}`);assert.ok(E.K+E.U<=1600+1e-6);assert.ok(E.U<1e-7);c.disposeNumericalResources();}
});

test('a material sample uses the identical signed stencil for physical mass, point and impulse moment',()=>{
 const q=Qaxis([.3,.7,-.2],.6),shift=[1,-.03,2],c=fixture(q,shift,false),n=Qrotate(q,[0,1,0]),sample={nodes:Array.from({length:8},(_,i)=>i),weights:local.map(p=>(1+3.2*p[0])/8),radius:0},solver=new StructuralSolidContactSolver(0,[],[],[],[sample]),h=1/240;for(let i=0;i<8;i++)c.velocity.set(n.map(v=>-2*v),i*3);c.predictStep(h,[0,0,0]);const before=c.position.slice(),p=point(c,sample),support=plane(q,shift.map((v,k)=>v-n[k]*.009)),gap=dot(p.map((v,k)=>v-support.p[k]),n)-STRUCTURAL_CONTACT_SKIN,k=sample.weights.reduce((s,w)=>s+w*w,0),lambda=-gap/k;assert.ok(gap<0);solver.project(c,[],[support]);const P=[0,0,0],L=[0,0,0];for(let i=0;i<8;i++){const delta=[0,1,2].map(a=>c.position[i*3+a]-before[i*3+a]);for(let a=0;a<3;a++){assert.ok(Math.abs(delta[a]-n[a]*lambda*sample.weights[i])<1e-14);P[a]+=delta[a];}const moment=cross(before.slice(i*3,i*3+3),delta);for(let a=0;a<3;a++)L[a]+=moment[a];}const expected=cross(p,n.map(v=>lambda*v));for(let a=0;a<3;a++){assert.ok(Math.abs(P[a]-lambda*n[a])<1e-13);assert.ok(Math.abs(L[a]-expected[a])<1e-13);}c.disposeNumericalResources();
});

test('retired affine support releases its previous unilateral load instead of binding zero-mass chart slots',()=>{
 const c=fixture(),sample={nodes:[0,1,2,3,4,5,6,7],weights:Array(8).fill(1/8),radius:0},solver=new StructuralSolidContactSolver(0,[],[],[],[sample]);c.predictStep(1/240,[0,0,0]);const p=plane([0,0,0,1],[0,.001,0]);solver.project(c,[],[p]);assert.ok(c.projective.external.some(v=>v!==0));c.detachNode(1);solver.project(c,[],[p]);assert.ok(c.projective.external.every(v=>Math.abs(v)<1e-14));c.disposeNumericalResources();
});

test('a physically disabled incident surface removes its previous load within the same prediction',()=>{
 const c=fixture();let enabled=true;const sample={nodes:[0,1,2,3,4,5,6,7],weights:Array(8).fill(1/8),radius:0,enabled:()=>enabled},solver=new StructuralSolidContactSolver(0,[],[],[],[sample]),p=plane([0,0,0,1],[0,.001,0]);c.predictStep(1/240,[0,0,0]);solver.project(c,[],[p]);assert.ok(c.projective.external.some(v=>v!==0));enabled=false;solver.project(c,[],[p]);assert.ok(c.projective.external.every(v=>Math.abs(v)<1e-14));c.disposeNumericalResources();
});
