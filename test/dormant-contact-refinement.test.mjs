import test from 'node:test';
import assert from 'node:assert/strict';
import {SolidBody,SolidWorld,Vadd,Vsub,Vscale,Vcross,Vdot,Qmul,Qunit} from '../dist/physics/compound.js';

// Instrumented exact rigid-motion adapters isolate Engine's phase ordering;
// they do not substitute a material law or introduce scripted panel deformation.
function fixture({reverse=false,staticTarget=false,closing=true,active=false}={}){
 const world=new SolidWorld({gravity:[0,0,0]}),near={offset:[0,0,0],half:[.2,.2,.2]},front={offset:[0,0,1],half:[.2,.2,.2]},a=world.add(new SolidBody({p:[0,1,0],mass:12,half:[.2,.7,1.7],shapes:reverse?[front,near]:[near,front],friction:0})),b=world.add(new SolidBody({p:[0,1,0],mass:staticTarget?0:12,half:[.2,.7,1.7],shapes:[{offset:[0,.41,0],half:[.2,.2,.2]},{offset:[0,0,1.41],half:[.2,.2,.2]}],friction:0})),events=[],owners=[];a.v=[.3,0,closing?2:0];if(!staticTarget)b.v=[.3,0,0];
 function attach(body,name){let v=[...body.v],w=[...body.w];const owner={active,advances:0,phased:0,projects:0,impulses:0,refineStaticsBeforePrediction:true,activate(){if(!this.active){v=[...body.v];w=[...body.w];}this.active=true;body.wake();},pointVelocity:p=>Vadd(v,Vcross(w,Vsub(p,body.p))),inverseEffectiveMass(p,n){const r=Vsub(p,body.p);return body.invMass+Vdot(n,Vcross(body.inertia(Vcross(r,n)),r));},impulse(j,p){this.impulses++;v=Vadd(v,Vscale(j,body.invMass));w=Vadd(w,body.inertia(Vcross(Vsub(p,body.p),j)));},force(){},torque(){},advance(h){this.advances++;body.p=Vadd(body.p,Vscale(v,h));const qd=Qmul([...w,0],body.q);body.q=Qunit(body.q.map((n,k)=>n+qd[k]*h*.5));},beginAdvance(h){this.phased++;this.advance(h);},projectAdvance(){this.projects++;},endAdvance(){},syncAfterContacts(){body.v=[...v];body.w=[...w];}};body.deformable=owner;body.contactRefinement=(_p,_n,speed)=>{events.push({name,speed,p:[...body.p],beforeAdvance:owner.advances});owner.activate();};owners.push(owner);}
 attach(a,'a');if(!staticTarget)attach(b,'b');
 const momentum=()=>{const P=[0,0,0],L=[0,0,0];for(const body of [a,b])if(body.invMass){const p=Vscale(body.v,body.mass),l=Vadd(Vcross(body.p,p),body.angularMomentum());for(let k=0;k<3;k++){P[k]+=p[k];L[k]+=l[k];}}return{P,L};},initial=momentum();world.step(1/120);return{world,a,b,owners,events,initial,final:momentum(),contacts:world.contacts.map(c=>({p:c.p,n:c.n,depth:c.depth,jn:c.jn,approach:c.approach})),dispose(){for(const body of [...world.bodies])world.remove(body);}};
}
const close=(a,b)=>a.forEach((n,k)=>assert.ok(Math.abs(n-b[k])<1e-10,`${n} versus ${b[k]}`));

test('a nonclosing first margin pair cannot hide a later closing dormant dynamic face on the first tick',()=>{
 const forward=fixture(),reverse=fixture({reverse:true});try{
  for(const f of [forward,reverse]){assert.ok(f.contacts.some(c=>c.jn>0));assert.ok(f.events.length>=2);assert.equal(f.events[0].p[2],0,'refinement must precede rigid prediction');assert.equal(f.events[0].beforeAdvance,0);assert.ok(f.owners.every(o=>o.advances===1&&o.phased===1&&o.projects===10&&o.impulses>0));close(f.final.P,f.initial.P);close(f.final.L,f.initial.L);}
  assert.deepEqual(forward.contacts,reverse.contacts);close(forward.a.p,reverse.a.p);close(forward.a.v,reverse.a.v);close(forward.a.w,reverse.a.w);close(forward.b.v,reverse.b.v);
 }finally{forward.dispose();reverse.dispose();}
});
test('static refinement retains the same first-tick contact result for both compound face orders',()=>{
 const forward=fixture({staticTarget:true}),reverse=fixture({staticTarget:true,reverse:true});try{for(const f of [forward,reverse]){assert.equal(f.events[0].p[2],0);assert.equal(f.owners[0].advances,1);assert.ok(f.contacts.some(c=>c.jn>0));}assert.deepEqual(forward.contacts,reverse.contacts);close(forward.a.v,reverse.a.v);close(forward.a.w,reverse.a.w);}finally{forward.dispose();reverse.dispose();}
});
test('all nonclosing swept-margin pairs leave dormant owners dormant',()=>{const f=fixture({closing:false});try{assert.deepEqual(f.events,[]);assert.equal(f.contacts.length,0);assert.ok(f.owners.every(o=>!o.active&&o.advances===0&&o.phased===0));close(f.final.P,f.initial.P);close(f.final.L,f.initial.L);}finally{f.dispose();}});
test('already active owners retain their phased prediction and exact contact order',()=>{const f=fixture({active:true});try{assert.ok(f.owners.every(o=>o.phased===1&&o.projects===10));assert.ok(f.contacts.some(c=>c.jn>0));close(f.final.P,f.initial.P);close(f.final.L,f.initial.L);}finally{f.dispose();}});
