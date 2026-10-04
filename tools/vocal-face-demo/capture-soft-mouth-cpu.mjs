#!/usr/bin/env node
import {mkdir,writeFile,unlink} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {
  Scene,CpuRenderer,encodePng,SoftVocalFaceRig,softVocalFaceSceneSpec,
  physicalDialogueScoreA,sampleArticulatorScore,renderArticulatedVocalTract,
  DIALOGUE_VOICE_A,wavBytes,sampleSoftMouthMotorPlan,SOFT_MOUTH_MOTOR_LEAD_S,
} from '../../dist/index.js';

const out='artifacts/soft-mouth';await mkdir(out,{recursive:true});
const width=960,height=540,fps=30,duration=5.5,frames=Math.ceil(duration*fps);
const source=physicalDialogueScoreA();
const score=Object.freeze(source.filter(g=>g.startS<duration).map(g=>Object.freeze({...g,endS:Math.min(g.endS,duration)})));
const spec=softVocalFaceSceneSpec();
spec.camera={position:[0,1.45,2.10],target:[0,1.34,.52],fov:30,focusDistance:1.6,aperture:.012};
const scene=new Scene(spec),rig=new SoftVocalFaceRig(scene),renderer=new CpuRenderer({width,height});

const silent=out+'/perioral-silent.mp4';
const encoder=spawn('ffmpeg',['-y','-hide_banner','-loglevel','error','-f','image2pipe','-vcodec','png','-framerate',String(fps),'-i','pipe:0','-an','-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',silent],{stdio:['pipe','inherit','inherit']});
const completed=once(encoder,'exit'),telemetry=[];
let maxPen=0,maxRemaining=0,maxKinetic=0,maxGap=0,minGap=Infinity;

for(let frame=0;frame<frames;frame++){
  const time=frame/fps,sample=sampleArticulatorScore(score,Math.min(time,duration-1e-6));
  const plan=sampleSoftMouthMotorPlan(score,Math.min(time,duration-1e-6),SOFT_MOUTH_MOTOR_LEAD_S);
  const state=rig.step(sample.articulators,1/fps,plan),d=state.mouth;
  maxPen=Math.max(maxPen,d.maxContactPenetrationM);maxRemaining=Math.max(maxRemaining,d.remainingToothPenetrationM);
  maxKinetic=Math.max(maxKinetic,d.kineticEnergyJ);maxGap=Math.max(maxGap,d.mouthGapM);minGap=Math.min(minGap,d.mouthGapM);
  renderer.render(scene,scene.camera);
  const png=encodePng(renderer.framebuffer(),width,height);
  if(!encoder.stdin.write(png))await once(encoder.stdin,'drain');
  if(frame===Math.floor(frames*.55))await writeFile(out+'/poster.png',png);
  if(frame%6===0)telemetry.push({time,pose:state.pose,mouth:d,tongue:state.tongue,articulators:sample.articulators});
}
encoder.stdin.end();const [videoCode]=await completed;if(videoCode!==0)throw new Error('video encoder failed '+videoCode);

const voice=renderArticulatedVocalTract(score,{sampleRate:48_000,tractLengthM:DIALOGUE_VOICE_A.tractLengthM,seed:1103},'continuous perioral soft-face proof');
const wav=out+'/voice.wav';await writeFile(wav,wavBytes(voice.audio));
const mp4=out+'/continuous-perioral-soft-face.mp4';
const mux=spawn('ffmpeg',['-y','-hide_banner','-loglevel','error','-i',silent,'-i',wav,'-c:v','copy','-c:a','aac','-b:a','224k','-shortest','-movflags','+faststart',mp4],{stdio:'inherit'});
const [muxCode]=await once(mux,'exit');if(muxCode!==0)throw new Error('mux failed '+muxCode);
await Promise.all([unlink(silent),unlink(wav)]);

const stats=renderer.inspect(),d=rig.mouth.diagnostics;
await writeFile(out+'/evidence.json',JSON.stringify({
  duration,frames,fps,renderer:stats,voice:voice.diagnostics,
  tongue:rig.tongue.diagnostics,
  perioral:{
    nodes:d.nodes,constraints:d.constraints,surfaceVertices:d.surfaceVertices,
    apertureBoundaryNodes:d.apertureBoundaryNodes,outerAttachmentNodes:d.outerAttachmentNodes,
    cheekNodes:d.cheekNodes,chinNodes:d.chinNodes,
    maxTrialToothPenetrationM:maxPen,maxRemainingToothPenetrationM:maxRemaining,
    maxKineticEnergyJ:maxKinetic,minGapM:minGap,maxGapM:maxGap,
  },
  telemetry,
},null,2));
console.log(JSON.stringify({mp4,duration,frames,perioral:{nodes:d.nodes,constraints:d.constraints,surfaceVertices:d.surfaceVertices,maxPen,maxRemaining,maxKinetic,minGap,maxGap}},null,2));
