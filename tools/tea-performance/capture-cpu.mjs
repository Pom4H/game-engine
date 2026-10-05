import {mkdir,readFile,writeFile,unlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {resolve,join} from 'node:path';
import {CpuRenderer,encodePng} from '../../dist/index.js';
import {createTeaPerformance} from './scene.mjs';
import {createTeaPerformancePlan} from './plan.mjs';

const width=Number(process.env.TEA_WIDTH??640),height=Number(process.env.TEA_HEIGHT??360),fps=Number(process.env.TEA_FPS??15);
if(![10,12,15,20,30].includes(fps)||!Number.isInteger(width)||!Number.isInteger(height)||width%2||height%2)throw new RangeError('Invalid capture geometry/cadence');
const out=resolve(process.env.TEA_OUTPUT??'artifacts/tea-performance-vtl');
const planPath=resolve(process.env.TEA_PLAN??out+'/plan.json'),audioPath=resolve(process.env.TEA_AUDIO??out+'/dialogue.wav');
await mkdir(out,{recursive:true});
const planBytes=await readFile(planPath),vtlPlan=JSON.parse(planBytes.toString('utf8')),audio=await readFile(audioPath);
const motorPlan=createTeaPerformancePlan();
if(vtlPlan.turns.length!==motorPlan.turns.length)throw new Error('VTL and face motor plans disagree on turn count');
for(let i=0;i<motorPlan.turns.length;i++){
  const a=motorPlan.turns[i],b=vtlPlan.turns[i];
  if(a.id!==b.id||a.speakerId!==b.speakerId||a.text!==b.text||Math.abs(a.startS-b.startS)>1e-9)throw new Error('VTL and face motor timelines diverged at '+a.id);
  const da=a.segments.reduce((n,s)=>n+s.durationS,0),db=b.segments.reduce((n,s)=>n+s.durationS,0);
  if(Math.abs(da-db)>1e-9)throw new Error('VTL phone translation changed duration at '+a.id);
}
if(audio.toString('ascii',0,4)!=='RIFF'||audio.toString('ascii',8,12)!=='WAVE')throw new Error('VTL dialogue must be WAV');
const sha=b=>createHash('sha256').update(b).digest('hex');

const play=createTeaPerformance({plan:motorPlan}),renderer=new CpuRenderer({width,height});play.step(0,0);
const duration=play.duration,frames=Math.ceil(duration*fps),silent=join(out,'tea-vtl-silent.mp4'),output=join(out,'tea-vtl-scene.mp4');
const encoder=spawn('ffmpeg',['-y','-v','error','-f','rawvideo','-pixel_format','rgba','-video_size',width+'x'+height,'-framerate',String(fps),'-i','pipe:0','-an','-c:v','libx264','-preset','fast','-crf','19','-pix_fmt','yuv420p','-movflags','+faststart',silent],{stdio:['pipe','inherit','inherit']});
const done=once(encoder,'exit');done.catch(()=>{});let error;encoder.once('error',e=>error=e);encoder.stdin.on('error',e=>error=e);
let tick=0;const telemetry=[];const started=Date.now();
try{
  for(let i=0;i<frames;i++){
    const target=Math.round(i/fps*60);while(tick<target){tick++;play.step(tick/60,1/60);}
    renderer.render(play.scene,play.scene.camera);const stats=renderer.inspect();
    if(stats.errors.length||stats.drawCalls<1)throw new Error('CPU render failed '+JSON.stringify(stats));
    const rgba=renderer.framebuffer();if(error)throw error;if(!encoder.stdin.write(rgba))await once(encoder.stdin,'drain');
    if(i===Math.round(19.3*fps))await writeFile(out+'/poster.png',encodePng(rgba,width,height));
    if(i%Math.max(1,fps*2)===0)telemetry.push({frame:i,timeS:tick/60,shot:play.inspect().shot,renderer:stats});
    if(i%Math.max(1,fps*5)===0)console.log(JSON.stringify({frame:i,frames,timeS:tick/60,elapsedS:(Date.now()-started)/1000}));
  }
  encoder.stdin.end();const [code]=await done;if(code!==0)throw new Error('ffmpeg encode failed '+code);
  const mux=spawn('ffmpeg',['-y','-v','error','-i',silent,'-i',audioPath,'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','224k','-af','apad','-t',String(duration),'-movflags','+faststart',output],{stdio:'inherit'});
  const [muxCode]=await once(mux,'exit');if(muxCode!==0)throw new Error('ffmpeg mux failed '+muxCode);
  await unlink(silent);
  const evidence={schemaVersion:1,sourceCommit:process.env.GITHUB_SHA??null,videoBackend:'cpu',audioBackend:'VocalTractLab',width,height,fps,durationS:duration,frames,
    vtlPlanSha256:sha(planBytes),motorPlanSha256:sha(Buffer.from(JSON.stringify(motorPlan))),audioSha256:sha(audio),videoSha256:sha(await readFile(output)),telemetry};
  await writeFile(out+'/video-evidence.json',JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify({...evidence,telemetry:undefined}));
}finally{renderer.dispose();if(encoder.exitCode===null){encoder.stdin.destroy();encoder.kill();}}
