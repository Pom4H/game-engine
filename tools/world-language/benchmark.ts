// Bun executes the TypeScript fixture and the engine's *same* JS runtime.
// This is a load/authoring experiment, NOT a physics throughput claim.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {gzipSync} from 'node:zlib';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
import {Scene} from '../../dist/scene/scene.js';
import {makeScene} from '../../examples/worlds/array.scene.ts';

const root=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const rustFile=join(root,'examples/worlds/array.world');
const tsFile=join(root,'examples/worlds/array.scene.ts');
const dir=mkdtempSync(join(tmpdir(),'world-language-'));
const median=(values:number[])=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)]!;
const measure=(factory:()=>Scene, iterations=25)=>{
  const times:number[]=[];
  for(let i=0;i<iterations+5;i++){
    const before=performance.now();
    const scene=factory();
    const elapsed=performance.now()-before;
    assert.equal(scene.entities.size,65);
    if(i>=5)times.push(elapsed);
  }
  return Number(median(times).toFixed(3));
};
try {
  const binaryPath=join(dir,'array.wscn');
  const rust=spawnSync('cargo',['run','--release','--quiet','--manifest-path',join(root,'compiler/Cargo.toml'),'--','compile',rustFile,'-o',binaryPath],{cwd:root,encoding:'utf8'});
  assert.equal(rust.status,0,rust.stderr);
  const binary=new Uint8Array(readFileSync(binaryPath));
  const a=new Scene(binary),b=new Scene(makeScene());
  assert.equal(a.entities.size,65);
  assert.equal(b.entities.size,65);
  // Canonical causality: both descriptions must produce equivalent state on every tick.
  for(let i=0;i<120;i++){
    assert.deepEqual(a.snapshot(),b.snapshot(),`different physical state at tick ${i}`);
    a.step(1/60);b.step(1/60);
  }
  assert.deepEqual(a.snapshot(),b.snapshot(),'different final physical state');
  const source=readFileSync(rustFile);
  const tsSource=readFileSync(tsFile);
  const json=Buffer.from(JSON.stringify(makeScene()));
  const report={
    comparableEntities:65, parityTicks:120,
    authoring:{worldBytes:source.length,typescriptBytes:tsSource.length,
      worldNonblankLines:source.toString().split(String.fromCharCode(10)).filter(x=>x.trim()&&!x.trim().startsWith('//')).length,
      typescriptNonblankLines:tsSource.toString().split(String.fromCharCode(10)).filter(x=>x.trim()&&!x.trim().startsWith('//')).length},
    transport:{wscnBytes:binary.length,jsonBytes:json.length,wscnGzipBytes:gzipSync(binary).length,jsonGzipBytes:gzipSync(json).length},
    loadAndConstructMedianMs:{wscn:measure(()=>new Scene(binary)),typescript:measure(()=>new Scene(makeScene()))},
    warnings:['Runtime excludes import/IO; only median scene construction is measured','Physics tick implementation is identical and not claimed faster','Fixed-width WSCN can exceed JSON size'],
  };
  mkdirSync(join(root,'artifacts'),{recursive:true});
  writeFileSync(join(root,'artifacts/world-language-benchmark.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}finally{rmSync(dir,{recursive:true,force:true});}
