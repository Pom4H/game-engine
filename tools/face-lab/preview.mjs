import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createWebGpuCapture} from '../tea-scene/webgpu-capture.mjs';

const out=resolve(process.env.FACE_PREVIEW_OUTPUT??'artifacts/face-preview');
await mkdir(out,{recursive:true});
const fps=2,width=640,height=360,hash=b=>createHash('sha256').update(b).digest('hex');
const capture=await createWebGpuCapture({root:resolve('.'),width,height,pagePath:'/tools/face-lab/player.html'});
let encoder;
try{
  const output=out+'/face-preview.mp4';
  const evidence={sourceCommit:process.env.GITHUB_SHA??null,backend:capture.kind,adapter:capture.adapter,width,height,fps,durationS:capture.duration,audio:'muted-diagnostic',frames:0,views:[]};
  encoder=spawn('ffmpeg',['-y','-v','error','-f','image2pipe','-vcodec','png','-framerate',String(fps),'-i','pipe:0','-an','-c:v','libx264','-preset','veryfast','-crf','22','-pix_fmt','yuv420p','-movflags','+faststart',output],{stdio:['pipe','inherit','inherit']});
  const done=once(encoder,'exit');done.catch(()=>{});
  let error;encoder.on('error',e=>error=e);encoder.stdin.on('error',e=>error=e);
  const frames=Math.round(capture.duration*fps);
  for(let i=0;i<frames;i++){
    const frame=await capture.frame(i/fps);
    if(error)throw error;
    if(!encoder.stdin.write(frame.bytes))await once(encoder.stdin,'drain');
    evidence.frames++;
    evidence.views.push({frame:i,timeS:frame.timeS,scene:frame.scene,renderer:frame.renderer,pngSha256:hash(frame.bytes)});
    console.log(JSON.stringify({frame:i+1,frames,timeS:frame.timeS,triangles:frame.renderer.triangles,errors:frame.renderer.errors}));
  }
  encoder.stdin.end();
  const [code]=await done;if(code!==0)throw new Error('ffmpeg exit '+code);encoder=null;
  evidence.videoSha256=hash(await readFile(output));
  await writeFile(out+'/evidence.json',JSON.stringify(evidence,null,2));
  console.log(JSON.stringify({...evidence,views:undefined}));
}finally{
  if(encoder){encoder.stdin.destroy();encoder.kill();}
  await capture.close();
}
