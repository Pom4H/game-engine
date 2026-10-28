import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join,relative} from 'node:path';

const root=resolve(import.meta.dirname,'../..'),beforeDir=resolve(process.argv[2]??join(root,'artifacts/gpu-visibility/phase1')),afterDir=resolve(process.argv[3]??join(root,'artifacts/gpu-visibility'));
const before=JSON.parse(await readFile(join(beforeDir,'report.json'),'utf8')),after=JSON.parse(await readFile(join(afterDir,'report.json'),'utf8'));
if(before.status!=='correctness-passed'||after.status!=='correctness-passed')throw new Error('Both runs must pass the crossover correctness gate');
if(before.results.length!==after.results.length)throw new Error('Runs must cover the same modes and scenarios');
const digest=data=>createHash('sha256').update(data).digest('hex'),results=[];
const means=quanta=>Object.fromEntries(Object.entries(quanta).map(([name,timing])=>[name,timing.meanMs]));
const metrics=result=>({cpuMs:result.cpuMs,cpuCullingMs:result.cpuCullingMs,gpuMs:result.gpuMs,frameIntervalMs:result.frameIntervalMs,fps:result.fps,uploadBytes:result.uploadBytes,instanceUploadBytes:result.instanceUploadBytes,visibilityUploadBytes:result.visibilityUploadBytes,cpuQuantaMeanMs:means(result.profile.cpu),gpuQuantaMeanMs:means(result.profile.gpu),preparation:result.render.preparation,environmentCache:result.render.environmentCache});
for(const result of after.results){
 const previous=before.results.find(value=>value.count===result.count&&value.scenario===result.scenario&&value.mode===result.mode);
 if(!previous||['width','height','frames','warmup','sourceHash','replayHash','afterHash'].some(key=>previous[key]!==result[key])||JSON.stringify(previous.adapter)!==JSON.stringify(result.adapter))throw new Error('Run controls or replay differ');
 if(!previous.timestampQueries||!result.timestampQueries)throw new Error('Native GPU timestamp evidence is required');
 const imageName=`${result.count}-${result.scenario}-${result.mode}.png`,oldImage=await readFile(join(beforeDir,imageName)),newImage=await readFile(join(afterDir,imageName));
 // Identical encoded PNGs prove that every decoded pixel is identical, without
 // introducing a second image decoder or a screenshot interpolation tolerance.
 const identicalPng=oldImage.equals(newImage);let linearMaxError=0;
 if(previous.linear.length!==result.linear.length)throw new Error('HDR sample counts differ');
 for(let n=0;n<result.linear.length;n++){
  const old=previous.linear[n],current=result.linear[n];if(old.x!==current.x||old.y!==current.y)throw new Error('HDR sample positions differ');
  for(let channel=0;channel<4;channel++)linearMaxError=Math.max(linearMaxError,Math.abs(old.rgba[channel]-current.rgba[channel]));
 }
 if(!identicalPng||linearMaxError!==0)throw new Error(`Preparation cache changed the reference image: ${imageName}, HDR max error ${linearMaxError}`);
 results.push({count:result.count,scenario:result.scenario,mode:result.mode,width:result.width,height:result.height,frames:result.frames,warmup:result.warmup,adapter:result.adapter,sourceHash:result.sourceHash,replayHash:result.replayHash,identicalPng,imageSha256:digest(newImage),linearMaxError,before:metrics(previous),after:metrics(result)});
}
const sample=after.results[0],execution=`Local ${process.platform==='win32'?'Windows':process.platform}, headless Chromium, native ${sample.adapter.vendor} ${sample.adapter.architecture}, ${sample.width}x${sample.height}`;
const evidence={date:new Date().toISOString().slice(0,10),execution,reference:'Same working tree and benchmark fixture before and after persistent render preparation caches; not the October 10 Engine Compare revision',baseline:relative(root,join(beforeDir,'report.json')).replaceAll('\\','/'),current:relative(root,join(afterDir,'report.json')).replaceAll('\\','/'),correctness:'exact-reference-match',frameBudgetMs:after.frameBudgetMs,frameBudgetPassed:after.frameBudgetPassed,note:'These sequential local runs are observational performance evidence. Exact PNG and HDR equality, scene controls and replay hashes are enforced; a higher mean FPS does not pass the p95 60 FPS budget.',comparisons:after.comparisons,results};
if(process.argv[4])await writeFile(resolve(process.argv[4]),JSON.stringify(evidence,null,2)+'\n');
console.log('Objects | Camera | Mode | CPU p95 before/after ms | FPS before/after | Identical PNG\n--- | --- | --- | ---: | ---: | ---');
for(const row of results)console.log(`${row.count} | ${row.scenario} | ${row.mode} | ${row.before.cpuMs.p95.toFixed(2)} / ${row.after.cpuMs.p95.toFixed(2)} | ${row.before.fps.toFixed(2)} / ${row.after.fps.toFixed(2)} | ${row.identicalPng}`);
console.log(`\nExact reference image/replay match: passed. 60 FPS p95 budget: ${after.frameBudgetPassed?'passed':'not passed'}.`);
