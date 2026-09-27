import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {EXAMPLES,LEGACY_PENDING} from '../tools/docs/examples.mjs';
import {SourceDocument,rebaseBindings} from '../tools/docs/document.mjs';
import {CompilerClient} from '../tools/docs/compiler-client.mjs';
import * as api from '../dist/dsl/index.js';
import {installProgram,programVehicles} from '../dist/dsl/runtime.js';
import {planProgramEdit,applyLiveProgram} from '../dist/dsl/edits.js';
import {Scene} from '../dist/scene/scene.js';
const require=createRequire(new URL('../tools/docs/package.json',import.meta.url));
const ts=require('typescript'),{compileSource}=require('./compile.cjs'),{analyze,editsFor,applyEdits}=require('./bindings.cjs');
const compile=source=>compileSource(ts,api,source);
const change=(source,key,value)=>{const b=analyze(ts,source).bindings.find(b=>b.key===key);assert.ok(b,key);return applyEdits(source,editsFor(source,b,value));};
for(const example of EXAMPLES)test(`DSL example ${example.id}: real Scene/Vehicle install, step and disposal`,()=>{
 const p=compile(example.source),scene=new Scene(p.scene);installProgram(scene,p);
 for(let i=0;i<15;i++)scene.step(1/60);
 assert.equal(scene.tick,15);assert.ok(scene.entities.size>0);
 for(const e of scene.entities.values())assert.ok(e.position.every(Number.isFinite),e.id);
 for(const [id,handle] of programVehicles(scene)){assert.equal(handle.vehicle.body,scene.physics.bodies.get(id));assert.equal(handle.vehicle.body.mass,handle.vehicle.blueprint.massKg);}
 scene.dispose();assert.equal(scene.physics.bodies.size,0);assert.equal(scene.entities.size,0);
});
test('AST patch changes only the intended numeric literal; comments/other roughness survive',()=>{
 const code=`// roughness: .2\nconst cfg = {material: {roughness: .2 /* keep */}, paint: {roughness: .7}};`;
 const b=analyze(ts,code).bindings.filter(b=>b.key==='roughness')[1];const edited=applyEdits(code,editsFor(code,b,.35));
 assert.equal(edited,code.replace('roughness: .7','roughness: 0.35'));
 assert.throws(()=>editsFor(edited,b,.6),/Source changed/);
});
test('scope-aware constant edits change the declaration; expressions are not overwritten',()=>{
 const code=`const r=.2; const material={roughness:r}; function f(r){return {roughness:r}}; const paint={roughness:.1+.2};`;
 const b=analyze(ts,code).bindings;
 assert.equal(b[0].raw,'.2');assert.ok(b[0].editable);assert.equal(b[1].editable,false);assert.equal(b[2].editable,false);
 assert.equal(applyEdits(code,editsFor(code,b[0],.5)),code.replace('r=.2','r=0.5'));
 assert.throws(()=>editsFor(code,b[2],.5),/read-only/);
});
test('vector edits retain comments and alpha; aliased vector axes are not offered as independent controls',()=>{
 const code='const paint={color:[.1, /* green */ .2, .3, .65]};';const b=analyze(ts,code).bindings[0];
 assert.equal(applyEdits(code,editsFor(code,b,[.4,.5,.6,.65])), 'const paint={color:[0.4, /* green */ 0.5, 0.6, .65]};');
 const other=analyze(ts,'const x=1; const a={position:[x,x,x]}').bindings[0];assert.equal(other.editable,false);
});
test('rapid HUD edits rebase source ranges without needing a compiler roundtrip',()=>{
 let code='const x={rendering:{exposure:1},paint:{roughness:.2}};',bs=analyze(ts,code).bindings;
 for(const [key,value] of [['exposure',1.125],['roughness',.365],['exposure',.75],['roughness',.01]]){
  const b=bs.find(b=>b.key===key),edits=editsFor(code,b,value);code=applyEdits(code,edits);bs=rebaseBindings(bs,edits,code,b.id,value);
 }
 assert.equal(code,'const x={rendering:{exposure:0.75},paint:{roughness:0.01}};');
});
test('keyboard and HUD use one bounded undo/redo history',()=>{
 const d=new SourceDocument('const x=1');d.set('const x=12',{group:'typing',at:100});d.set('const x=123',{group:'typing',at:200});d.end();d.set('const x=5',{group:'hud:x',at:300});d.set('const x=6',{group:'hud:x',at:400});
 assert.equal(d.undo().source,'const x=123');assert.equal(d.undo().source,'const x=1');assert.equal(d.redo().source,'const x=123');
 for(let i=0;i<200;i++)d.set(String(i));assert.ok(d.past.length<=100);
});
test('latest-wins worker never publishes stale results and coalesces pending work',()=>{
 const posted=[],seen=[],worker={postMessage:x=>posted.push(x),terminate(){}};
 const c=new CompilerClient(reply=>seen.push(reply),{createWorker:()=>worker,timeoutMs:10000});
 c.submit('a',1);c.submit('b',2);c.submit('c',3);assert.equal(posted.length,1);
 worker.onmessage({data:{id:posted[0].id,program:'a'}});assert.equal(seen.length,0);assert.equal(posted.length,2);assert.equal(posted[1].source,'c');
 worker.onmessage({data:{id:posted[1].id,program:'c'}});assert.equal(seen.length,1);assert.equal(seen[0].revision,3);c.dispose();
});
test('worker timeout terminates a hung program and accepts the next job',async()=>{
 const workers=[],seen=[];const c=new CompilerClient(r=>seen.push(r),{timeoutMs:12,createWorker:()=>{const w={posted:[],dead:false,postMessage(x){this.posted.push(x)},terminate(){this.dead=true}};workers.push(w);return w;}});
 c.submit('while(true){}',1);await new Promise(r=>setTimeout(r,30));assert.ok(workers[0].dead);assert.match(seen[0].error,/лимиту/);
 c.submit('ok',2);workers[1].onmessage({data:{id:workers[1].posted[0].id,program:'ok'}});assert.equal(seen.at(-1).program,'ok');c.dispose();
});
test('source errors/invalid descriptors/imports are rejected before installation',()=>{
 assert.throws(()=>compile('export default scene({'),SyntaxError);
 assert.throws(()=>compile("import fs from 'node:fs'; export default fs"),/Unsupported import/);
 assert.throws(()=>compile(EXAMPLES[0].source.replace('massKg: 1500','massKg: -1')),/mass/i);
 assert.throws(()=>compile(' '.repeat(64001)),/budget/);
});
test('camera, material and input edits preserve body identity, motion and wear',()=>{
 let src=EXAMPLES.find(e=>e.id==='wear').source,program=compile(src);const scene=new Scene(program.scene);installProgram(scene,program);for(let i=0;i<30;i++)scene.step(1/60);
 const h=programVehicles(scene).get('car'),body=h.vehicle.body,t=scene.time,wear=h.vehicle.part('rear.left').wear,velocity=[...body.velocity];
 for(const [key,value] of [['exposure',1.6],['roughness',.65],['steer',-.5],['orbit.1',13]]){
  src=change(src,key,value);const next=compile(src),edit=planProgramEdit(program,next);assert.equal(edit.mode,'live',key);applyLiveProgram(scene,program,next,edit);program=next;
  assert.equal(programVehicles(scene).get('car').vehicle.body,body);assert.equal(scene.time,t);assert.deepEqual(body.velocity,velocity);assert.equal(h.vehicle.part('rear.left').wear,wear);
 }
 assert.equal(scene.spec.rendering.exposure,1.6);assert.equal(scene.entities.get('car/body').material.roughness,.65);
 scene.dispose();
});
test('physical/material-default/alpha changes require explicit rebuild; exact no-op has no patch',()=>{
 const source=EXAMPLES[0].source,a=compile(source);
 const mass=compile(change(source,'massKg',1300));assert.equal(planProgramEdit(a,mass).mode,'rebuild');
 const other=compile(source.replace('roughness: .24,',''));assert.equal(planProgramEdit(a,other).mode,'rebuild');
 const alpha=compile(source.replace('.30, 1]', '.30, .5]'));assert.equal(planProgramEdit(a,alpha).mode,'rebuild');
 assert.deepEqual(planProgramEdit(a,compile(source)).patch,{});
});
test('authoring session reuses vehicle surface/wheels on appearance edits and remains bounded',()=>{
 const session=api.authoringSession(),dsl={...api,assembly:session.assembly};let source=EXAMPLES[0].source;
 session.begin();const a=compileSource(ts,dsl,source);session.end();source=change(source,'exposure',1.5);
 session.begin();const b=compileSource(ts,dsl,source);session.end();assert.equal(a.vehicles[0].geometry.body,b.vehicles[0].geometry.body);assert.equal(session.diagnostics()[0].bodyBuilds,1);
 session.begin();session.end();assert.equal(session.diagnostics().length,0);session.clear();
});
test('migration coverage never presents coupled-physics/network/storage as completed',()=>{
 for(const id of ['full-crash','full-network','full-storage','full-city','full-audio'])assert.ok(LEGACY_PENDING.some(x=>x.id===id));
 for(const x of EXAMPLES.filter(x=>x.legacy.includes('full-crash')))assert.equal(x.status,'partial');
});

