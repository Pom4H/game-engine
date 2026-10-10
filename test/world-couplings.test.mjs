import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Scene} from '../dist/scene/scene.js';
import {decodeWorldBinary,WORLD_BINARY_VERSION} from '../dist/scene/world-binary.js';
import {compileWorldCouplings,WORLD_SIGNAL_PORTS} from '../dist/world-ir/couplings.js';
import {eventsFromWorldInteractions,validateWorldInteractionGraph} from '../dist/world-ir/index.js';
import {renderAudio} from '../dist/audio/synth.js';
import {MemoryContentStore} from '../dist/render-ir/index.js';
import {projectSceneRenderFrame} from '../dist/execution/index.js';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const sourceFile=resolve(root,'examples/worlds/coupled-glass.world');
const source=readFileSync(sourceFile,'utf8');
const hasRust=spawnSync('cargo',['--version'],{encoding:'utf8'}).status===0;
const manifest=resolve(root,'compiler/Cargo.toml');
function invoke(sourceText,extra=[]){
 const dir=mkdtempSync(join(tmpdir(),'world-link-'));
 const infile=join(dir,'scene.world'),outfile=join(dir,'scene.wscn');
 writeFileSync(infile,sourceText);
 const p=spawnSync('cargo',[
  'run','--quiet','--manifest-path',manifest,'--','compile',infile,'-o',outfile,...extra,
 ],{cwd:root,encoding:'utf8'});
 const bytes=p.status===0?new Uint8Array(readFileSync(outfile)):null;
 rmSync(dir,{recursive:true,force:true});
 return{...p,bytes};
}
function compile(sourceText=source,extra=[]){
 const result=invoke(sourceText,extra);
 assert.equal(result.status,0,result.stderr);
 return result.bytes;
}
function view(bytes){return new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);}
const decoder=bytes=>decodeWorldBinary(bytes);
const graphOf=(scene,capacity=2048)=>{
 scene.enableWorldInteractions(capacity);
 for(let i=0;i<35;i++)scene.step(1/60);
 const graph=scene.worldInteractionGraph();
 validateWorldInteractionGraph(graph);
 return graph;
};

test('port tags and names are unique and stable for native compiler',()=>{
 assert.equal(WORLD_SIGNAL_PORTS.length,24);
 assert.equal(WORLD_SIGNAL_PORTS[0].path,'physics.contact.energy');
 assert.equal(WORLD_SIGNAL_PORTS[7].path,'npc.hearing.pressure');
 assert.equal(WORLD_SIGNAL_PORTS[23].path,'material.damage.fraction');
 assert.equal(new Set(WORLD_SIGNAL_PORTS.map(p=>p.path)).size,24);
});

test('Rust World compiler emits v3 typed causal graph, deterministic and topological',{skip:!hasRust},()=>{
 const a=compile(),b=compile();
 assert.deepEqual(a,b,'compiled bytes must be deterministic');
 assert.equal(WORLD_BINARY_VERSION,3);
 assert.equal(view(a).getUint16(4,true),3);
 const spec=decoder(a);
 assert.equal(spec.entities.length,2);
 assert.equal(spec.couplings.length,10);
 assert.ok(spec.couplings.some(x=>x.from==='fluid.pressure'&&x.to==='acoustic.pressure'));
 const wave=spec.couplings.findIndex(c=>c.id==='fluid_wave');
 const hearing=spec.couplings.findIndex(c=>c.id==='hearing');
 assert.ok(hearing>wave,'DAG must order receiver after source');
 const link=spec.couplings.find(c=>c.id==='hearing');
 assert.equal(link.min,10,'pressure threshold converted to SI Pa');
 const sample=spec.couplings.find(c=>c.id==='impact_sound');
 assert.equal(sample.min,.2);
 const extra=compile(source.replace('seed: 42','seed: 42\n  performance {tick_budget: 4ms; sample_every: 2; history: 128}'));
 assert.equal(view(extra).getUint16(4,true),3);
 assert.deepEqual(decoder(extra).performance,{tickBudgetMs:4,sampleEvery:2,history:128});
 const stripped=compile(source.replace('seed: 42','seed: 42\n  performance {tick_budget: 4ms; sample_every: 2; history: 128}'),['--strip-performance']);
 assert.equal(view(stripped).getUint16(4,true),3);
 assert.equal(decoder(stripped).performance,undefined);
 assert.deepEqual(decoder(stripped).couplings,spec.couplings);
 // Existing WSCN v1/v2 must remain unchanged for sources without couplings.
 const v1=compile('world Old { entity body {mesh: sphere(1m); body: static} }');
 assert.equal(view(v1).getUint16(4,true),1);
 const v2=compile('world Profile {performance {tick_budget: 5ms} entity a {mesh:sphere(1m);body:static}}');
 assert.equal(view(v2).getUint16(4,true),2);
 assert.equal(decoder(v2).performance.tickBudgetMs,5);
});

