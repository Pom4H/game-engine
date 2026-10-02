#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const hud=JSON.parse(await readFile(resolve(process.argv[2]??'artifacts/render-hud.json'),'utf8'));
const view=hud.views?.[0],profile=view?.renderer?.profile;
if(!view||!profile?.enabled)throw new Error('Meshwork calibration requires one profiled hardware render view');
const cpu=profile.cpuTotal,gpu=profile.gpuTotal;
const candidates=[cpu?.maxMs,gpu?.maxMs].filter(value=>Number.isFinite(value)&&value>0);
if(!candidates.length)throw new Error('Renderer profiler produced no positive bounded frame timing');
const frameMsBudget=Math.max(...candidates);
const runnerName=process.env.RUNNER_NAME??'unknown-runner';
const host=process.env.COMPUTERNAME??process.env.HOSTNAME??'unknown-host';
const adapter=hud.adapter??{};
if(adapter.isFallbackAdapter||/swiftshader|lavapipe|llvmpipe|software|microsoft basic render/i.test(JSON.stringify(adapter)))throw new Error('Software GPU cannot calibrate Meshwork');
const fingerprint=createHash('sha256').update(JSON.stringify({host,adapter})).digest('hex');
const startedMs=Number(process.env.MESHWORK_BENCH_STARTED_MS??Date.now()),finishedMs=Date.now();
const calibration={
  schema:1,
  slot:process.env.MESHWORK_WORKER_SLOT??'single',
  runnerName,host,fingerprint,adapter,
  frameMsBudget,
  frameNsBudget:String(BigInt(Math.ceil(frameMsBudget*1e6))),
  cpuMaxMs:cpu?.maxMs??null,
  cpuP95Ms:cpu?.p95Ms??null,
  gpuMaxMs:gpu?.maxMs??null,
  gpuP95Ms:gpu?.p95Ms??null,
  benchmarkStartedMs:startedMs,
  benchmarkFinishedMs:finishedMs,
  profileFrames:{cpu:profile.cpuFrames,gpu:profile.gpuFrames},
};
await mkdir(resolve('artifacts/meshwork'),{recursive:true});
await writeFile(resolve('artifacts/meshwork/calibration.json'),JSON.stringify(calibration,null,2));
console.log(JSON.stringify(calibration,null,2));
