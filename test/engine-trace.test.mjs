import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {EngineTrace,exportChromeTrace,traceReport,traceClockSync,validateTraceCapture,engineBudgets,technologyAudit} from '../dist/observability/index.js';
import {Scene} from '../dist/scene/scene.js';
import {BrowserRuntime} from '../dist/runtime/browser.js';
import {WebGPURenderer} from '../dist/render/webgpu.js';
import {EngineKernel} from '../dist/core/kernel.js';
import {SolidWorld,SolidBody} from '../dist/physics/compound.js';

test('disabled recorder reads no clocks, preserves return values and exceptions',()=>{
  let reads=0;const trace=new EngineTrace({enabled:false,now:()=>{reads++;return 1;}}),error=Error('sentinel');
  assert.equal(trace.measure('test','test',()=>42),42);assert.throws(()=>trace.measure('test','test',()=>{throw error;}),e=>e===error);
  trace.instant('event','test');trace.sample('metric',1);trace.flow('message','1','s');trace.complete('span','test',0,2);trace.frame(0,20);
  assert.equal(reads,0);assert.equal(trace.snapshot().events.length,0);
});

test('ring keeps chronology, immutable bounded scalars, exact loss accounting',()=>{
  const trace=new EngineTrace({capacity:64,originMs:1000}),context={tick:1};trace.instant('first','test',context,0);context.tick=9;
  assert.equal(trace.snapshot().events[0].args.tick,1);
  for(let i=1;i<80;i++)trace.instant('event','test',{i},i);
  const snapshot=trace.snapshot();assert.equal(snapshot.written,80);assert.equal(snapshot.dropped,16);assert.equal(snapshot.events.length,64);
  assert.equal(snapshot.events[0].args.i,16);assert.equal(snapshot.events.at(-1).args.i,79);
  assert.ok(Object.isFrozen(snapshot.events));assert.ok(Object.isFrozen(snapshot.events[0].args));assert.equal(traceReport(snapshot).complete,false);
  assert.throws(()=>trace.sample('bad',NaN),/timestamp/);assert.throws(()=>trace.instant('bad','test',{nested:{}}),/scalars/);
  assert.throws(()=>trace.sample('render.gpu.ms',-1),/Negative/);
  assert.throws(()=>trace.frame(20,10),/Negative/);
});

test('long-frame flight recorder retains context and stops after exact post-frame count',()=>{
  const trace=new EngineTrace({triggerMs:30,postTriggerFrames:2});
  trace.frame(0,16);trace.frame(16,56);assert.equal(trace.recording,true);assert.match(trace.snapshot().trigger,/30/);
  trace.frame(56,72);assert.equal(trace.recording,true);trace.frame(72,88);assert.equal(trace.recording,false);
  const count=trace.snapshot().events.length;trace.frame(88,104);assert.equal(trace.snapshot().events.length,count);
  const immediate=new EngineTrace({triggerMs:20,postTriggerFrames:0});immediate.frame(0,30);assert.equal(immediate.recording,false);
});

test('calibrated remote clock and Perfetto flows preserve units and uncertainty',()=>{
  const sync=traceClockSync(10,113,114,17);assert.deepEqual(sync,{remoteToLocalMs:-100,uncertaintyMs:3,roundTripMs:6});
  const client=new EngineTrace({source:'client',originMs:1000,clockUncertaintyMs:0});
  const remote=new EngineTrace({source:'server',originMs:1000+sync.remoteToLocalMs,clockUncertaintyMs:sync.uncertaintyMs});
  client.flow('input','seq:7','s',{tick:1},10);remote.flow('input','seq:7','f',{tick:2},114);remote.complete('physics','simulation',114,116);
  const exported=exportChromeTrace([client.snapshot(),remote.snapshot()]);assert.equal(exported.metadata.clockWarning,null);
  const flows=exported.traceEvents.filter(e=>e.cat==='flow');assert.equal(flows[1].ts-flows[0].ts,4000);assert.equal(flows[0].id,flows[1].id);
  assert.equal(exported.traceEvents.find(e=>e.name==='physics').dur,2000);
  const unsynced=new EngineTrace();assert.match(exportChromeTrace([client.snapshot(),unsynced.snapshot()]).metadata.clockWarning,/not calibrated/);
  assert.throws(()=>traceClockSync(2,5,4,6),/exchange/);
});

