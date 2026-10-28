import {readFile} from 'node:fs/promises';
const [baselineFile,currentFile]=process.argv.slice(2);
if(!baselineFile||!currentFile)throw new Error('Usage: node tools/winter/compare.mjs <baseline/report.json> <current/report.json>');
const [baseline,current]=await Promise.all([baselineFile,currentFile].map(async path=>JSON.parse(await readFile(path,'utf8'))));
if(baseline.version!==current.version||baseline.scene!==current.scene||baseline.input!==current.input)throw new Error('Incompatible reference runs');
if(baseline.views.length!==current.views.length)throw new Error('Changed view count');
let failed=false;
for(let i=0;i<baseline.views.length;i++){
 const a=baseline.views[i],b=current.views[i];
 if(a.id!==b.id||a.tick!==b.tick||a.width!==b.width||a.height!==b.height||JSON.stringify(a.camera)!==JSON.stringify(b.camera)||a.pixels.length!==b.pixels.length)throw new Error('Incompatible camera/sample definition: '+a.id);
 let changed=0;
 for(let j=0;j<a.pixels.length;j++){
  const p=a.pixels[j],q=b.pixels[j];if(p.x!==q.x||p.y!==q.y||!q.rgba.every(Number.isFinite))throw new Error('Invalid pixel samples');
  if(p.rgba.slice(0,3).some((v,k)=>Math.abs(v-q.rgba[k])>.02+.08*Math.abs(v)))changed++;
 }
 const ratio=changed/a.pixels.length;const visualFailed=ratio>.05;
 // Times are per renderer CPU/GPU work, not a claimed end-to-end game FPS.
 const timings={};for(const backend of ['cpuTotal','gpuTotal']){
  const old=a.profile[backend]?.p95Ms,now=b.profile[backend]?.p95Ms;
  if(old!==undefined&&now!==undefined){timings[backend]={baselineP95Ms:old,currentP95Ms:now,regression:now>old*1.3+2};failed ||= timings[backend].regression;}
 }
 failed ||= visualFailed;console.log(JSON.stringify({view:a.id,changedSamples:changed,totalSamples:a.pixels.length,visualFailed,timings}));
}
if(failed)process.exitCode=1;
