import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,mkdtempSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {Scene} from '../dist/scene/scene.js';
import {AcousticWaveField} from '../dist/physics/wave-field.js';
import {createWasmAcousticWaveField} from '../dist/physics/wave-wasm.js';
import {attachSceneAcoustics} from '../dist/scene/acoustic-coupling.js';
import {validateWorldInteractionGraph,eventsFromWorldInteractions} from '../dist/world-ir/index.js';
import {compileWorldCouplings} from '../dist/world-ir/couplings.js';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const source=resolve(root,'examples/worlds/physical-hearing.world');
const waveWasm=resolve(root,'kernels/world-wave/target/wasm32-unknown-unknown/release/world_wave_kernel.wasm');
const cargoAvailable=spawnSync('cargo',['--version'],{encoding:'utf8'}).status===0;
function compiledSpec(){
 const dir=mkdtempSync(join(tmpdir(),'world-acoustic-'));
 const output=join(dir,'sound.wscn');
 try{
  const p=spawnSync('cargo',[
   'run','--quiet','--manifest-path',join(root,'compiler/Cargo.toml'),
   '--','compile',source,'-o',output
  ],{cwd:root,encoding:'utf8'});
  assert.equal(p.status,0,p.stderr);
  return new Uint8Array(readFileSync(output));
 }finally{rmSync(dir,{recursive:true,force:true});}
}
const medium={
 size:[40,10,20],cellSizeM:.5,waveSpeedMps:343,densityKgM3:1.225,
 origin:[-10,0,-5],
};
const near=(a,b,label,rel=1e-8)=>assert.ok(
 Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-9+rel*Math.max(Math.abs(a),Math.abs(b)),
 label+': '+a+' vs '+b);

test('contact packet injects EXACT incremental wave energy into quiet and excited media',()=>{
 const field=new AcousticWaveField({
  size:[20,12,20],cellSizeM:.5,waveSpeedMps:120,densityKgM3:1.225,
 });
 const point=field.cellCenter(5,5,5);
 for(const energy of [4,0.1,20,1e-6]){
  const before=field.compressionEnergyJ();
  const result=field.injectEnergyPacket({position:point,acousticEnergyJ:energy,radiusM:1.35});
  const after=field.compressionEnergyJ();
  assert.ok(result.affectedCells>0);
  near(after-before,energy,'exact physical energy increment '+energy,1e-10);
  field.step(.001);
 }
 field.setSolidCell(18,8,18);
 const before=field.compressionEnergyJ();
 const blocked=field.injectEnergyPacket({
  position:field.cellCenter(18,8,18),acousticEnergyJ:2,radiusM:.3,
 });
 assert.equal(blocked,null);
 near(field.compressionEnergyJ(),before,'rejected pressure packet is side effect free',1e-10);
 assert.throws(()=>field.injectEnergyPacket({position:point,acousticEnergyJ:-1,radiusM:1}),/positive/);
});

test('wave pressure has a finite propagation front and does not transmit through a complete hard wall',()=>{
 const spec={size:[40,10,10],cellSizeM:.5,waveSpeedMps:100,densityKgM3:1.225};
 const open=new AcousticWaveField(spec),walled=new AcousticWaveField(spec);
 const source=open.cellCenter(7,4,5),listener=open.cellCenter(28,4,5);
 for(let y=0;y<10;y++)for(let z=0;z<10;z++)walled.setSolidCell(16,y,z);
 for(const field of [open,walled])field.injectEnergyPacket({position:source,acousticEnergyJ:2,radiusM:.7});
 for(let tick=0;tick<5;tick++){
  open.step(.002);walled.step(.002);
  assert.equal(open.pressureAt(listener),0,'finite difference stencil has no teleporting pressure');
 }
 let unblockedPeak=0,blockedPeak=0;
 for(let tick=0;tick<135;tick++){
  open.step(.002);walled.step(.002);
  unblockedPeak=Math.max(unblockedPeak,Math.abs(open.pressureAt(listener)));
  blockedPeak=Math.max(blockedPeak,Math.abs(walled.pressureAt(listener)));
 }
 assert.ok(unblockedPeak>1e-7,'pressure should eventually propagate through open air');
 assert.equal(blockedPeak,0,'a full solid plane should block transport');
});

test('declarative World port alone does not create any extra physical domain',()=>{
 const plain=new Scene({version:1,entities:[
  {id:'listener',position:[2,2,0],mesh:{kind:'sphere',radius:.1},renderOnly:true}
 ],couplings:compileWorldCouplings([
  {id:'hearing',from:'acoustic.pressure',to:'npc.hearing.pressure',min:.05},
 ])});
 assert.equal(plain.worldInteractionGraph(),undefined);
 assert.equal(plain.spec.couplings.length,1);
 for(let i=0;i<6;i++)plain.step(1/60);
 assert.equal(plain.entities.size,1);
 assert.equal(plain.drainEvents().length,0);
});

