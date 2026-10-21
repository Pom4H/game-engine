/** Immutable presentation dependencies, compiled once when a device is created.
 * Changing quality selects work; simulation and world state remain authoritative. */
export interface RenderFeatures {
  screenSpace:boolean;
  bloom:boolean;
  temporalAA:boolean;
  planarReflections:boolean;
  motionBlur:boolean;
}
export interface RenderPipelinePlan {
  readonly features:Readonly<RenderFeatures>;
  readonly effects:boolean;
  readonly motionVectors:boolean;
  readonly temporalSource:'effects'|'hdr';
  readonly presentSource:'motionBlur'|'taa'|'effects'|'hdr';
  readonly colorTargets:readonly (string|null)[];
  readonly passes:readonly string[];
}
const defaults:Readonly<RenderFeatures>=Object.freeze({screenSpace:true,bloom:true,temporalAA:true,planarReflections:true,motionBlur:false});
export function compileRenderPipeline(input:Partial<RenderFeatures>={}):RenderPipelinePlan {
  for(const [key,value] of Object.entries(input))if(!Object.hasOwn(defaults,key)||typeof value!=='boolean')throw new RangeError(`Invalid render feature ${key}`);
  const features=Object.freeze({...defaults,...input}),effects=features.screenSpace||features.bloom;
  const temporalSource=effects?'effects':'hdr',presentSource=features.motionBlur?'motionBlur':features.temporalAA?'taa':temporalSource,motionVectors=features.temporalAA||features.motionBlur;
  return Object.freeze({features,effects,motionVectors,temporalSource,presentSource,colorTargets:Object.freeze(['rgba16float',features.screenSpace?'rgba16float':null,features.screenSpace?'rgba8unorm':null,motionVectors?'rg16float':null]),passes:Object.freeze([
    ...(features.planarReflections?['reflection']:[]),'main.opaque','main.transparent',
    ...(features.bloom?['bloom.downsample','bloom.horizontal','bloom.vertical']:[]),
    ...(effects?['effects']:[]),...(features.temporalAA?['taa']:[]),...(features.motionBlur?['motionBlur']:[]),'present',
  ])});
}

/** Bloom without screen-space transport needs only these two radiance inputs. */
export const BLOOM_COMPOSITE_SHADER=`
@group(0) @binding(0) var hdr:texture_2d<f32>;
@group(0) @binding(3) var imageSampler:sampler;
@group(0) @binding(6) var bloom:texture_2d<f32>;
struct Out {@builtin(position) position:vec4<f32>,@location(0) uv:vec2<f32>}
@vertex fn vs(@builtin(vertex_index) i:u32)->Out{let p=vec2<f32>(f32((i<<1u)&2u),f32(i&2u));var o:Out;o.position=vec4<f32>(p*2.0-1.0,0,1);o.uv=vec2<f32>(p.x,1.0-p.y);return o;}
@fragment fn fs(in:Out)->@location(0) vec4<f32>{return vec4<f32>(textureSampleLevel(hdr,imageSampler,in.uv,0).rgb+textureSampleLevel(bloom,imageSampler,in.uv,0).rgb*.46,1);}
`;
