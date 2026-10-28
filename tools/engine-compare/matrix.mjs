#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,cp,readdir,stat,symlink} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {resolve,join,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {cpus,totalmem,release,platform} from 'node:os';
import {createMatrixPlan,validateMatrixPlan,capabilities} from './matrix-plan.mjs';
import {auditProfile} from './profiles.mjs';
import {requireHardware} from './metrics.mjs';
const root=resolve(import.meta.dirname,'../..'),args=process.argv.slice(2);
for(let n=0;n<args.length;n++){if(['--output','--plan','--tier'].includes(args[n])){if(!args[++n]||args[n].startsWith('--'))throw new Error('Missing matrix option value');}else if(!['--resume','--dry-run'].includes(args[n]))throw new Error('Unknown matrix argument: '+args[n]);}
function option(name,fallback){const i=args.indexOf(name);if(i<0)return fallback;if(!args[i+1]||args[i+1].startsWith('--'))throw new Error('Missing '+name);return args[i+1];}
const output=resolve(root,option('--output','artifacts/engine-compare/matrix-'+new Date().toISOString().replaceAll(':','-'))),mirror=join(output,'measured-workspace');
const plan=option('--plan')?validateMatrixPlan(JSON.parse(await readFile(resolve(root,option('--plan')),'utf8'))):createMatrixPlan(option('--tier','standard'));
const resume=args.includes('--resume'),dryRun=args.includes('--dry-run');
if(dryRun){console.log(JSON.stringify({...plan,capabilities},null,2));process.exit(0);}
async function exists(path){try{await stat(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function fingerprint(base,tree){const files=[];async function visit(path){for(const e of await readdir(path,{withFileTypes:true})){const f=join(path,e.name);if(e.isDirectory())await visit(f);else if(e.isFile())files.push(f);}}await visit(join(base,tree));const hash=createHash('sha256');for(const f of files.sort()){hash.update(relative(base,f).replaceAll('\\','/')+'\0');hash.update(await readFile(f));}return hash.digest('hex');}
const trees={srcSha256:'src',distSha256:'dist',harnessSha256:'tools/engine-compare',diagnosticSha256:'tools/gpu-visibility'};
if(!resume){
  if(await exists(output))throw new Error('Refusing existing output; use --resume with its unchanged plan');
  for(const tree of [...Object.values(trees),'tools/promo/assets']){await mkdir(resolve(mirror,tree,'..'),{recursive:true});await cp(join(root,tree),join(mirror,tree),{recursive:true});}
  await mkdir(join(mirror,'artifacts/engine-compare'),{recursive:true});await symlink(join(root,'artifacts/engine-compare/vendor'),join(mirror,'artifacts/engine-compare/vendor'),'junction');
  await writeFile(join(output,'plan.json'),JSON.stringify(plan,null,2)+'\n');
}else assert.deepEqual(JSON.parse(await readFile(join(output,'plan.json'),'utf8')),plan,'Resume plan changed');
const sourceState=Object.fromEntries(await Promise.all(Object.entries(trees).map(async([key,tree])=>[key,await fingerprint(mirror,tree)])));
const previous=resume&&await exists(join(output,'report.json'))?JSON.parse(await readFile(join(output,'report.json'),'utf8')):null;
if(previous)assert.deepEqual(previous.sourceState,sourceState,'Frozen source changed');
const report={version:1,status:'running',startedAt:previous?.startedAt??new Date().toISOString(),plan,capabilities,sourceState,expectedCases:plan.expectedCases,completedCases:0,batches:[],rows:[],
 methodology:{schedule:'Sequential batches; fresh native browser document/device per case, rotated engine order each repetition. No concurrent benchmark workloads.',scene:'Shared Render IR geometry/material parameters/initial physical replay. Object motion is deterministic by frame and restored before physical-state checks.',cpu:'Render wall time includes authored motion and actual backend buffer updates. Setup, scene construction, shader warmup and environment prefiltering are outside measurement.',gpu:'Common asynchronous hardware pass timestamps, >=95% coverage; excludes copy-only commands and queue gaps.',frame:'Headless RAF intervals, not display refresh or presentation FPS.',statistics:'Pooled per-frame p50/p95/mean plus each independent repetition; min/max of repetition p95 and CV of repetition means show dispersion. No causal/speed significance claim from a sequential run.',quality:'Canonical images at each matrix cell; exact input/motion audits. Cross-engine pixel differences are descriptive. Unsupported common effects are not silently substituted.'}};
report.machine=previous?.machine??{platform:platform(),osRelease:release(),cpu:cpus()[0]?.model,logicalProcessors:cpus().length,ramBytes:totalmem(),node:process.version};
if(!previous&&platform()==='win32'){try{report.machine.videoControllers=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command','Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion,DriverDate | ConvertTo-Json -Compress'],{encoding:'utf8',windowsHide:true}));}catch(error){report.machine.videoControllerMetadataError=String(error);}}
async function save(){await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');}
function dispersion(runs,key){const values=runs.map(r=>r[key].p95),means=runs.map(r=>r[key].mean),mean=means.reduce((s,v)=>s+v,0)/means.length;return {p95ByRepetition:values,minP95:Math.min(...values),maxP95:Math.max(...values),meanByRepetition:means,meanCV:mean?Math.sqrt(means.reduce((s,v)=>s+(v-mean)**2,0)/means.length)/mean:0};}
const motionReferences=new Map();
async function validate(batch,data){
 assert.equal(data.status,'completed');assert.equal(data.sceneInputsMatched,true);const c=data.controls;
 for(const key of ['width','height','profile','frames','warmup','repetitions','counts','scenarios','backends','quality','parameters'])assert.deepEqual(c[key],batch[key],key);
 for(const [key] of Object.entries(trees))if(data.sourceState[key])assert.equal(data.sourceState[key],sourceState[key],'Measured '+key);
 assert.equal(data.results.length,batch.counts.length*batch.scenarios.length*batch.backends.length*batch.repetitions);
 for(const run of data.results){requireHardware(run.adapter);assert.equal(run.afterHash,run.replayHash);assert.ok(run.timestampCoverage>=.95);assert.ok(!run.measured.errors?.length);assert.deepEqual(run.parameters,batch.parameters);auditProfile(batch.profile,run.backend,run.measured,run.gpuPasses);
  assert.equal(run.motion.motionApi,batch.parameters.motionApi);assert.equal(run.motion.registeredMovingObjects,batch.parameters.motionApi==='visual-transform'?run.motion.movingObjects:0);
  const motionKey=JSON.stringify([run.sourceHash,run.scenario,batch.parameters.dirtyFraction,run.frames,run.warmup]);
  if(motionReferences.has(motionKey))assert.equal(run.motionHash,motionReferences.get(motionKey),'Same poses across motion APIs');else motionReferences.set(motionKey,run.motionHash);
  if(run.backend==='engine'){assert.equal(run.measured.visibility.mode,batch.parameters.engineVisibility);if(batch.parameters.environmentMode==='fixed'){assert.equal(run.measured.measuredEnvironmentApplied,true);assert.equal(run.measured.environmentUpdates,1,'Fixed IBL rebuilt during measurement');}}else{assert.equal(run.measured.instancing,batch.parameters.peerInstancing);assert.ok(run.measured.comparisonEffects,'Actual peer configuration required');}
  const peer=data.results.find(r=>r.count===run.count&&r.scenario===run.scenario);for(const k of ['sourceHash','geometryHash','environmentHash','replayHash','motionHash'])assert.equal(run[k],peer[k],k);
  if(report.adapter)assert.deepEqual(run.adapter,report.adapter);else report.adapter=run.adapter;
  if(report.browser)assert.equal(data.browser.product,report.browser);else report.browser=data.browser.product;
 }
}
await save();
try{
 for(const batch of plan.batches){
  const directory=join(output,batch.id);let data;
  if(resume&&await exists(join(directory,'report.json'))){data=JSON.parse(await readFile(join(directory,'report.json'),'utf8'));if(data.status!=='completed')throw new Error('Incomplete batch '+batch.id+' retained; rerun into a fresh output rather than overwriting evidence');}
  else{
   await mkdir(directory,{recursive:true});console.log(JSON.stringify({event:'matrix-batch',id:batch.id,completedCases:report.completedCases,expectedCases:plan.expectedCases}));
   const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('COMPARE_'))delete env[key];Object.assign(env,{COMPARE_OUTPUT:directory,COMPARE_WIDTH:String(batch.width),COMPARE_HEIGHT:String(batch.height),COMPARE_PROFILE:batch.profile,COMPARE_COUNTS:batch.counts.join(','),COMPARE_SCENARIOS:batch.scenarios.join(','),COMPARE_BACKENDS:batch.backends.join(','),COMPARE_FRAMES:String(batch.frames),COMPARE_WARMUP:String(batch.warmup),COMPARE_REPETITIONS:String(batch.repetitions),COMPARE_QUALITY:batch.quality?'1':'0',COMPARE_ENGINE_VISIBILITY:batch.parameters.engineVisibility,COMPARE_PEER_INSTANCING:batch.parameters.peerInstancing?'1':'0',COMPARE_DIRTY_FRACTION:String(batch.parameters.dirtyFraction),COMPARE_ENVIRONMENT:batch.parameters.environmentMode,COMPARE_CPU_API_TIMINGS:'0',COMPARE_CPU_PHASE_TIMINGS:'0'});
   env.COMPARE_MOTION_API=batch.parameters.motionApi;
   const log=createWriteStream(join(directory,'runner.log'));
   const code=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[join(mirror,'tools/engine-compare/benchmark.mjs')],{cwd:mirror,env,windowsHide:true});child.stdout.on('data',chunk=>{process.stdout.write(chunk);log.write(chunk);});child.stderr.on('data',chunk=>{process.stderr.write(chunk);log.write(chunk);});child.on('error',reject);child.on('close',resolve);});await new Promise(r=>log.end(r));
   data=JSON.parse(await readFile(join(directory,'report.json'),'utf8'));if(code!==0)throw new Error('Batch '+batch.id+' failed: '+(data.error??code));
  }
  await validate(batch,data);report.completedCases+=data.results.length;report.batches.push({id:batch.id,status:data.status,runId:data.runId,cases:data.results.length,report:batch.id+'/report.json',parameters:batch.parameters,profile:batch.profile});
  for(const row of data.aggregates){const runs=data.results.filter(r=>r.backend===row.backend&&r.count===row.count&&r.scenario===row.scenario);report.rows.push({...row,batch:batch.id,axis:batch.axis,width:batch.width,height:batch.height,profile:batch.profile,parameters:batch.parameters,movingObjects:runs[0].motion.movingObjects,dispersion:{cpu:dispersion(runs,'cpuMs'),gpu:dispersion(runs,'gpuMs'),frame:dispersion(runs,'frameIntervalMs')},images:runs.map(r=>batch.id+'/'+r.image),actualImages:runs.map(r=>r.actualImage?batch.id+'/'+r.actualImage:null),sharedEffects:runs[0].pipeline.sharedEffects,report:batch.id+'/report.json'});}
  await save();
 }
 assert.equal(report.completedCases,plan.expectedCases);report.status='completed';report.completedAt=new Date().toISOString();report.gates={allCasesCompleted:true,sceneAndMotionInputsMatched:true,sharedEffectsAudited:true,nativeHardware:true,frameBudget:report.rows.every(r=>r.frameBudgetPassed),equalPixelQualityEstablished:false,exclusiveGPUUseEstablished:false};await save();
 for(const [key,tree]of Object.entries(trees))assert.equal(await fingerprint(mirror,tree),sourceState[key],'Frozen code changed during run');
 console.log(JSON.stringify({event:'matrix-completed',output,cases:report.completedCases,gates:report.gates}));
}catch(error){report.status='failed';report.error=String(error);await save();console.error(error);process.exitCode=1;}
