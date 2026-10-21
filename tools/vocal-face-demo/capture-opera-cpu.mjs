#!/usr/bin/env node
import {mkdir,writeFile,unlink} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {
  Scene,CpuRenderer,encodePng,VocalFaceRig,vocalFaceSceneSpec,
  originalOperaScore,sampleArticulatorScore,synthesizeOriginalOpera,wavBytes,
} from '../../dist/index.js';

const out='artifacts/opera-vocal-face';await mkdir(out,{recursive:true});
const width=960,height=540,fps=30,score=originalOperaScore(),duration=score.at(-1).endS,frames=Math.ceil(duration*fps);
const scene=new Scene(vocalFaceSceneSpec()),rig=new VocalFaceRig(scene),renderer=new CpuRenderer({width,height});
const silent=out+'/opera-silent.mp4';
const encoder=spawn('ffmpeg',['-y','-hide_banner','-loglevel','error','-f','image2pipe','-vcodec','png','-framerate',String(fps),'-i','pipe:0','-an','-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',silent],{stdio:['pipe','inherit','inherit']});
const completed=once(encoder,'exit'),telemetry=[];
for(let frame=0;frame<frames;frame++){
  const time=frame/fps,sample=sampleArticulatorScore(score,time),pose=rig.step(sample.articulators,1/fps);
  renderer.render(scene,scene.camera);
  const png=encodePng(renderer.framebuffer(),width,height);
  if(!encoder.stdin.write(png))await once(encoder.stdin,'drain');
  if(frame===Math.floor(frames*.58))await writeFile(out+'/poster.png',png);
  if(frame%6===0)telemetry.push({time,pose,pressurePa:sample.lungPressurePa,pitchHz:sample.pitchHz,vibratoHz:sample.vibratoHz});
}
encoder.stdin.end();const [videoCode]=await completed;if(videoCode!==0)throw new Error('video encoder failed '+videoCode);

const voice=synthesizeOriginalOpera({sampleRate:48_000,seed:77}),wav=out+'/voice.wav';
await writeFile(wav,wavBytes(voice.audio));
const mp4=out+'/original-opera-full-voice.mp4';
const mux=spawn('ffmpeg',['-y','-hide_banner','-loglevel','error','-i',silent,'-i',wav,'-c:v','copy','-c:a','aac','-b:a','224k','-shortest','-movflags','+faststart',mp4],{stdio:'inherit'});
const [muxCode]=await once(mux,'exit');if(muxCode!==0)throw new Error('mux failed '+muxCode);
await Promise.all([unlink(silent),unlink(wav)]);
const stats=renderer.inspect();
if(stats.errors.length||stats.drawCalls<=0)throw new Error('opera face render failed '+JSON.stringify(stats));
await writeFile(out+'/evidence.json',JSON.stringify({fps,duration,frames,renderer:stats,voice:voice.diagnostics,telemetry},null,2));
console.log(JSON.stringify({mp4,duration,frames,renderer:stats},null,2));
