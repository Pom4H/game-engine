import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,existsSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Scene} from '../dist/scene/scene.js';
import {
  WORLD_INTERACTION_IR_VERSION,WorldInteractionJournal,
  validateWorldInteractionGraph,eventsFromWorldInteractions,
} from '../dist/world-ir/index.js';
import {MemoryContentStore} from '../dist/render-ir/index.js';
import {projectSceneRenderFrame} from '../dist/execution/index.js';
import {renderAudio} from '../dist/audio/synth.js';
import {createWasmRigidContactKernel} from '../dist/physics/rigid-wasm.js';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const wasmPath=resolve(root,'kernels/world-rigid/target/wasm32-unknown-unknown/release/world_rigid_kernel.wasm');
const cargo=spawnSync('cargo',['--version'],{encoding:'utf8'}).status===0;

function fixture(){
  return new Scene({
    version:1,seed:46,gravity:[0,0,0],ground:-100,
    environment:{temperatureC:-4,snowfall:'light',wind:[3,0,1],humidity:.8},
    entities:[
      {id:'glass',position:[0,2,0],mesh:{kind:'box',size:[.01,1.4,1.2]},
        material:{kind:'glass'}},
      {id:'ball',position:[-1,2,0],mesh:{kind:'sphere',radius:.11},
        material:{kind:'steel'},body:{mass:3.8,velocity:[30,0,0]}},
      {id:'road',position:[0,-.12,0],mesh:{kind:'box',size:[14,.24,8]},
        material:{kind:'asphalt'},body:{},
        environmental:{surfaceUse:'road',snowDepthM:.028,waterDepthM:.004}},
    ],
  });
}
const near=(a,b,label)=>assert.ok(
  Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-9+Math.max(Math.abs(a),Math.abs(b))*1e-9,
  label+': '+a+' vs '+b
);
test('World IR remains an opt-in observation: full simulation and legacy event stream are unchanged',()=>{
 const reference=fixture(),observed=fixture();
 assert.equal(reference.worldInteractionGraph(),undefined);
 observed.enableWorldInteractions(4096);
 const collectedA=[],collectedB=[];
 for(let tick=0;tick<40;tick++){
   reference.step(1/60);
   observed.step(1/60);
   assert.deepEqual(observed.snapshot(),reference.snapshot(),'physical world changed at tick '+tick);
   collectedA.push(...reference.drainEvents());
   collectedB.push(...observed.drainEvents());
 }
 assert.deepEqual(collectedB,collectedA,'audio/event payloads must not change when capturing IR');
 const graph=observed.worldInteractionGraph();
 assert.equal(graph.schema,WORLD_INTERACTION_IR_VERSION);
 assert.equal(graph.tick,observed.tick);
 assert.deepEqual(graph.convention,{handedness:'right',up:'+Y',position:'m',time:'s',angle:'rad'});
 validateWorldInteractionGraph(graph);
 const contacts=graph.interactions.filter(x=>x.effect.kind==='contact');
 const effects=graph.interactions.filter(x=>x.effect.kind==='event');
 const weather=graph.interactions.filter(x=>x.effect.kind==='weather');
 assert.ok(contacts.length>0,'physical collisions must be recorded independently of impact cooldown');
 assert.ok(weather.length>0,'resolved world weather must be recorded');
 assert.ok(effects.some(x=>x.effect.event.type==='fracture'),'real brittle fracture must cause events');
 assert.ok(effects.some(x=>x.effect.event.type==='impact'),'real collision must cause audible events');
 for(const effect of effects){
   if(effect.effect.event.type==='mechanism')continue;
   assert.ok(effect.causeId,'material and impact effects must identify their contact cause');
   const parent=contacts.find(x=>x.id===effect.causeId);
   assert.ok(parent,'missing committed contact parent '+effect.causeId);
   assert.ok(parent.sequence<effect.sequence,'cause must precede effect');
   assert.equal(parent.effect.kind,'contact');
 }
 assert.deepEqual(eventsFromWorldInteractions(graph),collectedB);
 const originalAudio=renderAudio(collectedA,1,16000);
 const projectedAudio=renderAudio(eventsFromWorldInteractions(graph),1,16000);
 assert.deepEqual(projectedAudio.left,originalAudio.left);
 assert.deepEqual(projectedAudio.right,originalAudio.right);
 // Consumer draining events cannot mutate the immutable observational journal.
 collectedB[0].point[0]=99;
 assert.notEqual(eventsFromWorldInteractions(graph)[0].point[0],99);
});

