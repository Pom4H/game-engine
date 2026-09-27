import test from 'node:test';
import assert from 'node:assert/strict';
import {CpuProfiler,timingStats} from '../dist/core/profiling.js';
import {Scene} from '../dist/scene/scene.js';
import {EngineKernel} from '../dist/core/kernel.js';
import {SceneSystemRuntime} from '../dist/scene/system-runtime.js';
import {BrowserRuntime} from '../dist/runtime/browser.js';
import {RenderProfiler} from '../dist/render/profiler.js';

function clock(options={}){let time=0,reads=0;const profiler=new CpuProfiler({enabled:true,...options,now:()=>{reads++;return time;}});return{profiler,advance:ms=>{time+=ms;},get reads(){return reads;}};}
const byId=profiler=>Object.fromEntries(profiler.inspect().scopes.map(s=>[s.id,s]));

test('disabled profiler does not read the clock or allocate sample scopes',()=>{
 const c=clock({enabled:false}),value={};assert.equal(c.profiler.measure('test',()=>value),value);
 const failure=new Error('domain failure');assert.throws(()=>c.profiler.measure('test',()=>{throw failure;}),e=>e===failure);
 assert.equal(c.reads,0);assert.deepEqual(c.profiler.inspect().scopes,[]);
});

test('nested inclusive and self times do not double-count child work',()=>{
 const c=clock();c.profiler.measure('parent',()=>{c.advance(2);c.profiler.measure('child',()=>{c.advance(5);});c.advance(3);});
 const scopes=byId(c.profiler);assert.equal(scopes.parent.latestMs,10);assert.equal(scopes.parent.latestSelfMs,5);assert.equal(scopes.child.latestMs,5);
 assert.equal(scopes.parent.selfTotalMs+scopes.child.selfTotalMs,10);assert.equal(scopes.parent.calls,1);assert.equal(scopes.parent.failures,0);
});

test('recursive scope records each call and resets nesting between top-level calls',()=>{
 const c=clock();c.profiler.measure('same',()=>{c.advance(1);c.profiler.measure('same',()=>{c.advance(2);});c.advance(3);});
 c.profiler.measure('other',()=>{c.advance(4);});const s=byId(c.profiler);
 assert.equal(s.same.calls,2);assert.equal(s.same.totalMs,8);assert.equal(s.same.selfTotalMs,6);assert.equal(s.other.latestSelfMs,4);
});

test('exceptions propagate unchanged, are measured, and do not corrupt the next call',()=>{
 const c=clock(),failure=new Error('solver');
 assert.throws(()=>c.profiler.measure('outer',()=>{c.advance(1);c.profiler.measure('inner',()=>{c.advance(3);throw failure;});}),e=>e===failure);
 c.profiler.measure('next',()=>{c.advance(2);});const s=byId(c.profiler);
 assert.equal(s.outer.failures,1);assert.equal(s.inner.failures,1);assert.equal(s.outer.latestSelfMs,1);assert.equal(s.next.latestSelfMs,2);
});

test('ring window is bounded while lifetime calls and totals remain exact',()=>{
 const c=clock({capacity:3});for(let i=1;i<=5;i++)c.profiler.measure('job',()=>{c.advance(i);});
 const s=byId(c.profiler).job;assert.equal(s.calls,5);assert.equal(s.samples,3);assert.equal(s.totalMs,15);assert.equal(s.latestMs,5);
 assert.deepEqual(s.inclusive,{meanMs:4,p50Ms:4,p95Ms:4,maxMs:5});
 assert.throws(()=>{s.self.p95Ms=100;},TypeError);assert.throws(()=>{c.profiler.inspect().scopes.push({});},TypeError);
});

test('scope-budget overflow never suppresses the operation and is reported',()=>{
 const c=clock({maxScopes:1});let ran=0;c.profiler.measure('first',()=>{ran++;c.advance(1);});c.profiler.measure('second',()=>{ran++;c.advance(2);});
 assert.equal(ran,2);assert.equal(c.profiler.inspect().scopes.length,1);assert.equal(c.profiler.inspect().droppedScopes,1);
});

test('reset releases samples and active-reset errors preserve nesting',()=>{
 const c=clock();assert.throws(()=>c.profiler.measure('active',()=>c.profiler.reset()),/active CPU measurement/);
 assert.equal(byId(c.profiler).active.failures,1);c.profiler.reset();assert.deepEqual(c.profiler.inspect().scopes,[]);
 c.profiler.measure('after',()=>c.advance(2));assert.equal(byId(c.profiler).after.latestSelfMs,2);
});

test('shared statistics preserve renderer quantiles, including empty and unsorted input',()=>{
 assert.deepEqual(timingStats([]),{meanMs:0,p50Ms:0,p95Ms:0,maxMs:0});const values=[4,1,3,2];
 assert.deepEqual(timingStats(values),{meanMs:2.5,p50Ms:2,p95Ms:3,maxMs:4});assert.deepEqual(values,[4,1,3,2]);
 const renderer=new RenderProfiler(null,{enabled:false});renderer.beginFrame();renderer.submitted();assert.equal(renderer.inspect().cpuFrames,0);renderer.dispose();
});

