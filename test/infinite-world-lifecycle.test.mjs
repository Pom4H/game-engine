import test from 'node:test';
import assert from 'node:assert/strict';
import {InfiniteWorld} from '../dist/world/infinite-world.js';

const turn=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const tile=(key,priority=1,distanceM=0)=>({key,id:{lod:0,x:0,z:0},bounds:{minX:0,minZ:0,maxX:128,maxZ:128},sizeM:128,priority,distanceM});

// These are deterministic lifecycle tests, not GPU/FPS or process-heap benchmarks.
test('generation and residency stay bounded through a complete drain',async()=>{
  let active=0,peak=0,generated=0;
  const installed=[],uninstalled=[];
  const world=new InfiniteWorld({
    generate:async d=>{active++;peak=Math.max(peak,active);await Promise.resolve();active--;generated++;return d.key;},
    install:d=>installed.push(d.key),uninstall:d=>uninstalled.push(d.key),
  },{maxResident:8,maxConcurrent:2,retainUpdates:0});
  const stats=world.update(Array.from({length:64},(_,i)=>tile(String(i))));
  assert.equal(stats.wanted,8);assert.equal(stats.deferred,56);assert.equal(stats.pending,2);
  await world.flush();
  assert.equal(generated,8);assert.ok(peak<=2);assert.equal(world.inspect().active,0);
  assert.equal(world.inspect().resident,8);assert.equal(installed.length,8);
  world.update([]);assert.equal(uninstalled.length,8);world.dispose();
});

test('cancellation keeps real concurrency bounded across 1000 camera updates',async()=>{
  const jobs=[],released=[];
  const world=new InfiniteWorld({generate:(d,signal)=>{const job={d,signal,...deferred()};jobs.push(job);return job.promise;},release:(d,v)=>released.push(v)}, {maxResident:2,maxConcurrent:2,retainUpdates:0});
  world.update([tile('old-a'),tile('old-b')]);await turn();
  for(let i=0;i<1000;i++){world.update([tile('a-'+i),tile('b-'+i)]);await Promise.resolve();}
  assert.equal(jobs.length,2,'abort is not task completion');
  assert.ok(jobs.every(j=>j.signal.aborted));assert.equal(world.inspect().active,2);
  for(const job of jobs)job.resolve(job.d.key);
  await turn();assert.equal(jobs.length,4,'only the latest plan is admitted');
  assert.deepEqual(jobs.slice(2).map(j=>j.d.key),['a-999','b-999']);
  for(const job of jobs.slice(2))job.resolve(job.d.key);
  await world.flush();assert.equal(world.inspect().resident,2);assert.equal(released.length,2);
  world.dispose();assert.equal(released.length,4);assert.equal(new Set(released).size,4);
});

test('a late result after disposal is released but never installed',async()=>{
  const job=deferred(),calls=[];
  const world=new InfiniteWorld({generate:()=>job.promise,install:()=>calls.push('install'),uninstall:()=>calls.push('uninstall'),release:(d,v)=>calls.push(v)});
  world.update([tile('a')]);await turn();world.dispose();world.dispose();
  assert.equal(world.inspect().active,1);job.resolve('release');await world.flush();
  assert.deepEqual(calls,['release']);assert.equal(world.inspect().active,0);
});

test('flush waits for cancelled tasks and their cleanup',async()=>{
  const job=deferred();let released=false,drained=false;
  const world=new InfiniteWorld({generate:()=>job.promise,release:()=>{released=true;}});
  world.update([tile('a')]);await turn();world.update([]);
  const drain=world.flush().then(()=>{drained=true;});await turn();
  assert.equal(drained,false);job.resolve({});await drain;
  assert.equal(released,true);assert.equal(drained,true);world.dispose();
});

test('synchronous generation errors are contained and only explicitly retried',async()=>{
  let attempts=0,errors=0;
  const world=new InfiniteWorld({generate:()=>{attempts++;throw new Error('sync');},onError:()=>errors++});
  assert.doesNotThrow(()=>world.update([tile('a')]));await world.flush();
  assert.equal(attempts,1);assert.equal(errors,1);assert.equal(world.inspect().failed,1);
  world.update([tile('a')]);await world.flush();assert.equal(attempts,2);
  world.dispose();assert.equal(world.inspect().failed,0);
});

test('async failures do not create a retry microtask loop or starve other tiles',async()=>{
  let attempts=0;const errors=[];
  const world=new InfiniteWorld({
    generate:async d=>{if(d.key==='bad'){if(++attempts>4)world.dispose();throw new Error('async');}return d.key;},
    onError:d=>errors.push(d.key),
  },{maxResident:3,maxConcurrent:1});
  world.update([tile('bad',3),tile('good-a',2),tile('good-b',1)]);await world.flush();
  assert.equal(attempts,1);assert.deepEqual(errors,['bad']);
  assert.equal(world.inspect().failed,1);assert.equal(world.inspect().resident,2);world.dispose();
});

