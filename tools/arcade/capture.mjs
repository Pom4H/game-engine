import {spawnSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import scene,{authoredEntityCount,quality} from './scene.mjs';
import {prepareArcadeTextures} from './textures.mjs';
const width=Number(process.env.ARCADE_WIDTH??quality.internal[0]),height=Math.round(width*9/16);
assert(Number.isInteger(width)&&width>=640&&width<=3840,'Invalid capture width');
const ids=new Set();let sourceTriangles=0;
for(const e of scene.entities){
 assert(!ids.has(e.id),'Duplicate entity '+e.id);ids.add(e.id);
 assert(e.position?.every(Number.isFinite),'Invalid position '+e.id);
 if(e.mesh?.kind==='triangle-mesh'){
  assert(e.mesh.positions.length===e.mesh.normals.length);
  assert(e.mesh.positions.every(Number.isFinite)&&e.mesh.normals.every(Number.isFinite),'Non-finite geometry '+e.id);
  assert(e.mesh.indices.every(i=>Number.isInteger(i)&&i>=0&&i<e.mesh.positions.length/3),'Invalid index '+e.id);
  sourceTriangles+=e.mesh.indices.length/3;
 }
}
await mkdir('artifacts',{recursive:true});
const run=(command,args,env={})=>{
 const result=spawnSync(command,args,{encoding:'utf8',maxBuffer:32*1024*1024,windowsHide:true,env:{...process.env,...env}});
 if(result.error)throw result.error;
 if(result.status!==0)throw new Error(command+' failed: '+result.status+'\n'+result.stdout+'\n'+result.stderr);
};
await prepareArcadeTextures();
run(process.execPath,['tools/render-harness.mjs','tools/arcade/scene.mjs','tools/arcade/views.mjs',String(width),String(height)],{RENDER_WARMUP_FRAMES:String(quality.warmupFrames),RENDER_PROFILING:'1',RENDER_REQUIRE_HARDWARE:'1'});
const hud=JSON.parse(await readFile('artifacts/render-hud.json','utf8'));
for(const view of hud.views){
 assert.equal(view.renderer.backend,'webgpu');assert.equal(view.renderer.width,width);assert.equal(view.renderer.height,height);
 assert.equal(view.renderer.errors.length,0,JSON.stringify(view.renderer.errors));assert(view.renderer.triangles>0);
}
const evidence={commit:process.env.GITHUB_SHA,run:process.env.GITHUB_RUN_ID,runner:process.env.RUNNER_NAME,authoredEntityCount,batchedEntities:scene.entities.length,sourceTriangles,appliedQuality:{native:[width,height],warmupFrames:hud.warmupFrames},hud};
await writeFile('artifacts/arcade-evidence.json',JSON.stringify(evidence,null,2));
run('ffmpeg',['-y','-hide_banner','-loglevel','error','-i','artifacts/snowy-arcade.png','-vf','scale=960:-2:flags=lanczos','-q:v','9','artifacts/arcade-preview.jpg']);
run('ffmpeg',['-y','-hide_banner','-loglevel','error','-i','artifacts/snowy-arcade.png','-vf','scale=640:-2:flags=lanczos','-c:v','libwebp','-quality','55','artifacts/arcade-inspection.webp']);
console.log('ARCADE_PREVIEW_WEBP='+(await readFile('artifacts/arcade-inspection.webp')).toString('base64'));
const r=hud.views[0].renderer;
console.log('ARCADE_EVIDENCE='+JSON.stringify({...evidence,hud:undefined,adapter:hud.adapter,renderer:{backend:r.backend,width:r.width,height:r.height,drawCalls:r.drawCalls,triangles:r.triangles,errors:r.errors,pointLights:r.pointLights,lightOverflow:r.lightOverflow,reflectionProbe:r.reflectionProbe},profile:{cpu:r.profile?.cpuTotal,gpu:r.profile?.gpuTotal,snowInstances:r.profile?.latestGpu?.work?.snowInstances}}));
