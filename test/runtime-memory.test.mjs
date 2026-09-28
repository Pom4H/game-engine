import test from 'node:test';
import assert from 'node:assert/strict';
import {runtimeMemorySnapshot,trackRuntimeMemory,trackRuntimeSlot} from '../dist/index.js';

test('runtime memory exposes live collections and follows replaceable slots',()=>{
  const owner='test:runtime-memory:'+Date.now();
  const cache=trackRuntimeMemory(owner,'cache','cache',new Map(),8);
  cache.set('a',1);cache.set('b',2);
  const host={buffer:new Uint8Array(4)};
  trackRuntimeSlot(owner,'buffer','state',host,'buffer');

  let entries=runtimeMemorySnapshot().filter(entry=>entry.owner===owner);
  assert.equal(entries.find(entry=>entry.name==='cache')?.items,2);
  assert.equal(entries.find(entry=>entry.name==='cache')?.capacity,8);
  assert.equal(entries.find(entry=>entry.name==='buffer')?.bytes,4);

  host.buffer=new Uint8Array(16);
  entries=runtimeMemorySnapshot().filter(entry=>entry.owner===owner);
  assert.equal(entries.find(entry=>entry.name==='buffer')?.bytes,16);
});
