#!/usr/bin/env node
import {mkdir,readFile,writeFile,unlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {CpuRenderer,encodePng} from '../../dist/index.js';
import {createTeaScene} from './scene.mjs';

const root=resolve(fileURLToPath(new URL('../../',import.meta.url)));
const mode=process.argv[2]??'video',backend=process.env.TEA_BACKEND??'cpu';
const width=Number(process.env.TEA_WIDTH??960),height=Number(process.env.TEA_HEIGHT??width*9/16),fps=Number(process.env.TEA_FPS??30);
const output=resolve(root,process.env.TEA_OUTPUT??'artifacts/tea-scene');
const planPath=resolve(root,process.env.TEA_PLAN??'artifacts/tea-scene/plan.json');
const audioPath=resolve(root,process.env.TEA_AUDIO??'artifacts/tea-scene/dialogue.wav');
if(!['video','storyboard','preview'].includes(mode))throw new RangeError('Mode must be video, storyboard or preview');
if(!['cpu','webgpu'].includes(backend))throw new RangeError('TEA_BACKEND must be cpu or webgpu');
if(!Number.isInteger(width)||!Number.isInteger(height)||width<160||height<90||width>3840||height>2160||width%2||height%2)throw new RangeError('Capture dimensions must be positive even integers up to 3840x2160');
if(![15,20,30,60].includes(fps))throw new RangeError('TEA_FPS must be 15, 20, 30 or 60 for exact 60 Hz simulation steps');
await mkdir(output,{recursive:true});
const planBytes=await readFile(planPath),plan=JSON.parse(planBytes.toString('utf8'));
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
let capture;
if(backend==='webgpu'){
  const {createWebGpuCapture}=await import('./webgpu-capture.mjs');
  capture=await createWebGpuCapture({root,width,height,planPath,audioPath});
}else{
  const play=createTeaScene({plan}),renderer=new CpuRenderer({width,height});
  let tick=0;
  play.step(0,0);
  capture={duration:play.duration,kind:'cpu',adapter:null,
    async frame(timeS){
      const target=Math.round(timeS*60);
      if(target<tick)throw new RangeError('Capture must advance monotonically');
      while(tick<target){tick++;play.step(tick/60,1/60);}
      renderer.render(play.scene,play.scene.camera);
      const stats=renderer.inspect();
      if(stats.errors.length||!stats.drawCalls)throw new Error('Tea scene render failed: '+JSON.stringify(stats));
      return{bytes:renderer.framebuffer(),renderer:stats,scene:structuredClone(play.inspect()),timeS:tick/60};
    },async close(){renderer.dispose();},
  };
}
const duration=capture.duration;
if(!Number.isFinite(duration)||duration<=0||duration>120)throw new RangeError('Scene duration must be in (0,120] seconds');
const frameCount=Math.ceil(duration*fps),telemetry=[],started=Date.now();
const evidence={schemaVersion:1,mode,backend:capture.kind,adapter:capture.adapter,width,height,fps,durationS:duration,
  sourceCommit:process.env.GITHUB_SHA??process.env.TEA_SOURCE_COMMIT??null,
  sourcePlanSha256:sha256(planBytes),sourceAudioSha256:null,frames:0,telemetry};
evidence.sourceFilesSha256=Object.fromEntries(await Promise.all([
  'tools/tea-scene/scene.mjs','tools/tea-scene/capture.mjs','dist/animation/conversation-face.js',
  backend==='cpu'?'dist/render/cpu.js':'dist/render/webgpu.js',
  ...(backend==='webgpu'?['tools/tea-scene/player.html','tools/tea-scene/webgpu-capture.mjs','tools/tea-scene/server.mjs']:[]),
].map(async path=>[path,sha256(await readFile(join(root,path)))])));
const pngOf=frame=>backend==='cpu'?encodePng(frame.bytes,width,height):frame.bytes;
const run=(command,args)=>new Promise((yes,no)=>{const p=spawn(command,args,{stdio:'inherit'});p.once('error',no);p.once('exit',code=>code===0?yes():no(new Error(`${command} exited ${code}`)));});
let encoder;
try{
  if(mode==='preview'||mode==='storyboard'){
    const times=mode==='preview'?[Number(process.env.TEA_PREVIEW_TIME??duration*.52)]:[.1,2.2,4,6.8,9.4,11.3,13.3,duration-.2].filter(t=>t>=0&&t<duration);
    if(times.some(t=>!Number.isFinite(t)||t<0||t>=duration))throw new RangeError('Preview time must fall within the scene');
    for(let i=0;i<times.length;i++){
      const frame=await capture.frame(times[i]);
      const name=mode==='preview'?'preview.png':`storyboard-${String(i+1).padStart(2,'0')}.png`;
      await writeFile(join(output,name),pngOf(frame));
      telemetry.push({timeS:frame.timeS,image:name,renderer:frame.renderer,scene:frame.scene});
      console.log(JSON.stringify({image:name,timeS:frame.timeS,elapsedS:(Date.now()-started)/1000,renderer:frame.renderer}));
    }
    evidence.frames=times.length;
  }else{
    const audio=await readFile(audioPath);
    if(audio.length<44||audio.toString('ascii',0,4)!=='RIFF'||audio.toString('ascii',8,12)!=='WAVE')throw new Error('Procedural dialogue audio must be a WAV file');
    evidence.sourceAudioSha256=sha256(audio);
    const silent=join(output,'winter-tea-silent.mp4'),mp4=join(output,'winter-tea-scene.mp4');
    const input=backend==='cpu'?['-f','rawvideo','-pixel_format','rgba','-video_size',`${width}x${height}`]:['-f','image2pipe','-vcodec','png'];
    encoder=spawn('ffmpeg',['-y','-hide_banner','-loglevel','error',...input,'-framerate',String(fps),'-i','pipe:0','-an','-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',silent],{stdio:['pipe','inherit','inherit']});
    const completed=once(encoder,'exit');completed.catch(()=>{});
    let encoderError;
    encoder.once('error',error=>{encoderError=error;});encoder.stdin.on('error',error=>{encoderError=error;});
    const posterFrame=Math.round(Math.min(duration-.1,10.8)*fps);
    for(let index=0;index<frameCount;index++){
      const frame=await capture.frame(index/fps);
      if(encoderError)throw encoderError;
      if(!encoder.stdin.write(frame.bytes))await once(encoder.stdin,'drain');
      if(index===posterFrame)await writeFile(join(output,'poster.png'),pngOf(frame));
      if(index%15===0||index===frameCount-1)telemetry.push({frame:index,timeS:frame.timeS,renderer:frame.renderer,scene:frame.scene});
      if(index%30===0)console.log(JSON.stringify({frame:index,total:frameCount,timeS:frame.timeS,elapsedS:(Date.now()-started)/1000}));
    }
    encoder.stdin.end();const [code]=await completed;if(code!==0)throw new Error('Video encoder failed: '+code);encoder=undefined;
    // The closing reaction and sip remain visible after the final spoken words.
    await run('ffmpeg',['-y','-hide_banner','-loglevel','error','-i',silent,'-i',audioPath,'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','224k','-af','apad','-t',String(duration),'-movflags','+faststart',mp4]);
    await unlink(silent);
    evidence.frames=frameCount;evidence.outputSha256=sha256(await readFile(mp4));evidence.output=mp4;
  }
  evidence.renderSeconds=(Date.now()-started)/1000;
  await writeFile(join(output,`${mode}-evidence.json`),JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify({...evidence,telemetry:undefined},null,2));
}finally{
  if(encoder){encoder.stdin.destroy();encoder.kill();}
  await capture.close();
}
