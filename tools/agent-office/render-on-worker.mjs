#!/usr/bin/env node
/** Direct hardware capture on our own GPU worker, no GitHub Actions dispatcher.
 *
 * node tools/agent-office/render-on-worker.mjs
 * node tools/agent-office/render-on-worker.mjs --publish
 *
 * Windows (self-hosted RDNA3) or Linux (NVIDIA/AMD); never macOS.
 * All GPU proofs come from campus-capture.mjs; no software rendering fallback.
 */
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {copyFile,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const flags=new Set(process.argv.slice(2));
if([...flags].some(flag=>!['--publish','--help'].includes(flag)))
 throw new Error('Usage: node tools/agent-office/render-on-worker.mjs [--publish]');
if(flags.has('--help')){
 console.log('Render a GPU-verified Agent Campus MP4 on this self-hosted Windows/Linux worker.\n'
  +'Optional --publish uploads the MP4, stills and evidence to the private GitHub prerelease agent-campus-preview.');
 process.exit(0);
}
if(!['win32','linux'].includes(process.platform))
 throw new Error('Only our Windows/Linux GPU workers are supported (Apple is excluded).');

const bunPath=process.platform==='win32'&&existsSync(join(homedir(),'.bun','bin','bun.exe'))
 ?join(homedir(),'.bun','bin','bun.exe'):'bun';
const output=resolve(process.env.ENGINE_WORKER_OUTPUT??join(homedir(),'game-engine-renders','agent-campus'));
const artifact=join(root,'artifacts','agent-campus');
const tag='agent-campus-preview';
const repo='Pom4H/game-engine';
const safeFiles=['campus-walkthrough.mp4','campus-start.png','campus-middle.png',
 'campus-end.png','campus-evidence.json'];
const logPrefix='[our-gpu-worker]';
function run(executable,args,{cwd=root,env=process.env,capture=false,allowFailure=false}={}){
 return new Promise((resolveRun,reject)=>{
  const process=spawn(executable,args,{
   cwd,env,windowsHide:true,stdio:capture?['ignore','pipe','pipe']:'inherit',
  });
  let stdout='',stderr='';
  if(capture){
   process.stdout.on('data',value=>stdout+=String(value));
   process.stderr.on('data',value=>stderr+=String(value));
  }
  process.once('error',reject);
  process.once('close',code=>{
   if(code!==0&&!allowFailure)reject(new Error(
    executable+' '+args.join(' ')+' exited '+code+(stderr?'\n'+stderr.slice(-1800):'')));
   else resolveRun({code,stdout:stdout.trim(),stderr:stderr.trim()});
  });
 });
}
const ensure=(condition,message)=>{if(!condition)throw new Error(message);};
const number=(value,name)=>{const n=Number(value);ensure(Number.isFinite(n),name+' missing');return n;};
console.log(logPrefix,'Starting native GPU capture in',root);
const git=await run('git',['rev-parse','HEAD'],{capture:true});
const commit=git.stdout;
ensure(/^[0-9a-f]{40}$/.test(commit),'Not in an exact Git commit checkout');
console.log(logPrefix,'Source revision',commit);
await run(bunPath,['--version'],{capture:true});
await run('ffmpeg',['-version'],{capture:true});
await run('ffprobe',['-version'],{capture:true});
console.log(logPrefix,'Installing exact locked dependencies');
await run(bunPath,['install','--frozen-lockfile']);
await run(bunPath,['run','typecheck']);
await run(bunPath,['run','build']);
await run(process.execPath,['--test','test/agent-campus.test.mjs']);
for(const file of ['campus-app.mjs','campus-server.mjs','campus-capture.mjs']){
 await run(process.execPath,['--check','tools/agent-office/'+file]);
}
// Remove only prior ignored generated artifacts in the dedicated campus folder.
// A failed run must not accidentally publish the previous successful video.
await rm(artifact,{recursive:true,force:true});await mkdir(artifact,{recursive:true});
console.log(logPrefix,'Recording native Chromium WebGPU: 1920x1080 / 24 fps / 312 frames');
await run(process.execPath,['tools/agent-office/campus-capture.mjs'],{
 env:{...process.env,CAMPUS_REQUIRE_HARDWARE:'1',GITHUB_SHA:commit},
});
const evidence=JSON.parse(await readFile(join(artifact,'campus-evidence.json'),'utf8'));
ensure(evidence.software===false&&evidence.adapter&&evidence.renderer?.backend==='webgpu',
 'Hardware WebGPU proof absent — refusing the video');
ensure(number(evidence.frames,'frames')===312,'Unexpected video frame count');
ensure(number(evidence.fps,'fps')===24,'Unexpected video FPS');
ensure(evidence.outputResolution?.[0]===1920&&evidence.outputResolution?.[1]===1080,
 'Unexpected video output resolution');
ensure(Array.isArray(evidence.previews)&&evidence.previews.length===3,
 'Required first/middle/last GPU visual proofs are absent');
ensure(evidence.renderer.errors?.length===0,'GPU validation errors present');
const probe=await run('ffprobe',['-v','error','-count_frames','-select_streams','v:0',
 '-show_entries','stream=codec_name,width,height,nb_read_frames,duration',
 '-of','json',join(artifact,'campus-walkthrough.mp4')],{capture:true});
const media=JSON.parse(probe.stdout).streams?.[0];
ensure(media?.width===1920&&media?.height===1080&&Number(media.nb_read_frames)===312,
 'Hardware video is missing frames');
await mkdir(output,{recursive:true});
for(const file of safeFiles){
 ensure(existsSync(join(artifact,file)),'GPU capture artifact missing: '+file);
 await copyFile(join(artifact,file),join(output,file));
}
const report={
 schema:'engine.gpu-worker-render.v1',sourceRevision:commit,renderer:evidence.renderer.backend,
 hardwareAdapter:evidence.adapter,software:evidence.software,platform:process.platform,
 resolution:[1920,1080],fps:24,frames:312,videoCodec:media.codec_name,
 verifiedAt:new Date().toISOString(),
};
await writeFile(join(output,'worker-proof.json'),JSON.stringify(report,null,2));
await writeFile(join(artifact,'worker-proof.json'),JSON.stringify(report,null,2));
console.log(logPrefix,'Validated real GPU output:',join(output,'campus-walkthrough.mp4'));
if(flags.has('--publish')){
 console.log(logPrefix,'Publishing assets to private GitHub prerelease:',tag);
 const existing=await run('gh',['release','view',tag,'-R',repo],{capture:true,allowFailure:true});
 if(existing.code!==0){
  await run('gh',['release','create',tag,'--target',commit,'--title',
   'Agent Campus - hardware WebGPU preview','--notes',
   'Private reproducible 1080p/24fps hardware video; inspect attached GPU evidence.',
   '--prerelease','-R',repo]);
 }
 const files=[...safeFiles,'worker-proof.json'].map(file=>join(output,file));
 await run('gh',['release','upload',tag,...files,'--clobber','-R',repo]);
 const link=await run('gh',['release','view',tag,'-R',repo,'--json','url','--jq','.url'],{capture:true});
 console.log(logPrefix,'Video and evidence published:',link.stdout);
}
console.log(JSON.stringify({ok:true,commit,output:join(output,'campus-walkthrough.mp4'),
 adapter:evidence.adapter,frames:312,codec:media.codec_name,published:flags.has('--publish')},null,2));
