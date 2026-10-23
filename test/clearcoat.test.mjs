import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PROBE_MIP_LEVELS,PROBE_FILTER_SAMPLES,probeFilterPlan,PROBE_FILTER_SHADER} from '../dist/render/probe-filter.js';
const source=await readFile(new URL('../src/render/webgpu.ts',import.meta.url),'utf8');
const effects=await readFile(new URL('../src/render/lighting.ts',import.meta.url),'utf8');
test('local probe convolution covers every roughness level and face exactly once',()=>{
 const plan=probeFilterPlan();assert.equal(plan.length,6*(PROBE_MIP_LEVELS-1));
 assert.equal(new Set(plan.map(p=>`${p.face}:${p.mip}`)).size,plan.length);
 for(let face=0;face<6;face++){
  const levels=plan.filter(p=>p.face===face);assert.equal(levels.at(-1).roughness,1);
  levels.forEach((p,i)=>{assert.equal(p.mip,i+1);assert.ok(p.roughness>0&&p.roughness<=1);});
 }
 assert.equal(PROBE_FILTER_SAMPLES,64);
});
test('probe filter normalizes radiance and reads only the captured level',()=>{
 assert.match(PROBE_FILTER_SHADER,/sum\/max\(total/);
 assert.match(source,/localProbeCapture.createView\(\{dimension:'cube',baseMipLevel:0,mipLevelCount:1\}\)/);
 assert.match(source,/baseMipLevel:capture.mip,mipLevelCount:1/);
 assert.match(source,/mipmapFilter:'linear'/);
});
test('coat roughness blurs parallax-corrected local radiance rather than suppressing it',()=>{
 assert.doesNotMatch(source,/coatProbeWeight|reflectionDir,\.35\)/);
 assert.match(source,/reflectionDir,coatRough\*f32\(textureNumLevels\(environmentMap\)-1u\)/);
 assert.match(source,/coatProbeLod=max\(coatRough\*f32\(textureNumLevels\(localProbeMap\)-1u\),select\(0\.0,\.65,automotivePaint\)\)/);
 assert.match(source,/textureSampleLevel\(localProbeMap,reflectionSampler,parallaxProbeDirection\(in.worldPos,reflectionDir\),coatProbeLod\)/);
 assert.match(source,/coatEnvironment=mix\(coatEnvironment,coatLocal,f.params.y\)/);
});
test('coat filters normal variance independently of the rougher base lobe',()=>{
 // Main already uses a narrower coat variance kernel and a paint floor. The
 // old literal regex described the pre-refinement shader, not this contract.
 assert.match(source,/paintCoatFloor=select\(\.0,\.055,automotivePaint\)/);
 assert.match(source,/coatRough=clamp\(max\(paintCoatFloor,sqrt\(clearcoatRoughness\*clearcoatRoughness\+min\(\.06,normalVariance\*\.04\)\)\),\.08,1\.0\)/);
 assert.match(source,/let coatA2=pow\(coatRough,4\.0\)/);
});
test('coat direct and indirect light attenuate the base without emissive gains',()=>{
 assert.doesNotMatch(source,/clearcoat\*coatF\*\.28|clearcoat\*\(\.52/);
 assert.match(source,/materialAO\*\(1\.0-coatViewF\)/);
 assert.match(source,/environmentWeight\*pow\(1\.0-coatViewF,2\.0\)/);
 assert.match(source,/shadow\*\(1\.0-coatLightF\)/);
});
test('SSR uses independent coating roughness while AO retains the base roughness',()=>{
 assert.match(source,/out.normal=vec4<f32>\(n\*\.5\+\.5,roughness\)/);
 assert.match(source,/\.5\+\.5\*screenRoughness/);
 assert.match(effects,/rough=clamp\(coating.a\*2\.0-1\.0,0\.0,1\.0\)/);
 assert.match(source,/environmentFresnel\*pow\(1\.0-coatViewF,2\.0\)\+vec3<f32>\(coatViewF\)/);
});
