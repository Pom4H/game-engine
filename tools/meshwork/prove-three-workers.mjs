#!/usr/bin/env node
import {readdir,readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {defineRenderProgram,MemoryContentStore} from '../../dist/render-ir/index.js';
import {lowerRenderProgram} from '../../dist/execution/index.js';
import {compileTemporalMeshPlan} from '../../dist/meshwork/index.js';

const root=resolve(process.argv[2]??'artifacts/meshwork/calibrations');
const target=Number(process.argv[3]??120);
if(!Number.isSafeInteger(target)||target<1)throw new RangeError('target FPS must be a positive integer');

const find=async dir=>{
  const out=[];
  for(const entry of await readdir(dir,{withFileTypes:true})){
    const path=join(dir,entry.name);
    if(entry.isDirectory())out.push(...await find(path));
    else if(entry.name==='calibration.json')out.push(path);
  }
  return out;
};

const files=await find(root);
if(files.length<3)throw new Error('Need at least three calibration artifacts');
const calibrations=[];
for(const file of files)calibrations.push(JSON.parse(await readFile(file,'utf8')));

const byFingerprint=new Map();
for(const calibration of calibrations)if(!byFingerprint.has(calibration.fingerprint))byFingerprint.set(calibration.fingerprint,calibration);
const unique=[...byFingerprint.values()];
const overlapStart=unique.length?Math.max(...unique.map(x=>x.benchmarkStartedMs)):0;
const overlapEnd=unique.length?Math.min(...unique.map(x=>x.benchmarkFinishedMs)):0;
const concurrent=unique.length>=3&&overlapStart<overlapEnd;

const program=defineRenderProgram({
  schema:1,
  programHash:'program:meshwork-gpu-proof',
  profileHash:'profile:gpu-proof',
  partitionability:{kind:'temporal',warmupFrames:4},
  requiredResources:{resources:[]},
});
const graph=lowerRenderProgram(program),graphStore=new MemoryContentStore(),graphRef=graphStore.put('graph',graph);
const stream={streamId:'gpu-proof',targetFps:target,renderProgramHash:program.programHash};
const epoch={streamId:'gpu-proof',epoch:1n,checkpointHash:'checkpoint:gpu-proof',cameraHash:'camera:gpu-proof',profileHash:program.profileHash};

let plan=null,error=null;
if(unique.length>=3){
  try{
    plan=compileTemporalMeshPlan({
      program,graph,executionGraphRefHash:graphRef.hash,stream,epoch,
      resourceManifestHash:'manifest:gpu-proof',
      nowNs:0n,
      firstDisplayNs:2_000_000_000n,
      firstOutputFrame:0n,
      totalOutputFrames:96,
      reserveRatio:.8,
      guardNs:100_000_000n,
      workers:unique.slice(0,3).map((x,i)=>({
        workerId:'worker-'+i,
        frameNsBudget:BigInt(x.frameNsBudget),
        fixedNsBudget:5_000_000n,
      })),
    });
  }catch(cause){error=String(cause?.stack??cause);}
}

const report={
  schema:1,targetFps:target,
  calibrationArtifacts:calibrations.length,
  uniqueWorkers:unique.length,
  concurrent,
  overlapMs:Math.max(0,overlapEnd-overlapStart),
  workers:unique.map(x=>({
    runnerName:x.runnerName,host:x.host,fingerprint:x.fingerprint,adapter:x.adapter,
    frameMsBudget:x.frameMsBudget,benchmarkStartedMs:x.benchmarkStartedMs,benchmarkFinishedMs:x.benchmarkFinishedMs,
  })),
  plan,error,
};
await mkdir(resolve('artifacts/meshwork'),{recursive:true});
await writeFile(resolve('artifacts/meshwork/three-worker-proof.json'),JSON.stringify(report,(_,value)=>typeof value==='bigint'?value.toString():value,2));
console.log(JSON.stringify(report,(_,value)=>typeof value==='bigint'?value.toString():value,2));

if(unique.length<3)throw new Error('Three-worker proof requires three unique host+GPU fingerprints');
if(!concurrent)throw new Error('Three-worker benchmarks did not overlap; sequential reuse is not aggregate capacity');
if(!plan?.proofEligible)throw new Error('Meshwork did not prove target FPS with reserve while every worker remained below target');
