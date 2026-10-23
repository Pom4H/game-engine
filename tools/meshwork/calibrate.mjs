#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const hud=JSON.parse(await readFile(resolve(process.argv[2]??'artifacts/render-hud.json'),'utf8')),view=hud.views?.[0],profile=view?.renderer?.profile;
if(!view||!profile?.enabled)throw new Error('Meshwork calibration requires one profiled hardware render view');
const cpu=profile.cpuTotal,gpu=profile.gpuTotal,candidates=[cpu?.maxMs,gpu?.maxMs].filter(value=>Number.isFinite(value)&&value>0);
if(!candidates.length)throw new Error('Renderer profiler produced no positive bounded frame timing');
const frameMsBudget=Math.max(...candidates),runnerName=process.env.RUNNER_NAME??'unknown-runner',host=process.env.COMPUTERNAME??process.env.HOSTNAME??'unknown-host',adapter=hud.adapter??{};
if(adapter.isFallbackAdapter||/swiftshader|lavapipe|llvmpipe|software|microsoft basic render/i.test(JSON.stringify(adapter)))throw new Error('Software GPU cannot calibrate Meshwork');
const fingerprint=createHash('sha256').update(JSON.stringify({host,adapter})).digest('hex'),startedMs=Number(process.env.MESHWORK_BENCH_STARTED_MS??Date.now()),finishedMs=Date.now();

const envNumber=(name,{required=false,min=0}={})=>{
 const raw=process.env[name];if(raw===undefined||raw===''){if(required)throw new Error(name+' is required');return undefined;}
 const value=Number(raw);if(!Number.isFinite(value)||value<min)throw new RangeError(name+' is invalid');return value;
};
let transport;
const transportSource=process.env.MESHWORK_TRANSPORT_SOURCE;
if(transportSource!==undefined){
 if(!['measured','assumed'].includes(transportSource))throw new Error('MESHWORK_TRANSPORT_SOURCE must be measured or assumed');
 const ingressBytesPerSecond=envNumber('MESHWORK_INGRESS_BYTES_PER_SECOND',{required:true,min:1}),egressBytesPerSecond=envNumber('MESHWORK_EGRESS_BYTES_PER_SECOND',{required:true,min:1});
 const inputBytesPerFrameBudget=envNumber('MESHWORK_INPUT_BYTES_PER_FRAME',{required:true}),outputBytesPerFrameBudget=envNumber('MESHWORK_OUTPUT_BYTES_PER_FRAME',{required:true});
 const segmentInputBytesBudget=envNumber('MESHWORK_SEGMENT_INPUT_BYTES'),coldStartInputBytesBudget=envNumber('MESHWORK_COLD_START_INPUT_BYTES');
 const fixedNsBudget=envNumber('MESHWORK_TRANSPORT_FIXED_NS'),encodeNsPerOutputFrameBudget=envNumber('MESHWORK_ENCODE_NS_PER_FRAME');
 transport={
  source:transportSource,ingressBytesPerSecond,egressBytesPerSecond,inputBytesPerFrameBudget,outputBytesPerFrameBudget,
  ...(segmentInputBytesBudget!==undefined?{segmentInputBytesBudget}:{}),...(coldStartInputBytesBudget!==undefined?{coldStartInputBytesBudget}:{}),
  cacheWarm:process.env.MESHWORK_CACHE_WARM==='1',
  ...(fixedNsBudget!==undefined?{fixedNsBudget:String(BigInt(Math.ceil(fixedNsBudget)))}:{}),
  ...(encodeNsPerOutputFrameBudget!==undefined?{encodeNsPerOutputFrameBudget:String(BigInt(Math.ceil(encodeNsPerOutputFrameBudget)))}:{}),
 };
}
const calibration={
 schema:2,slot:process.env.MESHWORK_WORKER_SLOT??'single',runnerName,host,fingerprint,adapter,frameMsBudget,frameNsBudget:String(BigInt(Math.ceil(frameMsBudget*1e6))),
 cpuMaxMs:cpu?.maxMs??null,cpuP95Ms:cpu?.p95Ms??null,gpuMaxMs:gpu?.maxMs??null,gpuP95Ms:gpu?.p95Ms??null,
 benchmarkStartedMs:startedMs,benchmarkFinishedMs:finishedMs,profileFrames:{cpu:profile.cpuFrames,gpu:profile.gpuFrames},...(transport?{transport}:{}),
};
await mkdir(resolve('artifacts/meshwork'),{recursive:true});await writeFile(resolve('artifacts/meshwork/calibration.json'),JSON.stringify(calibration,null,2));console.log(JSON.stringify(calibration,null,2));
