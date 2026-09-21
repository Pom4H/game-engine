import {mkdir,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';

const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:fallback;};
const mode=arg('--mode','fast'),out=resolve(arg('--out','artifacts/photorealism-'+mode)),baseline=arg('--baseline'),assert=process.argv.includes('--assert');
const config=mode==='full'?{width:320,height:180,spp:96}:mode==='fast'?{width:160,height:90,spp:32}:null;
if(!config)throw new TypeError('--mode must be fast or full');
await mkdir(out,{recursive:true});
const production=resolve(out,'production.png'),reference=resolve(out,'reference.png'),exr=resolve(out,'reference.exr'),report=resolve(out,'report.json');

function runNode(args){
  return new Promise((resolveRun,reject)=>{
    const child=spawn(process.execPath,args,{stdio:'inherit'});
    child.once('error',reject);
    child.once('exit',code=>code===0?resolveRun():reject(new Error('Command failed: node '+args.join(' ')+' (exit '+code+')')));
  });
}

await runNode(['dist/cli.js','render','tools/photorealism/scene.mjs','--time','0','--width',String(config.width),'--height',String(config.height),'--out',production]);
await runNode(['tools/photorealism/reference.mjs','--width',String(config.width),'--height',String(config.height),'--spp',String(config.spp),'--png',reference,'--exr',exr]);
const metricArgs=['tools/photorealism/metric.mjs','--production',production,'--reference',reference,'--mode',mode,'--out',report];
if(baseline)metricArgs.push('--baseline',baseline);
if(assert)metricArgs.push('--assert');
await runNode(metricArgs);
const summary=JSON.parse(await readFile(report,'utf8'));
console.log(JSON.stringify({northStar:summary.metric,mode,gap:summary.gap,resolution:summary.resolution,report,production,reference,exr}));
