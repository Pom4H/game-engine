import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {spawn} from 'node:child_process';

const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:fallback;};
const dir=resolve(arg('--dir','artifacts/reality/stanford-orb')),withLpips=process.argv.includes('--with-lpips'),assert=process.argv.includes('--assert'),baselinePath=arg('--baseline');
await mkdir(dir,{recursive:true});
const manifest=JSON.parse(await readFile(join(dir,'captures.json'),'utf8'));

function run(command,args){
  return new Promise((ok,fail)=>{
    const child=spawn(command,args,{stdio:'inherit'});
    child.once('error',fail);child.once('exit',code=>code===0?ok():fail(new Error(`${command} ${args.join(' ')} exited ${code}`)));
  });
}
const reports=[];
for(const capture of manifest.captures){
  const captureDir=join(dir,capture.id);await mkdir(captureDir,{recursive:true});
  const production=join(captureDir,'production.png'),lpips=join(captureDir,'lpips.json'),report=join(captureDir,'report.json');
  await run(process.execPath,['dist/cli.js','render',capture.scenePath,'--time','0','--width','512','--height','512','--out',production]);
  if(withLpips)await run(process.env.REALITY_PYTHON??'python',['tools/reality/lpips.py','--production',production,'--reference',capture.reference,'--mask',capture.mask,'--out',lpips]);
  const metricArgs=['tools/reality/metric.mjs','--production',production,'--reference',capture.reference,'--mask',capture.mask,'--capture',capture.id,'--out',report];
  if(withLpips)metricArgs.push('--lpips',lpips);
  await run(process.execPath,metricArgs);
  reports.push({...JSON.parse(await readFile(report,'utf8')),split:capture.split,production,reference:capture.reference,mask:capture.mask});
}
const heldOut=reports.filter(r=>r.split==='heldOut'),calibration=reports.filter(r=>r.split==='calibration');
if(!heldOut.length)throw new Error('Reality benchmark has no held-out captures');
const gap=heldOut.reduce((s,r)=>s+r.gap,0)/heldOut.length;
const summary={version:1,metric:'RealityGap',lowerIsBetter:true,dataset:manifest.dataset,object:manifest.object,gap,calibration:calibration.map(r=>({capture:r.capture,gap:r.gap,psnr:r.psnr,ssim:r.ssim})),heldOut:heldOut.map(r=>({capture:r.capture,gap:r.gap,psnr:r.psnr,ssim:r.ssim,components:r.components})),lpips:withLpips};
if(baselinePath){
  const baseline=JSON.parse(await readFile(baselinePath,'utf8')),tolerance=baseline.tolerance??.003;
  summary.baseline={gap:baseline.gap,tolerance,delta:gap-baseline.gap};
  summary.regressions=gap>baseline.gap+tolerance?[{id:'held-out',baseline:baseline.gap,actual:gap}]:[];
}
await writeFile(join(dir,'summary.json'),JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary));
if(assert&&summary.regressions?.length){console.error('Held-out RealityGap regression: '+JSON.stringify(summary.regressions));process.exitCode=1;}
