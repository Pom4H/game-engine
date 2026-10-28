import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeCanonical} from '../tools/gpu-visibility/canonical-summary.mjs';
import {velocityExportAgreement} from '../tools/gpu-visibility/velocity-export-check.mjs';
import {materialInputAgreement} from '../tools/gpu-visibility/material-input-check.mjs';

function fixture(){
 const stages=['opaque','hdr','current','velocity','depth','taa'],hash='a'.repeat(64),report={status:'completed',controls:{flatPayload:false,repetitions:2,canonicalFrames:3},replayHash:hash,runs:[]};
 for(const mode of ['ascending','shuffled'])for(let repetition=0;repetition<2;repetition++)report.runs.push({mode,repetition,afterHash:hash,frames:Array.from({length:3},(_,frame)=>({frame,stages:Object.fromEntries(stages.map(name=>[name,{hash,sameOrderingRepeat:true,comparison:mode==='ascending'&&repetition===0?null:{changedChannels:0,maxEncodedError:0}}]))}))});
 return report;
}
test('all-frame gate preserves an early opaque divergence after the last frame agrees',()=>{
 const report=fixture(),stage=report.runs.at(-1).frames[1].stages.opaque;stage.hash='b'.repeat(64);stage.comparison={changedChannels:9,maxEncodedError:540};stage.sameOrderingRepeat=false;
 const result=summarizeCanonical(report);assert.equal(result.gates.coverage,true);assert.equal(result.gates.repeatability,false);
 assert.equal(result.runs.at(-1).firstDivergentFrame,1);assert.deepEqual(result.runs.at(-1).changedFrames,[1]);assert.equal(result.runs.at(-1).stages.opaque.changedChannels,9);
});
test('gate rejects incomplete frames, missing stages/runs and contradictory comparisons',()=>{
 for(const mutate of [r=>r.runs.pop(),r=>r.runs[1].frames.pop(),r=>delete r.runs[1].frames[0].stages.depth,r=>delete r.runs[1].frames[0].stages,r=>r.runs[1].frames[0].stages.hdr.hash='b'.repeat(64),r=>r.runs[1].afterHash='b'.repeat(64),r=>r.runs.push(r.runs[0])]){
  const report=fixture();mutate(report);const result=summarizeCanonical(report);assert.equal(result.gates.coverage,false);assert.equal(result.gates.repeatability,false);assert.ok(result.issues.length);
 }
});
test('identical captures pass only the observed repeatability gate',()=>{
 const result=summarizeCanonical(fixture());assert.equal(result.gates.repeatability,true);assert.ok(result.runs.every(run=>run.firstDivergentFrame===null));
 const legacy=fixture();delete legacy.controls.flatPayload;assert.equal(summarizeCanonical(legacy).gates.repeatability,true);
});
test('empty/failed diagnostics cannot pass by vacuous comparison',()=>{
 for(const report of [{status:'failed'},{status:'completed',controls:{repetitions:2,canonicalFrames:32},runs:[]}])assert.equal(summarizeCanonical(report).gates.repeatability,false);
});

test('readback agreement requires complete independent observations and exact channels',()=>{
 const report=fixture();Object.assign(report.controls,{readbackChecks:true,width:2,height:1});
 for(const run of report.runs)for(const frame of run.frames)frame.readbackChecks=Object.fromEntries(['opaque','normal'].map(name=>[name,{checkedChannels:8,compute:{changedChannels:0,maxEncodedError:0},repeatedCopy:{changedChannels:0,maxEncodedError:0}}]));
 assert.equal(summarizeCanonical(report).gates.readbackAgreement,true);
 const changed=structuredClone(report);changed.runs[1].frames[1].readbackChecks.opaque.compute={changedChannels:3,maxEncodedError:17};
 const result=summarizeCanonical(changed);assert.equal(result.gates.coverage,true);assert.equal(result.gates.readbackAgreement,false);assert.equal(result.gates.repeatability,false);
 for(const mutate of [r=>delete r.runs[1].frames[0].readbackChecks.normal,r=>r.runs[1].frames[0].readbackChecks.normal.checkedChannels=4,r=>delete r.runs[1].frames[0].readbackChecks.opaque.repeatedCopy]){
  const incomplete=structuredClone(report);mutate(incomplete);assert.equal(summarizeCanonical(incomplete).gates.coverage,false);assert.equal(summarizeCanonical(incomplete).gates.readbackAgreement,false);
 }
});

