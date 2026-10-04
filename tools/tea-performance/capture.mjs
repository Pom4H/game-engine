import {mkdir,readFile,writeFile,unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {createWebGpuCapture} from '../tea-scene/webgpu-capture.mjs';
import {createTeaPerformancePlan} from './plan.mjs';
const mode=process.argv[2]??'storyboard';if(!['storyboard','video'].includes(mode))throw new RangeError('Capture mode');
const root=resolve('.'),out=resolve(process.env.TEA_OUTPUT??'artifacts/tea-performance');await mkdir(out,{recursive:true});
const width=Number(process.env.TEA_WIDTH??960),height=Number(process.env.TEA_HEIGHT??540),fps=Number(process.env.TEA_FPS??20);
if(![width,height].every(x=>Number.isInteger(x)&&x>=160&&x<=3840&&x%2===0)||![15,20,30,60].includes(fps))throw new RangeError('Invalid capture dimensions/cadence');
const plan=createTeaPerformancePlan(),planPath=out+'/plan.json',audioPath=resolve(process.env.TEA_AUDIO??out+'/dialogue.wav');
await writeFile(planPath,JSON.stringify(plan,null,2));
const started=Date.now(),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const capture=await createWebGpuCapture({root,width,height,planPath,audioPath,pagePath:'/tools/tea-performance/player.html'});
let encoder;
try{
 const evidence={schema:1,sourceCommit:process.env.GITHUB_SHA??null,backend:capture.kind,adapter:capture.adapter,width,height,fps,durationS:capture.duration,planSha256:sha(await readFile(planPath)),frames:0,views:[]};
 if(mode==='storyboard'){
  for(const [name,time] of [['offer',2.2],['cold-hands',5.65],['pour',8.75],['confident',11.7],['handoff',15.1],['too-hot',19.3],['smirk',27.9],['departure',40.5]]){
   const frame=await capture.frame(time),file=out+'/'+name+'.png';await writeFile(file,frame.bytes);
   evidence.views.push({name,time:frame.timeS,pngSha256:sha(frame.bytes),scene:frame.scene,renderer:frame.renderer});evidence.frames++;
   console.log(JSON.stringify({view:name,time:frame.timeS,backend:capture.kind,triangles:frame.renderer.triangles,errors:frame.renderer.errors}));
  }
 }else{
  const audio=await readFile(audioPath);if(audio.toString('ascii',0,4)!=='RIFF')throw new TypeError('WAV required');evidence.audioSha256=sha(audio);
  const silent=out+'/tea-performance-silent.mp4',output=out+'/tea-performance.mp4',frames=Math.round(capture.duration*fps);
  encoder=spawn('ffmpeg',['-y','-v','error','-f','image2pipe','-vcodec','png','-framerate',String(fps),'-i','pipe:0','-an','-c:v','libx264','-preset','fast','-crf','20','-pix_fmt','yuv420p','-movflags','+faststart',silent],{stdio:['pipe','inherit','inherit']});
  const done=once(encoder,'exit');done.catch(()=>{});let error;encoder.on('error',e=>error=e);encoder.stdin.on('error',e=>error=e);
  for(let i=0;i<frames;i++){
   const frame=await capture.frame(i/fps);if(error)throw error;if(!encoder.stdin.write(frame.bytes))await once(encoder.stdin,'drain');
   if(i%fps===0)evidence.views.push({frame:i,time:frame.timeS,scene:frame.scene,renderer:frame.renderer});if(i%60===0)console.log(JSON.stringify({frame:i,frames,time:i/fps}));
  }
  encoder.stdin.end();const [code]=await done;if(code!==0)throw new Error('Encoder failed '+code);encoder=null;
  const mux=spawnSync('ffmpeg',['-y','-v','error','-i',silent,'-i',audioPath,'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','192k','-af','apad','-t',String(capture.duration),'-movflags','+faststart',output],{encoding:'utf8'});if(mux.status!==0)throw new Error(mux.stderr);await unlink(silent);evidence.frames=frames;evidence.videoSha256=sha(await readFile(output));
 }
 evidence.elapsedSeconds=(Date.now()-started)/1000;await writeFile(out+'/'+mode+'-evidence.json',JSON.stringify(evidence,null,2));
 console.log(JSON.stringify({...evidence,views:undefined}));
}finally{if(encoder){encoder.stdin.destroy();encoder.kill();}await capture.close();}
