import test from 'node:test';
import assert from 'node:assert/strict';
import {consoleSession,readPath,formatValue} from '../tools/docs/console.mjs';

test('one sample shares readers; the next sample observes live state',()=>{
 let calls=0,tick=1;
 const session=consoleSession({sources:{scene:()=>{calls++;return {tick};}}});
 const read=session.sample();assert.equal(read('scene.tick'),1);assert.equal(read('scene').tick,1);assert.equal(calls,1);
 tick=2;assert.equal(read('scene.tick'),1);assert.equal(session.sample()('scene.tick'),2);assert.equal(calls,2);
});
test('read traversal cannot call methods, inherited fields or getters',()=>{
 let touched=0;const state={get costly(){touched++;return 1;},method(){touched++;}};
 const roots={scene:()=>state};
 for(const path of ['scene.__proto__','scene.constructor','scene.costly','scene.method','toString','scene.missing','scene..tick'])assert.throws(()=>readPath(roots,path));
 assert.equal(touched,0);
});
test('existing entity Maps can be inspected without copying the world',()=>{
 const entity={position:[1,2,3]},roots={entities:()=>new Map([['car/body',entity]])};
 assert.equal(readPath(roots,'entities.car/body'),entity);assert.equal(readPath(roots,'entities.car/body.position.1'),2);
});
test('formatter bounds cyclic, typed and large values and does not invoke getters',()=>{
 const cyclic={x:1};cyclic.self=cyclic;
 assert.match(formatValue(cyclic),/reference/);
 assert.ok(formatValue(new Float64Array(100000)).length<1000);
 assert.ok(formatValue({large:'x'.repeat(100000)}).length<1000);
 assert.match(formatValue({get value(){throw new Error('must not run');}}),/getter/);
 assert.equal(formatValue(undefined),'undefined');assert.equal(formatValue(NaN),'"NaN"');
});
test('set uses the existing binding edit callback; inspected runtime is not writable',async()=>{
 const edits=[],binding={id:'render/scene/rendering/exposure/0',key:'exposure',editable:true,value:1};
 const session=consoleSession({sources:{render:()=>({exposure:1})},bindings:()=>[binding],edit:(...args)=>{edits.push(args);return 'queued';}});
 assert.equal(await session.execute('set exposure 1.2'),'queued');assert.deepEqual(edits,[[binding.id,1.2]]);
 await assert.rejects(session.execute('set render.exposure 2'),/Unknown source/);
 assert.equal(await session.execute('inspect render.exposure'),'1');
});
test('ambiguous and computed source bindings are rejected rather than guessed',async()=>{
 const list=[{id:'a',key:'mass',editable:true},{id:'b',key:'mass',editable:true},{id:'expr',key:'expr',editable:false}];
 const calls=[],session=consoleSession({sources:{},bindings:()=>list,edit:(...args)=>calls.push(args)});
 await assert.rejects(session.execute('set mass 3'),/Ambiguous/);
 await assert.rejects(session.execute('set expr 3'),/read-only/);
 await assert.rejects(session.execute('set a NaN'),SyntaxError);
 await session.execute('set a [1,2,3]');assert.deepEqual(calls,[['a',[1,2,3]]]);
});
test('only explicit commands run; errors reach the caller',async()=>{
 const session=consoleSession({sources:{scene:()=>({tick:4})},actions:{pause:target=>target,fail:()=>{throw new Error('stale epoch');}}});
 assert.equal(await session.execute('pause server'),'server');
 await assert.rejects(session.execute('fail'),/stale epoch/);
 for(const line of ['constructor','toString','eval alert(1)','scene.tick = 20'])await assert.rejects(session.execute(line),/Unknown command/);
 await assert.rejects(session.execute('x'.repeat(2049)),/limit/);
});
test('watches are bounded, deduplicated, removable and not polled by a timer',async()=>{
 let reads=0;const sources=Object.fromEntries(Array.from({length:17},(_,i)=>['v'+i,()=>{reads++;return i;}]));
 const session=consoleSession({sources});
 for(let i=0;i<16;i++)await session.execute('watch v'+i);
 await session.execute('watch v0');assert.equal(session.watches.size,16);
 await assert.rejects(session.execute('watch v16'),/Watch limit/);
 await session.execute('unwatch v0');await session.execute('watch v16');assert.equal(session.watches.size,16);
 const before=reads;await new Promise(r=>setTimeout(r,20));assert.equal(reads,before);
});
