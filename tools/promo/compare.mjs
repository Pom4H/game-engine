// Sequential authentic-engine comparison: previous take, then revised take.
// Both audio inputs are the corresponding world-only WAVs, without the score.
import {access,mkdtemp,mkdir,writeFile,rename,rm} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const root=fileURLToPath(new URL('../../',import.meta.url)),out=join(root,'artifacts/promo-v3');
const inputs={
 v2:{video:join(root,'artifacts/promo-v2/game-engine-winter-promo-1080p.mp4'),audio:join(root,'artifacts/promo-v2/winter-street-sounds.wav'),label:'V2 · ПРЕДЫДУЩАЯ ВЕРСИЯ / ДО ДОРАБОТКИ'},
 v3:{video:join(out,'game-engine-winter-promo-1080p.mp4'),audio:join(out,'winter-street-sounds.wav'),label:'V3 · НОВАЯ ВЕРСИЯ / СИСТЕМЫ ДВИЖКА'},
};
const subjects=[
 {id:'m3',start:10,end:16,label:'BMW M3 · МОКРАЯ ДОРОГА И ЗВУК ШИН'},
 {id:'walker',start:18,end:24,label:'ПЕШЕХОД · ПОХОДКА, МАТЕРИАЛЫ И СНЕГ'},
 {id:'footprints',start:24,end:30,label:'КОНТАКТ СТОПЫ · РЕЛЬЕФ СНЕГА И ХРУСТ'},
];
const segments=subjects.flatMap((subject,pair)=>['v2','v3'].map((version,side)=>({index:pair*2+side,subject:subject.id,version,sourceStartSeconds:subject.start,sourceEndSeconds:subject.end,outputStartSeconds:(pair*2+side)*6,outputEndSeconds:(pair*2+side+1)*6,label:inputs[version].label,description:subject.label})));
const output=join(out,'engine-before-after-1080p.mp4'),metadataPath=join(out,'engine-before-after-metadata.json');
const run=(command,args,capture=false)=>new Promise((resolve,reject)=>{
 const child=spawn(command,args,{stdio:capture?['ignore','pipe','pipe']:['ignore','inherit','inherit']});let stdout='',stderr='';
 if(capture){child.stdout.on('data',d=>{stdout+=d;});child.stderr.on('data',d=>{stderr+=d;});}
 child.on('error',reject);child.on('exit',code=>code===0?resolve(stdout):reject(new Error(`${command} exited ${code}${stderr?`: ${stderr.trim()}`:''}`)));
});
const probe=async path=>JSON.parse(await run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',path],true));
const fingerprint=async path=>{const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return{path,sha256:hash.digest('hex')};};
const filterPath=value=>`'${value.replaceAll('\\','\\\\').replaceAll("'","'\\''")}'`;
async function main(){
 if(process.argv.length>2)throw new Error('Usage: node tools/promo/compare.mjs');
 const missing=[];for(const input of Object.values(inputs))for(const path of [input.video,input.audio])try{await access(path);}catch{missing.push(path);}
 if(missing.length)throw new Error(`Comparison requires completed V2 and V3 video and world-only audio. Missing:\n${missing.join('\n')}`);
 let font;for(const candidate of ['/System/Library/Fonts/Supplemental/Arial.ttf','/System/Library/Fonts/Helvetica.ttc','/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'])try{await access(candidate);font=candidate;break;}catch{}
 if(!font)throw new Error('A local font with Cyrillic glyphs is required (Arial, Helvetica or DejaVu Sans).');
 const sourceMetadata={};for(const [version,input] of Object.entries(inputs)){
  const [video,audio]=await Promise.all([probe(input.video),probe(input.audio)]),v=video.streams.find(s=>s.codec_type==='video'),a=audio.streams.find(s=>s.codec_type==='audio');
  if(v?.width!==1920||v?.height!==1080||Math.abs(Number(video.format.duration)-48)>.1||Number(audio.format.duration)<30||a?.channels!==2)throw new Error(`${version} sources must contain a completed 48 s 1080p promo and stereo world sound spanning all selected intervals.`);
  sourceMetadata[version]={video:await fingerprint(input.video),audio:await fingerprint(input.audio),videoDurationSeconds:Number(video.format.duration),audioDurationSeconds:Number(audio.format.duration)};
 }
 await mkdir(out,{recursive:true});const temporary=await mkdtemp(join(tmpdir(),'engine-comparison-'));
 const partial=join(out,'engine-before-after-1080p.partial.mp4');
 try{
  const clips=[];
  for(const segment of segments){
   const input=inputs[segment.version],header=join(temporary,`header-${segment.index}.txt`),description=join(temporary,`detail-${segment.index}.txt`),clip=join(temporary,`segment-${segment.index}.mkv`);
   await writeFile(header,segment.label,'utf8');await writeFile(description,segment.description,'utf8');
   const videoFilter=[
    'fps=30','format=yuv420p',
    'drawbox=x=0:y=0:w=iw:h=124:color=black@0.66:t=fill',
    `drawtext=fontfile=${filterPath(font)}:textfile=${filterPath(header)}:expansion=none:fontsize=30:fontcolor=${segment.version==='v3'?'0xEEDCB7':'white'}:x=48:y=24`,
    `drawtext=fontfile=${filterPath(font)}:textfile=${filterPath(description)}:expansion=none:fontsize=22:fontcolor=0xCBD6DE:x=48:y=76`,
   ].join(',');
   console.log(`Comparison ${segment.index+1}/6: ${segment.version} ${segment.subject} ${segment.sourceStartSeconds}–${segment.sourceEndSeconds} s`);
   await run('ffmpeg',['-y','-hide_banner','-loglevel','warning','-ss',String(segment.sourceStartSeconds),'-t','6','-i',input.video,'-ss',String(segment.sourceStartSeconds),'-t','6','-i',input.audio,'-map','0:v:0','-map','1:a:0','-vf',videoFilter,'-af','aresample=48000,aformat=channel_layouts=stereo,afade=t=in:st=0:d=0.08,afade=t=out:st=5.92:d=0.08','-t','6','-c:v','libx264','-preset','slow','-crf','17','-pix_fmt','yuv420p','-c:a','pcm_s16le','-ar','48000','-ac','2',clip]);
   clips.push(clip);
  }
  const edit=join(temporary,'comparison.ffconcat');await writeFile(edit,'ffconcat version 1.0\n'+clips.map(path=>`file '${path.replaceAll("'","'\\''")}'`).join('\n')+'\n');
  await run('ffmpeg',['-y','-hide_banner','-loglevel','warning','-f','concat','-safe','0','-i',edit,'-map','0:v:0','-map','0:a:0','-c:v','copy','-c:a','aac','-b:a','256k','-ar','48000','-ac','2','-movflags','+faststart','-t','36',partial]);
  const verification=await probe(partial),video=verification.streams.find(s=>s.codec_type==='video'),audio=verification.streams.find(s=>s.codec_type==='audio');
  if(video?.width!==1920||video?.height!==1080||Number(video.nb_frames)!==1080||video.avg_frame_rate!=='30/1'||audio?.channels!==2||Number(audio.sample_rate)!==48000||Math.abs(Number(verification.format.duration)-36)>.05)throw new Error(`Comparison verification failed: ${JSON.stringify(verification)}`);
  await run('ffmpeg',['-hide_banner','-v','error','-i',partial,'-f','null','-']);
  await rename(partial,output);
  const metadata={version:1,createdAt:new Date().toISOString(),title:'Зимняя улица: предыдущая версия и новая интеграция в движок',order:'Each subject shows the previous V2 take for 6 seconds, immediately followed by the revised V3 take for 6 seconds.',durationSeconds:36,width:1920,height:1080,fps:30,frames:1080,audio:{source:'Corresponding world-only WAV for each recorded version; no music',sampleRate:48000,channels:2,addedFadeSeconds:.08,additionalLoudnessNormalization:false},video:{source:'Previously captured WebGPU engine frames',addedTreatment:'Top captions only; direct cuts between takes'},sources:sourceMetadata,segments,output:await fingerprint(output),verification:{decoded:true,durationSeconds:Number(verification.format.duration),videoFrames:Number(video.nb_frames),audioChannels:audio.channels,sampleRate:Number(audio.sample_rate)}};
  await writeFile(metadataPath,JSON.stringify(metadata,null,2)+'\n');console.log(JSON.stringify({output,metadata:metadataPath,seconds:36,frames:1080}));
 }finally{await rm(temporary,{recursive:true,force:true});await rm(partial,{force:true});}
}
try{await main();}catch(error){console.error(error.message??String(error));process.exitCode=1;}
