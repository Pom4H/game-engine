import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeWGSL,buildRenderAtomReport} from '../dist/index.js';

test('WGSL atom census expands reachable helper functions without inventing runtime loop counts',()=>{
 const shader=analyzeWGSL('sample',`
  @group(0) @binding(0) var source:texture_2d<f32>;
  @group(0) @binding(1) var samp:sampler;
  fn helper(uv:vec2<f32>)->vec3<f32>{return textureSampleLevel(source,samp,uv,0).rgb;}
  @fragment fn fs()->@location(0) vec4<f32>{var c=helper(vec2<f32>(0));if(c.x>0.0){c+=helper(vec2<f32>(1));}return vec4<f32>(c,1);}
 `,['fs']);
 const fs=shader.entries.fs;assert.equal(fs.textureSamples,2);assert.equal(fs.branches,1);assert.ok(fs.arithmetic>0);assert.deepEqual(new Set(fs.reachableFunctions),new Set(['fs','helper']));
});

test('render atom report exposes command and logical memory costs',()=>{
 const report=buildRenderAtomReport({
  width:1280,height:720,shadowDraws:3,reflectionDraws:2,mainOpaqueDraws:4,mainTransparentDraws:1,snowInstances:100,
  shadowTriangles:300,reflectionTriangles:200,mainOpaqueTriangles:400,mainTransparentTriangles:50,
  materialDraws:{asphalt:3,glass:2},materialTriangles:{asphalt:300,glass:150},
  uploads:{total:1000,uniform:600,surface:200,light:100,frame:64,snow:36},shaders:{},
 });
 assert.equal(report.commands.renderPasses,9);assert.equal(report.commands.drawIndexed,10);assert.equal(report.commands.instances,100);
 assert.equal(report.geometry.snowTriangles,200);assert.equal(report.memory.uploads.total,1000);
 assert.equal(report.memory.logicalResolveBytes,0);assert.ok(report.memory.logicalAttachmentWriteBytes>1280*720*4);assert.ok(report.memory.fullscreenTextureReadBytes.effectsMinimum>0);assert.ok(report.memory.fullscreenTextureReadBytes.taa>0);assert.ok(report.memory.fullscreenTextureReadBytes.present>0);
});
