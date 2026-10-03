import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryContentStore as SharedContentStore,contentHash} from '../dist/content/index.js';
import {MemoryContentStore as RenderContentStore} from '../dist/render-ir/index.js';
import {CausalStorage,MemoryScopeHeadStore} from '../dist/storage/index.js';

const grant=(ownerId='server:a')=>({scope:{domain:'physics',id:'region:41'},ownerId,epoch:1,revision:0});

test('render and world persistence share the exact same content-addressing implementation',()=>{
 const a=new SharedContentStore(),b=new RenderContentStore(),value={z:3,a:[1,2]};
 const ra=a.put('buffer',value),rb=b.put('buffer',value);
 assert.equal(ra.hash,rb.hash);assert.equal(ra.hash,contentHash({kind:'buffer',value}));
});

test('scope head is the only mutable pointer while state, mutations and checkpoints are immutable CAS',()=>{
 const content=new SharedContentStore(),heads=new MemoryScopeHeadStore(),storage=new CausalStorage(content,heads);
 const initial=storage.bootstrap(grant(),{position:[0,0,0],fuel:10},{tick:5,time:.5});
 const first=storage.append(initial,{tick:6,time:.6,action:'move',payload:{dx:1}});
 assert.equal(first.decision,'accept');assert.equal(first.head.revision,1);
 const stale=storage.append(initial,{tick:6,time:.6,action:'move',payload:{dx:99}});
 assert.equal(stale.decision,'stale-head');assert.equal(heads.read(initial.scope).revision,1);
 const second=storage.append(first.head,{tick:7,time:.7,action:'burn-fuel',payload:{litres:2}});
 assert.equal(second.decision,'accept');assert.equal(second.head.revision,2);
 const restored=storage.restore(second.head);
 assert.deepEqual(restored.state,{position:[0,0,0],fuel:10});
 assert.deepEqual(restored.mutations.map(x=>x.payload),[{dx:1},{litres:2}]);
 assert.deepEqual(restored.mutations.map(x=>[x.record.baseRevision,x.record.revision]),[[0,1],[1,2]]);
});

test('checkpoint compacts replay without duplicating unchanged state chunks',()=>{
 const content=new SharedContentStore(),heads=new MemoryScopeHeadStore(),storage=new CausalStorage(content,heads),g=grant();
 const h0=storage.bootstrap(g,{population:1000,roads:'v1'},{tick:0,time:0});
 const stateHash0=storage.restore(h0).checkpoint.state.hash;
 const cpSame=storage.checkpoint(h0,{population:1000,roads:'v1'});assert.equal(cpSame.decision,'accept');
 assert.equal(storage.restore(cpSame.head).checkpoint.state.hash,stateHash0,'identical state must deduplicate');
 const moved=storage.append(cpSame.head,{tick:1,time:1/60,action:'population-delta',payload:{delta:1}});assert.equal(moved.decision,'accept');
 const cp=storage.checkpoint(moved.head,{population:1001,roads:'v1'});assert.equal(cp.decision,'accept');
 const restored=storage.restore(cp.head);assert.deepEqual(restored.state,{population:1001,roads:'v1'});assert.equal(restored.mutations.length,0);
});

test('replication hydrates a peer before authority handoff and old head cannot win CAS',()=>{
 const source=new SharedContentStore(),target=new SharedContentStore(),heads=new MemoryScopeHeadStore(),storage=new CausalStorage(source,heads);
 const mesh=source.put('mesh',{id:'shared-road'}),h0=storage.bootstrap(grant(),{cars:4},{tick:10,time:1,dependencies:[mesh]});
 const h1=storage.append(h0,{tick:11,time:1.1,action:'spawn',payload:{car:'c5'}}).head;
 const proof=storage.replicate(h1,target);
 assert.ok(target.has(h1.checkpoint.hash));assert.ok(target.has(mesh.hash));
 const peer=new CausalStorage(target,new MemoryScopeHeadStore()),restored=peer.restore(h1);assert.deepEqual(restored.state,{cars:4});assert.deepEqual(restored.mutations[0].payload,{car:'c5'});
 const migrated=storage.handoff(h1,'server:b',proof);assert.equal(migrated.ownerId,'server:b');assert.equal(migrated.epoch,2);assert.equal(migrated.revision,h1.revision);
 assert.throws(()=>storage.handoff(h1,'server:c',proof),/head changed/);
});

test('tampered hydration proof cannot move authority',()=>{
 const source=new SharedContentStore(),target=new SharedContentStore(),heads=new MemoryScopeHeadStore(),storage=new CausalStorage(source,heads);
 const head=storage.bootstrap(grant(),{x:1},{tick:0,time:0}),proof=storage.replicate(head,target);
 assert.throws(()=>storage.handoff(head,'server:b',{...proof,stateHash:'sha256:deadbeef'}),/state hash|proof/i);
 assert.equal(heads.read(head.scope).ownerId,'server:a');
});