test('invalid profiler budgets fail at construction',()=>{
 for(const options of [{capacity:0},{capacity:4097},{capacity:1.5},{maxScopes:0},{maxScopes:1025}])assert.throws(()=>new CpuProfiler(options),RangeError);
});

test('system measurement surrounds the actual handler rather than command creation',()=>{
 const c=clock(),systems=new SceneSystemRuntime(c.profiler),kernel=new EngineKernel();
 systems.use('physics',()=>c.advance(7));
 kernel.use({id:'engine:physics',phase:'simulate',rateHz:60,reads:[],writes:['world'],context:'none',run:()=>{c.advance(1);return[{action:'physics'}];}});
 kernel.run(1,{},'detailed',{profiler:c.profiler,commit(commands,view){assert.equal(this.profiler,c.profiler);for(const command of commands)systems.run(command.action,1/60,1/60);return view;}});
 const s=byId(c.profiler);assert.equal(s['module:engine:physics'].latestMs,1);assert.equal(s['system:physics'].latestMs,7);
 assert.equal(s['kernel:commit'].latestMs,7);assert.equal(s['kernel:commit'].latestSelfMs,0);
});

test('custom module context preparation and real module work have separate scopes',()=>{
 const c=clock(),kernel=new EngineKernel();kernel.use({id:'custom',phase:'plan',rateHz:60,reads:['x'],writes:[],run:context=>{assert.equal(context.x,4);c.advance(3);}});
 kernel.run(1,{},'detailed',{profiler:c.profiler,read:()=>{c.advance(2);return{x:4};}});
 const s=byId(c.profiler);assert.equal(s['kernel:read'].latestMs,2);assert.equal(s['module:custom'].latestMs,3);
});

test('all built-in handlers are profiled with exact scheduled cadence',()=>{
 const c=clock(),scene=new Scene({version:1,entities:[]},c.profiler);for(let i=0;i<60;i++)scene.step();
 const s=byId(c.profiler);for(const action of scene.systemRuntime.actions)assert.ok(s[`system:${action}`],action);
 assert.equal(s['system:physics'].calls,60);assert.equal(s['system:weather'].calls,10);assert.equal(s['system:surfaces'].calls,30);assert.equal(s['scene:step'].calls,60);
 assert.equal('kernel:read' in s,false,'built-ins must keep their existing context:none fast path');scene.dispose();
});

test('profiled and disabled scenes produce identical per-tick physical states and events',()=>{
 const spec={version:1,entities:[{id:'ball',position:[0,3,0],mesh:{kind:'sphere',radius:.5},body:{mass:1,restitution:.5}}]};
 const a=new Scene(spec),b=new Scene(spec,new CpuProfiler({enabled:true,capacity:16}));
 for(let tick=0;tick<180;tick++){a.step();b.step();assert.deepEqual(a.snapshot(),b.snapshot());assert.deepEqual(a.drainEvents(),b.drainEvents());assert.deepEqual(a.lastExecution,b.lastExecution);}
 assert.deepEqual(a.profiler.inspect().scopes,[]);assert.ok(b.profiler.inspect().scopes.every(s=>s.samples<=16));a.dispose();b.dispose();
});

test('tier-suppressed systems do not acquire fake zero-cost samples',()=>{
 const c=clock(),scene=new Scene({version:1,entities:[]},c.profiler);for(let i=0;i<6;i++)scene.step(1/60,'dormant');
 const s=byId(c.profiler);assert.equal('system:physics' in s,false);assert.equal('system:animation' in s,false);assert.equal(s['system:weather'].calls,1);scene.dispose();
});

test('browser bridge exposes systems beside existing GPU timings and resets both',()=>{
 let resets=0,audioCalls=0;const renderProfile={enabled:true,cpuFrames:1,gpuFrames:1,timestampQueries:true,gpuLagFrames:0,cpu:{},gpu:{}};
 const renderer={render(){},inspect(){return{profile:renderProfile};},profile(){return renderProfile;},resetProfile(){resets++;},resize(){},async flush(){},dispose(){}};
 const runtime=new BrowserRuntime({},{version:1,entities:[]},renderer,{audio:false,autoplay:false,profiling:true});
 runtime.audio={play(){audioCalls++;},playFootsteps(){},updateAmbient(){},dispose(){}};
 runtime.step(2);const report=runtime.bridge().profile();assert.equal(report.gpu,renderProfile.gpu);assert.equal(report.systems.enabled,true);
 assert.equal(report.systems.scopes.find(s=>s.id==='system:physics').calls,2);assert.equal(report.systems.scopes.find(s=>s.id==='audio:dispatch').calls,1);assert.equal(audioCalls,1);
 runtime.reset();runtime.step();assert.equal(runtime.scene.profiler.inspect().scopes.find(s=>s.id==='system:physics').calls,3);
 runtime.resetProfile();assert.equal(resets,1);assert.deepEqual(runtime.profile().systems.scopes,[]);runtime.dispose();
});
