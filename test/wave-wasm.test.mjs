import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {AcousticWaveField} from '../dist/physics/wave-field.js';
import {createWasmAcousticWaveField,uploadAcousticPressurePlane} from '../dist/physics/wave-wasm.js';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const wasmPath=resolve(root,'kernels/world-wave/target/wasm32-unknown-unknown/release/world_wave_kernel.wasm');
const wasmBytes=new Uint8Array(readFileSync(wasmPath));
const module=await WebAssembly.compile(wasmBytes);
const spec={size:[23,7,19],cellSizeM:.5,waveSpeedMps:343,densityKgM3:1.225,velocityDampingPerSecond:6};

function prime(field){
  for(let y=0;y<7;y++)for(let z=0;z<19;z++)field.setSolidCell(12,y,z);
  for(let x=0;x<11;x++)for(let z=0;z<19;z++)if((x+z)%7===0)field.addPressureCell(x,3,z,(x+z+1)*1.25);
  field.injectBlast({position:[3.75,1.75,3.75],acousticEnergyJ:2.5,radiusM:1.25});
}
function near(a,b,label){
  assert.equal(a.length,b.length,label+' length');
  for(let i=0;i<a.length;i++){
    assert.ok(Number.isFinite(a[i])&&Number.isFinite(b[i]),label+' nonfinite '+i);
    const diff=Math.abs(a[i]-b[i]),budget=1e-10+Math.abs(a[i])*1e-11;
    assert.ok(diff<=budget,label+'['+i+'] '+a[i]+' != '+b[i]+' (difference '+diff+')');
  }
}
function parity(js,wasm,tick){
  assert.equal(wasm.solidCellCount,js.solidCellCount);
  assert.deepEqual(wasm.size,js.size);
  for(const key of ['pressurePa','velocityXMps','velocityYMps','velocityZMps']){
    near(js[key],wasm[key],key+' tick '+tick);
  }
  assert.deepEqual(wasm.solid,js.solid);
}
test('Rust/WASM acoustic solver matches production TS over wall changes and 160 ticks',async()=>{
  const js=new AcousticWaveField(spec);
  const wasm=await createWasmAcousticWaveField(spec,module);
  try{
    assert.equal(wasm.backend,'wasm');
    assert.equal(js.backend,'typescript');
    assert.equal(wasm.pressurePa.buffer,wasm.velocityXMps.buffer);
    prime(js);prime(wasm);parity(js,wasm,'initial');
    const originalMemory=wasm.pressurePa.buffer;
    const dt=wasm.maxStableDt*.72;
    for(let tick=0;tick<160;tick++){
      if(tick===70){
        for(let z=6;z<12;z++)for(let y=2;y<5;y++){js.setSolidCell(12,y,z,false);wasm.setSolidCell(12,y,z,false);}
      }
      const a=js.step(dt),b=wasm.step(dt);
      assert.deepEqual(b,a);
      parity(js,wasm,tick);
    }
    assert.strictEqual(wasm.pressurePa.buffer,originalMemory,'no wasm memory growth or state copies during ticks');
    assert.ok(Number.isFinite(js.compressionEnergyJ()));
  }finally{wasm.dispose();}
});

test('GPU r32float XZ slice is padded and passed to GPUQueue without intermediate JS copies',async()=>{
  const field=await createWasmAcousticWaveField(spec,module);
  try{
    field.addPressureCell(5,2,6,12.25);
    field.addPressureCell(8,2,1,-6.125);
    field.setSolidCell(7,2,6);
    const slice=field.pressurePlaneForGPU(2);
    assert.equal(slice.bytesPerRow%256,0);
    assert.equal(slice.width,23);
    assert.equal(slice.height,19);
    assert.equal(slice.data[6*slice.bytesPerRow/4+5],12.25);
    assert.equal(slice.data[1*slice.bytesPerRow/4+8],-6.125);
    assert.equal(slice.data[6*slice.bytesPerRow/4+7],0);
    const writes=[];
    const queue={writeTexture:(dest,data,layout,size)=>writes.push({dest,data,layout,size})};
    const texture={format:'r32float',usage:'COPY_DST'};
    const stats=uploadAcousticPressurePlane(field,queue,texture,2);
    assert.equal(writes.length,1);
    assert.strictEqual(writes[0].dest.texture,texture);
    assert.strictEqual(writes[0].data.buffer,field.pressurePa.buffer,'GPU staging is a view into the same Wasm memory');
    assert.equal(writes[0].data.byteOffset,slice.data.byteOffset);
    assert.deepEqual(writes[0].layout,{bytesPerRow:slice.bytesPerRow,rowsPerImage:19});
    assert.deepEqual(writes[0].size,[23,19,1]);
    assert.equal(stats.bytes,slice.data.byteLength);
    assert.throws(()=>field.pressurePlaneForGPU(7),/out of range/);
  }finally{field.dispose();}
});

test('WASM backend rejects unsupported grids and preserves TS CFL guard',async()=>{
  await assert.rejects(()=>createWasmAcousticWaveField({size:[200,200,100],cellSizeM:1,waveSpeedMps:1,densityKgM3:1},module),/max 2 million/);
  const field=await createWasmAcousticWaveField({size:[7,4,9],cellSizeM:1,waveSpeedMps:1,densityKgM3:1},module);
  try{
    assert.throws(()=>field.step(.7),/CFL/);
    assert.throws(()=>field.addPressureCell(8,1,1,1),/out of range/);
  }finally{field.dispose();}
});

test('GPU staging also works on the untouched TS backend',()=>{
  const field=new AcousticWaveField({size:[7,4,9],cellSizeM:1,waveSpeedMps:1,densityKgM3:1});
  field.addPressureCell(2,1,3,7);
  const slice=field.pressurePlaneForGPU(1);
  assert.equal(slice.data[3*slice.bytesPerRow/4+2],7);
  const second=field.pressurePlaneForGPU(1);
  assert.strictEqual(second.data,slice.data,'reuse staging rather than reallocating each upload');
});
