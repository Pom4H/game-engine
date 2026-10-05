import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const out=resolve(process.env.TEA_OUTPUT??'artifacts/tea-performance');
const evidence=JSON.parse(await readFile(out+'/storyboard-evidence.json','utf8'));
if(evidence.backend!=='webgpu-hardware'||!evidence.sourceCommit||evidence.sourceCommit!==process.env.GITHUB_SHA)throw new Error('Fresh hardware evidence required');
for(const name of ['offer','too-hot','smirk']){
 const r=spawnSync('ffmpeg',['-v','error','-i',out+'/'+name+'.png','-vf','scale=640:-2','-frames:v','1','-c:v','mjpeg','-q:v','6','-f','image2pipe','pipe:1'],{maxBuffer:2e6});
 if(r.status!==0)throw new Error(String(r.stderr));
 console.log('TEA_ENGINE_PREVIEW_'+name.toUpperCase().replaceAll('-','_')+'='+r.stdout.toString('base64'));
}
console.log('TEA_HARDWARE_EVIDENCE='+JSON.stringify({...evidence,views:evidence.views.map(v=>({name:v.name,time:v.time,pngSha256:v.pngSha256,triangles:v.renderer.triangles,drawCalls:v.renderer.drawCalls,errors:v.renderer.errors}))}));
