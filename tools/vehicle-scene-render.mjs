import {readFile,writeFile,rm,rename} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
// Production WebGPU renderer, recorded physical state, no pose keyframes or image generation.
const out='artifacts/vehicle-scene';
for(const name of ['parked','airborne','damaged']){
 const spec=JSON.parse(await readFile(`${out}/${name}.scene.json`,'utf8'));
 const sceneFile=`tools/.vehicle-${name}.scene.mjs`,viewsFile=`tools/.vehicle-${name}.views.mjs`;
 try{
  await writeFile(sceneFile,`export default ${JSON.stringify(spec)};\n`);
  await writeFile(viewsFile,`export default ${JSON.stringify([{name,output:`${out}/${name}.png`,camera:spec.camera}])};\n`);
  const result=spawnSync(process.execPath,['tools/render-harness.mjs',sceneFile,viewsFile,'1280','720'],{stdio:'inherit',timeout:120000});
  if(result.error)throw result.error;if(result.status!==0)throw new Error(`${name} WebGPU capture failed (${result.status})`);
  await rename('artifacts/render-hud.json',`${out}/${name}.render.json`);
 }finally{await rm(sceneFile,{force:true});await rm(viewsFile,{force:true});}
}