test('opaque boundary gate preserves post-pass changes and rejects incomplete captures',()=>{
 const report=fixture();report.controls.opaqueBoundary=true;
 for(const run of report.runs)for(const frame of run.frames){frame.opaqueBoundaryChecks={};for(const name of ['opaque','normal','specular','velocity']){frame.opaqueBoundaryChecks[name]={changedChannels:0,maxEncodedError:0};frame.stages[name+'AfterOpaque']=structuredClone(frame.stages.opaque);}}
 assert.equal(summarizeCanonical(report).gates.opaqueBoundaryAgreement,true);
 const changed=structuredClone(report);changed.runs[1].frames[0].opaqueBoundaryChecks.normal={changedChannels:4,maxEncodedError:113};
 const result=summarizeCanonical(changed);assert.equal(result.gates.coverage,true);assert.equal(result.gates.opaqueBoundaryAgreement,false);assert.equal(result.gates.repeatability,false);
 for(const mutate of [r=>delete r.runs[1].frames[0].opaqueBoundaryChecks.velocity,r=>delete r.runs[1].frames[0].stages.normalAfterOpaque]){
  const incomplete=structuredClone(report);mutate(incomplete);assert.equal(summarizeCanonical(incomplete).gates.coverage,false);
 }
});

test('duplicate velocity exports compare covered channels exactly and ignore background clear values',()=>{
 const extent={width:2,height:1},probe={...extent,channels:4,encoding:'rgba16float raw words',pixels:new Uint16Array([0x1400,0x9800,0,0,0x3800,0x3800,0x3c00,0x3c00])},velocity={...extent,channels:2,encoding:'rg16float raw words',pixels:new Uint16Array([0x1400,0x9800,0,0])},depth={...extent,channels:1,encoding:'depth32float raw words',pixels:new Uint32Array(new Float32Array([.8,1]).buffer)};
 assert.deepEqual(velocityExportAgreement(probe,velocity,depth),{coveredPixels:1,backgroundPixels:1,checkedChannels:2,changedChannels:0,maxEncodedError:0,coordinates:[]});
 velocity.pixels[0]=0x13ff;const changed=velocityExportAgreement(probe,velocity,depth);assert.equal(changed.changedChannels,1);assert.deepEqual(changed.coordinates,[{x:0,y:0,channel:0,before:0x1400,after:0x13ff}]);
 probe.pixels[0]=0;velocity.pixels[0]=0x8000;assert.equal(velocityExportAgreement(probe,velocity,depth).changedChannels,1);
});

test('duplicate velocity observations reject missing geometry, invalid depth and non-finite exports',()=>{
 const extent={width:1,height:1},probe={...extent,channels:4,encoding:'rgba16float raw words',pixels:new Uint16Array(4)},velocity={...extent,channels:2,encoding:'rg16float raw words',pixels:new Uint16Array(2)},depth={...extent,channels:1,encoding:'depth32float raw words',pixels:new Uint32Array(new Float32Array([.5]).buffer)};
 assert.throws(()=>velocityExportAgreement(probe,{...velocity,encoding:'wrong'},depth),/format/);
 assert.throws(()=>velocityExportAgreement(probe,velocity,{...depth,pixels:new Uint32Array(new Float32Array([1]).buffer)}),/no covered/);
 for(const value of [-.1,1.1,NaN,Infinity])assert.throws(()=>velocityExportAgreement(probe,velocity,{...depth,pixels:new Uint32Array(new Float32Array([value]).buffer)}),/depth/);
 velocity.pixels[0]=0x7c00;assert.throws(()=>velocityExportAgreement(probe,velocity,depth),/Non-finite/);
});

