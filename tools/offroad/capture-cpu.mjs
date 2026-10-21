import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Scene,CpuRenderer,encodePng} from '../../dist/index.js';
import spec from './scene.mjs';

const width=Number(process.env.OFFROAD_VIDEO_WIDTH??960),height=Number(process.env.OFFROAD_VIDEO_HEIGHT??540),fps=Number(process.env.OFFROAD_VIDEO_FPS??20),duration=Number(process.env.OFFROAD_VIDEO_DURATION??6),out=resolve(process.env.OFFROAD_VIDEO_OUTPUT??'artifacts/offroad-cpu.mp4');
if(![width,height,fps,duration].every(Number.isFinite)||!Number.isInteger(width)||!Number.isInteger(height)||!Number.isInteger(fps)||width<1||height<1||fps<1||fps>60||duration<=0||duration>30)throw new RangeError('Invalid offroad CPU capture settings');
await mkdir(resolve('artifacts'),{recursive:true});
const scene=new Scene(spec),renderer=new CpuRenderer({width,height}),frames=Math.round(duration*fps),simDt=1/60;
const encoder=spawn('ffmpeg',['-y','-hide_banner','-loglevel','error','-f','image2pipe','-vcodec','png','-framerate',String(fps),'-i','pipe:0','-an','-c:v','libx264','-preset','veryfast','-crf','19','-pix_fmt','yuv420p','-movflags','+faststart',out],{stdio:['pipe','inherit','inherit']});
const done=once(encoder,'exit');
let target=0;
for(let frame=0;frame<frames;frame++){
  target=frame/fps;
  while(scene.time+1e-9<target)scene.step(Math.min(simDt,target-scene.time));
  const car=scene.entities.get('offroad');
  if(car)scene.setCamera({position:[car.position[0]-6,car.position[1]+2.7,6.8],target:[car.position[0]+.8,car.position[1]+.15,0],fov:45});
  renderer.render(scene,scene.camera);
  const png=encodePng(renderer.framebuffer(),width,height);
  if(!encoder.stdin.write(png))await once(encoder.stdin,'drain');
  if(frame%20===0)console.log(JSON.stringify({frame,frames,time:scene.time,camera:scene.camera,car:scene.entities.get('offroad')?.position}));
}
encoder.stdin.end();const [code]=await done;if(code!==0)throw new Error('ffmpeg exit '+code);
console.log(JSON.stringify({out,width,height,fps,duration,frames,renderer:renderer.inspect()},null,2));
