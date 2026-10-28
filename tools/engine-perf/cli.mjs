#!/usr/bin/env node
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {cpus,platform,arch} from 'node:os';
import {performance} from 'node:perf_hooks';
import {execFileSync} from 'node:child_process';
import {EngineTrace,exportChromeTrace,traceReport,technologyAudit,engineBudgets} from '../../dist/observability/index.js';
import {Scene} from '../../dist/scene/scene.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const [command='help',...argv]=process.argv.slice(2),options={};
const allowed=new Set(['out','profile','ticks','bodies','file','before','after','inputs','cdp','url','seconds','device','cpu-profile','regression']);
for(let i=0;i<argv.length;i++){
  const key=argv[i]?.replace(/^--/,'');if(!argv[i]?.startsWith('--')||!allowed.has(key))throw Error(`Unknown option ${argv[i]}`);
  if(key==='cpu-profile'){options[key]=true;continue;}
  if(!argv[i+1]||argv[i+1].startsWith('--'))throw Error(`Missing value for --${key}`);options[key]=argv[++i];
}
const out=resolve(options.out??join(root,'artifacts/engine-perf',command));
const read=file=>JSON.parse(readFileSync(resolve(file),'utf8'));
const profile=options.profile?read(options.profile):undefined;
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const save=(name,value)=>{mkdirSync(out,{recursive:true});writeFileSync(join(out,name),JSON.stringify(value,null,2)+'\n');};
const integer=(value,fallback,min,max)=>{const n=Number(value??fallback);if(!Number.isSafeInteger(n)||n<min||n>max)throw Error(`Expected integer ${min}..${max}`);return n;};
function outputs(capture){const report=traceReport(capture,profile);save('capture.json',capture);save('trace.json',exportChromeTrace([capture]));save('report.json',report);console.log(JSON.stringify({output:out,complete:report.complete,passed:report.passed,metrics:report.rows.filter(r=>r.count||r.required)},null,2));return report;}
function sceneSpec(count){return {version:1,ground:-100,gravity:[0,-9.81,0],entities:Array.from({length:count},(_,i)=>({id:`body-${i}`,position:[i%16*1.3,2+Math.floor(i/16)*1.3,0],mesh:{kind:'box',size:[.8,.8,.8]},material:{kind:'steel'},body:{mass:2,velocity:[i%2?.1:-.1,0,0]}}))};}
function runScene(count,ticks,mode){
  const spec=sceneSpec(count),scene=new Scene(spec);
  for(let i=0;i<30;i++)scene.step();
  const trace=new EngineTrace({source:'node.scene',enabled:mode!=='disabled',capacity:262144,budgets:profile??{required:['simulation.tick.ms','physics.step.ms']},metadata:{workloadId:`falling-boxes:${count}:${ticks}`,controlledReplay:true,qualityHash:hash(spec),device:`${platform()}-${arch()} ${cpus()[0]?.model??'unknown'}`}});
  if(mode!=='baseline')scene.trace=trace;
  const start=performance.now();for(let i=0;i<ticks;i++)scene.step();const elapsedMs=performance.now()-start;
  trace.stop();return {trace,elapsedMs,msPerTick:elapsedMs/ticks,fingerprint:hash(scene.snapshot())};
}
function summarize(values){const a=[...values].sort((a,b)=>a-b);return {median:a[Math.floor(a.length/2)],min:a[0],max:a.at(-1),samples:values};}

