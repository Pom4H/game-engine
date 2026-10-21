import type {RenderFeatures} from './pipeline-plan.js';
import {CAMERA_DEPTH_WGSL} from './camera-depth.js';
export interface PostProcessingSettings {temporalAA:boolean;bloom:boolean;motionBlur:number}
/** A device compiles capabilities once; changing camera effects never replaces
 * Scene identities, simulation, geometry, materials or the device. */
export function resolvePostProcessing(features:Readonly<RenderFeatures>,current:Readonly<PostProcessingSettings>,input:Partial<PostProcessingSettings>):PostProcessingSettings{
 for(const [key,value]of Object.entries(input)){
  if(key==='motionBlur'){if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1)throw new RangeError('motionBlur must be in [0,1]');if(value>0&&!features.motionBlur)throw new RangeError('Motion blur was not compiled');}
  else if(key==='temporalAA'||key==='bloom'){if(typeof value!=='boolean'||value&&!features[key])throw new RangeError(`${key} is unavailable or invalid`);}
  else throw new RangeError(`Unknown postprocessing setting ${key}`);
 }
 return {...current,...input};
}
/** The Game's bounded shutter/depth rejection, applied in linear HDR after TAA.
 * Geometry velocity includes object motion. Raster jitter is removed so a
 * stationary scene does not blur when temporal coverage samples change. */
export const MOTION_BLUR_SHADER=CAMERA_DEPTH_WGSL+`
@group(0) @binding(0) var source:texture_2d<f32>;
@group(0) @binding(1) var velocity:texture_2d<f32>;
@group(0) @binding(2) var depth:texture_depth_2d;
@group(0) @binding(3) var linearSampler:sampler;
struct Shutter {control:vec4<f32>,jitter:vec4<f32>,depthProjection:vec4<f32>}
@group(0) @binding(4) var<uniform> shutter:Shutter;
struct Out {@builtin(position) position:vec4<f32>,@location(0) uv:vec2<f32>}
@vertex fn vs(@builtin(vertex_index) i:u32)->Out{let p=vec2<f32>(f32((i<<1u)&2u),f32(i&2u));var o:Out;o.position=vec4<f32>(p*2.0-1.0,0,1);o.uv=vec2<f32>(p.x,1.0-p.y);return o;}
fn linearDepth(d:f32)->f32{if(shutter.control.z>0.0){return logarithmicCameraDistance(d,shutter.control.z);}let p=shutter.depthProjection;return max(0.0,-(p.y-d*p.w)/(d*p.z-p.x));}
@fragment fn fs(in:Out)->@location(0) vec4<f32>{
 let size=vec2<f32>(textureDimensions(source));let dims=vec2<i32>(size);let halfTexel=.5/size;
 let rasterUV=clamp(in.uv+shutter.jitter.xy,halfTexel,vec2<f32>(1)-halfTexel);
 let pixel=clamp(vec2<i32>(rasterUV*size),vec2<i32>(0),dims-1);
 let center=textureSampleLevel(source,linearSampler,in.uv,0).rgb;
 let d=textureLoad(depth,pixel,0);let motion=textureLoad(velocity,pixel,0).xy-shutter.jitter.xy+shutter.jitter.zw;
 let finite=all((bitcast<vec2<u32>>(motion)&vec2<u32>(0x7f800000u))!=vec2<u32>(0x7f800000u));
 if(shutter.control.y<.5||!finite||d>=.99999){return vec4<f32>(center,1);}
 let blur=clamp(motion*shutter.control.x,vec2<f32>(-.015),vec2<f32>(.015));let z=linearDepth(d);
 var color=center;var weights=1.0;
 for(var i=1;i<=4;i++){
  let t=f32(i)/4.0-.5;let uv=clamp(in.uv+blur*t,halfTexel,vec2<f32>(1)-halfTexel);
  let q=clamp(vec2<i32>((uv+shutter.jitter.xy)*size),vec2<i32>(0),dims-1);let sampleZ=linearDepth(textureLoad(depth,q,0));
  let weight=select(0.0,1.0,abs(sampleZ-z)<max(.1,z*.04));
  color+=textureSampleLevel(source,linearSampler,uv,0).rgb*weight;weights+=weight;
 }
 return vec4<f32>(color/weights,1);
}
`;
