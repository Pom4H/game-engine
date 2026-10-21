import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const root=fileURLToPath(new URL('../../',import.meta.url));
export function buildKernels(){
  const directory=resolve(root,'artifacts/structural-wasm');mkdirSync(directory,{recursive:true});
  const compiler=process.env.CLANG??'clang';
  const version=spawnSync(compiler,['--version'],{encoding:'utf8'});
  if(version.status!==0)throw new Error(`Cannot run ${compiler}: ${version.error??version.stderr}. Install clang and lld, or set CLANG.`);
  const flags=['--target=wasm32','-O3','-ffp-contract=off','-fno-fast-math','-fno-builtin','-mbulk-memory','-nostdlib','-Wl,--no-entry','-Wl,--export=step','-Wl,--export=__heap_base','-Wl,--export-memory'];
  for(const variant of ['strict','sqrt']){
    const args=[...flags,...(variant==='strict'?['-DHOST_NORM']:[]),resolve(root,'tools/structural-wasm/kernel.c'),'-o',resolve(directory,`${variant}.wasm`)];
    const result=spawnSync(compiler,args,{encoding:'utf8'});
    if(result.status!==0)throw new Error(`Wasm compilation failed: ${result.error??result.stderr}`);
  }
  const build={compiler:version.stdout.split('\n')[0],flags,variants:{strict:'Production Math.hypot imported from JS',sqrt:'Wasm f64.sqrt; bounded finite fixture coordinates'}};
  writeFileSync(resolve(directory,'build.json'),JSON.stringify(build,null,2)+'\n');return build;
}
if(process.argv[1]===fileURLToPath(import.meta.url))buildKernels();
