/** Compare compiled production ABI modules, not a hand-written WASM surrogate.
 * Usage: node tools/structure-simd-wasm-parity.mjs reference.wasm simd.wasm
 */
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
if(process.argv.length!==4)throw new Error('Expected reference.wasm and simd.wasm');
const modules=await Promise.all(process.argv.slice(2).map(async p=>WebAssembly.compile(await readFile(p))));
function bind(e,h,n,m){
  const lengths=[n*3,n*3,n*3,n*3,n,n,n*3,m,m,m,m,m,m,m,m,m,m,m,m,m,m,n,m];
  return lengths.map((len,i)=>{
    const Type=i===7||i===22?Uint8Array:i>=8&&i<=11?Uint16Array:Float64Array;
    const ptr=e.world_structure_field(h,i)>>>0;
    assert.ok(ptr>0&&ptr%Type.BYTES_PER_ELEMENT===0&&ptr+len*Type.BYTES_PER_ELEMENT<=e.memory.buffer.byteLength);
    return new Type(e.memory.buffer,ptr,len);
  });
}
async function make(module,scenario){
  const {exports:e}=await WebAssembly.instantiate(module,{math:{hypot:Math.hypot,exp:Math.exp,pow:Math.pow}});
  const pairs=scenario==='chain'?[[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,7]]:
    [[0,1],[2,3],[1,2],[4,5],[6,7],[3,4],[0,7],[0,1],[5,6]];
  const h=e.world_structure_new(8,pairs.length)>>>0;assert.ok(h);
  const contacts=scenario==='contacts';
  if(contacts){
    assert.equal(e.world_structure_add_box(h,0.5,-0.1,0.5,2,0.1,2),1);
    assert.equal(e.world_structure_add_triangle(h,0,1,4),1);
    assert.equal(e.world_structure_finish_contacts(h),1);
  }
  const f=bind(e,h,8,pairs.length);
  f[0].set([0,0,0, 1,0,0, 0,1,0, 1,1,0, 0,0,1, 1,0,1, 0,1,1, 1,1,1]);
  f[4].fill(1);f[5].fill(1);
  pairs.forEach(([a,b],i)=>{
    f[8][i]=a;f[9][i]=b;
    f[13][i]=Math.hypot(...[0,1,2].map(k=>f[0][b*3+k]-f[0][a*3+k]));
  });
  if(scenario!=='chain'){f[7][7]=1;f[10][7]=2;f[11][7]=4;f[13][7]=1/6;}
  f[12].set(f[13]);f[14].fill(1e-5);f[15].fill(0.001);f[16].fill(5);
  f[16][6]=0.00001;f[17].fill(0.1);f[18].fill(20);
  f[0][3]+=0.08;f[0][21]+=0.08;
  const scalars=new Float64Array(e.memory.buffer,e.world_structure_scalars(h)>>>0,3);
  const stats=new Float64Array(e.memory.buffer,e.world_structure_contact_stats(h)>>>0,7);
  return {e,h,f,scalars,stats,contacts,buffer:e.memory.buffer};
}
const report=[];
for(const scenario of ['mixed','chain','contacts','topology-mutation']){
  const a=await make(modules[0],scenario),b=await make(modules[1],scenario);
  let maxAbsoluteError=0,squared=0,count=0;
  try{
    for(let tick=0;tick<120;tick++){
      if(scenario==='topology-mutation'&&tick===30){a.f[8][1]=1;b.f[8][1]=1;}
      const step=s=>s.e.world_structure_step(s.h,8,1/120,0,-9.81,0,0.2,1,0.001,10,+s.contacts);
      const sa=step(a),sb=step(b);assert.ok(sa===1||sa===2);assert.equal(sa,sb);
      assert.equal(a.e.memory.buffer,a.buffer);assert.equal(b.e.memory.buffer,b.buffer);
      for(const [x,y] of [...a.f.map((x,i)=>[x,b.f[i]]),[a.scalars,b.scalars],[a.stats,b.stats]]){
        for(let i=0;i<x.length;i++){
          if(!(x instanceof Float64Array)){assert.equal(x[i],y[i]);continue;}
          assert.ok(Number.isFinite(x[i])&&Number.isFinite(y[i]));
          const error=Math.abs(x[i]-y[i]);
          assert.ok(error<=1e-7*(1+Math.max(Math.abs(x[i]),Math.abs(y[i]))),
            `${scenario} tick=${tick} index=${i}: ${x[i]} versus ${y[i]}`);
          maxAbsoluteError=Math.max(maxAbsoluteError,error);squared+=error*error;count++;
        }
      }
    }
    report.push({scenario,ticks:120,maxAbsoluteError,rmse:Math.sqrt(squared/count)});
  }finally{a.e.world_structure_free(a.h);b.e.world_structure_free(b.h);}
}
console.log(JSON.stringify({scope:'Rust WASM ABI parity; not FPS or bitwise JS equivalence',report},null,2));
