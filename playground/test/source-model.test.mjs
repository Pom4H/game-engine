import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileSource} from '../../.qa/playground/compiler.js';
import {SourceDocument,literal,rebase,validateBindings} from '../../.qa/playground/source-document.js';
import {ProgramRuntime} from '../../.qa/src/dsl/runtime.js';
const catalog=JSON.parse(readFileSync(new URL('../examples/catalog.json',import.meta.url)));
const read=id=>readFileSync(new URL(`../examples/${id}.ts`,import.meta.url),'utf8');
const source=`import { scene, camera, body } from '@rom4/game-engine/dsl';\nconst roughness = 0.25; // preserve this explanation\nexport default scene({ camera: camera([7,3,8], [0,1,0], 42), rendering: { exposure: 1 } }, [\n body('metal', { position: [0,1,0], mesh: { kind: 'sphere', radius: 1 }, material: { kind: 'steel', roughness, metalness: 0.8 } }),\n body('other', { position: [-2,1,0], mesh: { kind: 'sphere', radius: 0.5 }, material: { roughness } }),\n]);\n`;
const edit=(doc,bindings,key,value,group)=>{const b=bindings.find(b=>b.key===key),before=bindings,e={...b.span,replacement:literal(value,b.span.text)};doc.edit([e],doc.version,group);const next=rebase(bindings,[e]);for(let i=0;i<next.length;i++)if(before[i].span.start===e.start&&before[i].span.end===e.end)next[i].value=value;return next;};

test('every migrated example compiles as TS, constructs production runtime and steps without synthetic fallback',()=>{
 for(const example of catalog){const text=read(example.id),{program,bindings}=compileSource(text);validateBindings(bindings,text);const runtime=new ProgramRuntime(program);
  for(let i=0;i<20;i++)runtime.step();assert.ok(runtime.scene.entities.size>0,example.id);assert.ok(Math.abs(runtime.scene.time-20/60)<1e-12,example.id);
  runtime.dispose();assert.equal(runtime.scene.physics.bodies.size,0,example.id);
 }
});

test('HUD edits a const initializer by AST span and preserves comments/formatting/aliases',()=>{
 const compiled=compileSource(source),doc=new SourceDocument(source),b=compiled.bindings.find(b=>b.owner==='metal'&&b.path==='material.roughness');
 assert.ok(b.writable);assert.equal(b.shared,2);assert.equal(b.span.text,'0.25');
 const next=edit(doc,compiled.bindings,b.key,.63,'roughness');assert.equal(doc.text,source.replace('= 0.25;','= 0.63;'));validateBindings(next,doc.text);
 const after=compileSource(doc.text);assert.equal(after.program.items[0].material.roughness,.63);assert.equal(after.program.items[1].material.roughness,.63);
 assert.equal(after.bindings.find(x=>x.key===b.key).value,.63);
});

test('one drag is one undo transaction; code and HUD use the SAME redo stack',()=>{
 const doc=new SourceDocument(source);let bindings=compileSource(source).bindings;const key=bindings.find(b=>b.path==='rendering.exposure').key;
 for(let i=0;i<30;i++)bindings=edit(doc,bindings,key,1+i/10,'drag');doc.endGroup();const dragged=doc.text;
 doc.replace(doc.text+'// typed\n','typing');doc.endGroup();assert.equal(doc.undo(),true);assert.equal(doc.text,dragged);assert.equal(doc.undo(),true);assert.equal(doc.text,source);
 assert.equal(doc.redo(),true);assert.equal(doc.text,dragged);assert.equal(doc.redo(),true);assert.ok(doc.text.endsWith('// typed\n'));
});

test('stale and overlapping source patches are rejected, not matched by regex or label',()=>{
 const doc=new SourceDocument(source),b=compileSource(source).bindings[0],version=doc.version;doc.replace('// inserted\n'+doc.text);
 assert.throws(()=>doc.edit([{...b.span,replacement:'2'}],version));assert.throws(()=>doc.edit([{start:0,end:2,text:'XX',replacement:'3'}],doc.version));
 assert.equal(doc.text,'// inserted\n'+source);
});

test('negative numbers, strings, arrays and booleans retain neighboring comments on UI changes',()=>{
 const text=read('vehicle'),{bindings}=compileSource(text),doc=new SourceDocument(text);let bs=bindings;
 for(const [path,value]of [['controls.steer',-.5],['damage',false],['paint.color[0]',.92]]){const b=bs.find(b=>b.owner==='m3'&&b.path===path);bs=edit(doc,bs,b.key,value,'change');}
 const result=compileSource(doc.text);assert.equal(result.program.items[1].controls.steer,-.5);assert.equal(result.program.items[1].damage,false);assert.equal(result.program.items[1].paint.color[0],.92);assert.ok(doc.text.includes('// Газ, руль'));
});