test('budget reports reject missing, insufficient, excessive and reduced-resolution evidence',()=>{
  const trace=new EngineTrace({budgets:{fps:100,minSamples:3,required:['frame.interval.ms','render.gpu.ms']}});
  trace.frame(0,8);assert.equal(traceReport(trace.snapshot()).passed,false);
  for(let i=0;i<3;i++)trace.sample('render.gpu.ms',4,{},i);
  let r=traceReport(trace.snapshot());assert.equal(r.rows.find(x=>x.metric==='frame.interval.ms').status,'insufficient');
  trace.frame(8,16);trace.frame(16,24);r=traceReport(trace.snapshot());assert.equal(r.passed,true);assert.equal(r.rows.find(x=>x.metric==='frame.interval.ms').p95,8);
  trace.sample('worker.queue',100);trace.sample('worker.queue',100);trace.sample('worker.queue',100);assert.equal(traceReport(trace.snapshot()).passed,false,'measured optional budget violations also fail');
  const lowResolution=new EngineTrace({metadata:{width:704,height:396},budgets:{required:[],minSamples:1}});assert.match(traceReport(lowResolution.snapshot()).evidenceIssues[0],/resolution/);
  const snapshot=structuredClone(trace.snapshot());snapshot.events[0].atMs=NaN;assert.throws(()=>validateTraceCapture(snapshot),/timestamp/);
  assert.throws(()=>engineBudgets({limits:{constructor:5}}),/Invalid budget/);assert.throws(()=>engineBudgets({required:['not-a-metric']}),/metrics/);
});

test('technology revision resolves reference files and scales independent budgets',()=>{
  const audit=technologyAudit();assert.equal(new Set(audit.technologies.map(t=>t.id)).size,audit.technologies.length);
  for(const entry of audit.technologies)for(const key of ['source','verification'])assert.ok(existsSync(resolve(entry[key])),`${entry.id} ${entry[key]}`);
  const b=engineBudgets({fps:120,physicsHz:240,limits:{'worker.queue':3}});
  assert.equal(b.limits['frame.interval.ms'],1000/120);assert.equal(b.limits['physics.step.ms'],2.5);assert.equal(b.limits['worker.queue'],3);
  assert.throws(()=>engineBudgets({gpuFraction:2}),/gpuFraction/);assert.throws(()=>engineBudgets({minSamples:0}),/minSamples/);
  assert.throws(()=>engineBudgets({targetFps:120}),/Unknown budget/);
});

test('Perfetto counters contain numeric values and retain frame context in annotations',()=>{
  const trace=new EngineTrace();trace.sample('render.gpu.ms',5,{frame:7,gpuExecutionPosition:'unavailable'},20);
  const exported=exportChromeTrace([trace.snapshot()]);assert.deepEqual(exported.traceEvents.find(e=>e.ph==='C').args,{value:5});
  assert.equal(exported.traceEvents.find(e=>e.cat==='metric.context').args.frame,7);
});

test('trace preserves physical replay in direct and kernel dispatch',()=>{
  const spec={version:1,entities:[{id:'box',position:[0,3,0],mesh:{kind:'box'},body:{mass:2}}]};
  for(const dispatch of ['direct','kernel']){
    const plain=new Scene(spec),observed=new Scene(spec),trace=new EngineTrace({capacity:32768});
    plain.setSystemDispatch(dispatch);observed.setSystemDispatch(dispatch);observed.trace=trace;
    for(let i=0;i<90;i++){plain.step();observed.step();assert.deepEqual(observed.snapshot(),plain.snapshot());}
    const events=trace.snapshot().events;assert.equal(events.filter(e=>e.name==='scene.tick').length,90);
    assert.ok(events.some(e=>e.name==='physics'&&e.category==='simulation.system'));
    assert.equal(observed.physics.rigidContactDiagnostics.traceFallbacks,plain.physics.rigidContactDiagnostics.traceFallbacks,'performance trace never enables physical provenance fallback');
  }
});

