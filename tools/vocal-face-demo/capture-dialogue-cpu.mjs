#!/usr/bin/env node
import {mkdir,writeFile,unlink} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {
  Scene,CpuRenderer,encodePng,VocalFaceRig,vocalFaceSceneSpec,
  physicalDialogueScoreA,physicalDialogueScoreB,sampleArticulatorScore,
  synthesizePhysicalDialogue,wavBytes,PHYSICAL_DIALOGUE_SCRIPT,
} from '../../dist/index.js';

const out='artifacts/physical-dialogue';await mkdir(out,{recursive:true});
const halfWidth=480,height=540,width=halfWidth*2,fps=30;
const scoreA=physicalDialogueScoreA(),scoreB=physicalDialogueScoreB(),duration=Math.max(scoreA.at(-1).endS,scoreB.at(-1).endS),frames=Math.ceil(duration*fps);

const specA=vocalFaceSceneSpec(),specB=vocalFaceSceneSpec();
specA.camera={...specA.camera,position:[.12,1.64,3.25],target:[.05,1.60,.25],fov:30};
specB.camera={...specB.camera,position:[-.12,1.64,3.25],target:[-.05,1.60,.25],fov:30};
const tintIds=new Set(['vocal-face-shoulders','vocal-face-neck','vocal-face-head','vocal-face-jaw','vocal-face-left-ear','vocal-face-right-ear','vocal-face-nose-bridge','vocal-face-nose-dorsum','vocal-face-nose-tip','vocal-face-nose-left-ala','vocal-face-nose-right-ala']);
for(const e of specB.entities)if(tintIds.has(e.id)&&e.material?.color)e.material={...e.material,color:[.54,.34,.28,1]};

const sceneA=new Scene(specA),sceneB=new Scene(specB),rigA=new VocalFaceRig(sceneA),rigB=new VocalFaceRig(sceneB);
const rendererA=new CpuRenderer({width:halfWidth,height}),rendererB=new CpuRenderer({width:halfWidth,height});

const joined=new Uint8Array(width*height*4);
const joinFrames=(a,b)=>{
  for(let y=0;y<height;y++){
    const aStart=y*halfWidth*4,bStart=y*halfWidth*4,oStart=y*width*4;
    joined.set(a.subarray(aStart,aStart+halfWidth*4),oStart);
    joined.set(b.subarray(bStart,bStart+halfWidth*4),oStart+halfWidth*4);
    const divider=(oStart+halfWidth*4);
    for(let dx=-2;dx<=1;dx++){const i=divider+dx*4;if(i>=oStart&&i<oStart+width*4){joined[i]=34;joined[i+1]=38;joined[i+2]=44;joined[i+3]=255;}}
  }
  return joined;
};

const speaking=(sample)=>sample.lungPressurePa>300||sample.voiced>.15;
const setPresence=(scene,on)=>{
  const key=scene.entities.get('vocal-face-key-light'),fill=scene.entities.get('vocal-face-fill-light');
  if(key?.light)key.light.intensity=on?20:10;
  if(fill?.light)fill.light.intensity=on?9:5;
};

const silent=out+'/dialogue-silent.mp4';
const encoder=spawn('ffmpeg',['-y','-hide_banner','-loglevel','error','-f','image2pipe','-vcodec','png','-framerate',String(fps),'-i','pipe:0','-an','-c:v','libx264','-preset','medium','-crf','19','-pix_fmt','yuv420p','-movflags','+faststart',silent],{stdio:['pipe','inherit','inherit']});
const completed=once(encoder,'exit'),telemetry=[];

for(let frame=0;frame<frames;frame++){
  const time=frame/fps;
  const sampleA=sampleArticulatorScore(scoreA,Math.min(time,duration)),sampleB=sampleArticulatorScore(scoreB,Math.min(time,duration));
  const poseA=rigA.step(sampleA.articulators,1/fps),poseB=rigB.step(sampleB.articulators,1/fps);
  setPresence(sceneA,speaking(sampleA));setPresence(sceneB,speaking(sampleB));
  rendererA.render(sceneA,sceneA.camera);rendererB.render(sceneB,sceneB.camera);
  const rgba=joinFrames(rendererA.framebuffer(),rendererB.framebuffer()),png=encodePng(rgba,width,height);
  if(!encoder.stdin.write(png))await once(encoder.stdin,'drain');
  if(frame===Math.floor(frames*.57))await writeFile(out+'/poster.png',png);
  if(frame%15===0)telemetry.push({time,poseA,poseB,sampleA:{pitchHz:sampleA.pitchHz,pressurePa:sampleA.lungPressurePa,voiced:sampleA.voiced},sampleB:{pitchHz:sampleB.pitchHz,pressurePa:sampleB.lungPressurePa,voiced:sampleB.voiced}});
}
encoder.stdin.end();const [videoCode]=await completed;if(videoCode!==0)throw new Error('video encoder failed '+videoCode);

const dialogue=synthesizePhysicalDialogue(48_000),wav=out+'/dialogue.wav';
await writeFile(wav,wavBytes(dialogue.audio));
const mp4=out+'/two-people-funny-dialogue.mp4';
const mux=spawn('ffmpeg',['-y','-hide_banner','-loglevel','error','-i',silent,'-i',wav,'-c:v','copy','-c:a','aac','-b:a','224k','-shortest','-movflags','+faststart',mp4],{stdio:'inherit'});
const [muxCode]=await once(mux,'exit');if(muxCode!==0)throw new Error('mux failed '+muxCode);
await Promise.all([unlink(silent),unlink(wav)]);

const statsA=rendererA.inspect(),statsB=rendererB.inspect();
if(statsA.errors.length||statsB.errors.length)throw new Error('dialogue renderer errors '+JSON.stringify({statsA,statsB}));
await writeFile(out+'/evidence.json',JSON.stringify({duration,frames,fps,script:PHYSICAL_DIALOGUE_SCRIPT,statsA,statsB,voiceA:dialogue.speakerA,voiceB:dialogue.speakerB,telemetry},null,2));
console.log(JSON.stringify({mp4,duration,frames,statsA,statsB},null,2));
