#!/usr/bin/env node
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,mkdtemp,rm,readdir} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute,extname} from 'node:path';
import {tmpdir} from 'node:os';
import {existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {summarizeCanonical} from './canonical-summary.mjs';

const pointLightDemand=process.argv.includes("--point-light-demand");
const surfacePresence=process.argv.includes('--surface-presence');
const radianceCausePlan=process.argv.includes('--radiance-cause-plan'),projectionPoseArena=process.argv.includes('--projection-pose-arena'),causePlanDiagnostic=radianceCausePlan||projectionPoseArena;
if(radianceCausePlan&&projectionPoseArena)throw new Error('Select one paired projection diagnostic');
const instanceOrder=process.argv.includes('--instance-order'),modelHistory=!instanceOrder&&process.argv.includes('--model-history'),shadowDemand=!instanceOrder&&!modelHistory&&process.argv.includes('--shadow-demand'),radianceProjection=!instanceOrder&&!modelHistory&&!shadowDemand&&process.argv.includes('--radiance-projection'),shadowFilter=!instanceOrder&&!modelHistory&&!shadowDemand&&!radianceProjection&&process.argv.includes('--shadow-filter'),mossDemand=!instanceOrder&&!modelHistory&&!shadowDemand&&!radianceProjection&&!shadowFilter&&process.argv.includes('--moss-demand'),trace=!pointLightDemand&&!instanceOrder&&!modelHistory&&!shadowDemand&&!radianceProjection&&!shadowFilter&&!mossDemand&&process.env.CANONICAL_TRACE==='1';
if(surfacePresence&&(instanceOrder||modelHistory||shadowDemand||radianceProjection||shadowFilter||mossDemand))throw new Error('Select one diagnostic');
if(pointLightDemand&&(surfacePresence||instanceOrder||modelHistory||shadowDemand||radianceProjection||shadowFilter||mossDemand||causePlanDiagnostic))throw new Error('Select one diagnostic');
if(pointLightDemand&&process.argv.includes('--check-repeatability'))throw new Error('This diagnostic does not establish canonical repeatability');
if(causePlanDiagnostic&&(surfacePresence||instanceOrder||modelHistory||shadowDemand||radianceProjection||shadowFilter||mossDemand))throw new Error('Select one diagnostic');
if(causePlanDiagnostic&&process.argv.includes('--check-repeatability'))throw new Error('This diagnostic does not measure canonical repeatability');
if((surfacePresence||modelHistory||shadowDemand||radianceProjection||shadowFilter||mossDemand)&&process.argv.includes('--check-repeatability'))throw new Error('This diagnostic does not measure canonical repeatability');
const root=resolve(import.meta.dirname,'../..'),output=resolve(root,process.env.CANONICAL_OUTPUT??(pointLightDemand?"artifacts/engine-compare/point-light-demand-paired":causePlanDiagnostic?(projectionPoseArena?'artifacts/engine-compare/projection-pose-arena-paired':'artifacts/engine-compare/radiance-cause-plan-paired'):surfacePresence?'artifacts/engine-compare/surface-presence-paired':instanceOrder?'artifacts/engine-compare/instance-order-diagnostic':modelHistory?'artifacts/engine-compare/model-history-diagnostic':radianceProjection?'artifacts/engine-compare/radiance-projection-paired':shadowFilter?'artifacts/engine-compare/shadow-filter-diagnostic':mossDemand?'artifacts/engine-compare/moss-demand-paired':trace?'artifacts/engine-compare/temporal-diagnostic':'artifacts/engine-compare/canonical-diagnostic'));
const chrome=process.env.CHROME_PATH??['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);if(!chrome)throw new Error('Native WebGPU browser required');
const controls={count:Number(process.env.CANONICAL_COUNT??(surfacePresence||instanceOrder||radianceProjection||causePlanDiagnostic||mossDemand?10000:5000)),width:1920,height:1080,repetitions:Number(process.env.CANONICAL_REPETITIONS??(instanceOrder?2:trace?3:6))};
if(process.argv.includes('--current-instances')){if(!modelHistory)throw new Error('Current instance observation requires model-history diagnostic');controls.temporalAA=false;}
if(instanceOrder){controls.flatPayload=process.argv.includes('--flat-payload');controls.continuousShadow=process.argv.includes('--continuous-shadow');controls.shadowInputs=process.argv.includes('--shadow-inputs');controls.instanceInputs=process.argv.includes('--instance-inputs');controls.readbackChecks=process.argv.includes('--readback-checks');controls.opaqueBoundary=process.argv.includes('--opaque-boundary');controls.lightingProbe=process.argv.includes('--lighting-probe');controls.probeKind=process.argv.find(value=>value.startsWith('--probe-kind='))?.slice('--probe-kind='.length)??'scalars';}
if(process.argv.includes('--lighting-probe')&&!instanceOrder)throw new Error('Lighting probe requires instance-order diagnostic');
if(instanceOrder)controls.probeF32=process.argv.includes('--probe-f32');
if(process.argv.includes('--probe-f32')&&!controls.lightingProbe)throw new Error('Full-precision probe requires instance-order lighting observation');
if(process.argv.includes('--instance-inputs')&&!instanceOrder)throw new Error('Instance input observation requires instance-order diagnostic');
if(instanceOrder)controls.materialUniforms=process.argv.includes('--material-uniforms');
if(process.argv.includes('--material-uniforms')&&!instanceOrder)throw new Error('Material uniform observation requires instance-order diagnostic');
if(process.argv.includes('--readback-checks')&&!instanceOrder)throw new Error('Readback checks require instance-order diagnostic');
if(process.argv.includes('--opaque-boundary')&&!instanceOrder)throw new Error('Opaque boundary requires instance-order diagnostic');
if(process.argv.some(value=>value.startsWith('--probe-kind='))&&!controls.lightingProbe)throw new Error('Probe kind requires a lighting probe');
if(surfacePresence||shadowDemand||radianceProjection||causePlanDiagnostic||mossDemand){controls.pairs=Number(process.env.CANONICAL_PAIRS??128);if(!Number.isSafeInteger(controls.pairs)||controls.pairs<16||controls.pairs>512)throw new Error('Invalid diagnostic pairs');}
if(!Number.isSafeInteger(controls.count)||controls.count<4||controls.count>100000||!Number.isSafeInteger(controls.repetitions)||controls.repetitions<2||controls.repetitions>12)throw new Error('Invalid diagnostic controls');
async function fingerprint(directory){
 const files=[];async function visit(path){for(const entry of await readdir(path,{withFileTypes:true})){const file=join(path,entry.name);if(entry.isDirectory())await visit(file);else if(entry.isFile())files.push(file);}}await visit(resolve(root,directory));
 const h=createHash('sha256');for(const file of files.sort()){h.update(relative(root,file).replaceAll('\\','/')+'\0');h.update(await readFile(file));}return h.digest('hex');
}
const sourceState={srcSha256:await fingerprint('src'),distSha256:await fingerprint('dist'),harnessSha256:await fingerprint('tools/engine-compare'),diagnosticSha256:await fingerprint('tools/gpu-visibility')};
const within=(parent,file)=>{const path=relative(parent,file);return path!==''&&!path.startsWith('..')&&!isAbsolute(path);};
const server=createServer(async(req,res)=>{
 try{
  const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(path==='/'){res.setHeader('content-type','text/html');res.end('<!doctype html><meta charset="utf-8"><style>body{margin:0}</style><canvas></canvas>');return;}
  const mounts=[['/dist/','dist'],['/tools/engine-compare/','tools/engine-compare'],['/tools/gpu-visibility/','tools/gpu-visibility']],mount=mounts.find(([prefix])=>path.startsWith(prefix));if(!mount){res.writeHead(404);res.end();return;}
  const parent=resolve(root,mount[1]),file=resolve(parent,path.slice(mount[0].length));if(!within(parent,file)){res.writeHead(404);res.end();return;}
  res.setHeader('content-type',['.js','.mjs'].includes(extname(file))?'text/javascript':'application/octet-stream');res.end(await readFile(file));
 }catch(error){res.writeHead(500);res.end(String(error));}
});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const profile=await mkdtemp(join(tmpdir(),'canonical-diagnostic-')),startedAt=new Date().toISOString();
const child=spawn(chrome,['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-extensions','--enable-unsafe-webgpu','--enable-gpu','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--user-data-dir='+profile,'--window-size=1920,1080','about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let stderr='',failure,ws,id=0;const pending=new Map(),errors=[],delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));child.stderr.on('data',chunk=>stderr=(stderr+chunk).slice(-4000));child.on('error',error=>failure=error);
await mkdir(output,{recursive:true});
try{
 let port;for(let n=0;n<200;n++){if(failure)throw failure;try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);if(port)break;}catch{}await delay(50);}if(!port)throw new Error('Browser did not start: '+stderr);
 const pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json(),page=pages.find(p=>p.type==='page');ws=new WebSocket(page.webSocketDebuggerUrl);
 ws.addEventListener('message',event=>{const message=JSON.parse(String(event.data));if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails);if(message.method==='Runtime.consoleAPICalled')for(const arg of message.params.args)if(typeof arg.value==='string'&&arg.value.startsWith('TEMPORAL_DIAGNOSTIC '))console.log(arg.value);const request=pending.get(message.id);if(request){pending.delete(message.id);message.error?request.reject(new Error(message.error.message)):request.resolve(message.result);}});
 ws.addEventListener('close',()=>{for(const request of pending.values())request.reject(new Error('Browser closed'));pending.clear();});
 await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const requestId=++id;pending.set(requestId,{resolve,reject});ws.send(JSON.stringify({id:requestId,method,params}));});
 const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);return result.result.value;};
 await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
 const browser=await send('Browser.getVersion');await send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/'});
 for(let n=0;n<200;n++){if(await evaluate("document.readyState==='complete'&&!!document.querySelector('canvas')"))break;await delay(50);}
 await writeFile(join(output,'report.json'),JSON.stringify({status:'running',startedAt,controls,sourceState,browser},null,2)+'\n');
 let module=surfacePresence?'surface-presence-diagnostic':instanceOrder?'instance-order-diagnostic':modelHistory?'model-history-diagnostic':shadowDemand?'shadow-demand-diagnostic':radianceProjection?'radiance-projection-diagnostic':shadowFilter?'shadow-filter-diagnostic':mossDemand?'moss-demand-diagnostic':trace?'temporal-diagnostic':'canonical-diagnostic',method=surfacePresence?'diagnoseSurfacePresence':instanceOrder?'diagnoseInstanceOrder':modelHistory?'diagnoseModelHistory':shadowDemand?'diagnoseShadowDemand':radianceProjection?'diagnoseRadianceProjection':shadowFilter?'diagnoseShadowFilter':mossDemand?'diagnoseMossDemand':trace?'diagnoseTemporal':'diagnoseCanonical';
 if(pointLightDemand){module="point-light-demand-diagnostic";method="diagnosePointLightDemand";controls.pairs=Number(process.env.POINT_LIGHT_PAIRS??64);}
 const result=await evaluate("import('/tools/gpu-visibility/"+(causePlanDiagnostic?(projectionPoseArena?'projection-pose-arena-diagnostic':'radiance-cause-plan-diagnostic'):module)+".mjs').then(m=>m."+(causePlanDiagnostic?(projectionPoseArena?'diagnoseProjectionPoseArena':'diagnoseRadianceCausePlan'):method)+'('+JSON.stringify(controls)+'))');if(errors.length)throw new Error(JSON.stringify(errors));
 for(const capture of result.captures??[]){
  if(!capture.imageDataURL?.startsWith('data:image/png;base64,'))throw new Error('Invalid diagnostic capture');
  const file=`${capture.mode}-frame-${capture.frame}.png`;await writeFile(join(output,file),Buffer.from(capture.imageDataURL.slice('data:image/png;base64,'.length),'base64'));delete capture.imageDataURL;capture.file=file;
 }
 const report={...result,startedAt,completedAt:new Date().toISOString(),sourceState,browser};
 if(!pointLightDemand&&!surfacePresence&&!modelHistory&&!shadowDemand&&!radianceProjection&&!causePlanDiagnostic&&!shadowFilter&&!mossDemand){report.repeatabilitySummary=summarizeCanonical(report);report.gates=report.repeatabilitySummary.gates;}
 await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({status:report.status,path:join(output,'report.json'),gates:report.gates,variations:report.repeatabilitySummary?.runs.map(run=>({mode:run.mode,repetition:run.repetition,firstDivergentFrame:run.firstDivergentFrame,changedFrames:run.changedFrames,repeatMismatchFrames:run.repeatMismatchFrames}))}));
 if(process.argv.includes('--check-repeatability')&&!report.repeatabilitySummary?.gates.repeatability){console.error('Canonical repeatability gate failed; full evidence retained at '+join(output,'report.json'));process.exitCode=1;}
 if(shadowFilter&&(!report.gates.normalizedCoverage||!report.gates.receiverPlaneDepth)){console.error('Shadow filter gate failed; full evidence retained at '+join(output,'report.json'));process.exitCode=1;}
 if((pointLightDemand||surfacePresence||mossDemand||causePlanDiagnostic)&&!Object.values(report.gates).every(Boolean)){console.error('Paired correctness/performance gate failed; full evidence retained at '+join(output,'report.json'));process.exitCode=1;}
}catch(error){await writeFile(join(output,'report.json'),JSON.stringify({status:'failed',startedAt,controls,sourceState,error:String(error),errors},null,2)+'\n');console.error(error);process.exitCode=1;}
finally{ws?.close();server.close();child.kill();await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));if(within(resolve(tmpdir()),resolve(profile)))for(let n=0;n<10;n++){try{await rm(profile,{recursive:true,force:true});break;}catch{await delay(100);}}}
