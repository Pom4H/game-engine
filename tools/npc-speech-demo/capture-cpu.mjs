#!/usr/bin/env node
import {mkdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {
  Scene,CpuRenderer,encodePng,SoftVocalFaceRig,softVocalFaceSceneSpec,
  planNpcRussianSpeech,synthesizeNpcRussianSpeech,sampleArticulatorScore,
  sampleSoftMouthMotorPlan,SOFT_MOUTH_MOTOR_LEAD_S,wavBytes,
} from '../../dist/index.js';

export const NPC_DEMO_TEXT='Привет. Я говорю своим голосом.';

const out='artifacts/npc-speech';await mkdir(out,{recursive:true});
const width=960,height=540,fps=30,score=planNpcRussianSpeech(NPC_DEMO_TEXT),duration=score.at(-1).endS,frames=Math.ceil(duration*fps);
const spec=softVocalFaceSceneSpec();
spec.camera={position:[0,1.51,2.35],target:[0,1.46,.45],fov:31,focusDistance:1.9,aperture:.014};
const scene=new Scene(spec),rig=new SoftVocalFaceRig(scene),renderer=new CpuRenderer({width,height});

const silent=out+'/npc-silent.mp4';
const encoder=spawn('ffmpeg',['-y','-hide_banner','-loglevel','error','-f','image2pipe','-vcodec','png','-framerate',String(fps),'-i','pipe:0','-an','-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',silent],{stdio:['pipe','inherit','inherit']});
const completed=once(encoder,'exit'),telemetry=[];

for(let frame=0;frame<frames;frame++){
  const time=frame/fps,sample=sampleArticulatorScore(score,Math.min(time,duration-1e-6));
  const plan=sampleSoftMouthMotorPlan(score,Math.min(time,duration-1e-6),SOFT_MOUTH_MOTOR_LEAD_S);
  const state=rig.step(sample.articulators,1/fps,plan);
  renderer.render(scene,scene.camera);
  const png=encodePng(renderer.framebuffer(),width,height);
  if(!encoder.stdin.write(png))await once(encoder.stdin,'drain');
  if(frame===Math.floor(frames*.48))await writeFile(out+'/poster.png',png);
  if(frame%6===0)telemetry.push({time,pose:state.pose,mouth:state.mouth,tongue:state.tongue,articulators:sample.articulators});
}
encoder.stdin.end();const [videoCode]=await completed;if(videoCode!==0)throw new Error('video encoder failed '+videoCode);

const voice=synthesizeNpcRussianSpeech(NPC_DEMO_TEXT,{sampleRate:48_000,controlRateHz:240});
const wav=out+'/npc-russian.wav';await writeFile(wav,wavBytes(voice.audio));
const mp4=out+'/npc-russian-geometry-speech.mp4';
const mux=spawn('ffmpeg',['-y','-hide_banner','-loglevel','error','-i',silent,'-i',wav,'-c:v','copy','-c:a','aac','-b:a','224k','-shortest','-movflags','+faststart',mp4],{stdio:'inherit'});
const [muxCode]=await once(mux,'exit');if(muxCode!==0)throw new Error('mux failed '+muxCode);

const stats=renderer.inspect();
await writeFile(out+'/evidence.json',JSON.stringify({
  text:NPC_DEMO_TEXT,duration,frames,fps,renderer:stats,voice:voice.diagnostics,
  finalMouth:rig.mouth.diagnostics,finalTongue:rig.tongue.diagnostics,telemetry,
},null,2));
console.log(JSON.stringify({text:NPC_DEMO_TEXT,mp4,wav,duration,frames,geometryDriven:voice.diagnostics.geometryDriven},null,2));