test('velocity export gate cannot pass absent or disagreeing duplicate MRT observations',()=>{
 const report=fixture();Object.assign(report.controls,{lightingProbe:true,probeKind:'velocity-input',opaqueBoundary:true,readbackChecks:true,width:2,height:1});
 for(const run of report.runs)for(const frame of run.frames){
  frame.stages.lightingProbe=structuredClone(frame.stages.opaque);
  frame.opaqueBoundaryChecks={};for(const name of ['opaque','normal','specular','velocity']){frame.opaqueBoundaryChecks[name]={changedChannels:0,maxEncodedError:0};frame.stages[(name==='normal'?'lightingProbe':name)+'AfterOpaque']=structuredClone(frame.stages.opaque);}
  frame.readbackChecks=Object.fromEntries(['opaque','lightingProbe','velocity'].map(name=>[name,{checkedChannels:name==='velocity'?4:8,compute:{changedChannels:0,maxEncodedError:0},repeatedCopy:{changedChannels:0,maxEncodedError:0}}]));
  frame.velocityExportChecks=Object.fromEntries(['final','afterOpaque'].map(name=>[name,{coveredPixels:1,backgroundPixels:1,checkedChannels:2,changedChannels:0,maxEncodedError:0}]));
 }
 assert.equal(summarizeCanonical(report).gates.repeatability,true);assert.equal(summarizeCanonical(report).gates.velocityExportAgreement,true);
 const changed=structuredClone(report);changed.runs[1].frames[1].velocityExportChecks.afterOpaque.changedChannels=1;
 const result=summarizeCanonical(changed);assert.equal(result.gates.coverage,true);assert.equal(result.gates.velocityExportAgreement,false);assert.equal(result.gates.repeatability,false);
 for(const mutate of [r=>delete r.runs[1].frames[0].velocityExportChecks.afterOpaque,r=>r.runs[1].frames[0].velocityExportChecks.final.coveredPixels=0,r=>r.runs[1].frames[0].velocityExportChecks.final.checkedChannels=4,r=>delete r.runs[1].frames[0].readbackChecks.velocity,r=>delete r.runs[1].frames[0].stages.lightingProbeAfterOpaque]){
  const incomplete=structuredClone(report);mutate(incomplete);assert.equal(summarizeCanonical(incomplete).gates.coverage,false);assert.equal(summarizeCanonical(incomplete).gates.repeatability,false);
 }
});

function materialFixture(){
 const extent={width:4,height:1},source=new Float32Array(80);source.set([.25,.5,1],32);source.set([.125,.375,.75],72);
 return{source,visible:new Uint32Array([0,1]),probe:{...extent,channels:4,encoding:'rgba16float raw words',pixels:new Uint16Array([0x3400,0x3800,0x3c00,1024,0x3000,0x3600,0x3a00,1025,0,0,0,0x7bff,0x3800,0x3800,0x3c00,0x3c00])},depth:{...extent,channels:1,encoding:'depth32float raw words',pixels:new Uint32Array(new Float32Array([.7,.8,.4,1]).buffer)}};
}
test('material input observations validate fragment source indices and indexed colors',()=>{
 const {probe,depth,source,visible}=materialFixture();
 assert.deepEqual(materialInputAgreement(probe,depth,source,visible),{sourceCount:2,backgroundPixels:1,nonInstancedPixels:1,instancedPixels:2,invalidIndexPixels:0,checkedChannels:6,changedChannels:0,maxEncodedError:0,coordinates:[]});
 probe.pixels[4]=0x3400;const wrongColor=materialInputAgreement(probe,depth,source,visible);assert.equal(wrongColor.changedChannels,1);assert.equal(wrongColor.coordinates[0].index,1);
 probe.pixels[4]=0x3000;probe.pixels[7]=1026;const wrongIndex=materialInputAgreement(probe,depth,source,visible);assert.equal(wrongIndex.invalidIndexPixels,1);assert.equal(wrongIndex.checkedChannels,3);
 probe.pixels[7]=1025;assert.equal(materialInputAgreement(probe,depth,source,new Uint32Array([0])).invalidIndexPixels,1);
 assert.throws(()=>materialInputAgreement(probe,depth,source,new Uint32Array([2])),/visible/);
});
test('material conversion bounds admit only the two adjacent representable binary16 results',()=>{
 const {probe,depth,source,visible}=materialFixture();source[32]=.25001;
 assert.equal(materialInputAgreement(probe,depth,source,visible).changedChannels,0);
 probe.pixels[0]=0x3401;assert.equal(materialInputAgreement(probe,depth,source,visible).changedChannels,0);
 probe.pixels[0]=0x3402;assert.equal(materialInputAgreement(probe,depth,source,visible).changedChannels,1);
 source[32]=NaN;assert.throws(()=>materialInputAgreement(probe,depth,source,visible),/color/);
});
test('material input gate requires source observations and retains numerical or index disagreement',()=>{
 const report=fixture();Object.assign(report.controls,{lightingProbe:true,probeKind:'material-input',instanceInputs:true,opaqueBoundary:true,count:2,width:4,height:1});
 for(const run of report.runs)for(const frame of run.frames){
  frame.stages.lightingProbe=structuredClone(frame.stages.opaque);frame.stages['instanceSource:test']=structuredClone(frame.stages.opaque);
  frame.opaqueBoundaryChecks={};for(const name of ['opaque','normal','specular','velocity']){frame.opaqueBoundaryChecks[name]={changedChannels:0,maxEncodedError:0};frame.stages[(name==='normal'?'lightingProbe':name)+'AfterOpaque']=structuredClone(frame.stages.opaque);}
  frame.materialInputChecks=Object.fromEntries(['final','afterOpaque'].map(name=>[name,{sourceCount:2,backgroundPixels:1,nonInstancedPixels:1,instancedPixels:2,invalidIndexPixels:0,checkedChannels:6,changedChannels:0,maxEncodedError:0}]));
 }
 assert.equal(summarizeCanonical(report).gates.repeatability,true);assert.equal(summarizeCanonical(report).gates.materialInputAgreement,true);
 for(const mutate of [check=>{check.changedChannels=1;check.maxEncodedError=128;},check=>{check.invalidIndexPixels=1;check.checkedChannels=3;}]){
  const changed=structuredClone(report);mutate(changed.runs[1].frames[0].materialInputChecks.afterOpaque);const result=summarizeCanonical(changed);assert.equal(result.gates.coverage,true);assert.equal(result.gates.materialInputAgreement,false);assert.equal(result.gates.repeatability,false);
 }
 for(const mutate of [r=>delete r.runs[1].frames[0].materialInputChecks.final,r=>r.controls.instanceInputs=false,r=>delete r.runs[1].frames[0].stages['instanceSource:test'],r=>r.runs[1].frames[0].materialInputChecks.afterOpaque.sourceCount=3,r=>r.runs[1].frames[0].materialInputChecks.final.checkedChannels=3]){
  const incomplete=structuredClone(report);mutate(incomplete);assert.equal(summarizeCanonical(incomplete).gates.coverage,false);assert.equal(summarizeCanonical(incomplete).gates.repeatability,false);
 }
});

