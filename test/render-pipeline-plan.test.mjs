import test from 'node:test';
import assert from 'node:assert/strict';
import {compileRenderPipeline} from '../dist/render/pipeline-plan.js';
import {buildRenderAtomReport} from '../dist/render/atoms.js';

test('quality plans compile all radiance dependency combinations without mutable caller state',()=>{
  for(let bits=0;bits<32;bits++){
    const input={screenSpace:!!(bits&1),bloom:!!(bits&2),temporalAA:!!(bits&4),planarReflections:!!(bits&8),motionBlur:!!(bits&16)},saved={...input};
    const plan=compileRenderPipeline(input);input.bloom=!input.bloom;
    assert.deepEqual(plan.features,saved);assert.ok(Object.isFrozen(plan)&&Object.isFrozen(plan.features)&&Object.isFrozen(plan.passes));
    const radiance=saved.screenSpace||saved.bloom?'effects':'hdr';
    assert.equal(plan.temporalSource,radiance);assert.equal(plan.presentSource,saved.motionBlur?'motionBlur':saved.temporalAA?'taa':radiance);
    assert.equal(plan.passes.includes('taa'),saved.temporalAA);assert.equal(plan.passes.includes('effects'),radiance==='effects');
    assert.equal(plan.passes.includes('reflection'),saved.planarReflections);assert.equal(plan.passes.includes('bloom.downsample'),saved.bloom);
    assert.equal(plan.passes.at(-1),'present');
    assert.deepEqual(plan.colorTargets,['rgba16float',saved.screenSpace?'rgba16float':null,saved.screenSpace?'rgba8unorm':null,saved.temporalAA||saved.motionBlur?'rg16float':null]);
  }
  assert.throws(()=>compileRenderPipeline({bloom:1}),/Invalid render feature/);
  assert.throws(()=>compileRenderPipeline({toString:true}),/Invalid render feature/);
  assert.throws(()=>compileRenderPipeline({temporalAa:false}),/Invalid render feature/);
});

test('disabled work contributes no postprocessing traffic or attachment writes to the profiler',()=>{
  const input={width:1920,height:1080,shadowMapSize:2048,shadowDraws:0,reflectionDraws:0,mainOpaqueDraws:1,mainTransparentDraws:0,snowInstances:0,shadowTriangles:0,reflectionTriangles:0,mainOpaqueTriangles:12,mainTransparentTriangles:0,materialDraws:{},materialTriangles:{},shadowBatchedInstances:0,shadowBatchedDraws:0,uploads:{total:0,uniform:0,surface:0,light:0,frame:0,snow:0,environment:0,instance:0},shaders:{}};
  const full=buildRenderAtomReport(input),minimal=buildRenderAtomReport({...input,pipeline:compileRenderPipeline({screenSpace:false,bloom:false,temporalAA:false,planarReflections:false})});
  assert.ok(minimal.memory.logicalAttachmentWriteBytes<full.memory.logicalAttachmentWriteBytes);
  for(const [key,value] of Object.entries(minimal.memory.fullscreenTextureReadBytes))if(key!=='present')assert.equal(value,0,key);
  for(const key of ['effectsHdr','taaHistory','reflectionColor','reflectionDepth','bloomDownsample','bloomHorizontal','bloomVertical','mainNormal','mainSpecular','mainVelocity'])assert.equal(minimal.memory.attachments[key],undefined,key);
  assert.equal(minimal.commands.byPass.effects,undefined);assert.equal(minimal.commands.byPass.taa,undefined);assert.equal(minimal.commands.byPass.reflection,undefined);
  const compiled=compileRenderPipeline({motionBlur:true}),off=buildRenderAtomReport({...input,pipeline:compiled,postProcessing:{temporalAA:false,bloom:false,motionBlur:0}});
  assert.equal(off.commands.byPass.taa,undefined);assert.equal(off.commands.byPass.motionBlur,undefined);assert.equal(off.commands.byPass['bloom.downsample'],undefined);
  assert.ok(off.memory.attachments.mainVelocity,'compiled motion MRT still writes when runtime post passes are disabled');assert.equal(off.memory.attachments.taaHistory,undefined);
  const shutter=buildRenderAtomReport({...input,pipeline:compiled,postProcessing:{temporalAA:false,bloom:false,motionBlur:.25}});
  assert.equal(shutter.commands.byPass.motionBlur.draw,1);assert.equal(shutter.commands.byPass.taa,undefined);assert.ok(shutter.memory.fullscreenTextureReadBytes.motionBlur>0);
});
