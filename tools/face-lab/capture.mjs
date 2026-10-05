import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createWebGpuCapture} from '../tea-scene/webgpu-capture.mjs';
const out=resolve(process.env.FACE_LAB_OUTPUT??'artifacts/face-lab');await mkdir(out,{recursive:true});
const fps=20,width=960,height=540,hash=b=>createHash('sha256').update(b).digest('hex');
const capture=await createWebGpuCapture({root:resolve('.'),width,height,pagePath:'/tools/face-lab/player.html'});
let encoder;try{
 const output=out+'/face-flex.mp4',evidence={sourceCommit:process.env.GITHUB_SHA??null,backend:capture.kind,adapter:capture.adapter,width,height,fps,durationS:capture.duration,audio:'muted-diagnostic',frames:0,views:[]};
 encoder=spawn('ffmpeg',['-y','-v','error','-f','image2pipe','-vcodec','png','-framerate',String(fps),'-i','pipe:0','-an','-c:v','libx264','-preset','fast','-crf','19','-pix_fmt','yuv420p','-movflags','+faststart',output],{stdio:['pipe','inherit','inherit']});const done=once(encoder,'exit');done.catch(()=>{});let error;encoder.on('error',e=>error=e);encoder.stdin.on('error',e=>error=e);
 for(let i=0;i<Math.round(capture.duration*fps);i++){
  const frame=await capture.frame(i/fps);if(error)throw error;if(!encoder.stdin.write(frame.bytes))await once(encoder.stdin,'drain');
  if(i%20===0){const name='frame-'+String(i).padStart(4,'0')+'.png';await writeFile(out+'/'+name,frame.bytes);evidence.views.push({frame:i,timeS:frame.timeS,pngSha256:hash(frame.bytes),scene:frame.scene,renderer:frame.renderer});console.log(JSON.stringify({frame:i,triangles:frame.renderer.triangles,meshes:frame.renderer.meshes,buffers:frame.renderer.buffers,errors:frame.renderer.errors}));}evidence.frames++;
 }
 encoder.stdin.end();const [code]=await done;if(code!==0)throw new Error('ffmpeg exit '+code);encoder=null;evidence.videoSha256=hash(await readFile(output));
 // A different number of cached GPU resources per expression is a leak, not quality.
 const resourceCounts=evidence.views.slice(2).map(v=>[v.renderer.meshes,v.renderer.buffers].join(':'));if(new Set(resourceCounts).size!==1)throw new Error('Unbounded face GPU resources: '+resourceCounts.join(','));
 await writeFile(out+'/evidence.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify({...evidence,views:undefined}));
}finally{if(encoder){encoder.stdin.destroy();encoder.kill();}await capture.close();}
