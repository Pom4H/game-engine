import {execFileSync} from 'node:child_process';
import {mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import {basename,dirname,join,resolve} from 'node:path';
import {CAUSAL_EVIDENCE_SCHEMA,classifyEvidence,parseCausalCommit,validateCausalCommit} from './protocol.mjs';

const arg=(name,fallback=null)=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:fallback;};
const subject=arg('--subject',process.env.GITHUB_SHA??'HEAD');
const input=resolve(arg('--input','artifacts'));
const out=resolve(arg('--out','artifacts/causality/evidence.json'));
const jobs={
  reality:arg('--reality-result',process.env.REALITY_JOB_RESULT),
  visualFast:arg('--visual-result',process.env.VISUAL_JOB_RESULT),
  performance1080:arg('--performance-result',process.env.PERFORMANCE_JOB_RESULT),
};
const commitMessage=git(['show','-s','--format=%B',subject]);
const declaration=parseCausalCommit(commitMessage),errors=validateCausalCommit(declaration);
if(errors.length)throw new Error('Invalid causal commit: '+errors.join('; '));
const sha=git(['rev-parse',subject]).trim();
const parents=git(['show','-s','--format=%P',subject]).trim().split(/\s+/).filter(Boolean);
const authoredAt=git(['show','-s','--format=%aI',subject]).trim();
const files=await walk(input).catch(()=>[]);
const reality=await readFirstJson(files.filter(path=>basename(path)==='summary.json'),value=>value?.metric==='RealityGap');
const performance1080=await readFirstJson(files.filter(path=>basename(path)==='clear-day.json'));
const visualFast=await readFirstJson(files.filter(path=>basename(path)==='visual-fast.json'));
const evidence={
  schema:CAUSAL_EVIDENCE_SCHEMA,
  subject:sha,
  parents,
  authoredAt,
  recordedAt:new Date().toISOString(),
  experiment:declaration.experiment,
  declaration,
  run:{
    repository:process.env.GITHUB_REPOSITORY??null,
    id:process.env.GITHUB_RUN_ID??null,
    attempt:process.env.GITHUB_RUN_ATTEMPT??null,
    url:process.env.GITHUB_SERVER_URL&&process.env.GITHUB_REPOSITORY&&process.env.GITHUB_RUN_ID?`${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`:null,
  },
  jobs,
  observations:{
    reality:reality?pickReality(reality):null,
    performance1080:performance1080?pickPerformance(performance1080):null,
    visualFast:visualFast?pickPerformance(visualFast):null,
  },
};
evidence.verdict=classifyEvidence({experiment:evidence.experiment,jobs,reality});
await mkdir(dirname(out),{recursive:true});
await writeFile(out,JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence,null,2));

function git(args){return execFileSync('git',args,{encoding:'utf8'});}
async function walk(root){
  const entries=await readdir(root,{withFileTypes:true}),files=[];
  for(const entry of entries){const path=join(root,entry.name);if(entry.isDirectory())files.push(...await walk(path));else files.push(path);}
  return files;
}
async function readFirstJson(paths,predicate=()=>true){
  for(const path of paths){try{const value=JSON.parse(await readFile(path,'utf8'));if(predicate(value))return value;}catch{}}
  return null;
}
function pickReality(value){
  return {dataset:value.dataset,object:value.object,gap:value.gap,baseline:value.baseline??null,regressions:value.regressions??[],heldOut:value.heldOut??[]};
}
function pickPerformance(value){
  const result=value.results?.[0];
  if(!result)return {scene:value.scene??null,results:[]};
  return {scene:value.scene??null,resolution:`${result.width}x${result.height}`,submittedFps:result.submittedFps,completedFps:result.completedFps,p95FrameMs:result.p95FrameMs,gpuP95Ms:result.renderProfile?.gpuTotal?.p95Ms??null,simulationToWallRatio:result.simulationToWallRatio,rendererErrors:result.renderer?.errors??[]};
}
