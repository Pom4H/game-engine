import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const digest=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const framesOf=run=>run.frames??[{frame:31,stages:run.stages}];

/** Interpret every observed frame. Execution completion and a repeatability
 * gate are distinct; final-frame agreement cannot erase earlier divergence. */
export function summarizeCanonical(report){
 const order=typeof report.controls?.flatPayload==='boolean'||report.runs?.some(run=>run.mode==='ascending'),modes=order?['ascending','shuffled']:['gpu','cpu-batched'];
 const repetitions=report.controls?.repetitions,traced=report.runs?.some(run=>Array.isArray(run.frames));
 const expectedFrames=traced?report.controls?.canonicalFrames:1,issues=[],runs=[],velocityExports=report.controls?.lightingProbe&&report.controls?.probeKind==='velocity-input',materialInputs=report.controls?.lightingProbe&&report.controls?.probeKind==='material-input',worldInputs=report.controls?.lightingProbe&&report.controls?.probeKind==='world-input',probeF32=report.controls?.probeF32;let readbackAgreement=true,opaqueBoundaryAgreement=true,velocityExportAgreement=true,materialInputAgreement=true,materialUniformAgreement=true,worldInputIndexAgreement=true;
 if(report.status!=='completed')issues.push('Diagnostic did not complete');
 if(!Number.isSafeInteger(repetitions)||repetitions<2)issues.push('Missing repeated captures');
 if(!Number.isSafeInteger(expectedFrames)||expectedFrames<1)issues.push('Missing frame extent');
 if(!digest(report.replayHash))issues.push('Missing physical replay hash');
 if(probeF32&&(!report.controls.lightingProbe||velocityExports||materialInputs||report.fullPrecisionProbe?.format!=='rgba32float'||report.fullPrecisionProbe?.encoding!=='rgba32float raw words'||report.fullPrecisionProbe?.colorAttachmentBytesPerSample!==36||report.fullPrecisionProbe?.requiredColorAttachmentLimit!==36||report.fullPrecisionProbe?.originalNormalWritten!==false||report.lightingProbe?.postprocessUsesProbeNormals!==false))issues.push('Missing full-precision probe contract');
 if(worldInputs&&(!probeF32||report.controls.instanceInputs!==true))issues.push('World input requires full precision and source observations');
 const seen=new Set(),references=new Map();
 for(const mode of modes){const reference=report.runs?.find(run=>run.mode===mode&&run.repetition===0);if(reference)references.set(mode,framesOf(reference));}
 const required=traced?['hdr','current','velocity','depth','taa']:['presentation','hdr','normal','effects','taa'];
 for(const run of report.runs??[]){
  const key=run.mode+':'+run.repetition,frames=framesOf(run),baseline=references.get(order?'ascending':run.mode),stages={},changedFrames=[],repeatMismatchFrames=[];
  if(!modes.includes(run.mode)||!Number.isSafeInteger(run.repetition)||run.repetition<0||run.repetition>=repetitions||seen.has(key))issues.push('Unexpected or duplicated run '+key);
  seen.add(key);
  if(run.afterHash!==report.replayHash)issues.push('Physical replay differs in '+key);
  if(frames.length!==expectedFrames)issues.push('Frame coverage differs in '+key);
  for(let index=0;index<frames.length;index++){
   const frame=frames[index],reference=baseline?.[index],isReference=run.repetition===0&&(!order||run.mode==='ascending');
   if(frame.frame!==(traced?index:31))issues.push('Unexpected frame sequence in '+key);
   const names=Object.keys(frame.stages??{}),referenceNames=Object.keys(reference?.stages??{});
   if(probeF32){
    const checks=frame.probe32Checks,stageNames=['lightingProbe',...(report.controls.opaqueBoundary?['lightingProbeAfterOpaque']:[])];
    if(!checks||checks.opaquePasses!==1||checks.format!=='rgba32float'||checks.colorAttachmentBytesPerSample!==36||checks.requestedColorAttachmentLimit!==36||!Number.isSafeInteger(checks.adapterColorAttachmentLimit)||checks.adapterColorAttachmentLimit<36||checks.originalNormalWritten!==false||!Number.isSafeInteger(checks.promotedPipelines)||checks.promotedPipelines<1)issues.push('Missing full-precision pass coverage in '+key+' frame '+frame.frame);
    for(const name of stageNames){const stage=frame.stages?.[name];if(!stage||stage.encoding!=='rgba32float raw words'||stage.channels!==4||stage.width!==report.controls.width||stage.height!==report.controls.height)issues.push('Missing full-precision stage format/extent in '+key+' frame '+frame.frame);}
   }
   if(report.controls?.opaqueBoundary){
    const expectedNames=['opaque','normal','specular','velocity'],checks=frame.opaqueBoundaryChecks??{};
    if(Object.keys(checks).length!==expectedNames.length||expectedNames.some(name=>!checks[name]||!frame.stages?.[(name==='normal'&&report.controls.lightingProbe?'lightingProbe':name)+'AfterOpaque']))issues.push('Opaque boundary coverage differs in '+key+' frame '+frame.frame);
    for(const name of expectedNames){
     const observation=checks[name];
     if(!observation||!Number.isSafeInteger(observation.changedChannels)||observation.changedChannels<0||!Number.isFinite(observation.maxEncodedError)||observation.maxEncodedError<0)issues.push('Missing opaque boundary comparison in '+key+' '+name);
     else if(observation.changedChannels>0)opaqueBoundaryAgreement=false;
    }
   }
   if(report.controls?.readbackChecks){
    const expectedNames=['opaque',report.controls.lightingProbe?'lightingProbe':'normal',...(velocityExports?['velocity']:[])],checks=frame.readbackChecks??{};
    if(Object.keys(checks).length!==expectedNames.length||expectedNames.some(name=>!checks[name]))issues.push('Readback check coverage differs in '+key+' frame '+frame.frame);
    for(const name of expectedNames){
     const check=checks[name];if(!check)continue;
     if(check.checkedChannels!==report.controls.width*report.controls.height*(name==='velocity'?2:4))issues.push('Readback channel coverage differs in '+key+' '+name);
     for(const method of ['compute','repeatedCopy']){
      const observation=check[method];
      if(!observation||!Number.isSafeInteger(observation.changedChannels)||observation.changedChannels<0||!Number.isFinite(observation.maxEncodedError)||observation.maxEncodedError<0)issues.push('Missing readback comparison in '+key+' '+name+' '+method);
      else if(observation.changedChannels>0)readbackAgreement=false;
     }
    }
   }
   if(velocityExports){
    const expectedNames=['final',...(report.controls.opaqueBoundary?['afterOpaque']:[])],checks=frame.velocityExportChecks??{},pixels=report.controls.width*report.controls.height;
    if(Object.keys(checks).length!==expectedNames.length||expectedNames.some(name=>!checks[name])||!frame.stages?.lightingProbe)issues.push('Velocity export coverage differs in '+key+' frame '+frame.frame);
    for(const name of expectedNames){
     const observation=checks[name];
     if(!observation||!Number.isSafeInteger(observation.coveredPixels)||observation.coveredPixels<1||!Number.isSafeInteger(observation.backgroundPixels)||observation.backgroundPixels<0||observation.coveredPixels+observation.backgroundPixels!==pixels||observation.checkedChannels!==observation.coveredPixels*2||!Number.isSafeInteger(observation.changedChannels)||observation.changedChannels<0||observation.changedChannels>observation.checkedChannels||!Number.isFinite(observation.maxEncodedError)||observation.maxEncodedError<0)issues.push('Missing velocity export comparison in '+key+' '+name);
     else if(observation.changedChannels>0)velocityExportAgreement=false;
    }
   }
   if(materialInputs){
    const expectedNames=['final',...(report.controls.opaqueBoundary?['afterOpaque']:[])],checks=frame.materialInputChecks??{},pixels=report.controls.width*report.controls.height;
    if(Object.keys(checks).length!==expectedNames.length||expectedNames.some(name=>!checks[name])||!frame.stages?.lightingProbe||report.controls.instanceInputs!==true||!Object.keys(frame.stages??{}).some(name=>name.startsWith('instanceSource:')))issues.push('Material input coverage differs in '+key+' frame '+frame.frame);
    for(const name of expectedNames){
     const observation=checks[name],counts=observation&&['backgroundPixels','nonInstancedPixels','instancedPixels','invalidIndexPixels','checkedChannels','changedChannels'].map(field=>observation[field]);
     if(!observation||counts.some(value=>!Number.isSafeInteger(value)||value<0)||observation.sourceCount!==report.controls.count||observation.instancedPixels<1||observation.invalidIndexPixels>observation.instancedPixels||observation.backgroundPixels+observation.nonInstancedPixels+observation.instancedPixels!==pixels||observation.checkedChannels!==(observation.instancedPixels-observation.invalidIndexPixels)*3||observation.changedChannels>observation.checkedChannels||!Number.isFinite(observation.maxEncodedError)||observation.maxEncodedError<0)issues.push('Missing material input comparison in '+key+' '+name);
     else if(observation.changedChannels>0||observation.invalidIndexPixels>0)materialInputAgreement=false;
    }
   }
   if(worldInputs){
    const expectedNames=['final',...(report.controls.opaqueBoundary?['afterOpaque']:[])],checks=frame.worldInputChecks??{},pixels=report.controls.width*report.controls.height;
    if(Object.keys(checks).length!==expectedNames.length||expectedNames.some(name=>!checks[name])||!names.some(name=>name.startsWith('instanceSource:')))issues.push('World input coverage differs in '+key+' frame '+frame.frame);
    for(const name of expectedNames){const check=checks[name],counts=check&&['backgroundPixels','nonInstancedPixels','instancedPixels','coveredPixels','invalidIndexPixels','checkedChannels'].map(field=>check[field]);
     if(!check||counts.some(value=>!Number.isSafeInteger(value)||value<0)||check.sourceCount!==report.controls.count||check.instancedPixels<1||check.coveredPixels!==check.nonInstancedPixels+check.instancedPixels||check.backgroundPixels+check.coveredPixels!==pixels||check.invalidIndexPixels>check.instancedPixels||check.checkedChannels!==check.coveredPixels*4)issues.push('Missing world input comparison in '+key+' '+name);
     else if(check.invalidIndexPixels>0)worldInputIndexAgreement=false;
    }
   }
   if(report.controls?.materialUniforms){
    // Archived reports used 23 vec4s; new captures explicitly declare 24.
    const checks=frame.materialUniformChecks,draws=checks?.draws,words=report.materialUniforms?.words??92,layoutValid=[92,96,100].includes(words)&&(!report.materialUniforms||report.materialUniforms.bytes===words*4);
    if(!layoutValid||!checks||checks.opaquePasses!==1||checks.uniformWords!==words||!Array.isArray(draws)||!draws.length||checks.expectedDraws!==draws.length||checks.checkedWords!==draws.length*words||!Number.isSafeInteger(checks.uniqueBindings)||checks.uniqueBindings<1||checks.uniqueBindings!==new Set(draws.map(draw=>draw.gpuStage)).size||new Set(draws.map(draw=>draw.hostStage)).size!==draws.length)issues.push('Material uniform draw coverage differs in '+key+' frame '+frame.frame);
    for(const draw of Array.isArray(draws)?draws:[]){
     if(typeof draw.objectId!=='string'||!draw.objectId||typeof draw.pipeline!=='string'||!draw.pipeline||draw.checkedWords!==words||draw.gpuStage!=='materialUniform:'+draw.objectId||typeof draw.hostStage!=='string'||!draw.hostStage.startsWith('materialUniformHost:'+draw.objectId+':')||!frame.stages?.[draw.gpuStage]||!frame.stages?.[draw.hostStage]||!Number.isSafeInteger(draw.changedChannels)||draw.changedChannels<0||draw.changedChannels>words||!Number.isFinite(draw.maxEncodedError)||draw.maxEncodedError<0)issues.push('Missing material uniform comparison in '+key+' frame '+frame.frame);
     else if(draw.changedChannels>0)materialUniformAgreement=false;
    }
   }
   if(required.some(name=>!names.includes(name))||names.length!==referenceNames.length||names.some(name=>!referenceNames.includes(name)))issues.push('Stage coverage differs in '+key+' frame '+frame.frame);
   let changed=false,repeatMismatch=false;
   for(const [name,stage] of Object.entries(frame.stages??{})){
    const ref=reference?.stages?.[name],comparison=stage.comparison;
    if(!digest(stage.hash))issues.push('Missing stage hash in '+key+' '+name);
    if(!isReference&&(!comparison||!Number.isSafeInteger(comparison.changedChannels)||comparison.changedChannels<0||!Number.isFinite(comparison.maxEncodedError)||comparison.maxEncodedError<0))issues.push('Missing comparison in '+key+' '+name);
    if(!isReference&&comparison&&((comparison.changedChannels===0)!==(stage.hash===ref?.hash)))issues.push('Hash and comparison disagree in '+key+' '+name);
    const counts=stages[name]??={changedFrames:0,changedChannels:0,maxEncodedError:0,firstDivergentFrame:null,repeatMismatchFrames:0};
    if(comparison?.changedChannels>0){counts.changedFrames++;counts.changedChannels+=comparison.changedChannels;counts.maxEncodedError=Math.max(counts.maxEncodedError,comparison.maxEncodedError);counts.firstDivergentFrame??=frame.frame;changed=true;}
    if(stage.sameOrderingRepeat===false){counts.repeatMismatchFrames++;repeatMismatch=true;}
   }
   if(changed)changedFrames.push(frame.frame);if(repeatMismatch)repeatMismatchFrames.push(frame.frame);
  }
  runs.push({mode:run.mode,repetition:run.repetition,checkedFrames:frames.length,firstDivergentFrame:changedFrames[0]??null,changedFrames,repeatMismatchFrames,stages});
 }
 for(const mode of modes)for(let repetition=0;repetition<(Number.isSafeInteger(repetitions)?repetitions:0);repetition++)if(!seen.has(mode+':'+repetition))issues.push('Missing run '+mode+':'+repetition);
 if(!report.runs?.length)issues.push('No observations');
 const coverage=issues.length===0,allComparisonsExact=runs.length>0&&runs.every(run=>!run.changedFrames.length),sameOrderingRepeatable=runs.length>0&&runs.every(run=>!run.repeatMismatchFrames.length);
 return{gates:{completed:report.status==='completed',coverage,allComparisonsExact,sameOrderingRepeatable,...(report.controls?.readbackChecks?{readbackAgreement:coverage&&readbackAgreement}:{}),...(report.controls?.opaqueBoundary?{opaqueBoundaryAgreement:coverage&&opaqueBoundaryAgreement}:{}),...(velocityExports?{velocityExportAgreement:coverage&&velocityExportAgreement}:{}),...(materialInputs?{materialInputAgreement:coverage&&materialInputAgreement}:{}),...(report.controls?.materialUniforms?{materialUniformAgreement:coverage&&materialUniformAgreement}:{}),...(probeF32?{fullPrecisionProbeCoverage:coverage}:{}),...(worldInputs?{worldInputIndexAgreement:coverage&&worldInputIndexAgreement}:{}),repeatability:coverage&&allComparisonsExact&&sameOrderingRepeatable&&readbackAgreement&&opaqueBoundaryAgreement&&velocityExportAgreement&&materialInputAgreement&&materialUniformAgreement&&worldInputIndexAgreement},issues:[...new Set(issues)],runs,
  interpretation:'Zero-tolerance agreement of the observed stages and frames. Instance-order controls also compare against ascending references; standard traces compare within each mode. Passing a finite sample does not eliminate intermittent variation or certify competitive performance/quality.'};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const file=process.argv.slice(2).find(value=>!value.startsWith('--'));if(!file)throw new Error('Provide a diagnostic report.json');
 const result=summarizeCanonical(JSON.parse(await readFile(resolve(file),'utf8')));console.log(JSON.stringify(result,null,2));
 if(process.argv.includes('--check-repeatability')&&!result.gates.repeatability)process.exitCode=1;
}
