#!/usr/bin/env node
import {readFileSync,writeFileSync,mkdirSync,existsSync,appendFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {audioFeatures,checkRange,compareImages,decodeWav,imageFeatures,verifyGpuProfile} from './metrics.mjs';

const mode=process.argv[2];
if(!['cpu','gpu'].includes(mode))throw new Error('Usage: node tools/quality/gate.mjs cpu|gpu [--profile=hardware-name] [--strict-references]');
const strict=process.argv.includes('--strict-references');
const profileName=process.argv.find(x=>x.startsWith('--profile='))?.split('=')[1]??'windows-hardware-1080p';
const config=JSON.parse(readFileSync('quality/profiles.json','utf8'));
const sources=JSON.parse(readFileSync('quality/references.json','utf8'));
const sourceIds=new Set(sources.sources.map(x=>x.id));
if(sources.schema!==1||sources.sources.length<4||sourceIds.size!==sources.sources.length||sources.sources.some(x=>!/^https:\/\//.test(x.url)))throw new Error('Invalid reality-reference catalog');
const failures=[],unverified=[],results={};
const json=path=>JSON.parse(readFileSync(path,'utf8'));
const check=(domain,name,passed,detail='')=>{if(!passed)failures.push({domain,name,detail});return passed;};
const missing=(domain,name,reason)=>unverified.push({domain,name,reason});
const assess=(domain,checks)=>{for(const c of checks)check(domain,c.name,c.passed,'actual='+JSON.stringify(c.actual)+', limit='+JSON.stringify(c.limit));};

function physics(){
  const bench=json('artifacts/fps/physics-budget.json'),proof=json('artifacts/proving-ground/physics-report.json');
  const found=new Set(bench.samples.map(x=>x.id));
  check('physics','complete fixture coverage',found.size===config.physics.expectedFixtures.length&&config.physics.expectedFixtures.every(x=>found.has(x)));
  for(const item of bench.samples){
    check('physics',item.id+' replay fingerprint',/^[a-f0-9]{64}$/.test(item.fingerprint));
    check('physics',item.id+' physics budget',item.performance.medianMsPerTick<=config.physics.maxMedianTickMs,JSON.stringify(item.performance));
  }
  check('physics','independent experiment suite',proof.experiments.length>=config.physics.minimumExperiments);
  check('physics','causal energy proof',proof.requirements.some(x=>x.id==='energy-accounting'&&x.status==='available')&&proof.requirements.some(x=>x.id==='cause-provenance'&&x.status==='available'));
  if(!proof.releaseReady)missing('physics','proving-ground release coverage','Still missing: '+proof.missing.join(', '));
  results.physics={fixtures:bench.samples.map(x=>({id:x.id,hash:x.fingerprint,cpuMedianMs:x.performance.medianMsPerTick})),
    experimentCount:proof.experiments.length,releaseReady:proof.releaseReady,missingDomains:proof.missing};
}

function audio(){
  const settings=config.audio,captures=[];
  const isolated=json('artifacts/acoustic-demo/transfer.json').closed;
  const perfectlyIsolated=isolated.direct.gain===0&&isolated.reflections.length===0&&(isolated.late?.gain??0)===0;
  for(const file of settings.captures){
    const metrics=audioFeatures(decodeWav(readFileSync(file))),name=file.split('/').at(-1),rms=Math.max(...metrics.channels.map(x=>x.rms));
    const signalCheck=file.endsWith('/door-closed.wav')&&perfectlyIsolated
      ?checkRange(name+' correctly silent ideal boundary',rms,settings.minimumRms)
      :checkRange(name+' non-silent RMS',rms,settings.minimumRms,'min');
    assess('audio',[signalCheck,
      checkRange(name+' peak',metrics.peak,settings.maximumPeak),
      checkRange(name+' clipped fraction',metrics.clippedFraction,settings.maximumClippedFraction),
      checkRange(name+' DC',Math.max(...metrics.channels.map(x=>Math.abs(x.dc))),settings.maximumDcAbs)]);
    captures.push({file,...metrics});
  }
  const door=json('artifacts/acoustic-demo/transfer.json');
  check('audio','open/closed door attenuation',door.open.direct.gain>door.closed.direct.gain,
    'open='+door.open.direct.gain+' closed='+door.closed.direct.gain);
  const frames=json('artifacts/car-garage-audio/trajectory.json').transferFrames;
  check('audio','garage acoustic evolution',frames.length>=4&&new Set(frames.map(x=>Math.round(x.directGain*1000))).size>1);
  if(perfectlyIsolated)missing('audio','real wall transmission','Our ideal sealed-boundary experiment transmits no sound; real finite-transmission walls require measured material data.');
  if(!settings.externalReference)missing('audio','real-room agreement','Pin an AIR/BUT measurement with matching room and source/listener geometry; signal sanity does not prove realism.');
  results.audio={captures,doorAttenuationRatio:door.comparison.directGainRatio,garageSnapshots:frames.length,externalReference:settings.externalReference};
}

function rgb(file,width,height){
  const data=execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-i',file,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{maxBuffer:Math.max(32*1024*1024,width*height*6)});
  if(data.length!==width*height*3)throw new Error('Unexpected rendered image size: '+file);
  return data;
}
function render(){
  const settings=config.render,hud=json('artifacts/render-hud.json'),width=hud.resolution?.[0],height=hud.resolution?.[1],expected=settings.scenes.flatMap(x=>x.views),byName=new Map(hud.views.map(x=>[x.name,x]));
  check('image','required viewpoints',expected.every(v=>byName.has(v.name)));
  check('image','full HD resolution',width===1920&&height===1080,JSON.stringify(hud.resolution));
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1)return;
  const images=[];
  for(const view of expected){
    if(!byName.has(view.name))continue;
    check('image',view.name+' reference provenance',view.referenceIds.every(id=>sourceIds.has(id)));
    if(!existsSync(view.output)){check('image',view.name+' PNG exists',false);continue;}
    const pixels=rgb(view.output,width,height),features=imageFeatures(pixels,width,height);
    assess('image',[checkRange(view.name+' visual contrast',features.lumaStdDev,settings.minimumLumaStdDev,'min'),
      checkRange(view.name+' spatial detail',features.meanEdge,settings.minimumMeanEdge,'min'),
      checkRange(view.name+' black frame',features.blackFraction,settings.maximumBlackFraction),
      checkRange(view.name+' white frame',features.whiteFraction,settings.maximumWhiteFraction)]);
    let baselineMetrics=null;
    if(view.baseline){
      if(!view.baseline.file||!view.baseline.sha256||!existsSync(view.baseline.file))check('image',view.name+' approved baseline exists',false);
      else {
        const digest=createHash('sha256').update(readFileSync(view.baseline.file)).digest('hex');
        if(check('image',view.name+' approved baseline fingerprint',digest===view.baseline.sha256)){
          baselineMetrics=compareImages(rgb(view.baseline.file,width,height),pixels,width,height);
          assess('image',[checkRange(view.name+' local SSIM',baselineMetrics.ssim,settings.minimumSSIM,'min'),
            checkRange(view.name+' luma error',baselineMetrics.meanAbsoluteLumaError,settings.maximumAbsoluteLumaError)]);
        }
      }
    }else missing('image',view.name+' calibrated scene','No reviewed and SHA-pinned same-camera photo or offline reference. Heuristics are only sanity.');
    images.push({name:view.name,output:view.output,sourceIds:view.referenceIds,features,baselineMetrics});
  }
  results.image={images,validatedBaselines:images.filter(x=>x.baselineMetrics).length+'/'+expected.length};
}
function performance(){
  const profile=config.gpu[profileName];if(!profile)throw new Error('Unknown performance hardware profile '+profileName);
  check('performance','hardware profile matches OS',profile.platform===process.platform,'required='+profile.platform+' actual='+process.platform);
  const sample=json('artifacts/fps/gpu-budget.json'),verdict=verifyGpuProfile(sample,profile);
  assess('performance',verdict.checks);
  results.performance={profile:profileName,adapter:sample.adapter,resolution:sample.resolution,observedFps:sample.observedFps,
    frameInterval:sample.frameInterval,frameCpu:sample.frameCpu,gpu:sample.gpu,
    gpuPassHotspots:verdict.gpuHotspots,simulationHotspots:verdict.simulationHotspots,
    drawCalls:sample.renderWork?.drawCalls,uploadBytes:sample.renderWork?.uploadBytes};
}

if(mode==='cpu'){physics();audio();}else{performance();render();}
if(strict)for(const item of unverified)failures.push({...item,detail:item.reason});
const status=failures.length?'fail':unverified.length?'incomplete':'pass';
const report={schema:'game-engine-quality/1',sha:process.env.GITHUB_SHA??null,mode,profile:mode==='gpu'?profileName:'cpu-physics',
  strict,status,failures,unverified,results};
mkdirSync(resolve('artifacts/quality'),{recursive:true});
writeFileSync('artifacts/quality/'+mode+'-report.json',JSON.stringify(report,null,2)+'\n');
const domains=Object.keys(results);
const summary=['## Reality quality gates: '+mode.toUpperCase()+' — '+status.toUpperCase(),'',
  '| Domain | Status |','| --- | --- |',
  ...domains.map(d=>'| '+d+' | '+(failures.some(x=>x.domain===d)?'FAIL':unverified.some(x=>x.domain===d)?'INCOMPLETE':'PASS')+' |'),
  '',...failures.map(x=>'- FAIL **'+x.domain+'/'+x.name+'**: '+x.detail),
  ...unverified.map(x=>'- UNVERIFIED **'+x.domain+'/'+x.name+'**: '+x.reason),
  '', 'Report: artifacts/quality/'+mode+'-report.json'].join('\n')+'\n';
writeFileSync('artifacts/quality/'+mode+'-summary.md',summary);
if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,summary);
if(process.env.GITHUB_ACTIONS==='true')for(const item of unverified)console.log('::warning::'+item.domain+'/'+item.name+': '+item.reason);
console.log(summary);
if(failures.length)process.exitCode=1;