if(command==='audit'){
  const audit=technologyAudit();let revision='unavailable';try{revision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();}catch{}
  const missing=[];for(const item of audit.technologies)for(const key of ['source','verification'])if(!existsSync(join(root,item[key])))missing.push(`${item.id}:${key}:${item[key]}`);
  const result={...audit,repositoryRevision:revision,toolchain:{node:process.version,typescript:read(join(root,'node_modules/typescript/package.json')).version},sourceFingerprint:hash(audit.technologies.map(t=>[t.source,existsSync(join(root,t.source))?hash(readFileSync(join(root,t.source),'utf8')):null])),budgets:engineBudgets(profile),missingReferences:missing};
  save('technologies.json',result);console.log(JSON.stringify({output:join(out,'technologies.json'),revision:result.revision,technologies:audit.technologies.length,missingReferences:missing,toolchain:result.toolchain},null,2));if(missing.length)process.exitCode=1;
}else if(command==='record'){
  const result=runScene(integer(options.bodies,64,1,1024),integer(options.ticks,180,1,10000),'recording');
  const report=outputs(result.trace.snapshot());save('workload.json',{elapsedMs:result.elapsedMs,msPerTick:result.msPerTick,fingerprint:result.fingerprint,scope:'CPU-only dynamic Scene; no game FPS or visual quality claim'});if(!report.passed)process.exitCode=1;
}else if(command==='bench'){
  const ticks=integer(options.ticks,180,30,3000),bodies=integer(options.bodies,64,1,256),runs={baseline:[],disabled:[],recording:[]},fingerprints=new Set();
  for(let round=0;round<6;round++)for(const mode of round%2?['recording','disabled','baseline']:['baseline','disabled','recording']){
    const result=runScene(bodies,ticks,mode);fingerprints.add(result.fingerprint);if(round>0)runs[mode].push(result.msPerTick);
  }
  const summary=Object.fromEntries(Object.entries(runs).map(([name,values])=>[name,summarize(values)]));
  const result={schema:'engine.tooling-overhead.v1',ticks,bodies,device:`${platform()}-${arch()} ${cpus()[0]?.model}`,replayIdentical:fingerprints.size===1,summary,
    disabledOverheadPercent:(summary.disabled.median/summary.baseline.median-1)*100,recordingOverheadPercent:(summary.recording.median/summary.baseline.median-1)*100,
    method:'Five scored rounds after one warmup round; alternating mode order; entire Scene tick including tracing. Timing is noisy; overhead does not establish game FPS.'};
  save('overhead.json',result);console.log(JSON.stringify(result,null,2));if(!result.replayIdentical)process.exitCode=1;
}else if(command==='report'){
  if(!options.file)throw Error('Use --file capture.json');const result=outputs(read(options.file));if(!result.passed)process.exitCode=1;
}else if(command==='merge'){
  if(!options.inputs)throw Error('Use --inputs client.json,server.json,worker.json');const captures=options.inputs.split(',').map(read);save('trace.json',exportChromeTrace(captures));console.log(join(out,'trace.json'));
}else if(command==='compare'){
  if(!options.before||!options.after)throw Error('Use --before capture.json --after capture.json');
  const before=read(options.before),after=read(options.after),a=traceReport(before,profile),b=traceReport(after,profile);
  const mismatches=[];for(const key of ['device','workloadId','qualityHash'])if(!before.metadata[key]||before.metadata[key]!==after.metadata[key])mismatches.push(key);
  if(typeof before.metadata.device!=='string'||before.metadata.device==='unspecified')mismatches.push('measured device identity');
  if((before.metadata.cpuProfile??false)!==(after.metadata.cpuProfile??false))mismatches.push('CPU profiling mode');
  if(before.metadata.controlledReplay!==true||after.metadata.controlledReplay!==true)mismatches.push('controlled replay evidence');
  if(JSON.stringify(a.budgets)!==JSON.stringify(b.budgets))mismatches.push('budgets');
  if(!a.complete||!b.complete)mismatches.push('dropped events');
  if(a.rows.some(r=>r.required&&(r.status==='missing'||r.status==='insufficient')))mismatches.push('baseline evidence coverage');
  const tolerance=Number(options.regression??5);if(!Number.isFinite(tolerance)||tolerance<0||tolerance>100)throw Error('Invalid regression percent');
  const rows=a.rows.filter(r=>r.count&&r.metric!=='trace.dropped').map(row=>{const next=b.rows.find(r=>r.metric===row.metric);const deltaPercent=row.value>0&&next?.value!==null?(next.value/row.value-1)*100:null;return {metric:row.metric,before:row.value,after:next?.value??null,deltaPercent,status:next?.status,regressed:deltaPercent!==null&&deltaPercent>tolerance};});
  const result={comparable:!mismatches.length,mismatches,passed:!mismatches.length&&b.passed&&!rows.some(r=>r.regressed),rows,scope:'Comparison requires matching declared device, workload, quality and budgets; it does not prove visual or physical equivalence.'};
  save('comparison.json',result);console.log(JSON.stringify(result,null,2));if(!result.passed)process.exitCode=1;
}else if(command==='capture'){
  const {captureBrowser}=await import('./capture-browser.mjs');const capture=await captureBrowser({cdp:options.cdp??'http://127.0.0.1:9222',url:options.url??'http://localhost:3007/',seconds:integer(options.seconds,10,1,120),device:options.device??'unspecified',cpuProfile:!!options['cpu-profile'],profile,save});
  const result=outputs(capture);if(!result.passed)process.exitCode=1;
}else if(command==='help'){
  console.log('Engine performance tools\n  audit [--profile budget.json]\n  record [--ticks 180 --bodies 64]\n  bench [--ticks 180 --bodies 64]\n  capture [--cdp http://127.0.0.1:9222 --url http://localhost:3007/ --seconds 10 --device NAME --cpu-profile]\n  report --file capture.json [--profile budget.json]\n  merge --inputs client.json,server.json,worker.json\n  compare --before a.json --after b.json [--regression 5]\nAll commands accept --out DIRECTORY. Build first: npm run build.');
}else throw Error(`Unknown command ${command}`);
