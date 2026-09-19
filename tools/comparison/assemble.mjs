import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {renderAudio,wavBytes} from '../../dist/audio/synth.js';
const root=fileURLToPath(new URL('../../',import.meta.url)),out=join(root,'artifacts/comparison');
const clips=[
 {name:'intro',duration:6,text:'Эмерджентная физика. Сначала старая версия, затем исправленная. Сравните движение и звук.'},
 {name:'fracture-before',duration:9,sim:2,text:'Раньше пол обходил закон разрушения стекла.'},
 {name:'fracture-after',duration:9,sim:2,text:'Теперь работает закон разрушения стекла.'},
 {name:'momentum-before',duration:9,sim:2.2,text:'Раньше осколки теряли движение исходного тела.'},
 {name:'momentum-after',duration:9,sim:2.2,text:'Теперь осколки сохраняют движение тела.'},
 {name:'friction-before',duration:9,sim:3.3,text:'Раньше разное трение давало одинаковый результат.'},
 {name:'friction-after',duration:9,sim:3.3,text:'Разное трение меняет пройденный путь.'},
 {name:'outro',duration:6,text:'Материал определяет разрушение. Импульс сохраняется. Трение меняет движение.'},
];
async function run(binary,args){await new Promise((resolve,reject)=>{const child=spawn(binary,args,{stdio:'inherit'});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`${binary}: ${code}`)));});}
await mkdir(out,{recursive:true});
const mode=process.argv[2]??'all';
if(mode==='voices'||mode==='all')for(const clip of clips){
 await writeFile(join(out,`${clip.name}-narration.txt`),clip.text+'\n');
 await run('say',['-v','Milena','-r',clip.name==='intro'||clip.name==='outro'?'205':'185','-f',join(out,`${clip.name}-narration.txt`),'-o',join(out,`${clip.name}-voice.aiff`)]);
}
if(mode==='voices')process.exit(0);
for(const clip of clips){
 const rawEvents=clip.sim?JSON.parse(await readFile(join(out,`${clip.name}-events.json`),'utf8')):[];
 const events=rawEvents.map(event=>({...event,time:2.6+event.time/(clip.sim/4.5)}));
 await writeFile(join(out,`${clip.name}-fx.wav`),wavBytes(renderAudio(events,clip.duration)));
 await run('ffmpeg',['-y','-hide_banner','-loglevel','error','-i',join(out,`${clip.name}-silent.mp4`),'-i',join(out,`${clip.name}-fx.wav`),'-i',join(out,`${clip.name}-voice.aiff`),'-filter_complex',`[1:a]volume=0.72[sfx];[2:a]loudnorm=I=-19:TP=-3:LRA=7,aresample=48000,adelay=140|140,apad,atrim=duration=${clip.duration}[voice];[sfx][voice]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.95:level=false,afade=t=out:st=${clip.duration-.16}:d=0.16[a]`,'-map','0:v','-map','[a]','-c:v','copy','-c:a','aac','-b:a','192k','-ar','48000','-ac','2','-t',String(clip.duration),'-movflags','+faststart',join(out,`${clip.name}.mp4`)]);
 console.log('mixed',clip.name);
}
await writeFile(join(out,'concat.txt'),clips.map(clip=>`file '${clip.name}.mp4'`).join('\n')+'\n');
await run('ffmpeg',['-y','-hide_banner','-loglevel','error','-f','concat','-safe','0','-i',join(out,'concat.txt'),'-c','copy','-movflags','+faststart',join(out,'emergent-physics-before-after-1080p.mp4')]);
let start=0;const chapters=clips.map(clip=>{const result={...clip,start,end:start+clip.duration};start=result.end;return result;});
await writeFile(join(out,'chapters.json'),JSON.stringify(chapters,null,2));
await writeFile(join(out,'fx-concat.txt'),clips.map(clip=>`file '${clip.name}-fx.wav'`).join('\n')+'\n');
await run('ffmpeg',['-y','-hide_banner','-loglevel','error','-i',join(out,'emergent-physics-before-after-1080p.mp4'),'-f','concat','-safe','0','-i',join(out,'fx-concat.txt'),'-map','0:v','-map','1:a','-af','volume=0.72,alimiter=limit=0.95:level=false','-c:v','copy','-c:a','aac','-b:a','192k','-ar','48000','-ac','2','-t','66','-movflags','+faststart',join(out,'emergent-physics-effects-only-1080p.mp4')]);
console.log(join(out,'emergent-physics-before-after-1080p.mp4'));