test('committed wheel/surface mechanical work becomes a typed relation, not a second surface simulation',()=>{
 const a=fixture(),b=fixture();
 b.enableWorldInteractions(64);
 const input={sourceId:'ball',surfaceId:'road',x:0,z:0,radiusM:.45,
  durationSeconds:.016,speedMps:8,slipSpeedMps:2,normalLoadN:3500,frictionCoefficient:.72};
 assert.equal(a.surfaces.applyContactWork(input),true);
 assert.equal(b.surfaces.applyContactWork(input),true);
 const surfaceA=a.surfaces.sample('road',0,0),surfaceB=b.surfaces.sample('road',0,0);
 assert.deepEqual(surfaceB,surfaceA,'observations must never alter physical surface state');
 const graph=b.worldInteractionGraph();
 const effects=graph.interactions.filter(x=>x.effect.kind==='surface-work');
 assert.equal(effects.length,1);
 const [record]=effects;
 assert.deepEqual(record.source,{domain:'body',id:'ball'});
 assert.deepEqual(record.target,{domain:'surface',id:'road'});
 assert.deepEqual(record.effect.contact,input);
 const expected=input.normalLoadN*input.frictionCoefficient*
   (input.slipSpeedMps+input.speedMps*.018)*input.durationSeconds;
 near(record.effect.workJ,expected,'authoritative contact work J');
 assert.ok(record.effect.affectedCells>0);
 near(record.effect.resulting.trackMelt,surfaceB.trackMelt,'surface track melt');
 const before=graph.interactions.length;
 assert.equal(b.surfaces.applyContactWork({...input,radiusM:-1}),false);
 assert.equal(b.worldInteractionGraph().interactions.length,before,'rejected work cannot create a causal record');
 b.disableWorldInteractions();
 assert.equal(b.worldInteractionGraph(),undefined);
 assert.equal(b.surfaces.applyContactWork(input),true,'capture cleanup must not disable physical laws');
 b.enableWorldInteractions(32);
 assert.equal(b.worldInteractionGraph().interactions.length,0,'re-enabling creates an independent bounded view');
});

test('World Interaction IR is bounded and cursor-based, with explicit missing-history watermark',()=>{
 const scene=fixture(),journal=new WorldInteractionJournal(16);
 for(let n=0;n<45;n++)journal.recordWeather(scene.environment,n,n*.1);
 const graph=journal.snapshot(45,4.5);
 assert.equal(graph.interactions.length,16);
 assert.equal(graph.dropped,29);
 assert.equal(graph.firstSequence,30);
 assert.equal(graph.nextSequence,46);
 assert.equal(graph.afterSequence,0);
 assert.deepEqual(graph.interactions.map(x=>x.sequence),Array.from({length:16},(_,i)=>i+30));
 validateWorldInteractionGraph(graph);
 const after=journal.snapshot(45,4.5,42);
 assert.equal(after.interactions.length,3);
 assert.equal(after.afterSequence,42);
 validateWorldInteractionGraph(after);
 assert.ok(Object.isFrozen(after.interactions));
 assert.ok(Object.isFrozen(after.interactions[0].effect));
 assert.throws(()=>{after.interactions[0].effect.temperatureC=999;},TypeError);
 assert.throws(()=>new WorldInteractionJournal(10),/capacity/);
 assert.throws(()=>journal.snapshot(1,1,-1),/cursor/);
});

test('Render IR optionally references the same content-addressed causal graph and stays backward compatible',()=>{
 const scene=fixture(),store=new MemoryContentStore();
 assert.throws(()=>projectSceneRenderFrame(scene,store,{epoch:1n,frame:0n,includeInteractions:true}),/Enable World/);
 const ordinary=projectSceneRenderFrame(scene,store,{epoch:1n,frame:0n});
 assert.equal(ordinary.frame.interactionGraph,undefined);
 scene.enableWorldInteractions(256);
 for(let i=0;i<12;i++)scene.step(1/60);
 const projected=projectSceneRenderFrame(scene,store,{epoch:1n,frame:12n,includeInteractions:true});
 const ref=projected.frame.interactionGraph;
 assert.equal(ref.kind,'graph');
 assert.ok(projected.frame.resources.resources.some(r=>r.hash===ref.hash&&r.kind==='graph'));
 const stored=store.require(ref.hash);
 assert.deepEqual(stored,scene.worldInteractionGraph());
 const again=projectSceneRenderFrame(scene,store,{epoch:1n,frame:12n,includeInteractions:true});
 assert.equal(again.frameRef.hash,projected.frameRef.hash);
 assert.ok(projected.frame.observation.hash,'CausalRenderObservation remains its own authority-free projection');
});