test('kernel traces actual custom module execution and preserves thrown errors',()=>{
  const kernel=new EngineKernel(),trace=new EngineTrace(),error=Error('module failed');
  kernel.use({id:'custom:module',phase:'simulate',rateHz:60,reads:[],writes:[],context:'none',run:()=>{throw error;}});
  assert.throws(()=>kernel.compile("detailed").run(1,{}, {trace}),e=>e===error);
  const record=trace.snapshot().events.find(e=>e.name==='custom:module');assert.equal(record.category,'kernel.module');assert.equal(record.args.tick,1);
});

test('compound solver performance capture retains exact state and contact order',()=>{
  const plain=new SolidWorld(),observed=new SolidWorld();observed.trace=new EngineTrace();
  for(const world of [plain,observed])world.add(new SolidBody({mass:1,p:[0,2,0]}));
  for(let i=0;i<30;i++){assert.deepEqual(observed.step(1/120),plain.step(1/120));assert.deepEqual(observed.bodies.map(b=>[b.p,b.v,b.q,b.w]),plain.bodies.map(b=>[b.p,b.v,b.q,b.w]));}
  assert.equal(observed.trace.snapshot().events.filter(e=>e.name==='compound.step').length,30);
});

test('runtime bridge starts/stops capture, follows reset, releases renderer hook',async t=>{
  const original=WebGPURenderer.create,hooks=[];
  WebGPURenderer.create=async()=>({prepareMaterials:async()=>{},render(){},inspect(){return{};},setTrace:trace=>hooks.push(trace),dispose(){}});
  t.after(()=>{WebGPURenderer.create=original;});
  const runtime=await BrowserRuntime.create({width:1920,height:1080},{version:1,entities:[]},{audio:false,autoplay:false,exposeBridge:false});
  runtime.bridge().startTrace({budgets:{minSamples:1,required:['simulation.tick.ms']}});runtime.step(2);
  const initial=runtime.scene;runtime.reset();assert.notEqual(runtime.scene,initial);runtime.step();
  const capture=runtime.bridge().stopTrace();assert.equal(capture.state,'stopped');assert.equal(capture.events.filter(e=>e.name==='scene.tick').length,3);
  runtime.dispose();assert.equal(hooks.at(-1),undefined);assert.throws(()=>runtime.startTrace(),/disposed/);
});

test('CLI creates reports and fails incomplete captures instead of silently passing',()=>{
  const dir=mkdtempSync(join(tmpdir(),'engine-perf-test-'));
  try{
    const result=spawnSync(process.execPath,['tools/engine-perf/cli.mjs','record','--ticks','65','--bodies','2','--out',dir],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr+result.stdout);const capture=JSON.parse(readFileSync(join(dir,'capture.json'),'utf8'));
    assert.equal(capture.schema,'engine.trace.v1');assert.equal(JSON.parse(readFileSync(join(dir,'report.json'),'utf8')).passed,true);
    const compare=spawnSync(process.execPath,['tools/engine-perf/cli.mjs','compare','--before',join(dir,'capture.json'),'--after',join(dir,'capture.json'),'--out',join(dir,'comparison')],{encoding:'utf8'});
    assert.equal(compare.status,0,compare.stdout+compare.stderr);
    const missing=new EngineTrace();const file=join(dir,'empty.json');writeFileSync(file,JSON.stringify(missing.snapshot()));
    const incomplete=spawnSync(process.execPath,['tools/engine-perf/cli.mjs','report','--file',file,'--out',join(dir,'missing')],{encoding:'utf8'});
    assert.equal(incomplete.status,1,incomplete.stdout+incomplete.stderr);assert.equal(JSON.parse(readFileSync(join(dir,'missing/report.json'),'utf8')).passed,false);
  }finally{const absolute=resolve(dir);assert.ok(absolute.startsWith(resolve(tmpdir()))&&absolute.includes('engine-perf-test-'));rmSync(absolute,{recursive:true,force:true});}
});