test('Rust World v3 contact -> physical wave -> actual NPC pressure reading and energy budget',{skip:!cargoAvailable},()=>{
 const bytes=compiledSpec();
 const baseline=new Scene(bytes),scene=new Scene(bytes);
 assert.ok(scene.spec.couplings.some(c=>c.id==='contact_air'));
 assert.ok(scene.spec.couplings.some(c=>c.id==='heard_pressure'));
 scene.enableWorldInteractions(2048);
 const field=new AcousticWaveField(medium);
 const coupled=attachSceneAcoustics(scene,field,{
  fieldId:'outdoor-air',listeners:[{entityId:'listener'}],
 });
 let audible=false,emitted=false;
 const events=[],debug=[];
 for(let tick=0;tick<28;tick++){
  baseline.step(1/60);scene.step(1/60);
  assert.deepEqual(scene.snapshot(),baseline.snapshot(),
   'Acoustic coupling may not modify rigid body state at tick '+tick);
  const stats=coupled.diagnostics;
  debug.push({tick,executed:scene.lastExecution.includes('engine:acoustic:outdoor-air'),contacts:scene.physics.contacts.map(c=>({a:c.a,b:c.b,mode:c.mode,normalEnergy:c.normalEnergy,impulse:c.impulse,normalSpeed:c.normalSpeed,point:c.point})),stats});
  assert.ok(stats.radiatedAcousticEnergyJ<=stats.contactDissipationBudgetJ+1e-9,
   'acoustics must never spend more than dissipated contact energy');
  emitted||=stats.injectedSources>0;
  audible||=stats.audibleSensorSamples>0;
  events.push(...scene.drainEvents());
 }
 assert.ok(emitted,'a real collision must excite the physical acoustic medium: '+JSON.stringify(debug.filter(x=>x.contacts.length>0||x.stats.sourceContacts>0||!x.executed).slice(0,7)));
 assert.ok(audible,'registered NPC listener must measure a propagated wave');
 assert.ok(coupled.totalRadiatedEnergyJ>0);
 assert.ok(coupled.sourcesEverInjected>0);
 const graph=scene.worldInteractionGraph();
 validateWorldInteractionGraph(graph);
 assert.equal(graph.tick,scene.tick);
 const radiation=graph.interactions.filter(r=>r.effect.kind==='acoustic-radiation');
 const hearing=graph.interactions.filter(r=>r.effect.kind==='hearing');
 assert.ok(radiation.length>0);
 assert.ok(hearing.length>0);
 assert.ok(radiation.every(r=>r.couplingIds?.includes('contact_air')));
 assert.ok(hearing.every(r=>r.couplingIds?.includes('heard_pressure')));
 for(const r of radiation){
  assert.ok(graph.interactions.some(p=>p.id===r.causeId&&p.effect.kind==='contact'),
   'acoustic pressure must cite its REAL contributing contact');
  assert.ok(r.effect.acousticEnergyJ<=r.effect.dissipatedNormalEnergyJ);
 }
 assert.ok(hearing.every(r=>r.effect.rmsPressurePa>=.05));
 assert.deepEqual(eventsFromWorldInteractions(graph),events);
 assert.deepEqual(baseline.drainEvents(),events);
 coupled.close();field.dispose();
});

test('render-only listener is not acoustic geometry or an invented collider',{skip:!cargoAvailable},()=>{
 const scene=new Scene(compiledSpec());
 const field=new AcousticWaveField(medium);
 const {syncSceneAcousticBoundaries}=cachedBoundaries;
 const before=syncSceneAcousticBoundaries(field,[...scene.entities.values()].filter(e=>e.id!=='listener'));
 const withListener=syncSceneAcousticBoundaries(field,scene.entities.values());
 assert.equal(withListener.solidCells,before.solidCells,
  'visual-only sensor may never block physically simulated sound');
 assert.equal(scene.entities.get('listener').body,undefined);
});

test('Rust/WASM and TS wave backends produce matching contact-driven pressure and listener RMS',
 {skip:!cargoAvailable||!existsSync(waveWasm)},async()=>{
 const bytes=compiledSpec(),baseline=new Scene(bytes),accelerated=new Scene(bytes);
 const tsField=new AcousticWaveField(medium);
 const rustField=await createWasmAcousticWaveField(medium,new Uint8Array(readFileSync(waveWasm)));
 const a=attachSceneAcoustics(baseline,tsField,{fieldId:'air',listeners:[{entityId:'listener'}]});
 const b=attachSceneAcoustics(accelerated,rustField,{fieldId:'air',listeners:[{entityId:'listener'}]});
 try{
  for(let tick=0;tick<22;tick++){
   baseline.step(1/60);accelerated.step(1/60);
   assert.deepEqual(baseline.snapshot(),accelerated.snapshot());
   near(a.diagnostics.radiatedAcousticEnergyJ,b.diagnostics.radiatedAcousticEnergyJ,'source energy');
   const pa=a.sensor('listener'),pb=b.sensor('listener');
   if(pa&&pb)near(pa.rmsPressurePa,pb.rmsPressurePa,'measured RMS pressure',1e-7);
  }
  for(let i=0;i<tsField.pressurePa.length;i++)
   near(tsField.pressurePa[i],rustField.pressurePa[i],'full pressure parity '+i,1e-7);
  assert.strictEqual(rustField.backend,'wasm');
 }finally{a.close();b.close();tsField.dispose();rustField.dispose();}
});

import * as cachedBoundaries from '../dist/scene/acoustic-boundary.js';