test('current material uniform layout is checked against its declaration and cannot accept a truncated archived capture',()=>{
 const report=fixture();report.controls.materialUniforms=true;report.materialUniforms={words:96,bytes:384};
 for(const run of report.runs)for(const frame of run.frames){
  for(const name of ['materialUniform:test','materialUniformHost:test:0'])frame.stages[name]=structuredClone(frame.stages.opaque);
  frame.materialUniformChecks={opaquePasses:1,expectedDraws:1,uniformWords:96,uniqueBindings:1,checkedWords:96,draws:[{objectId:'test',pipeline:'material 2 opaque back',hostStage:'materialUniformHost:test:0',gpuStage:'materialUniform:test',checkedWords:96,changedChannels:0,maxEncodedError:0}]};
 }
 assert.equal(summarizeCanonical(report).gates.materialUniformAgreement,true);
 for(const change of [r=>{const c=r.runs[0].frames[0].materialUniformChecks;c.uniformWords=c.checkedWords=c.draws[0].checkedWords=92;},r=>r.materialUniforms.bytes=368,r=>r.materialUniforms.words=104,r=>delete r.materialUniforms]){const bad=structuredClone(report);change(bad);assert.equal(summarizeCanonical(bad).gates.coverage,false);}
});

test('material uniform gate requires every draw host/GPU reference and retains a word mismatch',()=>{
 const report=fixture();report.controls.materialUniforms=true;
 for(const run of report.runs)for(const frame of run.frames){
  for(const name of ['materialUniform:test','materialUniformHost:test:0'])frame.stages[name]=structuredClone(frame.stages.opaque);
  frame.materialUniformChecks={opaquePasses:1,expectedDraws:1,uniformWords:92,uniqueBindings:1,checkedWords:92,draws:[{objectId:'test',pipeline:'material 2 opaque back',hostStage:'materialUniformHost:test:0',gpuStage:'materialUniform:test',checkedWords:92,changedChannels:0,maxEncodedError:0}]};
 }
 assert.equal(summarizeCanonical(report).gates.repeatability,true);assert.equal(summarizeCanonical(report).gates.materialUniformAgreement,true);
 const changed=structuredClone(report);changed.runs[1].frames[1].materialUniformChecks.draws[0].changedChannels=1;const result=summarizeCanonical(changed);assert.equal(result.gates.coverage,true);assert.equal(result.gates.materialUniformAgreement,false);assert.equal(result.gates.repeatability,false);
 for(const mutate of [r=>delete r.runs[1].frames[0].materialUniformChecks,r=>r.runs[1].frames[0].materialUniformChecks.draws=[],r=>delete r.runs[1].frames[0].stages['materialUniform:test'],r=>delete r.runs[1].frames[0].stages['materialUniformHost:test:0'],r=>r.runs[1].frames[0].materialUniformChecks.uniformWords=88,r=>r.runs[1].frames[0].materialUniformChecks.uniqueBindings=2,r=>r.runs[1].frames[0].materialUniformChecks.expectedDraws=2]){
  const incomplete=structuredClone(report);mutate(incomplete);assert.equal(summarizeCanonical(incomplete).gates.coverage,false);assert.equal(summarizeCanonical(incomplete).gates.materialUniformAgreement,false);
 }
});

