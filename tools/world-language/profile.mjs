import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,relative,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Scene} from '../../dist/scene/scene.js';

const root=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const source=resolve(process.argv[2]??join(root,'examples/worlds/array.world'));
const ticks=Number(process.argv[3]??240),mode=process.argv[4]??'kernel';
if(!Number.isSafeInteger(ticks)||ticks<1||ticks>100000)throw new RangeError('Ticks must be within 1..100000');
if(mode!=='kernel'&&mode!=='direct')throw new TypeError('Dispatch must be kernel or direct');
const dir=mkdtempSync(join(tmpdir(),'world-profiler-'));
try {
  let binary=source;
  if(extname(source)==='.world'){
    binary=join(dir,'profile.wscn');
    const cargo=spawnSync('cargo',['run','--release','--quiet','--manifest-path',join(root,'compiler/Cargo.toml'),'--','compile',source,'-o',binary],{cwd:root,encoding:'utf8'});
    if(cargo.status!==0)throw new Error('worldc compile failed: '+cargo.stderr);
  }
  const scene=new Scene(new Uint8Array(readFileSync(binary)));
  if(!scene.spec.performance)throw new Error('Scene needs a performance {} directive (WSCN v2)');
  scene.setSystemDispatch(mode);
  for(let i=0;i<ticks;i++)scene.step(1/60);
  const report=scene.performanceReport();
  if(!report)throw new Error('Performance profiler did not produce a report');
  const slowest=Object.entries(report.systems).sort((a,b)=>b[1].p95Ms-a[1].p95Ms).map(([system,stats])=>({system,...stats}));
  const output={source:relative(root,source),ticks,dispatch:mode,topSystems:slowest.slice(0,8),report};
  mkdirSync(join(root,'artifacts'),{recursive:true});
  const outfile=join(root,'artifacts/world-performance-report.json');
  writeFileSync(outfile,JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify({artifact:relative(root,outfile),ticks,dispatch:mode,
    p50Ms:report.tick.p50Ms,p95Ms:report.tick.p95Ms,
    exceeded:report.exceededTicks,recorded:report.recordedTicks,
    topSystems:output.topSystems.slice(0,5)},null,2));
}finally{rmSync(dir,{recursive:true,force:true});}
