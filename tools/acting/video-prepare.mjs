import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {VIDEO_LINES,createActingVideo} from './video-scene.mjs';
const out=resolve(process.env.ACTING_VIDEO_OUT??'artifacts/acting-video');await mkdir(out,{recursive:true});
const run=(exe,args)=>{const r=spawnSync(exe,args,{encoding:'utf8'});if(r.status!==0)throw new Error(r.stderr||r.stdout||String(r.error));return r.stdout;};
const lines=VIDEO_LINES.map((line,i)=>({...line,path:join(out,`line-${i}.wav`),rate:line.speakerId==='anna'?1:-1}));
const raw=join(out,'speech-input.json');await writeFile(raw,JSON.stringify(lines));
run('powershell.exe',['-NoProfile','-File',resolve('tools/acting/video-speech.ps1'),'-PlanPath',raw]);
const visemePhone=['','a','a','O','E','6','i','u','o','aU','OY','aI','h','r','l','s','S','T','f','t','k','m'];
let start=1.1;const turns=[];
for(let i=0;i<lines.length;i++){
 const line=lines[i],duration=Number(run('ffprobe',['-v','error','-show_entries','format=duration','-of','csv=p=0',line.path]).trim());
 const points=JSON.parse(await readFile(line.path+'.visemes.json','utf8')).sort((a,b)=>a.atS-b.atS);
 if(points.length<4)throw new Error('Speech backend produced no usable viseme timing');
 // SAPI's position units can differ from the chosen WAV output format/rate.
 // Fit the ordered mouth events to the measured utterance duration explicitly.
 const clockScale=duration/(points.at(-1).atS+points.at(-1).durationS);for(const point of points){point.atS*=clockScale;point.durationS*=clockScale;}
 const segments=[];if(points[0].atS>0)segments.push({phone:'',durationS:points[0].atS});
 for(let j=0;j<points.length;j++){const end=Math.min(duration,points[j+1]?.atS??duration),d=end-points[j].atS;if(d>.00001)segments.push({phone:visemePhone[points[j].viseme]??'',durationS:d});}
 const turn={...VIDEO_LINES[i],id:'line-'+i,startS:start,endS:start+duration,segments,pitch:[{timeS:0,hz:line.speakerId==='anna'?198:172}],durationS:duration,visemeClockScale:clockScale};turns.push(turn);start=turn.endS+.55;
}
const plan={version:1,duration:start+4,turns,audio:'Microsoft Irina Desktop, offline Windows speech; VisemeReached events rescaled to each measured WAV duration and mapped approximately to the existing face rig',syntheticScenarioReceipts:true};
await writeFile(join(out,'plan.json'),JSON.stringify(plan,null,2));
const inputs=lines.flatMap(l=>['-i',l.path]),filters=turns.map((t,i)=>`[${i}:a]aresample=48000,adelay=${Math.round(t.startS*1000)}:all=1[a${i}]`);
filters.push(turns.map((_,i)=>`[a${i}]`).join('')+`amix=inputs=${turns.length}:normalize=0,apad,atrim=duration=${plan.duration}[mix]`);
run('ffmpeg',['-y','-hide_banner','-loglevel','error',...inputs,'-filter_complex',filters.join(';'),'-map','[mix]','-c:a','pcm_s16le',join(out,'dialogue.wav')]);
// Exercise the actual Scene, reducer and both face/animation clocks before GPU capture.
const play=createActingVideo(plan);for(let tick=1;tick<=Math.ceil(plan.duration*60);tick++)play.step(tick/60,1/60);const state=play.inspect();
if(!state.lampOn||state.events.length!==3||state.actors[0].sentiment.benevolence<=.5)throw new Error('Scenario failed to publish the expected outcomes');
await writeFile(join(out,'scenario-check.json'),JSON.stringify(state,null,2));play.dispose();
console.log(JSON.stringify({out,duration:plan.duration,lines:turns.map(t=>({speaker:t.speakerId,text:t.text,startS:t.startS,endS:t.endS,phones:t.segments.length})),finalSentiment:state.actors[0].sentiment}));