test('World IR works on Rust-compiled WSCN without requiring a runtime language interpreter',{skip:!cargo},()=>{
 const temporary=mkdtempSync(join(tmpdir(),'world-ir-'));
 try{
  const output=join(temporary,'collision.wscn');
  const result=spawnSync('cargo',[
   'run','--quiet','--manifest-path',join(root,'compiler/Cargo.toml'),'--',
   'compile',join(root,'examples/worlds/collision.world'),'-o',output,
  ],{cwd:root,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const binary=new Uint8Array(readFileSync(output));
  const reference=new Scene(binary),observed=new Scene(binary);
  observed.enableWorldInteractions(512);
  for(let i=0;i<115;i++){
    reference.step(1/60);observed.step(1/60);
    assert.deepEqual(reference.snapshot(),observed.snapshot());
  }
  const graph=observed.worldInteractionGraph();
  validateWorldInteractionGraph(graph);
  assert.ok(graph.interactions.some(x=>x.effect.kind==='weather'));
  assert.ok(graph.interactions.some(x=>x.effect.kind==='contact'));
  assert.deepEqual(reference.drainEvents(),eventsFromWorldInteractions(graph));
 }finally{rmSync(temporary,{recursive:true,force:true});}
});

test('WASM rigid acceleration yields the same causal interaction IDs and cross-domain effects',{skip:!existsSync(wasmPath)},async()=>{
 const module=await WebAssembly.compile(new Uint8Array(readFileSync(wasmPath)));
 const kernel=await createWasmRigidContactKernel(module);
 const a=fixture(),b=fixture();
 a.enableWorldInteractions(512);b.enableWorldInteractions(512);
 b.physics.setRigidContactKernel(kernel);
 try{
  for(let tick=0;tick<30;tick++){a.step(1/60);b.step(1/60);assert.deepEqual(a.snapshot(),b.snapshot());}
  const left=a.worldInteractionGraph(),right=b.worldInteractionGraph();
  assert.deepEqual(left.interactions.map(x=>[x.id,x.effect.kind,x.causeId]),
    right.interactions.map(x=>[x.id,x.effect.kind,x.causeId]));
  assert.deepEqual(eventsFromWorldInteractions(left),eventsFromWorldInteractions(right));
  const ca=left.interactions.filter(x=>x.effect.kind==='contact');
  const cb=right.interactions.filter(x=>x.effect.kind==='contact');
  assert.equal(ca.length,cb.length);
  for(let i=0;i<ca.length;i++){
    near(ca[i].effect.normalEnergyJ,cb[i].effect.normalEnergyJ,'WASM contact energy');
    near(ca[i].effect.normalImpulseNs,cb[i].effect.normalImpulseNs,'WASM impulse');
  }
 }finally{b.physics.setRigidContactKernel(null);kernel.dispose();}
});


test('untrusted causal graph rejects corrupted units, physical laws and missing parents',()=>{
 const journal=new WorldInteractionJournal(16);
 journal.recordWeather(fixture().environment,1,.1);
 const original=journal.snapshot(1,.1);
 const law=structuredClone(original);
 law.interactions[0].law='physics.contact';
 assert.throws(()=>validateWorldInteractionGraph(law),/law/);
 const broken=structuredClone(original);
 broken.interactions[0].effect.temperatureC=NaN;
 assert.throws(()=>validateWorldInteractionGraph(broken),/finite/);
 const invalidDomain=structuredClone(original);
 invalidDomain.interactions[0].source.domain='invented-source';
 assert.throws(()=>validateWorldInteractionGraph(invalidDomain),/domain/);
 const nonexistentParent=structuredClone(original);
 nonexistentParent.interactions[0].causeId='wi:1:1';
 assert.throws(()=>validateWorldInteractionGraph(nonexistentParent),/parent/);
});

test('bounded parent index evicts older pairs without unbounded auxiliary memory',()=>{
 const journal=new WorldInteractionJournal(16);
 for(let i=0;i<40;i++)journal.recordContact({
  a:'body'+i,b:'ground',normal:[0,1,0],point:[i,0,0],
  penetration:0,impulse:1,normalSpeed:1,normalEnergy:1,mode:'resolve',
 },1,.016);
 assert.equal(journal.stats.retained,16);
 assert.equal(journal.stats.dropped,24);
 assert.equal(journal.contactForPair('body0','ground',1),undefined);
 assert.ok(journal.contactForPair('body39','ground',1));
 validateWorldInteractionGraph(journal.snapshot(1,.016));
});
