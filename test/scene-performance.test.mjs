import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Scene} from '../dist/scene/scene.js';
import {decodeWorldBinary} from '../dist/scene/world-binary.js';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const hasRust=spawnSync('cargo',['--version'],{encoding:'utf8'}).status===0;

function compile(){
  const dir=mkdtempSync(join(tmpdir(),'world-perf-'));
  const filename=join(dir,'array.wscn');
  const result=spawnSync('cargo',['run','--quiet','--manifest-path',join(root,'compiler/Cargo.toml'),'--','compile',join(root,'examples/worlds/array.world'),'-o',filename],{cwd:root,encoding:'utf8'});
  if(result.status!==0){rmSync(dir,{recursive:true,force:true});assert.fail(result.stderr);}
  return {dir,bytes:new Uint8Array(readFileSync(filename))};
}
test('WSCN v2 profile roundtrip, bounded sampling and deterministic physics parity', {skip:!hasRust},()=>{
  const {dir,bytes}=compile();
  try{
    assert.equal(new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint16(4,true),2);
    const spec=decodeWorldBinary(bytes);
    assert.deepEqual(spec.performance,{tickBudgetMs:5,sampleEvery:5,history:120});
    const profiled=new Scene(bytes);
    const plain=new Scene({...spec,performance:undefined});
    assert.equal(plain.performanceReport(),undefined);
    for(let i=0;i<125;i++){
      profiled.step(1/60);
      plain.step(1/60);
      assert.deepEqual(profiled.snapshot(),plain.snapshot(),'profiling changed state at tick '+i);
    }
    const report=profiled.performanceReport();
    assert.equal(report.budgetMs,5);
    assert.equal(report.recordedTicks,25);
    assert.equal(report.sampleEvery,5);
    assert.equal(report.latest.tick,125);
    assert.equal(report.latest.work.bodies,65);
    assert.ok(report.latest.work.substeps>=1);
    assert.equal(report.latest.work.dispatch,'kernel');
    assert.ok(report.tick.meanMs>0);
    assert.ok(report.systems.physics.count>0);
    assert.ok(report.latest.overheadMs>=0);
    profiled.disablePerformanceProfiling();
    assert.equal(profiled.performanceReport(),undefined);
    profiled.enablePerformanceProfiling({tickBudgetMs:.001,sampleEvery:1,history:8});
    for(let i=0;i<16;i++)profiled.step(1/60);
    const bounded=profiled.performanceReport();
    assert.equal(bounded.recordedTicks,8);
    assert.equal(bounded.latest.tick,141);
    assert.equal(bounded.exceededTicks,8);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('decoder rejects corrupted WSCN v2 performance extension metadata', {skip:!hasRust},()=>{
  const {dir,bytes}=compile();
  try{
    const broken=new Uint8Array(bytes);
    const view=new DataView(broken.buffer);
    view.setUint32(152,0,true);
    assert.throws(()=>decodeWorldBinary(broken),/invalid performance extension bounds/);
    const invalid=new Uint8Array(bytes);
    const cfg=new DataView(invalid.buffer);
    const offset=cfg.getUint32(20,true)+cfg.getUint32(152,true);
    cfg.setFloat64(offset,NaN,true);
    assert.throws(()=>decodeWorldBinary(invalid),/non-finite/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