test('full-precision world gate requires native word formats, pass coverage and source observations',()=>{
 const report=fixture();Object.assign(report.controls,{lightingProbe:true,probeKind:'world-input',probeF32:true,instanceInputs:true,opaqueBoundary:true,count:2,width:2,height:1});report.fullPrecisionProbe={format:'rgba32float',encoding:'rgba32float raw words',colorAttachmentBytesPerSample:36,requiredColorAttachmentLimit:36,originalNormalWritten:false};report.lightingProbe={postprocessUsesProbeNormals:false};
 for(const run of report.runs)for(const frame of run.frames){
  for(const name of ['lightingProbe','lightingProbeAfterOpaque'])frame.stages[name]={...structuredClone(frame.stages.opaque),width:2,height:1,channels:4,encoding:'rgba32float raw words'};
  frame.stages['instanceSource:test']=structuredClone(frame.stages.opaque);frame.probe32Checks={opaquePasses:1,format:'rgba32float',colorAttachmentBytesPerSample:36,adapterColorAttachmentLimit:128,requestedColorAttachmentLimit:36,originalNormalWritten:false,promotedPipelines:72};frame.opaqueBoundaryChecks={};for(const name of ['opaque','normal','specular','velocity']){frame.opaqueBoundaryChecks[name]={changedChannels:0,maxEncodedError:0};if(name!=='normal')frame.stages[name+'AfterOpaque']=structuredClone(frame.stages.opaque);}
  frame.worldInputChecks=Object.fromEntries(['final','afterOpaque'].map(name=>[name,{sourceCount:2,backgroundPixels:0,nonInstancedPixels:1,instancedPixels:1,coveredPixels:2,invalidIndexPixels:0,checkedChannels:8}]));
 }
 assert.equal(summarizeCanonical(report).gates.repeatability,true);assert.equal(summarizeCanonical(report).gates.worldInputIndexAgreement,true);
 const changed=structuredClone(report);changed.runs[1].frames[0].worldInputChecks.afterOpaque.invalidIndexPixels=1;assert.equal(summarizeCanonical(changed).gates.coverage,true);assert.equal(summarizeCanonical(changed).gates.worldInputIndexAgreement,false);
 for(const mutate of [r=>delete r.fullPrecisionProbe,r=>delete r.runs[1].frames[0].probe32Checks,r=>r.runs[1].frames[0].stages.lightingProbe.encoding='rgba16float raw words',r=>r.runs[1].frames[0].probe32Checks.originalNormalWritten=true,r=>delete r.runs[1].frames[0].worldInputChecks.final,r=>delete r.runs[1].frames[0].stages['instanceSource:test'],r=>r.controls.instanceInputs=false]){const incomplete=structuredClone(report);mutate(incomplete);assert.equal(summarizeCanonical(incomplete).gates.fullPrecisionProbeCoverage,false);assert.equal(summarizeCanonical(incomplete).gates.repeatability,false);}
});

test('current 100-word material captures declare their full layout while retaining archived 96-word support',()=>{
 const report=fixture();report.controls.materialUniforms=true;report.materialUniforms={words:100,bytes:400};
 for(const run of report.runs)for(const frame of run.frames){for(const name of ['materialUniform:test','materialUniformHost:test:0'])frame.stages[name]=structuredClone(frame.stages.opaque);frame.materialUniformChecks={opaquePasses:1,expectedDraws:1,uniformWords:100,uniqueBindings:1,checkedWords:100,draws:[{objectId:'test',pipeline:'material 2 opaque back',hostStage:'materialUniformHost:test:0',gpuStage:'materialUniform:test',checkedWords:100,changedChannels:0,maxEncodedError:0}]};}
 assert.equal(summarizeCanonical(report).gates.coverage,true);report.materialUniforms.bytes=384;assert.equal(summarizeCanonical(report).gates.coverage,false);
});
