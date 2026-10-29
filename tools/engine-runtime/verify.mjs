import {spawnSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const simd=process.argv.includes('--simd');
function run(command,args,env=process.env){const r=spawnSync(command,args,{cwd:root,env,stdio:'inherit',shell:false});if(r.error)throw r.error;if(r.status!==0)process.exit(r.status??1);}
run(process.execPath,['tools/engine-runtime/build.mjs',...(simd?['--simd']:[])]);
// Use the repository's declared build command (Bun is already its package manager).
run('bun',['run','build']);
run(process.execPath,['--test','test/rust-kernel-adapter.test.mjs','test/rust-kernel-parity.test.mjs'],{
  ...process.env,ROM4_REQUIRE_RUST:'1',ROM4_RUST_WASM:resolve(root,`artifacts/rust-engine/rom4-engine.${simd?'simd':'scalar'}.wasm`),
});
