// These test the host adapter, NOT Rust numerical correctness.
import test from 'node:test';
import assert from 'node:assert/strict';
import {RustKernelRuntime,RustKernelPass} from '../dist/rust.js';
function mock() {
  const memory=new WebAssembly.Memory({initial:1});let next=256,sequence=0,error=0;
  const batches=new Map();let freed=0;
  const api={memory,
    rom4_abi_version:()=>1,rom4_last_error:()=>error,
    rom4_create(w,n,h,v,k,t,d){
      const sizes=[w*15,w*7,n*3,h*4,h,h*12,v*3,n*3,v*k,v*k,v*3,t*3,v*3,d*9,v*6];
      const fields=sizes.map((length,i)=>{next=Math.ceil(next/8)*8;const kind=[3,8,11].includes(i)?2:i===14?3:1;
        const offset=next;next+=length*(kind===1?8:4);return {offset,length,kind};});
      if(next>memory.buffer.byteLength)memory.grow(Math.ceil((next-memory.buffer.byteLength)/65536));
      batches.set(++sequence,{fields,bytes:sizes.reduce((s,l,i)=>s+l*(fields[i].kind===1?8:4),0)});error=0;return sequence;
    },
    rom4_free(h){if(!batches.delete(h)){error=1;return 0;}freed++;error=0;return 1;},
    rom4_execute(h,f){error=!batches.has(h)?1:f===8?6:0;return error?0:1;},
    rom4_field_ptr(h,f){error=0;return batches.get(h).fields[f-1].offset;},
    rom4_field_len(h,f){error=0;return batches.get(h).fields[f-1].length;},
    rom4_field_kind(h,f){error=0;return batches.get(h).fields[f-1].kind;},
    rom4_live_handles:()=>batches.size,rom4_live_bytes:()=>[...batches.values()].reduce((s,b)=>s+b.bytes,0),
  };
  return {api,get freed(){return freed;}};
}
test('ABI and required exports are validated',()=>{
  const m=mock();assert.throws(()=>new RustKernelRuntime({}),/memory/);
  assert.throws(()=>new RustKernelRuntime({...m.api,rom4_abi_version:()=>2}),/ABI/);
  assert.throws(()=>new RustKernelRuntime({...m.api,rom4_execute:undefined}),/rom4_execute/);
});
test('invalid counts are rejected before native allocation',()=>{
  const m=mock(),r=new RustKernelRuntime(m.api);
  for(const config of [{wheelCount:NaN},{wheelCount:-1},{wheelCount:1.5},{wheelCount:16385},{nodeCount:1,vertexCount:1,influences:0},{hingeCount:1}])assert.throws(()=>r.createBatch(config),RangeError);
  assert.equal(r.stats.liveHandles,0);r.dispose();
});
test('steady-state buffer getters reuse both object and typed arrays',()=>{
  const m=mock(),r=new RustKernelRuntime(m.api),b=r.createBatch({wheelCount:4});
  const views=b.buffers;views.wheelInput[0]=42;
  for(let i=0;i<100;i++){b.execute(RustKernelPass.Wheels);assert.strictEqual(b.buffers,views);}
  assert.equal(b.buffers.wheelInput[0],42);assert.equal(views.wheelInput.length,60);assert.equal(views.wheelOutput.length,28);r.dispose();
});
test('memory growth refreshes views without losing prior data',()=>{
  const m=mock(),r=new RustKernelRuntime(m.api),a=r.createBatch({wheelCount:1});
  const old=a.buffers;old.wheelInput[0]=0.125;
  const b=r.createBatch({wheelCount:2048});
  assert.equal(old.wheelInput.byteLength,0);assert.notStrictEqual(a.buffers,old);
  assert.equal(a.buffers.wheelInput[0],0.125);b.dispose();r.dispose();
});
test('native failure is reported and disposal is idempotent',()=>{
  const m=mock(),r=new RustKernelRuntime(m.api),b=r.createBatch({});
  assert.throws(()=>b.execute(RustKernelPass.Dents),/pass combination/);
  assert.throws(()=>b.execute(2**32),/mask/);
  b.dispose();b.dispose();assert.equal(m.freed,1);
  assert.throws(()=>b.buffers,/disposed/);assert.throws(()=>b.execute(0),/disposed/);
  r.dispose();r.dispose();assert.throws(()=>r.createBatch(),/disposed/);
});
test('runtime disposal releases every live batch, including empty batches',()=>{
  const m=mock(),r=new RustKernelRuntime(m.api),a=r.createBatch({wheelCount:1}),b=r.createBatch({});
  r.dispose();assert.equal(m.freed,2);assert.equal(r.stats.liveHandles,0);assert.equal(r.stats.liveBytes,0);
  assert.throws(()=>a.buffers,/disposed/);assert.throws(()=>b.buffers,/disposed/);
});
test('corrupt field layout frees the newly-created native handle',()=>{
  const m=mock(),r=new RustKernelRuntime({...m.api,rom4_field_kind:()=>99});
  assert.throws(()=>r.createBatch({wheelCount:1}),/layout mismatch/);
  assert.equal(m.freed,1);assert.equal(r.stats.liveHandles,0);r.dispose();
});
test('out-of-bounds or misaligned native memory ranges are rejected',()=>{
  for(const pointer of [-1,3,2**32]){
    const m=mock(),r=new RustKernelRuntime({...m.api,rom4_field_ptr:()=>pointer});
    assert.throws(()=>r.createBatch({wheelCount:1}),/field range/);assert.equal(m.freed,1);r.dispose();
  }
});