test('calculated fields are read-only; shadowed parameters never edit an unrelated global const',()=>{
 const code=source.replace("const roughness = 0.25;", "const roughness = 0.25;\nfunction f(roughness) { return body('local', {material: {roughness}, mesh: {kind:'sphere'}}); }\nconst unused=f(0.8);").replace('metalness: 0.8','metalness: Math.sqrt(0.25)');
 const {bindings}=compileSource(code);const local=bindings.find(b=>b.owner==='local'&&b.path==='material.roughness');assert.equal(local.writable,false);assert.notEqual(local.span.start,code.indexOf('0.25'));
 const calculated=bindings.find(b=>b.owner==='metal'&&b.path==='material.metalness');assert.equal(calculated.writable,false);
});

test('aliased imports and a spread const keep source provenance',()=>{
 const code=`import {scene as stage, body as object} from '@rom4/game-engine/dsl';\nconst paint={roughness:0.2,metalness:0.7}; export default stage({},[object('x',{mesh:{kind:'sphere'},material:{...paint, roughness:0.4}})]);`;
 const {bindings}=compileSource(code);assert.equal(bindings.find(b=>b.path==='material.roughness').value,.4);assert.equal(bindings.find(b=>b.path==='material.metalness').value,.7);
});

test('each source revision is re-indexed; undo is not a stale-offset write',()=>{
 const doc=new SourceDocument(source);doc.replace('// prefix\n'+source);const current=compileSource(doc.text).bindings,b=current.find(b=>b.path==='rendering.exposure');edit(doc,current,b.key,2);
 assert.ok(doc.text.includes('exposure: 2'));assert.ok(doc.text.startsWith('// prefix\n'));doc.undo();assert.ok(doc.text.includes('exposure: 1'));
});

test('source map rejects untrusted ranges before exposing inspector inputs',()=>{
 const bindings=compileSource(source).bindings;assert.throws(()=>validateBindings([{...bindings[0],span:{start:0,end:999999,text:'x'}}],source));assert.throws(()=>validateBindings([{...bindings[0],value:NaN}],source));
});

test('camera/shader edits preserve scene identity, mesh identity and simulation time',()=>{
 const before=compileSource(source),runtime=new ProgramRuntime(before.program);runtime.step();const scene=runtime.scene,mesh=scene.entities.get('metal').mesh,time=scene.time;
 const after=compileSource(source.replace('= 0.25;','= 0.63;').replace('exposure: 1','exposure: 2'));
 assert.equal(runtime.reconcile(after.program),true);assert.equal(runtime.scene,scene);assert.equal(scene.entities.get('metal').mesh,mesh);assert.equal(scene.time,time);assert.equal(scene.entities.get('metal').material.roughness,.63);assert.equal(scene.spec.rendering.exposure,2);
 runtime.dispose();
});

test('steering hot edit does not re-upload geometry or discard tyre lifetime state',()=>{
 const code=read('wear'),runtime=new ProgramRuntime(compileSource(code).program);for(let i=0;i<30;i++)runtime.step();
 const car=runtime.vehicles.get('m3').vehicle,wear=car.part('rear.left').wear,mesh=runtime.scene.entities.get('m3/body').mesh,revision=runtime.scene.renderStructureRevision;
 assert.equal(runtime.reconcile(compileSource(code.replace('steer: 0','steer: 0.1')).program),true);assert.equal(car,runtime.vehicles.get('m3').vehicle);assert.equal(car.part('rear.left').wear,wear);assert.equal(runtime.scene.entities.get('m3/body').mesh,mesh);
 assert.equal(runtime.scene.renderStructureRevision,revision,'controls must not dirty lighting/material geometry');runtime.dispose();
});

test('invalid code/data cannot replace the active scene; structural changes explicitly require a rebuild',()=>{
 const runtime=new ProgramRuntime(compileSource(source).program);runtime.step();const old=runtime.scene;
 assert.throws(()=>compileSource(source.replace('export default','export default !!!')));assert.throws(()=>runtime.reconcile({...runtime.program,stage:{rendering:{exposure:-1}}}));assert.equal(old,runtime.scene);
 assert.equal(runtime.reconcile(compileSource(source.replace('radius: 1','radius: 2')).program),false);assert.equal(old,runtime.scene);runtime.dispose();
});


test('hot lighting after glass fracture updates surviving fragments and never resurrects destroyed bodies',()=>{
 const source=read('glass'),runtime=new ProgramRuntime(compileSource(source).program);for(let i=0;i<60;i++)runtime.step();
 const ids=[...runtime.scene.entities.keys()];assert.ok(ids.some(id=>id.includes(':shard:')));
 assert.equal(runtime.reconcile(compileSource(source.replace('exposure: 1','exposure: 1.3')).program),true);assert.deepEqual([...runtime.scene.entities.keys()],ids);runtime.dispose();
});
