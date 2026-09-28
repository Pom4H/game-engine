import test from 'node:test';
import assert from 'node:assert/strict';
import {CausalRuntime} from '../dist/index.js';

test('one cause has one attachment path',()=>{
  const runtime=new CausalRuntime(),seen=[];
  runtime.when('physics',frame=>seen.push(frame));
  runtime.apply({type:'physics',deltaSeconds:1/60},2);
  assert.deepEqual(seen,[{dt:1/60,at:2}]);
  assert.throws(()=>runtime.when('physics',()=>{}),/already attached/);
});

test('unknown causes fail instead of disappearing into callbacks',()=>{
  const runtime=new CausalRuntime();
  assert.throws(()=>runtime.apply({type:'events',deltaSeconds:1/60},1),/No effect/);
});