test('partial installation failure detaches and releases exactly once',async()=>{
  let attempts=0;const calls=[];
  const world=new InfiniteWorld({generate:()=>({}),install:()=>{calls.push('install');if(++attempts>4)world.dispose();throw new Error('install');},uninstall:()=>calls.push('detach'),release:()=>calls.push('release'),onError:()=>calls.push('error')});
  world.update([tile('a')]);await world.flush();
  assert.deepEqual(calls,['install','detach','release','error']);assert.equal(world.has('a'),false);
  world.dispose();assert.equal(calls.filter(c=>c==='release').length,1);
});

test('throwing uninstall cannot skip release or cleanup of the next tile',async()=>{
  const released=[],errors=[];
  const world=new InfiniteWorld({generate:d=>d.key,uninstall:()=>{throw new Error('detach');},release:(d,v)=>released.push(v),onError:(d,e)=>errors.push(e.message)}, {maxResident:2,maxConcurrent:2});
  world.update([tile('a'),tile('b')]);await world.flush();
  assert.doesNotThrow(()=>world.dispose());assert.deepEqual(released,['a','b']);
  assert.deepEqual(errors,['detach','detach']);assert.equal(world.inspect().hookErrors,2);
  world.dispose();assert.equal(released.length,2);assert.equal(world.inspect().resident,0);
});

test('release failures are observable and do not block remaining cleanup',async()=>{
  const attempted=[];
  const world=new InfiniteWorld({generate:d=>d.key,release:(d,v)=>{attempted.push(v);if(v==='a')throw new Error('release');}}, {maxResident:2,maxConcurrent:2});
  world.update([tile('a'),tile('b')]);await world.flush();world.dispose();
  assert.deepEqual(attempted,['a','b']);assert.equal(world.inspect().hookErrors,1);
});

test('throwing diagnostic callbacks cannot strand a concurrency slot',async()=>{
  let attempts=0;
  const world=new InfiniteWorld({generate:async()=>{if(++attempts>4)world.dispose();throw new Error('generation');},onError:()=>{throw new Error('diagnostic');}});
  world.update([tile('a')]);await world.flush();
  assert.equal(world.inspect().active,0);assert.equal(world.inspect().hookErrors,1);assert.equal(attempts,1);world.dispose();
});

test('undefined is a valid owned payload, not an uninitialized entry',async()=>{
  let detached=0,released=0;
  const world=new InfiniteWorld({generate:()=>undefined,uninstall:(d,v)=>{assert.equal(v,undefined);detached++;},release:(d,v)=>{assert.equal(v,undefined);released++;}});
  world.update([tile('a')]);await world.flush();
  assert.equal(world.has('a'),true);assert.equal(world.ready().length,1);
  world.dispose();assert.equal(detached,1);assert.equal(released,1);
});

test('priority then distance then key determines admission, independent of input order',async()=>{
  const demands=[tile('z',10,2),tile('b',10,1),tile('a',10,1),tile('near-low',1,0)];
  for(let shift=0;shift<demands.length;shift++){
    const generated=[];
    const world=new InfiniteWorld({generate:d=>{generated.push(d.key);return d.key;}},{maxResident:3,maxConcurrent:1});
    const order=[...demands.slice(shift),...demands.slice(0,shift)];
    world.update(order);await world.flush();assert.deepEqual(generated,['a','b','z']);world.dispose();
  }
});

test('invalid updates are atomic and leave a live plan unchanged',async()=>{
  const world=new InfiniteWorld({generate:d=>d.key});world.update([tile('live')]);await world.flush();
  const before=world.inspect();
  assert.throws(()=>world.update([tile('dup'),tile('dup')]),/duplicate/);
  for(const bad of [tile('bad',NaN),tile('bad',Infinity),tile('bad',1,-1),tile('bad',1,NaN)])assert.throws(()=>world.update([bad]),RangeError);
  assert.deepEqual(world.inspect(),before);assert.equal(world.has('live'),true);world.dispose();
});

test('admission snapshots borrowed demands before deferred work begins',async()=>{
  const demand=tile('original');let seen;
  const world=new InfiniteWorld({generate:d=>{seen=d;return d.key;}});
  world.update([demand]);demand.key='changed';demand.id.x=77;demand.bounds.minX=99;
  await world.flush();assert.equal(seen.key,'original');assert.equal(seen.id.x,0);assert.equal(seen.bounds.minX,0);
  assert.equal(world.has('original'),true);world.dispose();
});

test('cancellation before invocation never runs the generator',async()=>{
  let calls=0;
  const world=new InfiniteWorld({generate:()=>{calls++;return{};}});
  world.update([tile('a')]);world.dispose();await world.flush();assert.equal(calls,0);
});