test('bindings retain semantic IDs across literal length, comments and whitespace edits',()=>{
 const a=EXAMPLES[0].source,b=a.replace('exposure: 1,','exposure: .625,').replace('roughness: .24','roughness: 0.125');
 assert.deepEqual(analyze(ts,a).bindings.map(b=>b.id),analyze(ts,'// header\n'+b).bindings.map(b=>b.id));
 const ids=analyze(ts,a).bindings.map(b=>b.id);assert.equal(new Set(ids).size,ids.length);
});
test('rebased shared scalar and vector references remain coherent before the worker replies',()=>{
 let code='const r=.2; const cfg={rendering:{exposure:r},paint:{color:[r, .4, .5, 1]}};',bs=analyze(ts,code).bindings;
 let b=bs.find(b=>b.key==='exposure'),edits=editsFor(code,b,.7);code=applyEdits(code,edits);bs=rebaseBindings(bs,edits,code,b.id,.7);
 b=bs.find(b=>b.key==='color');assert.deepEqual(b.value,[.7,.4,.5,1]);assert.equal(b.elements[0].raw,'0.7');
 edits=editsFor(code,b,[.7,.9,.5,1]);code=applyEdits(code,edits);bs=rebaseBindings(bs,edits,code,b.id,[.7,.9,.5,1]);
 assert.equal(code,'const r=0.7; const cfg={rendering:{exposure:r},paint:{color:[r, 0.9, .5, 1]}};');
 assert.equal(bs.find(b=>b.key==='exposure').value,.7);
 edits=editsFor(code,bs.find(b=>b.key==='color'),[.3,.9,.5,1]);code=applyEdits(code,edits);bs=rebaseBindings(bs,edits,code,b.id,[.3,.9,.5,1]);
 assert.equal(bs.find(b=>b.key==='exposure').value,.3);
 assert.deepEqual(bs.find(b=>b.key==='color').value,[.3,.9,.5,1]);
});
test('no-op edits preserve numeric spelling, references and comments',()=>{
 const code='const c={paint:{color:[.1, /* keep */ .2, .3, 1]}, massKg:1_500};';
 for(const b of analyze(ts,code).bindings)assert.deepEqual(editsFor(code,b,b.value),[]);
 assert.equal(analyze(ts,'const c={paint:{color:[.1,.2]}}').bindings[0].editable,false);
});
test('cancel invalidates pending compiler replies without running queued imported code',()=>{
 const workers=[],seen=[];const c=new CompilerClient(r=>seen.push(r),{createWorker:()=>{const w={posted:[],dead:false,postMessage(x){this.posted.push(x)},terminate(){this.dead=true}};workers.push(w);return w;}});
 c.submit('old',1);c.submit('queued',2);const old=workers[0],reply=old.onmessage;c.cancel();
 reply({data:{id:old.posted[0].id,program:'old'}});assert.ok(old.dead);assert.equal(seen.length,0);assert.equal(old.posted.length,1);
 c.submit('approved',3);const next=workers[1];next.onmessage({data:{id:next.posted[0].id,program:'approved'}});assert.equal(seen[0].program,'approved');c.dispose();
});
