import test from 'node:test';
import assert from 'node:assert/strict';
import {CausalWorldRuntime,BlueprintRegistry,definitionDigest} from '../dist/index.js';

test('Engine calendar drains deterministic due work within its budget and invalidates only declared consumers',()=>{
 const clock=new CausalWorldRuntime();for(const id of ['z','a','b'])clock.events.schedule({id,dueTick:10,kind:'build',payload:{units:1}});clock.events.schedule({id:'future',dueTick:12,kind:'build'});assert.equal(clock.events.cancel('z'),true);
 assert.deepEqual(clock.advanceTo(10,1).processed.map(e=>e.id),['a']);assert.equal(clock.advanceTo(10,0).saturated,true);assert.deepEqual(clock.advanceTo(10,1).processed.map(e=>e.id),['b']);assert.equal(clock.advanceTo(10,1).saturated,false);
 const restored=new CausalWorldRuntime();restored.events.restore(clock.events.snapshot());assert.deepEqual(restored.advanceTo(12).processed.map(e=>e.id),['future']);assert.throws(()=>restored.advanceTo(11),/backwards/);
 clock.dependencies.watch('a',['stock','price']);clock.dependencies.watch('b',['price']);clock.dependencies.watch('c',['weather']);assert.deepEqual(clock.dependencies.invalidate(['stock','stock']),['a']);assert.equal(clock.dependencies.version('stock'),1);assert.deepEqual(clock.dependencies.invalidate(['price']),['a','b']);clock.dependencies.unwatch('b');assert.deepEqual(clock.dependencies.invalidate(['price']),['a']);
});

test('Engine blueprint registry preserves canonical keys, immutable compiled definitions and one compilation per revision',()=>{
 let calls=0;const registry=new BlueprintRegistry(spec=>{calls++;return{weight:spec.mass*2,parts:[...spec.parts]};},2),source={id:'assembly:1',revision:1,kind:'machine',author:'host',spec:{mass:12,parts:['left','right']}};
 const value=registry.publish(source);assert.equal(calls,1);assert.equal(registry.publish(source),value);assert.equal(calls,1);assert.equal(definitionDigest({mass:12,parts:['left','right']}),definitionDigest({parts:['left','right'],mass:12}));
 source.spec.parts.push('later');assert.deepEqual(value.spec.parts,['left','right']);assert.deepEqual(value.compiled.parts,['left','right']);assert.throws(()=>value.compiled.parts.push('mutation'),TypeError);assert.throws(()=>registry.publish(source),/immutable/);
 const next=registry.publish({...source,revision:2});assert.notEqual(next.key,value.key);assert.deepEqual(registry.ref(value.key),{key:value.key,id:value.id,revision:1,digest:value.digest});assert.equal(registry.getRevision('machine','assembly:1',1),value);assert.throws(()=>registry.publish({...source,id:'other'}),/full/);
});
