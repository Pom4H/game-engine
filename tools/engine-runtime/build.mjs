import {spawnSync} from 'node:child_process';
import {mkdirSync,copyFileSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const simd=process.argv.includes('--simd'),variant=simd?'simd':'scalar';
const out=resolve(root,'artifacts/rust-engine');
const target=resolve(out,'build',variant);
const manifest=resolve(root,'kernels/engine-runtime/Cargo.toml');
function run(command,args,env=process.env){
  const r=spawnSync(command,args,{cwd:root,env,stdio:'inherit',shell:false});
  if(r.error)throw new Error(`Cannot run ${command}: ${r.error.message}. Install Rust and the wasm32-unknown-unknown target.`);
  if(r.status!==0)throw new Error(`${command} failed (${r.status??r.signal})`);
}
// Do not silently accept compiler flags that change the numerical contract.
if(process.env.RUSTFLAGS?.trim()||process.env.CARGO_ENCODED_RUSTFLAGS?.trim())
  throw new Error('Run with empty RUSTFLAGS/CARGO_ENCODED_RUSTFLAGS; this build selects and records the scalar/SIMD variant.');
run('cargo',['test','--manifest-path',manifest,'--target-dir',target]);
const flags=simd?'-C target-feature=+simd128':'-C target-feature=-simd128';
run('cargo',['build','--release','--target','wasm32-unknown-unknown','--manifest-path',manifest,'--target-dir',target],{...process.env,RUSTFLAGS:flags});
mkdirSync(out,{recursive:true});
const wasm=resolve(out,`rom4-engine.${variant}.wasm`);
copyFileSync(resolve(target,'wasm32-unknown-unknown/release/rom4_engine_runtime.wasm'),wasm);
const bytes=readFileSync(wasm),module=new WebAssembly.Module(bytes);
if(WebAssembly.Module.imports(module).length)throw new Error('Host imports would reintroduce per-element FFI');
const rustc=spawnSync('rustc',['--version'],{encoding:'utf8',shell:false});
if(rustc.error||rustc.status!==0)throw new Error('Cannot record rustc version');
writeFileSync(resolve(out,`build.${variant}.json`),JSON.stringify({variant,flags,rustc:rustc.stdout.trim(),
  byteLength:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),imports:WebAssembly.Module.imports(module),
  exports:WebAssembly.Module.exports(module).map(e=>e.name)},null,2)+'\n');
console.log(wasm);
