import {spawnSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import scene,{authoredEntityCount,quality} from './scene.mjs';
const width=Number(process.env.ARCADE_WIDTH??1920),height=Math.round(width*9/16);
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
const run=(command,args)=>{const result=spawnSync(command,args,{stdio:'inherit',windowsHide:true});if(result.error)throw result.error;if(result.status!==0)throw new Error(command+' failed: '+result.status);};
run(process.execPath,['tools/render-harness.mjs','tools/arcade/scene.mjs','tools/arcade/views.mjs',String(width),String(height)]);
const hud=JSON.parse(await readFile('artifacts/render-hud.json','utf8'));
for(const view of hud.views){assert.equal(view.renderer.backend,'webgpu');assert.equal(view.renderer.errors.length,0,JSON.stringify(view.renderer.errors));assert(view.renderer.triangles>0);}
await writeFile('artifacts/arcade-evidence.json',JSON.stringify({commit:process.env.GITHUB_SHA,run:process.env.GITHUB_RUN_ID,runner:process.env.RUNNER_NAME,authoredEntityCount,batchedEntities:scene.entities.length,sourceTriangles,requestedQuality:quality,capture:[width,height],hud},null,2));
run('ffmpeg',['-y','-hide_banner','-loglevel','error','-i','artifacts/snowy-arcade.png','-vf','scale=960:-2','-q:v','9','artifacts/arcade-preview.jpg']);
console.log('ARCADE_PREVIEW_BASE64='+(await readFile('artifacts/arcade-preview.jpg')).toString('base64'));
console.log('ARCADE_EVIDENCE='+await readFile('artifacts/arcade-evidence.json','utf8'));