test('Rust compiler rejects dimensions, invalid port, unknown dependency, DAG cycles and unknown units',{skip:!hasRust},()=>{
 const invalid=[
  ['coupling bad {from: physics.contact.energy to: acoustic.pressure}','dimension mismatch'],
  ['coupling bad {from: fluid.pressure to: acoustic.pressure min: 12J}','coupling min'],
  ['coupling bad {from: npc.telepathy to: material.fracture.energy}','unknown coupling signal'],
  ['coupling bad {from: fluid.pressure to: acoustic.pressure after: missing}','unknown coupling dependency'],
  ['coupling bad {from: fluid.pressure to: fluid.pressure}','same signal'],
  ['coupling a {from:fluid.pressure to:acoustic.pressure} coupling b {from:acoustic.pressure to:fluid.pressure}','cyclic'],
  ['coupling a {from: fluid.pressure to: acoustic.pressure} coupling a {from: fluid.pressure to: npc.hearing.pressure}','duplicate World coupling'],
 ];
 for(const [declaration,message] of invalid){
  const bad=invoke('world Bad {\n'+declaration+'\n}');
  assert.notEqual(bad.status,0,declaration);
  assert.match(bad.stderr,new RegExp(message),declaration);
  assert.match(bad.stderr,/scene\.world:2:/,declaration);
 }
});

test('WSCN v3 hostile-extension corruption is rejected before scene creation',{skip:!hasRust},()=>{
 const bytes=compile();
 const error=(patch,pattern)=>{
  const mutated=new Uint8Array(bytes);
  const v=view(mutated);
  patch(mutated,v);
  assert.throws(()=>decoder(mutated),pattern);
 };
 error((bytes,v)=>v.setUint32(140,0,true),/coupling extension/);
 error((bytes,v)=>v.setUint32(140,0xfffffff0,true),/coupling extension/);
 error((bytes,v)=>{
  const start=v.getUint32(20,true)+v.getUint32(140,true);
  v.setUint16(start+6,64,true);
 },/coupling extension/);
 error((bytes,v)=>{
  const start=v.getUint32(20,true)+v.getUint32(140,true);
  v.setUint32(start+8,70000,true);
 },/coupling extension/);
 error((bytes,v)=>{
  const start=v.getUint32(20,true)+v.getUint32(140,true);
  v.setUint8(start+16+6,254);
 },/coupling signal/);
 error((bytes,v)=>{
  const start=v.getUint32(20,true)+v.getUint32(140,true);
  v.setUint16(start+16+14,16,true);
 },/coupling flags/);
 error((bytes,v)=>{
  const start=v.getUint32(20,true)+v.getUint32(140,true);
  v.setFloat64(start+16+24,NaN,true);
 },/non-finite/);
});

test('TS SceneSpec compiler enforces identical physical dimensions and DAG semantics',()=>{
 assert.throws(()=>compileWorldCouplings([{id:'bad',from:'physics.contact.energy',to:'acoustic.pressure'}]),/dimension mismatch/);
 assert.throws(()=>compileWorldCouplings([{id:'bad',from:'fluid.pressure',to:'acoustic.pressure',min:NaN}]),/finite/);
 assert.throws(()=>compileWorldCouplings([{id:'a',from:'fluid.pressure',to:'acoustic.pressure',after:'b'},
 {id:'b',from:'acoustic.pressure',to:'fluid.pressure'}]),/Cyclic/);
 const couplings=compileWorldCouplings([
 {id:'hearing',from:'acoustic.pressure',to:'npc.hearing.pressure',after:'wave'},
 {id:'wave',from:'fluid.pressure',to:'acoustic.pressure'},
 ]);
 assert.deepEqual(couplings.map(c=>c.id),['wave','hearing']);
 assert.ok(Object.isFrozen(couplings));
});

test('compiled relations annotate ONLY real audio/fracture events, preserving physical scene',{skip:!hasRust},()=>{
 const bytes=compile();
 const original=new Scene(bytes),observed=new Scene(bytes);
 const graph=graphOf(observed);
 for(let i=0;i<35;i++)original.step(1/60);
 assert.deepEqual(original.snapshot(),observed.snapshot());
 const originalEvents=original.drainEvents();
 assert.deepEqual(eventsFromWorldInteractions(graph),originalEvents);
 const observedEvents=graph.interactions.filter(c=>c.effect.kind==='event');
 assert.ok(observedEvents.some(c=>c.effect.event.type==='fracture'),'must fracture glass');
 assert.ok(observedEvents.some(c=>c.effect.event.type==='impact'),'must emit real audible impact');
 const linked=observedEvents.filter(c=>c.couplingIds?.length);
 assert.ok(linked.some(c=>c.effect.event.type==='impact'&&c.couplingIds.includes('impact_sound')));
 assert.ok(linked.some(c=>c.effect.event.type==='fracture'&&c.couplingIds.includes('brittle_failure')));
 assert.ok(linked.every(c=>c.causeId),'active coupling must have an actual contact parent');
 assert.ok(linked.every(c=>c.couplingIds.every(id=>['impact_sound','brittle_failure'].includes(id))),
  'unimplemented acoustic/NPC/thermal couplings are descriptors only');
 const a=renderAudio(originalEvents,1,16000);
 const b=renderAudio(eventsFromWorldInteractions(graph),1,16000);
 assert.deepEqual(a.left,b.left);assert.deepEqual(a.right,b.right);
 assert.deepEqual(graph.couplings,observed.spec.couplings);
 const store=new MemoryContentStore();
 const projected=projectSceneRenderFrame(observed,store,{epoch:1n,frame:BigInt(observed.tick),includeInteractions:true});
 assert.deepEqual(store.require(projected.frame.interactionGraph.hash),graph);
});

test('World IR refuses a forged realized relation in an untrusted graph',{skip:!hasRust},()=>{
 const scene=new Scene(compile());
 const graph=graphOf(scene);
 const forged=structuredClone(graph);
 const target=forged.interactions.find(x=>x.effect.kind==='event'&&x.causeId);
 assert.ok(target);
 target.couplingIds=['hearing'];
 assert.throws(()=>validateWorldInteractionGraph(forged),/unrealized or invalid coupling/);
});