test('an obsolete generation cannot overwrite a later request with the same key',async()=>{
  const jobs=[],installed=[],released=[];
  const world=new InfiniteWorld({generate:()=>{const job=deferred();jobs.push(job);return job.promise;},install:(d,v)=>installed.push(v),release:(d,v)=>released.push(v)}, {maxResident:1,maxConcurrent:1,retainUpdates:0});
  world.update([tile('a')]);await turn();world.update([]);world.update([tile('a')]);
  assert.equal(jobs.length,1);jobs[0].resolve('old');await turn();assert.equal(jobs.length,2);
  jobs[1].resolve('new');await world.flush();assert.deepEqual(installed,['new']);assert.deepEqual(released,['old']);
  assert.equal(world.value('a'),'new');world.dispose();assert.deepEqual(released,['old','new']);
});

test('retention cannot prevent admission within the resident count limit',async()=>{
  const released=[];
  const world=new InfiniteWorld({generate:d=>d.key,release:(d,v)=>released.push(v)},{maxResident:2,maxConcurrent:1,retainUpdates:100});
  world.update([tile('a'),tile('b')]);await world.flush();world.update([tile('c'),tile('d')]);await world.flush();
  assert.equal(world.inspect().resident,2);assert.deepEqual(released,['a','b']);assert.deepEqual(world.ready().map(x=>x.value),['c','d']);world.dispose();
});

test('recursive dispose is idempotent and never double releases a value',async()=>{
  let released=0;
  const world=new InfiniteWorld({generate:()=>({}),uninstall:()=>world.dispose(),release:()=>released++});
  world.update([tile('a'),tile('b')]);await world.flush();world.dispose();world.dispose();
  assert.equal(released,2);assert.equal(world.inspect().resident,0);
});

test('disposal during install defers cleanup until the hook returns',async()=>{
  let inInstall=false;const calls=[];
  const world=new InfiniteWorld({generate:()=>({}),install:()=>{inInstall=true;world.dispose();assert.deepEqual(calls,[]);inInstall=false;},uninstall:()=>calls.push('detach'),release:()=>{assert.equal(inInstall,false);calls.push('release');}});
  world.update([tile('a')]);await world.flush();assert.deepEqual(calls,['detach','release']);assert.equal(world.has('a'),false);
});

test('a plan change inside install cannot publish an obsolete tile',async()=>{
  const released=[],installed=[];
  const world=new InfiniteWorld({generate:d=>d.key,install:d=>{installed.push(d.key);if(d.key==='a')world.update([tile('b')]);},release:(d,v)=>released.push(v)}, {maxResident:1,maxConcurrent:1});
  world.update([tile('a')]);await world.flush();assert.deepEqual(installed,['a','b']);assert.deepEqual(released,['a']);
  assert.equal(world.has('a'),false);assert.equal(world.has('b'),true);world.dispose();
});

test('a rejected cancelled task is not reported as a generation failure',async()=>{
  const job=deferred(),errors=[];
  const world=new InfiniteWorld({generate:()=>job.promise,onError:(d,e)=>errors.push(e)});
  world.update([tile('a')]);await turn();world.dispose();job.reject(new Error('aborted'));await world.flush();
  assert.deepEqual(errors,[]);assert.equal(world.inspect().active,0);
});

test('failure metadata is bounded across distinct plans',async()=>{
  let attempts=0;
  const world=new InfiniteWorld({generate:async()=>{attempts++;if(attempts>210)world.dispose();throw new Error('unavailable');}},{maxResident:2,maxConcurrent:1});
  for(let i=0;i<200;i++){world.update([tile(String(i))]);await world.flush();assert.equal(world.inspect().failed,1);}
  assert.equal(attempts,200);world.dispose();assert.equal(world.inspect().failed,0);
});

test('200 load/unload cycles return the explicit resource ledger to zero',async()=>{
  const live=new Set();let created=0,released=0;
  const world=new InfiniteWorld({generate:d=>{const resource={key:d.key,id:++created};live.add(resource);return resource;},release:(d,value)=>{assert.equal(live.delete(value),true,'exactly one owner must release each payload');released++;}},{maxResident:4,maxConcurrent:2,retainUpdates:0});
  for(let i=0;i<200;i++){
    world.update(Array.from({length:4},(_,j)=>tile(`${i}:${j}`)));await world.flush();assert.equal(live.size,4);
    world.update([]);await world.flush();assert.equal(live.size,0);assert.equal(world.inspect().active,0);
  }
  world.dispose();assert.equal(created,800);assert.equal(released,800);assert.equal(world.inspect().hookErrors,0);
});

test('reentrant update during eviction is isolated without corrupting the new plan',async()=>{
  let recursive=true;
  const world=new InfiniteWorld({generate:d=>d.key,uninstall:()=>{if(recursive){recursive=false;world.update([tile('recursive')]);}}},{maxResident:1,maxConcurrent:1,retainUpdates:0});
  world.update([tile('a')]);await world.flush();world.update([tile('b')]);await world.flush();
  assert.equal(world.has('b'),true);assert.equal(world.has('recursive'),false);assert.equal(world.inspect().hookErrors,1);world.dispose();
});
