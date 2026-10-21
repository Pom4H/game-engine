import {MATERIAL_UNIFORM_WORDS,MATERIAL_UNIFORM_BYTES} from './material-layout.js';
import {FACADE_SURFACE_WGSL} from './facade-surface.js';
import {GROUND_LITTER_WGSL} from './ground-litter.js';
import {GROUND_COVER_WGSL} from './ground-cover.js';
import {RAIN_SURFACE_WGSL,writeSurfaceWeather,writeProbeSurfaceWeather} from './rain-surface.js';
import {TERRAIN_MAP_WGSL} from './terrain-map.js';
import {COATING_LOSS_WGSL} from './coating-loss.js';
import {SURFACE_HIT_WGSL,surfacePassShader} from './surface-hit.js';
import {createNoiseVolume,NOISE_VOLUME_SIZE} from './noise-volume.js';
import {PROBE_MIP_LEVELS,PROBE_FILTER_SHADER,probeFilterPlan} from './probe-filter.js';
import {ProbeCapture} from './probe-capture.js';
import {bakeEnvironmentMap,type EnvironmentMapData} from './environment-map.js';
import {EnvironmentMapWorker,type EnvironmentWorker} from './environment-map-worker.js';
import {meshBounds,intersectsClip,type MeshBounds} from './visibility.js';
import {GpuVisibility,InstanceStream,INSTANCE_FLOATS,CURRENT_INSTANCE_FLOATS,VISIBILITY_SHADER,type VisibilityBatch,type VisibilityMode,type VisibilityRequest} from './gpu-visibility.js';
import {instancedMaterialShader,instancedReflectionShader,instancedShadowShader,ShadowInstanceIndices} from './instancing.js';
import {RenderVisibilityPlan,castsRenderShadow} from './visibility-plan.js';
import {selectSpotShadows,SPOT_SHADOW_LIMIT,SPOT_SHADOW_SIZE,SPOT_SHADOW_WGSL,type SpotShadow} from './spot-shadow.js';
import {RenderModelHistory} from './model-history.js';
import {MOTION_BLUR_SHADER,resolvePostProcessing,type PostProcessingSettings} from './camera-post.js';
import {compileRenderPipeline,BLOOM_COMPOSITE_SHADER,type RenderFeatures,type RenderPipelinePlan} from './pipeline-plan.js';
import {SurfaceTextures} from './surface-textures.js';
import {buildLightGrid,LIGHT_GRID_WGSL,MAX_RENDER_LIGHTS,LIGHT_GRID_SIDE,LIGHT_GRID_CELL,LIGHTS_PER_CELL,LIGHT_SOURCE_FLOATS} from './light-grid.js';
import {FOG_WGSL,FOG_MEDIUM_WGSL} from './fog.js';
import {FRAME_UNIFORM_WORDS,FRAME_UNIFORM_BYTES,FRAME_WGSL,SKY_SHADER,EFFECTS_SHADER,PRESENT_SHADER,BLOOM_SHADER,TAA_SHADER} from './lighting.js';
import {V3,compose,lookAt,multiply4,multiply4Into,perspective,type Mat4,type Vec3} from '../math.js';
import {primitiveKey,primitiveMesh,meshVertexAttributes} from '../procedural/mesh.js';
import type {Primitive,CameraSpec,SurfaceTextureSpec,EnvironmentRadianceSpec} from '../scene/types.js';
import type {Scene,RuntimeEntity} from '../scene/scene.js';
import type {Renderer,RenderStats} from './types.js';
import {RenderProfiler} from './profiler.js';
import {analyzeWGSL,buildRenderAtomReport,type ShaderProgramAtoms} from './atoms.js';
import {buildSceneRadianceProbe,distantRadianceKey,distantRadianceCacheStats,RenderRadianceProjection} from './radiance.js';
import {SHADOW_FILTER_WGSL} from './shadow-filter.js';
import {sunShadowProjection} from './shadow-projection.js';
import {cameraProjection} from './calibrated-camera.js';
import {cameraDepthConfiguration,type CameraDepthConfiguration} from './camera-depth.js';
import {renderPrimitive,renderModel,primitiveBaseScale,RenderFrameCache,type RenderFrameIR,type RenderObjectIR} from './frame.js';
import {RenderFrameFamily,type RenderFrameBuilder} from './depth.js';
import type {SimulationProfileInput} from '../core/depth.js';
import {buildDiffuseIrradianceSH} from './irradiance.js';
import {snowfallShader,snowfallUniform} from './snowfall.js';
import {opaqueDepthPrepassEnabled,opaqueDepthPrepassShader} from './opaque-depth-prepass.js';

type GPUAny=any;
const defaultLabelColor:Vec3=[226/255,217/255,188/255];
const emptyLabelKey=JSON.stringify(['',defaultLabelColor]);
const labelKey=(text:string,color?:Vec3)=>text===''&&color===undefined?emptyLabelKey:JSON.stringify([text,color??defaultLabelColor]);
const SHADOW_MAP_SIZE=2048;
const DYNAMIC_SHADOW_MAP_SIZE=1024;
export interface WebGPURendererOptions {profiling?:boolean;visibility?:VisibilityMode;features?:Partial<RenderFeatures>;logarithmicDepthFar?:number;opaqueDepthPrepass?:boolean}
interface GPUMesh{key:string;bounds:MeshBounds;vertex:GPUAny;color:GPUAny;index:GPUAny;count:number;format:'uint16'|'uint32';triangles:number}
interface GPUObject{source?:RuntimeEntity;material?:RuntimeEntity['material'];uniform:GPUAny;bind:GPUAny;texture:GPUAny;deformationTexture:GPUAny;width:number;height:number;owned?:boolean;label?:string;materialKey?:string;uniformReady?:boolean;lastModel?:Mat4;lastPrevModel?:Mat4;instancedMaterial?:boolean;
  materialTexture?:GPUAny;normalTexture?:GPUAny;ormTexture?:GPUAny;heightTexture?:GPUAny;labelTexture?:GPUAny;
  /** Bounded object staging buffers reused across frames. */
  uniformStaging?:Float32Array;surfaceStaging?:Float32Array;deformationStaging?:Float32Array;lastSurfaceRevision?:number|undefined;
}
interface GPUCameraBatch {buffer:GPUAny;stream:InstanceStream;visibility:VisibilityBatch;bind:GPUAny;reflection?:{visibility:VisibilityBatch;bind:GPUAny};shadows?:Partial<Record<'static'|'dynamic'|'spot0'|'spot1',ShadowInstanceIndices>>;items:RuntimeEntity[];mesh:GPUMesh;code:number;culled:boolean;records:{entity:RuntimeEntity;model:Mat4;previous:Mat4;material:RuntimeEntity['material']}[]}
interface SharedShadowPlan {batch:GPUCameraBatch;view:ShadowInstanceIndices}
interface CameraBatchCause {entity:RuntimeEntity;primitive:Primitive|undefined;material:RuntimeEntity['material'];surfaceUse:number;eligible:boolean}
interface GPUShadowBatch{buffer:GPUAny;capacity:number;data?:Float32Array}
interface GPUInstanceBatch{buffer:GPUAny;capacity:number;data:Float32Array}
interface InstancePlan{key:string;items:RuntimeEntity[];first:RuntimeEntity;culled:boolean;buffer:GPUAny}
interface ShadowBatchPlan{key:string;items:RuntimeEntity[];culled:boolean;buffer:GPUAny}
const materialShader=(reflection=false,relief=false,coating=false,logarithmic=false)=>FRAME_WGSL+LIGHT_GRID_WGSL+FOG_WGSL+RAIN_SURFACE_WGSL+TERRAIN_MAP_WGSL+GROUND_LITTER_WGSL+GROUND_COVER_WGSL+FACADE_SURFACE_WGSL+(coating?COATING_LOSS_WGSL:'')+`
override MATERIAL_CLASS:i32=-1;
struct U {
  model: mat4x4<f32>,
  prevModel: mat4x4<f32>,
  color: vec4<f32>,
  surface: vec4<f32>,     // moss, wetness, roughness, darkening
  weather: vec4<f32>,     // dirt, wear, seed, material kind
  surfacePhase: vec4<f32>, // snow depth m, water depth m, slush, ice depth m
  surfaceDynamics: vec4<f32>, // puddle, track melt, body deposition, rear deposition
  motion: vec4<f32>,      // dir x, dir z, road dirt, body wetness
  objectState: vec4<f32>, // surface-use, treatment, clearcoat, clearcoat roughness
  fieldFrame: vec4<f32>,
  fieldSize: vec4<f32>,
  pbr:vec4<f32>,
  emission:vec4<f32>,
  texture:vec4<f32>, // size metres, bump amount, albedo blend, enabled
  detail:vec4<f32>,  // normal strength, normal enabled, ORM strength, ORM enabled
  snowpack:vec4<f32>, // freshness, liquid fraction, crust, normalized grain size
  relief:vec4<f32>, // depth metres, height map ready
  surfaceOverride:vec4<f32>,groundDetail:vec4<f32>, // external wetness/darkening, final authored roughness
}
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var fieldTexture: texture_2d<f32>;
@group(0) @binding(2) var labelTexture:texture_2d<f32>;
@group(0) @binding(3) var labelSampler:sampler;
@group(0) @binding(4) var surfaceTexture:texture_2d<f32>;
@group(0) @binding(5) var surfaceSampler:sampler;
@group(0) @binding(6) var normalTexture:texture_2d<f32>;
@group(0) @binding(7) var ormTexture:texture_2d<f32>;
@group(0) @binding(8) var deformationTexture:texture_2d<f32>;
@group(1) @binding(0) var<uniform> f:Frame;
@group(1) @binding(1) var shadowMap:texture_depth_2d;
@group(1) @binding(2) var shadowSampler:sampler_comparison;
@group(1) @binding(3) var reflectionMap:texture_2d<f32>;
@group(1) @binding(4) var reflectionSampler:sampler;
@group(1) @binding(7) var noiseVolume:texture_3d<f32>;
@group(1) @binding(8) var noiseSampler:sampler;
@group(1) @binding(9) var environmentMap:texture_cube<f32>;
@group(1) @binding(10) var localProbeMap:texture_cube<f32>;
@group(1) @binding(11) var dynamicShadowMap:texture_depth_2d;
@group(1) @binding(12) var opaqueScene:texture_2d<f32>;
${relief?SURFACE_HIT_WGSL:''}
fn deformationAt(worldXZ:vec2<f32>)->vec4<f32>{
 if(u.fieldSize.w<.5){return vec4<f32>(0);}
 let dims=max(vec2<i32>(1),vec2<i32>(u.fieldSize.xy));
 let uv=clamp((worldXZ-u.fieldFrame.xy)/max(u.fieldFrame.zw,vec2<f32>(.0001))+.5,vec2<f32>(0),vec2<f32>(1));
 let p=clamp(uv*vec2<f32>(dims)-.5,vec2<f32>(0),vec2<f32>(dims-1));
 let i0=vec2<i32>(floor(p));let i1=min(i0+vec2<i32>(1),dims-1);let t=fract(p);
 let a=textureLoad(deformationTexture,i0,0);
 let b=textureLoad(deformationTexture,vec2<i32>(i1.x,i0.y),0);
 let c=textureLoad(deformationTexture,vec2<i32>(i0.x,i1.y),0);
 let d=textureLoad(deformationTexture,i1,0);
 return mix(mix(a,b,t.x),mix(c,d,t.x),t.y);
}
fn displaceWorld(world:vec4<f32>)->vec4<f32>{var w=world;if(u.fieldSize.w>.5){w.y+=deformationAt(w.xz).x;}return w;}
@vertex fn shadowVS(@location(0) position:vec3<f32>)->@builtin(position) vec4<f32>{return f.lightVP*displaceWorld(u.model*vec4<f32>(position,1));}
@vertex fn shadowVSInstanced(
 @location(0) position:vec3<f32>,
 @location(2) m0:vec4<f32>,@location(3) m1:vec4<f32>,@location(4) m2:vec4<f32>,@location(5) m3:vec4<f32>
)->@builtin(position) vec4<f32>{return f.lightVP*displaceWorld(mat4x4<f32>(m0,m1,m2,m3)*vec4<f32>(position,1));}
${SHADOW_FILTER_WGSL}
${SPOT_SHADOW_WGSL}
fn shadowAt(p:vec3<f32>,n:vec3<f32>)->f32{
 let clip=f.lightVP*vec4<f32>(p+n*.003,1);let uv=clip.xy*.5*vec2<f32>(1,-1)+.5;
 // Offset taps need the receiver depth at their own UV, rather than the
 // centre depth. Derive the actual geometric plane before any early return;
 // the material normal bias must not define the receiver's slope.
 let receiver=f.lightVP*vec4<f32>(p,1);
 let plane=vec3<f32>(receiver.xy*.5*vec2<f32>(1,-1)+.5,receiver.z);
 let gradient=shadowReceiverGradient(dpdx(plane),dpdy(plane));
 if(any(uv<vec2<f32>(0))||any(uv>vec2<f32>(1))||clip.z>1.0||clip.z<0.0){return 1.0;}
 var staticValue=0.0;var dynamicValue=f32(DYNAMIC_SHADOW_SAMPLES);
 let staticTexel=1.0/vec2<f32>(textureDimensions(shadowMap));
 for(var i=0u;i<STATIC_SHADOW_SAMPLES;i++){
  let offset=SHADOW_TAPS[i]*staticTexel*2.05;
  staticValue+=textureSampleCompareLevel(shadowMap,shadowSampler,uv+offset,clip.z+dot(gradient,offset)-.000025);
 }
 if(f.eye.w>.5){
  dynamicValue=0.0;
  let dynamicTexel=1.0/vec2<f32>(textureDimensions(dynamicShadowMap));
  for(var i=0u;i<DYNAMIC_SHADOW_SAMPLES;i++){
   let offset=SHADOW_TAPS[i]*dynamicTexel*1.55;
   dynamicValue+=textureSampleCompareLevel(dynamicShadowMap,shadowSampler,uv+offset,clip.z+dot(gradient,offset)-.000025);
  }
 }
 let visibility=combineShadowVisibility(staticValue,dynamicValue);
 let edge=min(min(uv.x,1.0-uv.x),min(uv.y,1.0-uv.y));return mix(1.0,visibility,smoothstep(0.0,.025,edge));
}

struct VOut {
  @builtin(position) position: vec4<f32>,
  @location(0) normal: vec3<f32>,
  @location(1) worldPos: vec3<f32>,
  @location(2) uv:vec2<f32>,
  @location(3) @interpolate(flat) reflected:u32,
  @location(4) velocity:vec2<f32>,
  @location(5) vertexColor:vec4<f32>,
  @location(6) localPos:vec3<f32>,
  @location(7) @interpolate(flat) tint:vec4<f32>,
  @location(8) @interpolate(flat) instanceSeed:f32,
  @location(10) @interpolate(flat) variationSeed:f32,
  ${logarithmic?'@location(11) cameraDepth:f32,':''}
}

fn hash3(p:vec3<f32>)->f32 {
  var q=fract(p*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);
}
fn noise3(p:vec3<f32>)->f32 {
  let i=floor(p);let f=fract(p);let s=f*f*(3.0-2.0*f);
  return textureSampleLevel(noiseVolume,noiseSampler,(i+s+vec3<f32>(.5))/${NOISE_VOLUME_SIZE}.0,0).r;
}
fn fbm(p:vec3<f32>)->f32 {
  return noise3(p)*0.58+noise3(p*2.07+17.3)*0.28+noise3(p*4.11+41.7)*0.14;
}
fn tileSeam(p:vec2<f32>)->f32{
  let cell=fract(p/0.62);
  let edge=min(min(cell.x,1.0-cell.x),min(cell.y,1.0-cell.y));
  return 1.0-smoothstep(0.018,0.045,edge);
}
fn tyreTracks(z:f32)->f32{
  let repeated=abs(fract((z+0.34)/1.55)-0.5);
  return 1.0-smoothstep(0.065,0.13,repeated);
}

fn grassWorld(world:vec4f,uv:vec2f)->vec4f {
 var result=world;
 if(u.groundDetail.x>4.5){result.y-=uv.y*smoothstep(3.5,6.5,distance(world.xz,f.eye.xz));}
 return result;
}
@vertex fn vs(@location(0) position: vec3<f32>, @location(1) normal: vec3<f32>, @location(6) vertexColor:vec4<f32>, @location(13) authoredUV:vec2<f32>, @location(14) authoredSeed:f32) -> VOut {
  var out: VOut;out.reflected=0u;out.vertexColor=vertexColor;out.localPos=position;out.tint=u.color;out.instanceSeed=u.weather.z;out.variationSeed=authoredSeed+u.weather.z;
  let world=grassWorld(displaceWorld(u.model*vec4<f32>(position,1.0)),authoredUV);
  out.position=f.viewVP*world;${logarithmic?'out.cameraDepth=out.position.w;':''}let previous=f.previousVP*grassWorld(displaceWorld(u.prevModel*vec4<f32>(position,1.0)),authoredUV);
  let currentNdc=out.position.xy/max(abs(out.position.w),.00001);let previousNdc=previous.xy/max(abs(previous.w),.00001);
  out.velocity=vec2<f32>((currentNdc.x-previousNdc.x)*.5,(previousNdc.y-currentNdc.y)*.5);
  out.worldPos=world.xyz;out.uv=authoredUV;
  let a=u.model[0].xyz;let b=u.model[1].xyz;let c=u.model[2].xyz;
  out.normal=normalize(mat3x3<f32>(a/dot(a,a),b/dot(b,b),c/dot(c,c))*normal);
  return out;
}

// Instanced PBR: full per-instance current/previous model, tint and seed.
@vertex fn vsInstanced(
 @location(0) position:vec3<f32>,@location(1) normal:vec3<f32>,@location(6) vertexColor:vec4<f32>,
 @location(2) m0:vec4<f32>,@location(3) m1:vec4<f32>,@location(4) m2:vec4<f32>,@location(5) m3:vec4<f32>,
 @location(7) p0:vec4<f32>,@location(8) p1:vec4<f32>,@location(9) p2:vec4<f32>,@location(10) p3:vec4<f32>,
 @location(11) tint:vec4<f32>,@location(12) seed:vec4<f32>,@location(13) authoredUV:vec2<f32>,@location(14) authoredSeed:f32
)->VOut{
 let m=mat4x4<f32>(m0,m1,m2,m3);let pm=mat4x4<f32>(p0,p1,p2,p3);
 var out:VOut;out.reflected=0u;out.vertexColor=vertexColor;out.localPos=position;out.tint=tint;out.instanceSeed=seed.x;out.variationSeed=authoredSeed+seed.x;
 let world=grassWorld(displaceWorld(m*vec4<f32>(position,1.0)),authoredUV);
 out.position=f.viewVP*world;${logarithmic?'out.cameraDepth=out.position.w;':''}
 let previous=f.previousVP*grassWorld(displaceWorld(pm*vec4<f32>(position,1.0)),authoredUV);
 let currentNdc=out.position.xy/max(abs(out.position.w),.00001);
 let previousNdc=previous.xy/max(abs(previous.w),.00001);
 out.velocity=vec2<f32>((currentNdc.x-previousNdc.x)*.5,(previousNdc.y-currentNdc.y)*.5);
 out.worldPos=world.xyz;out.uv=authoredUV;
 let a=m[0].xyz;let b=m[1].xyz;let c=m[2].xyz;
 out.normal=normalize(mat3x3<f32>(a/dot(a,a),b/dot(b,b),c/dot(c,c))*normal);
 return out;
}
@vertex fn reflectionVS(@location(0) position:vec3<f32>,@location(1) normal:vec3<f32>,@location(6) vertexColor:vec4<f32>,@location(13) authoredUV:vec2f,@location(14) authoredSeed:f32)->VOut{
 var out:VOut;out.vertexColor=vertexColor;out.localPos=position;out.tint=u.color;out.instanceSeed=u.weather.z;out.variationSeed=authoredSeed+u.weather.z;let world=grassWorld(displaceWorld(u.model*vec4<f32>(position,1)),authoredUV);out.position=f.reflectionVP*world;${logarithmic?'out.cameraDepth=out.position.w;':''}out.worldPos=world.xyz;let a=u.model[0].xyz;let b=u.model[1].xyz;let c=u.model[2].xyz;out.normal=normalize(mat3x3<f32>(a/dot(a,a),b/dot(b,b),c/dot(c,c))*normal);out.uv=authoredUV;out.reflected=1u;out.velocity=vec2<f32>(0);return out;
}

fn pointLight(source:PointSource,world:vec3<f32>,n:vec3<f32>,geometric:vec3<f32>,viewDir:vec3<f32>,roughness:f32,base:vec3<f32>,f0:vec3<f32>,metal:f32,coat:f32,coatRoughness:f32)->vec3<f32>{
 let delta=source.position.xyz-world;let dist=length(delta);if(dist>=source.position.w){return vec3<f32>(0);}
 let l=delta/max(dist,.001);let nl=max(dot(n,l),0.0);
 // These factors multiply the complete BRDF by exact zero. Reject before
 // specular evaluation and shadow PCF; retain every nonzero contribution.
 if(nl<=0.0){return vec3<f32>(0);}
 let emission=emissionWeight(source,-delta);if(emission<=0.0){return vec3<f32>(0);}
 let nv=max(dot(n,viewDir),.001);
 let halfVector=l+viewDir;let h=halfVector*inverseSqrt(max(dot(halfVector,halfVector),1e-12));
 // Finite lamp size keeps specular stable at subpixel scale.
 let r=max(roughness,.08+.18/max(dist,1.0));let a2=pow(r,4.0);let nh=max(dot(n,h),0.0);
 let d=a2/(3.14159*pow(nh*nh*(a2-1.0)+1.0,2.0));let k=pow(r+1.0,2.0)/8.0;
 let g=nv/(nv*(1.0-k)+k)*nl/(nl*(1.0-k)+k);
 let fr=f0+(1.0-f0)*pow(1.0-max(dot(viewDir,h),0.0),5.0);
 let atten=pow(max(0.0,1.0-pow(dist/source.position.w,4.0)),2.0)/(1.0+dist*dist*.18)*emission*spotShadowVisibility(source,world,geometric);
 if(coat<=0.0){return (base*(1.0-fr)*(1.0-metal)/3.14159+d*g*fr/max(4.0*nv*nl,.001))*source.color.rgb*source.color.w*atten*nl;}
 let coatF=coat*(.04+.96*pow(1.0-max(dot(viewDir,h),0.0),5.0));
 let cr=max(coatRoughness,.08+.18/max(dist,1.0));let ca2=pow(cr,4.0);
 let cd=ca2/(3.14159*pow(nh*nh*(ca2-1.0)+1.0,2.0));let ck=pow(cr+1.0,2.0)/8.0;
 let cg=nv/(nv*(1.0-ck)+ck)*nl/(nl*(1.0-ck)+ck);
 let under=(base*(1.0-fr)*(1.0-metal)/3.14159+d*g*fr/max(4.0*nv*nl,.001))*(1.0-coatF);
 return (under+vec3<f32>(cd*cg*coatF/max(4.0*nv*nl,.001)))*source.color.rgb*source.color.w*atten*nl;
}

fn texelAt(p:vec3<f32>,weights:vec3<f32>)->vec3<f32>{
 return textureSample(surfaceTexture,surfaceSampler,p.zy/u.texture.x).rgb*weights.x+textureSample(surfaceTexture,surfaceSampler,p.xz/u.texture.x).rgb*weights.y+textureSample(surfaceTexture,surfaceSampler,p.xy/u.texture.x).rgb*weights.z;
}
fn normalTexelAt(p:vec3<f32>,weights:vec3<f32>,surfaceNormal:vec3<f32>)->vec3<f32>{
 let sx=textureSample(normalTexture,surfaceSampler,p.zy/u.texture.x).xyz*2.0-1.0;
 let sy=textureSample(normalTexture,surfaceSampler,p.xz/u.texture.x).xyz*2.0-1.0;
 let sz=textureSample(normalTexture,surfaceSampler,p.xy/u.texture.x).xyz*2.0-1.0;
 let nx=vec3<f32>(sign(surfaceNormal.x)*sx.z,sx.y,sx.x);
 let ny=vec3<f32>(sy.x,sign(surfaceNormal.y)*sy.z,sy.y);
 let nz=vec3<f32>(sz.x,sz.y,sign(surfaceNormal.z)*sz.z);
 return normalize(nx*weights.x+ny*weights.y+nz*weights.z);
}
fn ormTexelAt(p:vec3<f32>,weights:vec3<f32>)->vec3<f32>{
 return textureSample(ormTexture,surfaceSampler,p.zy/u.texture.x).rgb*weights.x+textureSample(ormTexture,surfaceSampler,p.xz/u.texture.x).rgb*weights.y+textureSample(ormTexture,surfaceSampler,p.xy/u.texture.x).rgb*weights.z;
}
struct GOut{${relief||logarithmic?'@builtin(frag_depth) depth:f32,':''}@location(0) color:vec4<f32>,@location(1) normal:vec4<f32>,@location(2) specular:vec4<f32>,@location(3) velocity:vec2<f32>}
fn parallaxProbeDirection(worldPos:vec3<f32>,reflectionDir:vec3<f32>)->vec3<f32>{
  if(f.localProbePosition.w<.5){return reflectionDir;}
  let ray=normalize(reflectionDir);
  let safeRay=select(vec3<f32>(.00001),ray,abs(ray)>vec3<f32>(.00001));
  let t0=(f.localProbeMin.xyz-worldPos)/safeRay;
  let t1=(f.localProbeMax.xyz-worldPos)/safeRay;
  let exitT=max(min(max(t0.x,t1.x),min(max(t0.y,t1.y),max(t0.z,t1.z))),0.0);
  let hit=worldPos+ray*exitT;
  return normalize(hit-f.localProbePosition.xyz);
}

@fragment fn fs(input: VOut) -> GOut {
  var in=input;
  ${relief?`let surfaceHit=intersectSurface(input.worldPos,normalize(input.normal),normalize(input.worldPos-f.eye.xyz),u.relief.x/max(.000001,max(length(dpdx(input.worldPos)),length(dpdy(input.worldPos)))));
  in.worldPos=surfaceHit.position;in.normal=surfaceHit.normal;
  let hitClip=f.viewVP*vec4<f32>(surfaceHit.position,1);let previousClip=f.previousVP*vec4<f32>(surfaceHit.previousPosition,1);
  in.velocity=(hitClip.xy/hitClip.w-previousClip.xy/previousClip.w)*vec2<f32>(.5,-.5);` : ''}
  ${reflection?'if(in.worldPos.y<.04){discard;}':''}
  let externalSurface=u.surfaceOverride.x>.5;let finalRoughness=u.surfaceOverride.y>.5;
  let hasField=u.fieldSize.z>0.5;
  var track=tyreTracks(in.worldPos.z)*u.surfaceDynamics.y;
  var snowDepth=u.surfacePhase.x;
  var waterDepth=u.surfacePhase.y;
  var slush=u.surfacePhase.z;
  if(hasField){
    let fieldUV=(in.worldPos.xz-u.fieldFrame.xy)/max(u.fieldFrame.zw,vec2<f32>(0.001))+vec2<f32>(0.5);
    let cell=clamp(vec2<i32>(floor(fieldUV*u.fieldSize.xy)),vec2<i32>(0),vec2<i32>(u.fieldSize.xy)-vec2<i32>(1));
    let local=textureLoad(fieldTexture,cell,0);
    track=local.x;snowDepth=local.y;waterDepth=local.z;slush=local.w;
  }

  let facadeDpX=dpdx(in.worldPos);let facadeDpY=dpdy(in.worldPos);let facadeUvX=dpdx(in.uv);let facadeUvY=dpdy(in.uv);
  var facadeEmission=0.;
  let geometricNormal=normalize(in.normal);
  var n=geometricNormal;
  let deformation=deformationAt(in.worldPos.xz);
  // Physical deformation texels are provably zero until the first stamp.
  // Keep weather field sampling active (z), but elide five deformation
  // texture fetches and normal reconstruction when the field is pristine.
  if(u.fieldSize.w>.5){
    let sx=max(u.fieldFrame.z/max(u.fieldSize.x,1.0),.001);
    let sz=max(u.fieldFrame.w/max(u.fieldSize.y,1.0),.001);
    let hx0=deformationAt(in.worldPos.xz-vec2<f32>(sx,0)).x;
    let hx1=deformationAt(in.worldPos.xz+vec2<f32>(sx,0)).x;
    let hz0=deformationAt(in.worldPos.xz-vec2<f32>(0,sz)).x;
    let hz1=deformationAt(in.worldPos.xz+vec2<f32>(0,sz)).x;
    let fieldNormal=normalize(vec3<f32>((hx0-hx1)/(2.0*sx),1.0,(hz0-hz1)/(2.0*sz)));
    let influence=clamp(smoothstep(.00015,.0025,abs(deformation.x))+deformation.y*.28+deformation.z*.12,0.0,.92);
    n=normalize(mix(n,fieldNormal,influence));
  }
  let eye=select(f.eye.xyz,vec3<f32>(f.eye.x,.03-f.eye.y,f.eye.z),in.reflected==1u);
  let viewDir=normalize(eye-in.worldPos);
  let sunlight=f.environment.y;
  let hour=f.environment.z*24.0;
  let sunrise=exp(-pow((hour-7.4)/1.15,2.0))*sunlight;
  let light=f.sun.xyz;
  // Opposing light/view directions have no half-vector; normalizing zero can
  // write NaN into HDR (even a zero light contribution then multiplies NaN).
  let halfVector=light+viewDir;let halfDir=halfVector*inverseSqrt(max(dot(halfVector,halfVector),1e-12));
  let ndl=max(dot(n,light),0.0);

  var albedo=in.tint.rgb*in.vertexColor.rgb;
  // No label is represented by an exactly transparent 1x1 texture.
  // Skip the redundant fetch on every pixel of an unlabelled object.
  // A real label (1024x128) keeps the original sampling/filtering equations.
  if(textureDimensions(labelTexture).x>1u){
    let label=textureSample(labelTexture,labelSampler,in.uv);
    albedo=mix(albedo,label.rgb,label.a);
  }
  let materialKind=select(u.weather.w,f32(MATERIAL_CLASS),MATERIAL_CLASS>=0);
  let surfaceUse=u.objectState.x;
  let treatment=u.objectState.y;
  let treatmentClearcoat=select(0.0,.82,treatment>3.5&&treatment<4.5);
  var clearcoat=select(treatmentClearcoat,clamp(u.objectState.z,0.0,1.0),u.objectState.z>=0.0);
  let clearcoatRoughness=select(.075,clamp(u.objectState.w,.02,1.0),u.objectState.w>=0.0);
  // Paint microflake stays procedural: no texture fetch, but it modulates both
  // the base coat and its roughness so the clearcoat catches fine metallic breakup.
  let paintMicro=select(0.0,hash3(floor(in.worldPos*420.0))-.5,treatment>3.5&&treatment<4.5&&materialKind>1.5&&materialKind<2.5);
  let seed=vec3<f32>(in.instanceSeed*13.7,in.instanceSeed*7.1,in.instanceSeed*3.9);
  let upward=smoothstep(0.05,0.82,n.y);
  let snowHistory=max(max(u.snowpack.x,u.snowpack.y),max(u.snowpack.z,u.snowpack.w));
  let snowFresh=select(.45,u.snowpack.x,snowHistory>.0001);
  let snowLiquid=select(.03,u.snowpack.y,snowHistory>.0001);
  let snowCrust=select(.02,u.snowpack.z,snowHistory>.0001);
  let snowGrain=select(.20,u.snowpack.w,snowHistory>.0001);

  if(u.pbr.z>.5&&u.pbr.z<1.5&&u.texture.w<.5){
    // Meter-scale masonry with restrained mortar, per-brick variation and
    // sub-centimetre surface breakup. The previous high-contrast normals made
    // whole facades read like stylised blocks at medium distance.
    let horizontal=select(in.worldPos.x,in.worldPos.z,abs(n.x)>abs(n.z));
    let row=floor(in.worldPos.y/.074);
    let uv=vec2<f32>(horizontal/.255+fract(row*.5),in.worldPos.y/.074);
    let cell=fract(uv);let edge=min(cell,1.0-cell);
    let aa=max(fwidth(uv.x),fwidth(uv.y))*.7;
    let seam=1.0-smoothstep(.022-aa,.045+aa,min(edge.x,edge.y));
    let brickId=floor(uv);
    let brickTone=hash3(vec3<f32>(brickId,in.instanceSeed*100.0))-.5;
    let weather=noise3(in.worldPos*vec3<f32>(.34,.055,.34)+seed*2.0)-.5;
    albedo*=1.0+brickTone*.10+weather*.07;
    albedo=mix(albedo,vec3<f32>(.34,.33,.31),seam*.32);
    let tangent=select(vec3<f32>(1,0,0),vec3<f32>(0,0,1),abs(n.x)>abs(n.z));
    let bevel=(smoothstep(vec2<f32>(.018),vec2<f32>(.055),edge)-smoothstep(vec2<f32>(.055),vec2<f32>(.11),edge))*(vec2<f32>(1)-2.0*step(vec2<f32>(.5),cell));
    let clay=noise3(in.worldPos*52.0);
    n=normalize(n+tangent*bevel.x*.055+vec3<f32>(0,bevel.y*.045,0)+tangent*(clay-.5)*.014);
    let ageStreak=noise3(in.worldPos*vec3<f32>(1.1,.055,1.1)+seed*8.0);
    albedo*=.965+ageStreak*.045;
  }
  if(materialKind>5.5&&materialKind<6.5){
    // Preserve material-derived vertex colour: load, melt and exposed ground
    // are encoded by the authoritative volume's presentation, not a white override.
    // Adjacent tiles are one material: entity IDs must not create colour seams.
    albedo*=.985+noise3(in.worldPos*1.8)*.015;
  }
  if(u.pbr.z>3.5&&u.pbr.z<4.5){
    let q=clamp(in.uv,vec2<f32>(0),vec2<f32>(1));
    let interior=vec3<f32>(.065,.075,.085)+vec3<f32>(.23,.16,.09)*u.emission.x;
    let edge=min(min(q.x,1.0-q.x),min(q.y,1.0-q.y));
    let ceiling=smoothstep(.10,.22,q.y);let floorGlow=smoothstep(.62,.97,q.y);
    albedo=interior*(.7+ceiling*.3)+vec3<f32>(.16,.13,.09)*floorGlow;
    let curtain=(1.0-smoothstep(.12,.20,q.x))+smoothstep(.80,.88,q.x);
    albedo=mix(albedo,vec3<f32>(.36,.33,.27),curtain*.5);
    albedo*=.85+noise3(in.worldPos*2.0)*.1;
  }
  if(u.pbr.z>1.5&&u.pbr.z<2.5){
    let mineral=noise3(in.worldPos*7.5+seed)-.5;
    let weather=noise3(in.worldPos*vec3<f32>(.75,.08,.75)+seed*3.0)-.5;
    let fine=noise3(in.worldPos*46.0+seed*9.0)-.5;
    albedo*=.965+mineral*.055+weather*.065+fine*.018;
    let tangent=select(vec3<f32>(1,0,0),vec3<f32>(0,0,1),abs(n.x)>abs(n.z));
    n=normalize(n+tangent*fine*.012);
  }
  if(u.pbr.z>4.5){
    let weave=noise3(in.worldPos*210.0);let folds=noise3(in.worldPos*vec3<f32>(17,31,19));
    albedo*=.90+weave*.075+folds*.07;
  }
  // Concrete / paving. Square sidewalk tiles are a semantic surface consequence.
  if(materialKind>3.5 && materialKind<4.5) {
    let coarse=fbm(in.worldPos*2.4+seed);
    let pores=fbm(in.worldPos*14.0+seed*2.3);
    albedo*=0.78+coarse*0.24+pores*0.07;
    if(surfaceUse>1.5 && surfaceUse<2.5){
      let seam=tileSeam(in.worldPos.xz);
      albedo=mix(albedo,albedo*0.42,seam*.72);
      albedo*=0.93+fbm(vec3<f32>(floor(in.worldPos.x/0.62),0.0,floor(in.worldPos.z/0.62))+seed)*0.1;
    }

    // Zero moss contributes no albedo; the physical uniform stays live.
    if(u.surface.x!=0.0){
      let sheltered=1.0-smoothstep(0.42,0.96,abs(n.y));
      let growthField=fbm(in.worldPos*1.35+seed*4.2)*0.72+fbm(in.worldPos*5.7+seed)*0.28;
      let moistureBias=u.surface.y*0.28+upward*0.22+sheltered*0.07;
      let threshold=0.94-u.surface.x*0.62;
      let mossMask=smoothstep(threshold-0.16,threshold+0.04,growthField+moistureBias);
      let mossVariation=fbm(in.worldPos*8.5+seed*8.0);
      let mossColor=mix(vec3<f32>(0.035,0.075,0.02),vec3<f32>(0.16,0.27,0.065),mossVariation);
      albedo=mix(albedo,mossColor,mossMask*u.surface.x);
    }
  }

  // Asphalt is a phase mixture, not a black material. Fresh melt water darkens
  // aggregate, dirty snow becomes slurry, and repeated traffic clears wet ruts
  // while pushing coarse slush toward their shoulders.
  var roadTrack=track;
  var roadSlurry=0.0;
  var slushRidge=0.0;
  if(materialKind>4.5 && materialKind<5.5){
    // Grain is entirely subpixel when its analytic AA weight reaches zero.
    // At that point *all five* noise texture fetches contribute exactly zero;
    // preserve the .94 mean response and the original normal normalization.
    let grainAA=1.0-smoothstep(.6,2.0,max(length(dpdx(in.worldPos)),length(dpdy(in.worldPos)))*37.0);
    if(grainAA<=0.0){
      albedo*=.94;
      n=normalize(n);
    }else{
      let aggregate=noise3(in.worldPos*37.0+seed);
      albedo*=mix(.94,.70+aggregate*.46,grainAA);
      let mineral=noise3(in.worldPos*95.0);albedo=mix(albedo,albedo*1.55,smoothstep(.72,.91,mineral)*.18*grainAA);
      let scale=vec3<f32>(27,27,27);let gravel=noise3(in.worldPos*scale);
      let gradient=vec3<f32>(noise3(in.worldPos*scale+vec3<f32>(.12,0,0))-gravel,0,noise3(in.worldPos*scale+vec3<f32>(0,0,.12))-gravel);
      n=normalize(n+gradient*.42*grainAA);
    }

    let phaseWet=clamp(slush*.95+waterDepth/.0035*.42,0.0,1.0);
    let rutGain=smoothstep(.035,.22,phaseWet);
    var historicalRut=0.0;
    // When no physical water/slush enables old tyre rut exposure, its
    // contribution is identically zero. Do not fetch lane-warp noise.
    if(rutGain>0.0){
      let laneWarp=(noise3(in.worldPos*vec3<f32>(.055,.02,.18)+seed*4.0)-.5)*.10;
      historicalRut=tyreTracks(in.worldPos.z+laneWarp)*rutGain;
    }
    roadTrack=max(track,historicalRut*.72);
    let shoulderBand=smoothstep(.10,.48,historicalRut)*(1.0-smoothstep(.58,.94,historicalRut));
    // An absent ridge cannot scatter slurry or perturb normals. Both
    // noise fetches are causally unnecessary until a real ridge is present.
    slushRidge=0.0;
    if(shoulderBand>0.0&&slush>0.0){
      slushRidge=shoulderBand*slush*(.72+.55*noise3(in.worldPos*vec3<f32>(1.7,.1,5.2)+seed*7.0));
    }
    roadSlurry=clamp(slush*(.36+.42*(1.0-roadTrack))+slushRidge*.72,0.0,1.0);

    let slurryColor=mix(vec3<f32>(.34,.35,.35),vec3<f32>(.16,.135,.105),clamp(u.weather.x*1.5+.22,0.0,1.0));
    albedo=mix(albedo,slurryColor,roadSlurry*.66);
    // Cleared ruts expose saturated asphalt; shoulders retain granular brown-grey mush.
    albedo=mix(albedo,albedo*.50,roadTrack*(.50+.28*phaseWet));
    albedo=mix(albedo,slurryColor*.92,slushRidge*.72);
    n=normalize(mix(n,geometricNormal,roadTrack*.42));
    if(slushRidge>0.0){
      let ridgeNoise=noise3(in.worldPos*vec3<f32>(8,.2,18)+seed*11.0)-.5;
      n=normalize(n+vec3<f32>(ridgeNoise*.05,0,ridgeNoise*.08)*slushRidge);
    }else{
      n=normalize(n);
    }
    track=roadTrack;
  }

  // Snow grains are sub-millimetre relief. Filter them by the pixel footprint;
  // centimetre-scale normals made deep powder look like grey rock and shimmer.
  if(materialKind>5.5&&materialKind<6.5){
    let pixelM=max(length(dpdx(in.worldPos)),length(dpdy(in.worldPos)));
    let grainWeight=1.0-smoothstep(.008,.035,pixelM);
    let crystal=noise3(in.worldPos*85.0);
    albedo*=(1.0-snowLiquid*.14)*(.987+crystal*.013*grainWeight);
    let tx=normalize(dpdx(in.worldPos)+vec3<f32>(.000001,0,0));
    let ty=normalize(dpdy(in.worldPos)+vec3<f32>(0,.000001,0));
    let heightM=mix(.00045,.00008,clamp(snowLiquid+snowCrust*.7,0.0,1.0));
    let grad=(tx*dpdx(crystal)/max(length(dpdx(in.worldPos)),.0001)+ty*dpdy(crystal)/max(length(dpdy(in.worldPos)),.0001))*heightM*grainWeight;
    n=normalize(n-(grad-n*dot(grad,n)));
  }

  // Moving bodies accumulate fresh snow on upward and rear-facing surfaces.
  let bodyDeposit=max(u.surfaceDynamics.z,u.surfaceDynamics.w);
  if(bodyDeposit>.001){
    let motionDir=normalize(vec3<f32>(u.motion.x,0.0,u.motion.y)+vec3<f32>(0.0001,0.0,0.0));
    let rearFacing=smoothstep(0.05,0.9,dot(n,-motionDir));
    let bodySnow=clamp(u.surfaceDynamics.z*upward+u.surfaceDynamics.w*rearFacing,0.0,1.0);
    albedo=mix(albedo,vec3<f32>(0.91,0.945,0.98),bodySnow*smoothstep(.18,.78,fbm(in.worldPos*4.4+seed)+.25));
  }

  // Mud is a projection of real contact work accumulated on the body state.
  // Lower panels, wheel-arch height and the rear wake receive most of the load.
  var bodyMudMask=0.0;
  if(u.motion.z>.001){
    let motionDir=normalize(vec3<f32>(u.motion.x,0.0,u.motion.y)+vec3<f32>(0.0001,0.0,0.0));
    let rearFacing=smoothstep(.02,.86,dot(n,-motionDir));
    let lowBand=1.0-smoothstep(-.18,.72,in.localPos.y);
    let sideBand=smoothstep(.12,.94,1.0-abs(n.y));
    let splash=fbm(in.worldPos*vec3<f32>(5.8,8.6,5.8)+seed*9.0);
    let flecks=noise3(in.worldPos*31.0+seed*17.0);
    bodyMudMask=clamp(u.motion.z*(lowBand*.82+rearFacing*.46+sideBand*.18)*smoothstep(.30,.70,splash+flecks*.22),0.0,.92);
    let mudColor=mix(vec3<f32>(.11,.055,.018),vec3<f32>(.27,.145,.052),noise3(in.worldPos*12.0+seed));
    albedo=mix(albedo,mudColor,bodyMudMask*.88);
  }

  var materialAO=1.0;var mappedRoughness=-1.0;var mappedMetalness=-1.0;
  if((u.texture.w>.5&&u.texture.w<1.5)||u.detail.y>.5||u.detail.w>.5){
    let w=pow(abs(n),vec3<f32>(6));let weights=w/max(w.x+w.y+w.z,.001);
    if(u.texture.w>.5&&u.texture.w<1.5){
      let tex=texelAt(in.worldPos,weights);
      albedo*=mix(vec3<f32>(1),tex,u.texture.z);
      let e=u.texture.x/512.0;let center=dot(tex,vec3<f32>(.333333));
      let grad=vec3<f32>(dot(texelAt(in.worldPos+vec3<f32>(e,0,0),weights),vec3<f32>(.333333))-center,dot(texelAt(in.worldPos+vec3<f32>(0,e,0),weights),vec3<f32>(.333333))-center,dot(texelAt(in.worldPos+vec3<f32>(0,0,e),weights),vec3<f32>(.333333))-center);
      n=normalize(n-(grad-n*dot(n,grad))*u.texture.y*.012/e);
    }
    if(u.detail.y>.5){
      let mapped=normalTexelAt(in.worldPos,weights,n);
      n=normalize(mix(n,mapped,clamp(u.detail.x,0.0,2.0)));
    }
    if(u.detail.w>.5){
      let orm=ormTexelAt(in.worldPos,weights);let strength=clamp(u.detail.z,0.0,1.0);
      materialAO=mix(1.0,orm.r,strength);
      mappedRoughness=mix(select(u.surface.z,u.pbr.x,u.pbr.x>=0.0),orm.g,strength);
      mappedMetalness=mix(u.pbr.y,orm.b,strength);
    }
  }

  var terrainWater=0.;
  if(u.texture.w>1.5){
    albedo=textureSampleLevel(surfaceTexture,surfaceSampler,terrainMapUV(in.uv,u.texture.x,textureDimensions(surfaceTexture)),0).rgb;
    terrainWater=terrainWaterMask(albedo);
    if(terrainWater>.5){n=terrainWaterNormal(geometricNormal,in.uv,f.up.w,terrainSourceAxes(facadeDpX,facadeDpY,facadeUvX,facadeUvY));}
    let terrainRoughness=select(u.surface.z,u.pbr.x,u.pbr.x>=0.);
    // Preserve the source adapter's existing wet-film interpolation while
    // replacing the dry terrain .92 base with the original water .075 base.
    mappedRoughness=terrainRoughness-(.92-.075)*(1.-clamp(u.surface.y,0.,1.))*terrainWater;
  }
  // Water is also state, not a material override. Procedural depressions localize
  // the scalar water volume into shallow puddles.
  var puddleMask=0.0;
  if(u.surfaceDynamics.x>.001){
    let depression=1.0-fbm(in.worldPos*0.58+seed*6.0);
    puddleMask=u.surfaceDynamics.x*smoothstep(0.7-u.surfaceDynamics.x*.35,0.9-u.surfaceDynamics.x*.12,depression)*upward;
  }
  let physicalWetness=clamp(u.surface.y+u.motion.w+waterDepth/0.006+puddleMask*.5,0.0,1.0);
  var wetness=select(physicalWetness,clamp(u.surface.y,0.0,1.0),externalSurface);
  albedo*=1.0-u.surface.w-select(wetness*.24,0.0,externalSurface);

  var roughness=clamp(select(select(u.surface.z,u.pbr.x,u.pbr.x>=0.0),mappedRoughness,mappedRoughness>=0.0)-select(wetness*.28,0.0,finalRoughness)+paintMicro*.006-deformation.y*.10+deformation.z*.07+bodyMudMask*.38,select(.08,.055,terrainWater>.5),1.0);
  if(treatment>3.5&&treatment<4.5){
    // Sub-percent tonal variation keeps the flake visible only inside the
    // clearcoat highlight; it is intentionally below the level of a noisy paint texture.
    albedo*=1.0+paintMicro*.004;
  }
  let automotivePaint=treatment>3.5&&treatment<4.5&&materialKind>1.5&&materialKind<2.5;
  // Two-scale procedural automotive finish. The broad component is the subtle
  // orange-peel of real clearcoat; the fine component breaks up pin-sharp probe
  // reflections without changing the underlying body geometry.
  if(automotivePaint){
    let peel=noise3(in.worldPos*92.0);
    let peelX=noise3((in.worldPos+vec3<f32>(.006,0,0))*92.0)-peel;
    let peelY=noise3((in.worldPos+vec3<f32>(0,.006,0))*92.0)-peel;
    let peelZ=noise3((in.worldPos+vec3<f32>(0,0,.006))*92.0)-peel;
    let peelGrad=vec3<f32>(peelX,peelY,peelZ);
    n=normalize(n+(peelGrad-n*dot(peelGrad,n))*.0025);
  }
  // Ground cover is world-anchored and footprint filtered. The terrain water mask,
  // geometric orientation and green albedo prevent painting grass onto water or walls.
  let turfPosition=in.worldPos.xz+f.renderOrigin.xz;
  let turfFootprint=max(length(facadeDpX.xz),length(facadeDpY.xz))*.5;
  if(u.groundDetail.x>3.5&&u.groundDetail.x<4.5&&geometricNormal.y>.8&&terrainWater<.5&&albedo.g>albedo.r*1.08&&albedo.g>albedo.b*1.10){
    albedo=turf(turfPosition,albedo,turfFootprint);
  }
  if(u.groundDetail.x>4.5){n=normalize(mix(n,vec3f(0,1,0),.55));}
  if(u.groundDetail.z>.5){
    let facade=facadeMaterial(in.uv,facadeDpX,facadeDpY,facadeUvX,facadeUvY,geometricNormal,in.worldPos.y+f.renderOrigin.y,in.variationSeed,u.groundDetail.z>1.5,resolveFacadeNight(u.groundDetail.w,f.surfaceRain.w,f.renderOrigin.w),u.surface.y,f.surfaceRain.x,in.tint.rgb*in.vertexColor.rgb);
    albedo=facade.color;roughness=facade.roughness;n=facade.normal;facadeEmission=facade.emission;
  }
  // Snow accumulation is derived from mass balance. Road tracks expose wet/slushy
  // asphalt only if traffic actually supplied enough contact work.
  let snowBase=clamp(snowDepth/0.055,0.0,1.0);
  var snowMask=0.0;
  // Most objects have no deposited snow. Skip nine 3D-noise reads on those
  // fragments instead of evaluating an FBM that will later be multiplied by zero.
  // Bulk snow already carries material colour from its physical volume. The
  // deposited cover below belongs to other materials and must not repaint it.
  if(snowBase>.001&&terrainWater<.5&&(materialKind<5.5||materialKind>6.5)){
    snowMask=upward*snowBase*smoothstep(0.12,0.82,fbm(in.worldPos*1.9+seed*3.1)+snowBase*.74);
    if(surfaceUse>.5 && surfaceUse<1.5){snowMask*=1.0-track*.96;}
    if(surfaceUse>2.5 && surfaceUse<3.5){snowMask=clamp(snowMask+snowBase*.38,0.0,1.0);}
    let slushColor=mix(vec3<f32>(0.48,0.5,0.5),vec3<f32>(0.22,0.19,0.16),clamp(u.weather.x+u.motion.z,0.0,1.0));
    var settledColor=mix(vec3<f32>(.82,.875,.92),vec3<f32>(.95,.975,1.0),snowFresh);
    settledColor=mix(settledColor,vec3<f32>(.64,.67,.69),snowLiquid*.62);
    settledColor=mix(settledColor,vec3<f32>(.78,.85,.91),snowCrust*.38);
    let historyPatch=fbm(in.worldPos*mix(7.0,2.2,snowGrain)+seed*13.0)-.5;
    settledColor*=1.0+historyPatch*mix(.045,.11,snowGrain)*(1.0-snowLiquid*.45);
    albedo=mix(albedo,slushColor,snowMask*slush*.52);
    albedo=mix(albedo,settledColor,snowMask*(1.0-slush*.55));
  }

  let ndx=dpdx(n);let ndy=dpdy(n);let normalVariance=max(dot(ndx,ndx),dot(ndy,ndy));
  roughness=clamp(sqrt(roughness*roughness+min(.06,normalVariance*.04)),select(.08,.055,terrainWater>.5),1.0);
  let historySnowRoughness=clamp(.95-snowLiquid*.34-snowCrust*.30-snowGrain*.035,.38,.97);
  if(snowMask>.001){roughness=mix(roughness,historySnowRoughness,snowMask*(1.0-slush*.42));}
  if(materialKind>5.5&&materialKind<6.5){roughness=mix(roughness,historySnowRoughness,.72);}
  var waterCoverage=select(1.0,wetness,externalSurface);
  if(materialKind>4.5&&materialKind<5.5&&!externalSurface){
    let hollows=noise3(in.worldPos*vec3<f32>(1.4,.1,2.3))*.78+noise3(in.worldPos*vec3<f32>(7.5,.1,9.3))*.22;
    // A damp film darkens stone but does not submerge the aggregate. Only
    // depressions filled by the local water column become smooth puddles.
    let fill=clamp(waterDepth/.006,0.0,1.0);
    // A damp film changes roughness before it fills every depression as a
    // mirror. Scale subpixel puddle coverage by the available water volume.
    waterCoverage=smoothstep(.64,.80,hollows+fill*.50)*smoothstep(.00015,.0012,waterDepth)*sqrt(fill);
    // Tyre channels retain melt water even when the surrounding aggregate has drained.
    let rutWater=roadTrack*smoothstep(.00012,.0011,waterDepth)*(.42+.58*fill);
    waterCoverage=max(waterCoverage,rutWater);
    let aggregate=noise3(in.worldPos*37.0+seed);
    let mineralRoughness=clamp(max(roughness,.60)+(aggregate-.5)*.24,.50,.93);
    roughness=mix(mineralRoughness,.18+noise3(in.worldPos*3.0)*.04,waterCoverage);
    roughness=mix(roughness,max(roughness,.82),slushRidge*.60);
    albedo*=mix(1.0,.73,waterCoverage);
    // Millimetres of water level out the gravel; its normals must not turn the
    // planar reflection into waves across the entire road.
    n=normalize(mix(n,geometricNormal,waterCoverage*.95));
  }
  // Source surface seeds are flat per triangle; wind and time advect litter.
  let absoluteLitter=in.worldPos+f.renderOrigin.xyz;
  let litterUV=select(in.uv,absoluteLitter.xz+absoluteLitter.yy*.37,u.groundDetail.x<2.5);
  let litterFootprint=max(length(dpdx(litterUV)),length(dpdy(litterUV)));
  let litterHorizontal=smoothstep(.65,.96,geometricNormal.y);
  if(u.groundDetail.x>.5&&u.groundDetail.x<3.5&&f.groundLitter.z>.5&&litterHorizontal>.25){
    let paving=u.groundDetail.x>1.5;let tile=u.groundDetail.x>2.5;
    let chance=select(select(.018,.08,paving),.18,tile)*(1.-f.surfaceRain.x*.92);
    let cellSize=select(select(2.8,1.6,paving),1.1,tile);
    let litter=groundLitter(in.worldPos.xz+f.renderOrigin.xz,cellSize,chance,litterFootprint,in.variationSeed+41.,f.groundLitter.xy,f.up.w);
    let amount=litter.a*litterHorizontal;
    let darkening=1.-u.surface.w-select(wetness*.24,0.,externalSurface);
    albedo=mix(albedo,litter.rgb*darkening,amount);let litterRoughness=mix(.9,.62,litter.a);
    if(externalSurface&&u.groundDetail.y>=0.){roughness+=(litterRoughness-u.groundDetail.y)*amount*.55*(1.-clamp(wetness,0.,1.));}
    else{roughness=mix(roughness,litterRoughness,amount*.55);}
  }
  // Ground cells stay absolute across render rebases. Paint coordinates stay
  // in continuous mesh-local metres, including mirrored source geometry.
  let surfaceRain=f.surfaceRain.x;let rainHorizontal=smoothstep(.65,.96,geometricNormal.y);
  if(u.surfaceOverride.z>.5&&u.surfaceOverride.z<1.5&&surfaceRain>.01&&rainHorizontal>.55){
    let ripple=rainRipple(select(in.worldPos.xz+f.renderOrigin.xz,in.uv,u.texture.w>1.5),surfaceRain,f.up.w);
    var rippleNormal=ripple.xy;if(u.texture.w>1.5){rippleNormal=terrainSourceAxes(facadeDpX,facadeDpY,facadeUvX,facadeUvY)*rippleNormal;}
    n=normalize(n+vec3f(rippleNormal.x,0,rippleNormal.y)*rainHorizontal);
    albedo*=1.-ripple.w*.55;let sheen=mix(f.sky.rgb*.55,vec3f(.22,.24,.27),.35);
    albedo=mix(albedo,sheen,ripple.z*.85);roughness=mix(roughness,.03,max(ripple.z,ripple.w*.65));
    wetness=max(wetness,max(ripple.z,ripple.w));waterCoverage=max(waterCoverage,max(ripple.z,ripple.w));
  }
  if(u.surfaceOverride.z>1.5&&surfaceRain>.02&&rainHorizontal>.28){
    let bead=roofRainBead(vec2f(in.localPos.z,in.localPos.x*u.surfaceOverride.w),surfaceRain,f.up.w,f.surfaceRain.yz);
    n=normalize(n+vec3f(bead.x,0,bead.y)*rainHorizontal);albedo*=1.-bead.w*.12;
    roughness=mix(roughness,.03,max(bead.z,bead.w)*.85);wetness=max(wetness,max(bead.z,bead.w)*.7);
  }
  // Match the source surface BRDF guard after the rain layers.
  if(u.surfaceOverride.z>.5){roughness=clamp(roughness,.055,1.0);}
  ${coating?`var coating=vec2f(1,0);var metal=select(u.pbr.y,mappedMetalness,mappedMetalness>=0.0);var base=pow(max(albedo,vec3<f32>(0)),vec3<f32>(2.2));
  if(u.relief.z>=0.){
    coating=coatingLoss(in.uv,fwidth(in.uv),u.relief.w,u.relief.z);
    let primer=pow(mix(in.tint.rgb*in.vertexColor.rgb*.48,vec3f(.24,.25,.24),.65),vec3f(2.2));
    base=mix(base,primer,coating.x);base=mix(base,pow(vec3f(.46,.47,.48),vec3f(2.2)),coating.y);
    roughness=mix(mix(roughness,.76,coating.x),.42,coating.y);metal=mix(metal,.82,coating.y);clearcoat*=1.-coating.x;
  }`:`let metal=select(u.pbr.y,mappedMetalness,mappedMetalness>=0.0);let base=pow(max(albedo,vec3<f32>(0)),vec3<f32>(2.2));`}
  let nv=max(dot(n,viewDir),.001);let nl=max(dot(n,light),0.0);let nh=max(dot(n,halfDir),0.0);let vh=max(dot(viewDir,halfDir),0.0);
  let a2=pow(roughness,4.0);let d=a2/(3.14159*pow(nh*nh*(a2-1.0)+1.0,2.0));
  let k=pow(roughness+1.0,2.0)/8.0;let g=(nv/(nv*(1.0-k)+k))*(nl/(nl*(1.0-k)+k));
  // The engine's dielectric base assumes IOR 1.5: under an IOR 1.5 coat
  // that interface is index-matched, rather than a second air/paint reflection.
  let f0=mix(vec3<f32>(.04*(1.0-clearcoat)),base,metal);let fresnel=f0+(1.0-f0)*pow(1.0-vh,5.0);
  let specular=d*g*fresnel/max(4.0*nv*nl,.001);
  // Sun visibility has no receiver when the actual frame light is zero.
  // The uniform branch keeps shadowAt's receiver derivatives in uniform flow.
  var shadow=1.0;
  if(f.sun.w!=0.0){shadow=shadowAt(in.worldPos,geometricNormal)${relief?'*surfaceVisibility(in.worldPos,input.worldPos,normalize(input.normal),light)':''};}
  // Diffuse and specular now query the same world-radiance representation.
  // High-mip cubemap radiance is the cheap irradiance cache; screen-space
  // transport later only refines local visibility/colour bleed.
  var diffuseIrradiance:vec3<f32>;
  if(f.irradiance0.w>.5){
    let x=n.x;let y=n.y;let z=n.z;
    diffuseIrradiance=max(vec3<f32>(0),
      f.irradiance0.rgb*.282094792+
      f.irradiance1.rgb*(.488602512*y)+
      f.irradiance2.rgb*(.488602512*z)+
      f.irradiance3.rgb*(.488602512*x)+
      f.irradiance4.rgb*(1.092548431*x*y)+
      f.irradiance5.rgb*(1.092548431*y*z)+
      f.irradiance6.rgb*(.315391565*(3.0*z*z-1.0))+
      f.irradiance7.rgb*(1.092548431*x*z)+
      f.irradiance8.rgb*(.546274215*(x*x-y*y))
    )/3.141592654;
  }else{
    let diffuseDirection=normalize(n+vec3<f32>(0,.16,0));
    let diffuseEnvironment=textureSampleLevel(environmentMap,reflectionSampler,diffuseDirection,6.1).rgb;
    let horizonEnvironment=textureSampleLevel(environmentMap,reflectionSampler,normalize(n+viewDir*.18),5.4).rgb;
    diffuseIrradiance=mix(diffuseEnvironment,horizonEnvironment,.16)*.94;
  }
  // Authored diffuse illumination is an independent source of incident energy.
  // In particular, black camera backdrops do not require physically unlit objects.
  diffuseIrradiance+=f.ambientIrradiance.rgb;
  // Filter the coat normal distribution too; a sharp second lobe must not
  // bypass the base layer's anti-aliasing on curved/subpixel panel edges.
  let paintCoatFloor=select(.0,.055,automotivePaint);
  let coatRough=clamp(max(paintCoatFloor,sqrt(clearcoatRoughness*clearcoatRoughness+min(.06,normalVariance*.04))),.08,1.0);
  let coatViewF=clearcoat*(.04+.96*pow(1.0-nv,5.0));
  let coatLightF=clearcoat*(.04+.96*pow(1.0-vh,5.0));
  var color=base*diffuseIrradiance*(1.0-metal)*materialAO*(1.0-coatViewF);
  color+=(base*(1.0-fresnel)*(1.0-metal)/3.14159+specular)*f.sunColor.rgb*f.sun.w*nl*shadow*(1.0-coatLightF);
  let environmentFresnel=f0+(1.0-f0)*pow(1.0-nv,5.0);
  let reflectionDir=reflect(-viewDir,n);
  let fallbackEnvironment=textureSampleLevel(environmentMap,reflectionSampler,reflectionDir,roughness*6.0).rgb;
  // Vertical body panels benefit from the nearby city capture more than the
  // forward-facing hood/fascia. Bias the local probe by surface orientation so
  // the door gains building reflections without changing the established front look.
  let sideReflection=smoothstep(.30,.82,abs(n.z));
  // Parallax correction fixes placement; roughness still needs a wider probe
  // footprint so painted panels do not read like a magnifying mirror.
  let paintProbeScale=select(1.0,.42,automotivePaint);
  let localProbeWeight=f.params.y*(1.0-smoothstep(.035,.28,roughness))*.68*mix(1.0,1.16,sideReflection)*paintProbeScale;
  let localProbeLod=roughness*f32(textureNumLevels(localProbeMap)-1u)*select(.72,.95,automotivePaint);
  var localProbe=fallbackEnvironment;
  let glassLike=materialKind>.5&&materialKind<1.5;
  if(f.params.y>.5&&(localProbeWeight>.001||clearcoat>0.0||glassLike)){
    localProbe=textureSampleLevel(localProbeMap,reflectionSampler,parallaxProbeDirection(in.worldPos,reflectionDir),localProbeLod).rgb;
  }
  let environmentRadiance=mix(fallbackEnvironment,localProbe,localProbeWeight);
  let envC0=vec4<f32>(-1.0,-.0275,-.572,.022);let envC1=vec4<f32>(1.0,.0425,1.04,-.04);
  let envR=roughness*envC0+envC1;let envA004=min(envR.x*envR.x,exp2(-9.28*nv))*envR.x+envR.y;
  let envBRDF=vec2<f32>(-1.04,1.04)*envA004+envR.zw;
  let environmentWeight=select(1.0,mix(.22,1.0,waterCoverage),materialKind>4.5&&materialKind<5.5);
  color+=environmentRadiance*(f0*envBRDF.x+envBRDF.y)*environmentWeight*pow(1.0-coatViewF,2.0);

  // Both sources use the authored coat lobe. Roughness changes convolution,
  // not whether the street exists in the reflection; local capture wins when ready.
  if(clearcoat>0.0){
    let coatA2=pow(coatRough,4.0);
    let coatD=coatA2/(3.14159*pow(nh*nh*(coatA2-1.0)+1.0,2.0));
    let coatK=pow(coatRough+1.0,2.0)/8.0;
    let coatG=(nv/(nv*(1.0-coatK)+coatK))*(nl/(nl*(1.0-coatK)+coatK));
    let coatSpec=coatD*coatG*coatLightF/max(4.0*nv*nl,.001);
    color+=f.sunColor.rgb*f.sun.w*nl*shadow*coatSpec;
    var coatEnvironment=textureSampleLevel(environmentMap,reflectionSampler,reflectionDir,coatRough*f32(textureNumLevels(environmentMap)-1u)).rgb;
    if(f.params.y>.5){
      // Probe convolution owns clearcoat blur. Do not dim reflected radiance to
      // make glossy paint look rougher: that destroys the energy in automotive
      // highlights and makes coated surfaces read as matte. The roughness-selected
      // mip controls footprint while the completed local probe retains its energy.
      let coatProbeLod=max(coatRough*f32(textureNumLevels(localProbeMap)-1u),select(0.0,.65,automotivePaint));
      let coatLocal=textureSampleLevel(localProbeMap,reflectionSampler,parallaxProbeDirection(in.worldPos,reflectionDir),coatProbeLod).rgb;
      coatEnvironment=mix(coatEnvironment,coatLocal,f.params.y);
    }
    // Same split-sum BRDF fit as the base, evaluated at the coat roughness.
    let coatR=coatRough*envC0+envC1;
    let coatA004=min(coatR.x*coatR.x,exp2(-9.28*nv))*coatR.x+coatR.y;
    let coatBRDF=vec2<f32>(-1.04,1.04)*coatA004+coatR.zw;
    color+=coatEnvironment*(.04*coatBRDF.x+coatBRDF.y)*clearcoat;
  }

  // Glass is composited over the actual opaque scene. This keeps concrete,
  // lights and geometry behind the pane instead of approximating transmission
  // from an environment map that cannot know what is directly behind it.
  if(materialKind>.5&&materialKind<1.5){
    let glassIor=max(1.0001,u.pbr.w);
    let glassR0=pow((glassIor-1.0)/(glassIor+1.0),2.0);
    let glassF=glassR0+(1.0-glassR0)*pow(1.0-nv,5.0);
    let size=vec2<f32>(textureDimensions(opaqueScene));
    let incident=-viewDir;
    let refractedDir=normalize(refract(incident,n,1.0/glassIor));
    let modelScale=vec3<f32>(length(u.model[0].xyz),length(u.model[1].xyz),length(u.model[2].xyz));
    let opticalDistance=clamp(min(modelScale.x,min(modelScale.y,modelScale.z))*.12,.01,.18);
    let bend=(refractedDir-incident)*opticalDistance;
    let cameraDepth=max(dot(in.worldPos-f.eye.xyz,f.forward.xyz),.25);
    let uvOffset=vec2<f32>(
      dot(bend,f.right.xyz)/(2.0*cameraDepth*f.forward.w*f.right.w),
      -dot(bend,f.up.xyz)/(2.0*cameraDepth*f.forward.w)
    );
    let screenUV=clamp(in.position.xy/size+uvOffset,vec2<f32>(.001),vec2<f32>(.999));
    var transmitted=textureSampleLevel(opaqueScene,reflectionSampler,screenUV,0).rgb;
    let transmission=clamp(u.emission.w,0.0,1.0);
    transmitted*=transmission*transmission;
    let glassFallback=textureSampleLevel(environmentMap,reflectionSampler,reflectionDir,max(.05,roughness)*5.0).rgb;
    let glassReflection=mix(glassFallback,localProbe,f.params.y*(1.0-smoothstep(.08,.32,roughness))*.72);
    // Preserve the cool pane tint in transmission while allowing the grazing
    // Fresnel lobe to remain neutral and crisp against the city capture.
    transmitted*=mix(vec3<f32>(1.0),in.tint.rgb,clamp(1.0-transmission,.0,.35));
    let reflectionTint=mix(vec3<f32>(1.0),in.tint.rgb*.92+.08,clamp(glassF,.0,.72));
    color=mix(transmitted,glassReflection*reflectionTint,glassF);
  }
  if(materialKind>9.5){
    color=mix(color,environmentRadiance,.58+.32*pow(1.0-nv,5.0));
  }
  // Rough dry asphalt is an absorber, not a sky-colored mirror. Keep the broad
  // dielectric lobe subdued until actual water/ice state creates local coverage.
  if(materialKind>4.5&&materialKind<5.5){color*=mix(.52,1.0,max(waterCoverage,clamp(u.surfacePhase.w/.0015,0.0,1.0)*.35));}

  if(f.params.x>.5){let bin=lightCell(in.worldPos);if(bin!=0xffffffffu){for(var j=0u;j<lightCells[bin];j++){color+=pointLight(lightGrid.sources[lightCells[bin+1u+j]],in.worldPos,n,geometricNormal,viewDir,roughness,base,f0,metal,clearcoat,coatRough);}}}
  // Backlit fabric transmits its dyed weave. Constant emission alone erases
  // the cloth texture and turns every lit curtain into a featureless panel.
  color+=base*facadeEmission;
  color+=u.emission.rgb*select(vec3<f32>(1),clamp(albedo,vec3<f32>(.05),vec3<f32>(1)),u.pbr.z>4.5);
  // reflectionVP mirrors around y=.015 in render space. Applying that image
  // to elevated/sloped roads projects road paint and actors at false positions.
  // Those surfaces use depth-tested SSR instead of the unrelated global plane.
  let asphalt=materialKind>4.5&&materialKind<5.5;
  let planarRoad=asphalt&&abs(in.worldPos.y-.015)<.02&&geometricNormal.y>.999;
  if(planarRoad&&in.reflected==0u){
    let p=f.reflectionVP*vec4<f32>(in.worldPos,1);let uv=p.xy/p.w*vec2<f32>(.5,-.5)+.5;
    let ripple=vec2<f32>(noise3(in.worldPos*vec3<f32>(7,1,3))-.5,noise3(in.worldPos*vec3<f32>(3,1,9)+9.0)-.5)*.000075;let blur=vec2<f32>(.0011,.0021)*(roughness+.2);var reflection=textureSampleLevel(reflectionMap,reflectionSampler,clamp(uv+ripple,vec2<f32>(.001),vec2<f32>(.999)),0).rgb*.28;
    for(var k=0;k<6;k++){let a=f32(k)*1.0472;reflection+=textureSampleLevel(reflectionMap,reflectionSampler,clamp(uv+ripple+vec2<f32>(cos(a),sin(a))*blur,vec2<f32>(.001),vec2<f32>(.999)),0).rgb*.12;}
    let icePatch=smoothstep(.58,.77,noise3(in.worldPos*vec3<f32>(.35,.1,1.1)))*clamp(u.surfacePhase.w/.002,0.0,1.0);
    let fres=.02+.96*pow(1.0-nv,5.0);
    // Damp aggregate is still rough: a small wetness value must not overlay a
    // sharp copy of the whole street before a smooth water/ice film forms.
    let roadReflection=max(waterCoverage*(1.0-roadSlurry*.72),icePatch*.45)*(1.0-smoothstep(.25,.55,roughness));
    let inBounds=p.w>0.0&&all(uv>vec2<f32>(.001))&&all(uv<vec2<f32>(.999));
    color=mix(color,reflection,select(0.0,fres*roadReflection,inBounds));
  }
  let fog=1.0-exp(-fogViewDepth(eye,in.worldPos,f.sky.w));
  color=mix(color,f.fogColor.rgb,clamp(fog,0.0,1.0));
  color+=pointFog(eye,in.worldPos,f.sky.w);
  let grazing=pow(1.0-nv,5.0);
  let screenReflectance=environmentFresnel*pow(1.0-coatViewF,2.0)+vec3<f32>(coatViewF);
  // Pack independent SSR roughness in reflectance.a; normal.a stays the base
  // roughness for diffuse/AO. Planar receivers must not receive a second SSR
  // reflection; elevated wet asphalt can use the local depth-tested path.
  let screenRoughness=mix(roughness,min(roughness,coatRough),clearcoat);
  ${coating?'if(coating.x<.015){discard;}':''}
  let glassOpacity=mix(clamp(in.tint.a*.90,.22,.55),.82,grazing);var out:GOut;out.color=vec4<f32>(color,select(in.tint.a,glassOpacity,materialKind>.5&&materialKind<1.5));out.normal=vec4<f32>(n*.5+.5,roughness);out.specular=vec4<f32>(screenReflectance,select(.5+.5*screenRoughness,0.0,planarRoad||(asphalt&&waterCoverage<=.001)));out.velocity=in.velocity;${logarithmic?`out.depth=logarithmicCameraDepth(${relief?'hitClip.w':'input.cameraDepth'},f.cameraDepth.x);`:relief?'out.depth=clamp(hitClip.z/hitClip.w,0.0,1.0);':''}return out;
}`;

const snowShader=(logarithmic=false)=>FRAME_WGSL+LIGHT_GRID_WGSL+FOG_MEDIUM_WGSL+snowfallShader(logarithmic);
function materialShaderForPlan(source:string,plan:RenderPipelinePlan):string{
  if(plan.features.planarReflections)return source;
  return source.replace('let planarRoad=asphalt&&','let planarRoad=false&&asphalt&&');
}

const reflectionLodShader=(logarithmic=false)=>FRAME_WGSL+COATING_LOSS_WGSL+FACADE_SURFACE_WGSL+TERRAIN_MAP_WGSL+GROUND_COVER_WGSL+`
struct U {
  model:mat4x4<f32>,prevModel:mat4x4<f32>,color:vec4<f32>,surface:vec4<f32>,weather:vec4<f32>,
  surfacePhase:vec4<f32>,surfaceDynamics:vec4<f32>,motion:vec4<f32>,objectState:vec4<f32>,
  fieldFrame:vec4<f32>,fieldSize:vec4<f32>,pbr:vec4<f32>,emission:vec4<f32>,texture:vec4<f32>,detail:vec4<f32>,snowpack:vec4<f32>,relief:vec4<f32>,surfaceOverride:vec4<f32>,groundDetail:vec4<f32>
}
@group(0) @binding(0) var<uniform> u:U;
@group(0) @binding(4) var surfaceTexture:texture_2d<f32>;
@group(0) @binding(5) var surfaceSampler:sampler;
@group(1) @binding(0) var<uniform> f:Frame;
fn grassWorld(world:vec4f,uv:vec2f)->vec4f {
 var result=world;
 if(u.groundDetail.x>4.5){result.y-=uv.y*smoothstep(3.5,6.5,distance(world.xz,f.eye.xz));}
 return result;
}
struct O {@builtin(position) position:vec4<f32>,@location(0) normal:vec3<f32>,@location(1) worldPos:vec3<f32>,@location(2) vertexColor:vec3<f32>,@location(4) uv:vec2f,@location(5) @interpolate(flat) seed:f32${logarithmic?',@location(6) cameraDepth:f32':''}}
@vertex fn reflectionVS(@location(0) position:vec3<f32>,@location(1) normal:vec3<f32>,@location(6) vertexColor:vec4<f32>,@location(13) authoredUV:vec2f,@location(14) authoredSeed:f32)->O{
  let world=grassWorld(u.model*vec4<f32>(position,1),authoredUV);let a=u.model[0].xyz;let b=u.model[1].xyz;let c=u.model[2].xyz;
  var out:O;out.seed=authoredSeed+u.weather.z;out.uv=authoredUV;out.position=f.reflectionVP*world;${logarithmic?'out.cameraDepth=out.position.w;':''}out.worldPos=world.xyz;out.vertexColor=vertexColor.rgb;
  out.normal=normalize(mat3x3<f32>(a/dot(a,a),b/dot(b,b),c/dot(c,c))*normal);return out;
}
${logarithmic?'struct ReflectionOutput {@location(0) color:vec4<f32>,@builtin(frag_depth) depth:f32}':''}
@fragment fn fs(in:O)->${logarithmic?'ReflectionOutput':'@location(0) vec4<f32>'}{
 let coatingWidth=fwidth(in.uv);
  if(in.worldPos.y<.04){discard;}
  var n=normalize(in.normal);
  let facadeDpX=dpdx(in.worldPos);let facadeDpY=dpdy(in.worldPos);let facadeUvX=dpdx(in.uv);let facadeUvY=dpdy(in.uv);var facadeEmission=0.;
  var base=pow(max(u.color.rgb*in.vertexColor*(1.0-select(0.0,u.surface.w,u.surfaceOverride.x>.5)),vec3<f32>(0)),vec3<f32>(2.2));
  if(u.texture.w>1.5){let color=textureSampleLevel(surfaceTexture,surfaceSampler,terrainMapUV(in.uv,u.texture.x,textureDimensions(surfaceTexture)),0).rgb;base=pow(max(color*(1.-select(0.,u.surface.w,u.surfaceOverride.x>.5)),vec3f(0)),vec3f(2.2));if(terrainWaterMask(color)>.5){n=terrainWaterNormal(n,in.uv,f.up.w,terrainSourceAxes(facadeDpX,facadeDpY,facadeUvX,facadeUvY));}}
  if(u.relief.z>=0.){let loss=coatingLoss(in.uv,coatingWidth,u.relief.w,u.relief.z);if(loss.x<.015){discard;}base=mix(mix(base,pow(mix(u.color.rgb*in.vertexColor*.48,vec3f(.24,.25,.24),.65),vec3f(2.2)),loss.x),pow(vec3f(.46,.47,.48),vec3f(2.2)),loss.y);}
  if(u.groundDetail.z>.5){let facade=facadeMaterial(in.uv,facadeDpX,facadeDpY,facadeUvX,facadeUvY,n,in.worldPos.y+f.renderOrigin.y,in.seed,u.groundDetail.z>1.5,resolveFacadeNight(u.groundDetail.w,f.surfaceRain.w,f.renderOrigin.w),u.surface.y,f.surfaceRain.x,u.color.rgb*in.vertexColor);base=pow(max(facade.color,vec3f(0)),vec3f(2.2));n=facade.normal;facadeEmission=facade.emission;}
  if(u.groundDetail.x>3.5&&u.groundDetail.x<4.5){
    let coverColor=pow(max(base,vec3f(0)),vec3f(1./2.2));
    let coverFootprint=max(length(facadeDpX.xz),length(facadeDpY.xz))*.5;
    if(n.y>.8&&terrainWaterMask(coverColor)<.5&&coverColor.g>coverColor.r*1.08&&coverColor.g>coverColor.b*1.10){base=pow(max(turf(in.worldPos.xz+f.renderOrigin.xz,coverColor,coverFootprint),vec3f(0)),vec3f(2.2));}
  }
  if(u.groundDetail.x>4.5){n=normalize(mix(n,vec3f(0,1,0),.55));}
  let ndl=max(dot(n,f.sun.xyz),0.0);
  let sky=f.sky.rgb*(.18+.60*max(n.y,0.0));
  let direct=f.sunColor.rgb*f.sun.w*ndl*.318309886;
  let radiance=base*(sky+direct+facadeEmission)+u.emission.rgb;
  ${logarithmic?'var out:ReflectionOutput;out.color=vec4<f32>(radiance,1);out.depth=logarithmicCameraDepth(in.cameraDepth,f.cameraDepth.x);return out;':'return vec4<f32>(radiance,1);'}
}
`;

const PROBE_SHADER=COATING_LOSS_WGSL+FACADE_SURFACE_WGSL+TERRAIN_MAP_WGSL+GROUND_COVER_WGSL+`
struct U {
  model:mat4x4<f32>,prevModel:mat4x4<f32>,color:vec4<f32>,surface:vec4<f32>,weather:vec4<f32>,
  surfacePhase:vec4<f32>,surfaceDynamics:vec4<f32>,motion:vec4<f32>,objectState:vec4<f32>,
  fieldFrame:vec4<f32>,fieldSize:vec4<f32>,pbr:vec4<f32>,emission:vec4<f32>,texture:vec4<f32>,detail:vec4<f32>,snowpack:vec4<f32>,relief:vec4<f32>,surfaceOverride:vec4<f32>,groundDetail:vec4<f32>
}
struct P {vp:mat4x4<f32>,sun:vec4<f32>,sunColor:vec4<f32>,sky:vec4<f32>,renderOrigin:vec4<f32>,surfaceFrame:vec4f}
@group(0) @binding(0) var<uniform> u:U;
@group(0) @binding(4) var surfaceTexture:texture_2d<f32>;
@group(0) @binding(5) var surfaceSampler:sampler;
@group(1) @binding(0) var<uniform> p:P;
struct O {@builtin(position) position:vec4<f32>,@location(0) normal:vec3<f32>,@location(1) vertexColor:vec3<f32>,@location(2) uv:vec2f,@location(3) worldPos:vec3f,@location(4) @interpolate(flat) seed:f32}
@vertex fn vs(@location(0) position:vec3<f32>,@location(1) normal:vec3<f32>,@location(6) vertexColor:vec4<f32>,@location(13) authoredUV:vec2f,@location(14) authoredSeed:f32)->O{
 let world=u.model*vec4<f32>(position,1);let a=u.model[0].xyz;let b=u.model[1].xyz;let c=u.model[2].xyz;
 var out:O;out.seed=authoredSeed+u.weather.z;out.worldPos=world.xyz;out.uv=authoredUV;out.position=p.vp*world;out.vertexColor=vertexColor.rgb;out.normal=normalize(mat3x3<f32>(a/dot(a,a),b/dot(b,b),c/dot(c,c))*normal);return out;
}
@fragment fn fs(in:O)->@location(0) vec4<f32>{
 let coatingWidth=fwidth(in.uv);
 var n=normalize(in.normal);let facadeDpX=dpdx(in.worldPos);let facadeDpY=dpdy(in.worldPos);let facadeUvX=dpdx(in.uv);let facadeUvY=dpdy(in.uv);var facadeEmission=0.;
 var base=pow(max(u.color.rgb*in.vertexColor*(1.0-select(0.0,u.surface.w,u.surfaceOverride.x>.5)),vec3<f32>(0)),vec3<f32>(2.2));
 if(u.texture.w>1.5){let color=textureSampleLevel(surfaceTexture,surfaceSampler,terrainMapUV(in.uv,u.texture.x,textureDimensions(surfaceTexture)),0).rgb;base=pow(max(color*(1.-select(0.,u.surface.w,u.surfaceOverride.x>.5)),vec3f(0)),vec3f(2.2));if(terrainWaterMask(color)>.5){n=terrainWaterNormal(n,in.uv,p.surfaceFrame.x,terrainSourceAxes(facadeDpX,facadeDpY,facadeUvX,facadeUvY));}}
 if(u.relief.z>=0.){let loss=coatingLoss(in.uv,coatingWidth,u.relief.w,u.relief.z);if(loss.x<.015){discard;}base=mix(mix(base,pow(mix(u.color.rgb*in.vertexColor*.48,vec3f(.24,.25,.24),.65),vec3f(2.2)),loss.x),pow(vec3f(.46,.47,.48),vec3f(2.2)),loss.y);}
 if(u.groundDetail.z>.5){let facade=facadeMaterial(in.uv,facadeDpX,facadeDpY,facadeUvX,facadeUvY,n,in.worldPos.y+p.renderOrigin.y,in.seed,u.groundDetail.z>1.5,resolveFacadeNight(u.groundDetail.w,p.sky.w,p.renderOrigin.w),u.surface.y,p.sunColor.w,u.color.rgb*in.vertexColor);base=pow(max(facade.color,vec3f(0)),vec3f(2.2));n=facade.normal;facadeEmission=facade.emission;}
 if(u.groundDetail.x>3.5&&u.groundDetail.x<4.5){
   let coverColor=pow(max(base,vec3f(0)),vec3f(1./2.2));
   let coverFootprint=max(length(facadeDpX.xz),length(facadeDpY.xz))*.5;
   if(n.y>.8&&terrainWaterMask(coverColor)<.5&&coverColor.g>coverColor.r*1.08&&coverColor.g>coverColor.b*1.10){base=pow(max(turf(in.worldPos.xz+p.renderOrigin.xz,coverColor,coverFootprint),vec3f(0)),vec3f(2.2));}
 }
 if(u.groundDetail.x>4.5){n=normalize(mix(n,vec3f(0,1,0),.55));}
 let ndl=max(dot(n,p.sun.xyz),0.0);let up=.35+1.15*max(n.y,0.0);
 let radiance=base*(p.sky.rgb*up+p.sunColor.rgb*p.sun.w*ndl*.72+facadeEmission)+u.emission.rgb;
 return vec4<f32>(radiance,1);
}
`;

export class WebGPURenderer implements Renderer{
  private readonly cameraBatches=new Map<string,GPUCameraBatch>();
  private readonly cameraBatchMembers=new Set<string>();
  private cameraBatchLocations=new Map<string,{batch:GPUCameraBatch;index:number}>();
  private cameraBatchTemporalPending=new Set<RuntimeEntity>();
  private cameraBatchTemporalNext=new Set<RuntimeEntity>();
  private cameraBatchTemporalSeen=new Set<RuntimeEntity>();
  private cameraBatchTemporalReset=false;
  private cameraBatchCauses:CameraBatchCause[]=[];private cameraBatchPlans:GPUCameraBatch[]=[];private cameraBatchScene:Scene|null=null;private cameraBatchPlanBuilds=0;
  private readonly instanceMetadata=new WeakMap<RuntimeEntity,{material:RuntimeEntity['material'];key:string;weather:Float32Array}>();
  private readonly materialBatchKeys=new WeakMap<object,string>();
  private cameraBatchMeshIds=new WeakMap<GPUMesh,number>();private cameraBatchMeshSerial=0;
  private cameraBatchMaterialIds=new Map<string,number>();private cameraBatchMaterialSerial=0;
  private batchTriangles=0;private batchVisible:number|null=0;
  private depth:GPUAny=null;private hdr:GPUAny=null;private opaqueScene:GPUAny=null;private opaqueBind:GPUAny=null;private normal:GPUAny=null;private specular:GPUAny=null;private velocity:GPUAny=null;private effectsHdr:GPUAny=null;private effectsBind:GPUAny=null;private taaA:GPUAny=null;private taaB:GPUAny=null;private taaBindAB:GPUAny=null;private taaBindBA:GPUAny=null;private presentBindA:GPUAny=null;private presentBindB:GPUAny=null;private reflection:GPUAny=null;private reflectionDepth:GPUAny=null;private depthW=0;private depthH=0;
  private fixedResolution:readonly [number,number]|undefined;
  private bloomA:GPUAny=null;private bloomB:GPUAny=null;private bloomDownBind:GPUAny=null;private bloomHorizontalBind:GPUAny=null;private bloomVerticalBind:GPUAny=null;
  private readonly meshes=new Map<string,GPUMesh>();private readonly meshByPrimitive=new WeakMap<object,GPUMesh>();private readonly objects=new Map<string,GPUObject>();private readonly shadowBatches=new Map<string,GPUShadowBatch>();
  private readonly instanceBatches=new Map<string,GPUInstanceBatch>();
  // Stable render-only entities keep the same immutable material and frozen mesh
  // until an actual appearance/geometry revision. Cache batch identity and seed.
  private readonly instanceIdentity=new WeakMap<RuntimeEntity,{primitive:Primitive;material:RuntimeEntity['material'];key:string;seed:number}>();
  private instancingEnabled=true;private readonly errors:string[]=[];private readonly labels=new Map<string,GPUAny>();
  private readonly surfaceTextures:SurfaceTextures;
  private appearanceScene:Scene|null=null;private appearanceRevision=-1;private renderFrame:RenderFrameIR|null=null;
  private readonly frameFamily=new RenderFrameFamily();private frameBuilder:RenderFrameBuilder=this.frameFamily.compile('detailed');
  private readonly frameCache=new RenderFrameCache();
  private readonly radianceProjection=new RenderRadianceProjection();
  private readonly materialLoads=new Map<string,Promise<void>>();private readonly failedMaterials=new Set<string>();private disposed=false;
  private pointLights=0;private lightOverflow=0;private lightGridKey='';private environmentKey='';private environmentMapCache?:Map<string,{irradiance:Float32Array;mips:Uint16Array[]}>;private environmentUpdates=0;private readonly environmentInvalidations=new Map<string,number>();private environmentScene:Scene|null=null;private measuredRadianceSpec:EnvironmentRadianceSpec|null=null;private measuredRadiance:Float32Array|null=null;private readonly environmentIrradiance=new Float32Array(36);private collectedScene:Scene|null=null;private collectedRevision=-1;private collectedVisible:RuntimeEntity[]=[];private collectedOpaque:RuntimeEntity[]=[];private collectedTransparent:RuntimeEntity[]=[];
  private shadowValid=false;private shadowRevision=-1;private spotShadows:SpotShadow[]=[];
  private localProbeMask=0;private localProbeFace=0;private localProbePosition:Vec3|null=null;private localProbeBounds:{min:Vec3;max:Vec3}|null=null;private localProbeKey='';private probeComplete=false;private readonly probeCapture=new ProbeCapture();
  private drawCalls=0;private triangles=0;private lastCamera:Vec3=[0,0,0];private lastScene:Scene|null=null;private lastLights:readonly RuntimeEntity[]=[];private previousVp:Mat4|null=null;private previousJitter:readonly[number,number]|null=null;private previousCamera:Vec3|null=null;private previousTarget:Vec3|null=null;private readonly previousModels=new RenderModelHistory();private readonly modelCache=new Map<string,{px:number;py:number;pz:number;rx:number;ry:number;rz:number;sx:number;sy:number;sz:number;matrix:Mat4}>();private readonly cullScratch=new Float32Array(16);private readonly visibilityPlan=new RenderVisibilityPlan();private historyValid=false;private taaHistoryIndex=0;private lastRenderTime=-Infinity;
  private readonly profiler:RenderProfiler;
  private presentBindDirect:GPUAny=null;
  private postProcessing:PostProcessingSettings;
  private blackBloom:GPUAny=null;private effectsBindNoBloom:GPUAny=null;
  private motionHdr:GPUAny=null;private motionBindA:GPUAny=null;private motionBindB:GPUAny=null;private motionBindDirect:GPUAny=null;private presentBindMotion:GPUAny=null;
  private readonly shaderAtoms:Readonly<Record<string,ShaderProgramAtoms>>;
  private opaqueDepthTarget:GPUAny=null;
  private constructor(private readonly canvas:HTMLCanvasElement,private readonly device:GPUAny,private readonly context:GPUAny,private readonly format:string,private readonly gpu:GPUAny,profiling:boolean,timestampQueries:boolean,private readonly visibilityMode:VisibilityMode='cpu',private readonly pipelinePlan:RenderPipelinePlan=compileRenderPipeline(),private readonly depthConfiguration:CameraDepthConfiguration=cameraDepthConfiguration(),private readonly opaqueDepthPrepass=false){
    this.postProcessing={temporalAA:pipelinePlan.features.temporalAA,bloom:pipelinePlan.features.bloom,motionBlur:pipelinePlan.features.motionBlur?.25:0};
    this.surfaceTextures=new SurfaceTextures(device);this.profiler=new RenderProfiler(device,{enabled:profiling,timestampQueries});
    const logarithmic=depthConfiguration.encoding==='logarithmic',materialSource=opaqueDepthPrepassShader(materialShaderForPlan(materialShader(false,false,false,logarithmic),pipelinePlan),opaqueDepthPrepass),reflectionSource=reflectionLodShader(logarithmic);
    this.shaderAtoms=profiling?Object.freeze({
      material:analyzeWGSL('material',materialSource,['vs','fs','shadowVS']),
      ...(visibilityMode!=='cpu'?{instances:analyzeWGSL('instances',instancedMaterialShader(materialSource,pipelinePlan.motionVectors),['vs','fs']),...(pipelinePlan.features.planarReflections?{reflectionInstances:analyzeWGSL('reflectionInstances',instancedReflectionShader(reflectionSource,pipelinePlan.motionVectors),['reflectionVS','fs'])}:{}),visibility:analyzeWGSL('visibility',VISIBILITY_SHADER,['main'])}:{}),
      ...(pipelinePlan.features.planarReflections?{reflection:analyzeWGSL('reflection',reflectionSource,['reflectionVS','fs'])}:{}),
      sky:analyzeWGSL('sky',SKY_SHADER,['vs','fs']),
      snow:analyzeWGSL('snow',snowShader(logarithmic),['vs','fs']),
      ...(pipelinePlan.features.bloom?{bloom:analyzeWGSL('bloom',BLOOM_SHADER,['vs','downsample','horizontal','vertical'])}:{}),
      ...(pipelinePlan.effects?{effects:analyzeWGSL('effects',pipelinePlan.features.screenSpace?EFFECTS_SHADER:BLOOM_COMPOSITE_SHADER,['vs','fs'])}:{}),
      ...(pipelinePlan.features.temporalAA?{taa:analyzeWGSL('taa',TAA_SHADER,['vs','fs'])}:{}),
      ...(pipelinePlan.features.motionBlur?{motionBlur:analyzeWGSL('motionBlur',MOTION_BLUR_SHADER,['vs','fs'])}:{}),
      present:analyzeWGSL('present',PRESENT_SHADER,['vs','fs']),
    }):Object.freeze({});
    device.addEventListener?.('uncapturederror',(event:any)=>{const message=event?.error?.message??String(event?.error);this.errors.push(message);console.error('Game Engine WebGPU:',message);});device.lost?.then((info:any)=>this.errors.push(`Device lost: ${info?.message??'unknown'}`));
  }
  static async create(canvas:HTMLCanvasElement,options:WebGPURendererOptions={}):Promise<WebGPURenderer>{
    const depthConfiguration=cameraDepthConfiguration(options.logarithmicDepthFar),logarithmic=depthConfiguration.encoding==='logarithmic';
    const opaqueDepthPrepass=opaqueDepthPrepassEnabled(options.opaqueDepthPrepass,depthConfiguration,1);
    const pipelinePlan=compileRenderPipeline(options.features);
    const visibilityMode=options.visibility??'cpu';
    if(!['cpu','cpu-batched','gpu'].includes(visibilityMode))throw new RangeError('Invalid visibility mode');
    const gpu=(navigator as any).gpu;if(!gpu)throw new Error('WebGPU unavailable');
    const adapter=await gpu.requestAdapter({powerPreference:'high-performance'});if(!adapter)throw new Error('No WebGPU adapter');
    const profiling=options.profiling??false,timestampQueries=profiling&&!!adapter.features?.has?.('timestamp-query');
    const device=await adapter.requestDevice(timestampQueries?{requiredFeatures:['timestamp-query']}:undefined),context=canvas.getContext('webgpu') as any,format=gpu.getPreferredCanvasFormat();
    // Pipeline validation can happen before the renderer's uncaptured-error
    // listener exists. Report the original error instead of an invalid encoder
    // on the first frame that tries to use an invalid pipeline.
    device.pushErrorScope('validation');let initializationScopeOpen=true;
    try{
    context.configure({device,format,alphaMode:'opaque'});
    const pipelineChecks:Promise<string|null>[]=[];
    const createPipeline=(label:string,descriptor:GPUAny):Promise<GPUAny>=>{
      let pending:Promise<GPUAny>;
      if(typeof device.createRenderPipelineAsync==='function'){
        try{pending=Promise.resolve(device.createRenderPipelineAsync({label,...descriptor}));}
        catch(error){pending=Promise.reject(error);}
      }else{
        device.pushErrorScope('validation');
        try{pending=Promise.resolve(device.createRenderPipeline({label,...descriptor}));}
        catch(error){pending=Promise.reject(error);}
        finally{
          const check=device.popErrorScope().then((error:GPUAny)=>error?`${label}: ${error.message}`:null);
          // Shader diagnostics may yield before the final validation join.
          void check.catch(()=>{});pipelineChecks.push(check);
        }
      }
      const ready=pending.catch(error=>{throw new Error(`WebGPU initialization: ${label}: ${error?.message??String(error)}`,{cause:error});});
      // Attach a handler immediately: an unrelated earlier layout dependency may
      // fail before the final graph join. The join still receives this rejection.
      void ready.catch(()=>{});return ready;
    };
    // The reflection plane clip uses discard. Keep it out of the main material
    // pipeline so opaque geometry can use early depth rejection on tile GPUs.
    const materialSource=opaqueDepthPrepassShader(materialShaderForPlan(materialShader(false,false,false,logarithmic),pipelinePlan),opaqueDepthPrepass),reflectionSource=reflectionLodShader(logarithmic);
    const module=device.createShaderModule({code:materialSource}),reflectionModule=device.createShaderModule({code:reflectionSource}),geometryVertexBuffer={arrayStride:24,attributes:[{shaderLocation:0,offset:0,format:'float32x3'},{shaderLocation:1,offset:12,format:'float32x3'}]},colorVertexBuffer={arrayStride:16,attributes:[{shaderLocation:6,offset:0,format:'unorm8x4'},{shaderLocation:13,offset:4,format:'float32x2'},{shaderLocation:14,offset:12,format:'float32'}]},vertex={module,entryPoint:'vs',buffers:[geometryVertexBuffer,colorVertexBuffer]};
    const objectLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:3,buffer:{type:'uniform'}},{binding:1,visibility:2,texture:{sampleType:'unfilterable-float'}},{binding:2,visibility:2,texture:{sampleType:'float'}},{binding:3,visibility:2,sampler:{type:'filtering'}},{binding:4,visibility:2,texture:{sampleType:'float'}},{binding:5,visibility:2,sampler:{type:'filtering'}},{binding:6,visibility:2,texture:{sampleType:'float'}},{binding:7,visibility:2,texture:{sampleType:'float'}},{binding:8,visibility:3,texture:{sampleType:'unfilterable-float'}},{binding:9,visibility:2,texture:{sampleType:'float'}}]});
    const frameLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:3,buffer:{type:'uniform'}}]});
    const probeFrameLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:3,buffer:{type:'uniform'}}]});
    const lightLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:3,buffer:{type:'uniform'}},{binding:1,visibility:2,texture:{sampleType:'depth'}},{binding:2,visibility:2,sampler:{type:'comparison'}},{binding:3,visibility:2,texture:{sampleType:'float'}},{binding:4,visibility:2,sampler:{type:'filtering'}},{binding:5,visibility:3,buffer:{type:'read-only-storage'}},{binding:6,visibility:3,buffer:{type:'read-only-storage'}},{binding:7,visibility:2,texture:{viewDimension:'3d'}},{binding:8,visibility:2,sampler:{type:'filtering'}},{binding:9,visibility:2,texture:{sampleType:'float',viewDimension:'cube'}},{binding:10,visibility:2,texture:{sampleType:'float',viewDimension:'cube'}},{binding:11,visibility:2,texture:{sampleType:'depth'}},{binding:12,visibility:2,texture:{sampleType:'float'}},{binding:13,visibility:2,texture:{sampleType:'depth',viewDimension:'2d-array'}},{binding:14,visibility:2,buffer:{type:'uniform'}},...(opaqueDepthPrepass?[{binding:15,visibility:2,texture:{sampleType:'depth'}}]:[])]});
    const lightBuffer=device.createBuffer({size:(4+MAX_RENDER_LIGHTS*LIGHT_SOURCE_FLOATS)*4,usage:0x80|0x08}),cellBuffer=device.createBuffer({size:LIGHT_GRID_SIDE**2*(LIGHTS_PER_CELL+1)*4,usage:0x80|0x08});
    const frame=device.createBuffer({size:FRAME_UNIFORM_BYTES,usage:0x40|0x08}),shadow=device.createTexture({size:[SHADOW_MAP_SIZE,SHADOW_MAP_SIZE],format:'depth32float',usage:0x10|0x04}),dynamicShadow=device.createTexture({size:[DYNAMIC_SHADOW_MAP_SIZE,DYNAMIC_SHADOW_MAP_SIZE],format:'depth32float',usage:0x10|0x04});
    const spotShadowMap=device.createTexture({label:'spotlight shadows',size:[SPOT_SHADOW_SIZE,SPOT_SHADOW_SIZE,SPOT_SHADOW_LIMIT],format:'depth32float',usage:0x10|0x04});
    const spotShadowParams=device.createBuffer({label:'spotlight receiver projections',size:SPOT_SHADOW_LIMIT*80,usage:0x40|0x08});
    const spotFrames=Array.from({length:SPOT_SHADOW_LIMIT},()=>device.createBuffer({size:FRAME_UNIFORM_BYTES,usage:0x40|0x08}));
    const spotFrameBinds=spotFrames.map(buffer=>device.createBindGroup({layout:frameLayout,entries:[{binding:0,resource:{buffer}}]}));
    const comparison=device.createSampler({compare:'less-equal',minFilter:'linear',magFilter:'linear'}),sampler=device.createSampler({minFilter:'linear',magFilter:'linear',mipmapFilter:'linear'});
    const noiseVolume=createNoiseVolume(device),noiseSampler=device.createSampler({minFilter:'linear',magFilter:'linear',addressModeU:'repeat',addressModeV:'repeat',addressModeW:'repeat'});
    const environmentMap=device.createTexture({label:'prefiltered environment',size:[256,256,6],mipLevelCount:9,format:'rgba16float',usage:0x04|0x02}),environmentView=environmentMap.createView({dimension:'cube'});
    // 192px local capture: 2.25x the linear sampling detail of the old 128px probe,
    // while keeping the capture cheap enough to avoid a full-resolution reflection pass.
    const localProbeMap=device.createTexture({label:'local reflection probe',size:[192,192,6],mipLevelCount:PROBE_MIP_LEVELS,format:'rgba16float',usage:0x10|0x04|0x02}),localProbeView=localProbeMap.createView({dimension:'cube'});
    const localProbeCapture=device.createTexture({label:'local reflection capture',size:[192,192,6],format:'rgba16float',usage:0x10|0x04|0x01});
    const localProbeDepth=device.createTexture({label:'local reflection probe depth',size:[192,192],format:'depth32float',usage:0x10});
    const surfaceSampler=device.createSampler({minFilter:'linear',magFilter:'linear',mipmapFilter:'linear',addressModeU:'repeat',addressModeV:'repeat',maxAnisotropy:8});
    const emptyField=device.createTexture({size:[1,1],format:'rgba32float',usage:0x04|0x02}),emptyLabel=device.createTexture({size:[1,1],format:'rgba8unorm',usage:0x04|0x02});device.queue.writeTexture({texture:emptyField},new Float32Array(4),{bytesPerRow:16},[1,1]);device.queue.writeTexture({texture:emptyLabel},new Uint8Array(4),{bytesPerRow:4},[1,1]);
    const frameBind=device.createBindGroup({layout:frameLayout,entries:[{binding:0,resource:{buffer:frame}}]});
    const opaqueDepthEmpty=opaqueDepthPrepass?device.createTexture({label:'opaque depth prepass fallback',size:[1,1],format:'depth32float',usage:0x04}):null;
    const reflectionBind=device.createBindGroup({layout:lightLayout,entries:[{binding:0,resource:{buffer:frame}},{binding:1,resource:shadow.createView()},{binding:2,resource:comparison},{binding:3,resource:emptyLabel.createView()},{binding:4,resource:sampler},{binding:5,resource:{buffer:lightBuffer}},{binding:6,resource:{buffer:cellBuffer}},{binding:7,resource:noiseVolume.createView()},{binding:8,resource:noiseSampler},{binding:9,resource:environmentView},{binding:10,resource:localProbeView},{binding:11,resource:dynamicShadow.createView()},{binding:12,resource:emptyLabel.createView()},{binding:13,resource:spotShadowMap.createView({dimension:'2d-array'})},{binding:14,resource:{buffer:spotShadowParams}},...(opaqueDepthPrepass?[{binding:15,resource:opaqueDepthEmpty.createView()}]:[])]});
    const layout=device.createPipelineLayout({bindGroupLayouts:[objectLayout,lightLayout]});
    const instanceVertexBuffer={arrayStride:160,stepMode:'instance',attributes:[
      {shaderLocation:2,offset:0,format:'float32x4'},{shaderLocation:3,offset:16,format:'float32x4'},
      {shaderLocation:4,offset:32,format:'float32x4'},{shaderLocation:5,offset:48,format:'float32x4'},
      {shaderLocation:7,offset:64,format:'float32x4'},{shaderLocation:8,offset:80,format:'float32x4'},
      {shaderLocation:9,offset:96,format:'float32x4'},{shaderLocation:10,offset:112,format:'float32x4'},
      {shaderLocation:11,offset:128,format:'float32x4'},{shaderLocation:12,offset:144,format:'float32x4'}
    ]};
    const instancedVertex={...vertex,entryPoint:'vsInstanced',buffers:[geometryVertexBuffer,colorVertexBuffer,instanceVertexBuffer]};
    const blend={color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}};
    // Fragment outputs without consumers have null attachment slots. Keep the
    // original material math; the pipeline owns the write/dependency contract.
    const mainTargets=(transparent=false,snow=false)=>pipelinePlan.colorTargets.map((format,index)=>format?{format,...(index===0?(transparent||snow?{blend}:{}):snow&&index===3?{blend}:transparent||snow?{writeMask:0}:{})}:null);
    const materialClasses=[0,1,2,3,4,5,6,7,8,9,10] as const;
    const make=(transparent:boolean,cullMode:'none'|'back',materialClass=-1,instanced=false)=>createPipeline(`material ${materialClass} ${transparent?'transparent':'opaque'} ${cullMode}`,{layout,vertex:instanced?instancedVertex:vertex,fragment:{module,entryPoint:'fs',constants:{MATERIAL_CLASS:materialClass,...(opaqueDepthPrepass?{OPAQUE_DEPTH_PREPASS:!transparent}:{})},targets:mainTargets(transparent)},primitive:{topology:'triangle-list',cullMode},depthStencil:{format:'depth32float',depthWriteEnabled:!transparent,depthCompare:'less'}});
    const reliefModule=device.createShaderModule({code:materialShaderForPlan(materialShader(false,true,false,logarithmic),pipelinePlan)});
    const makeRelief=(cullMode:'none'|'back')=>createPipeline('surface relief '+cullMode,{layout,vertex:{...vertex,module:reliefModule},fragment:{module:reliefModule,entryPoint:'fs',targets:mainTargets()},primitive:{topology:'triangle-list',cullMode},depthStencil:{format:'depth32float',depthWriteEnabled:true,depthCompare:'less'}});
    const coatingModule=device.createShaderModule({code:materialShaderForPlan(materialShader(false,false,true,logarithmic),pipelinePlan)});
    const makeCoating=(cullMode:'none'|'back')=>createPipeline('coating overlay '+cullMode,{layout,vertex:{...vertex,module:coatingModule},fragment:{module:coatingModule,entryPoint:'fs',targets:mainTargets()},primitive:{topology:'triangle-list',cullMode},depthStencil:{format:'depth32float',depthWriteEnabled:true,depthCompare:'less'}});
    const coatingCulled=makeCoating('back'),coatingDouble=makeCoating('none');
    const reliefCulled=makeRelief('back'),reliefDouble=makeRelief('none');
    const opaqueCulled=new Map(materialClasses.map(code=>[code,make(false,'back',code)])),opaqueDouble=new Map(materialClasses.map(code=>[code,make(false,'none',code)]));
    const opaqueInstancedCulled=new Map(materialClasses.map(code=>[code,make(false,'back',code,true)])),opaqueInstancedDouble=new Map(materialClasses.map(code=>[code,make(false,'none',code,true)]));
    const instanceLayout=visibilityMode==='cpu'?null:device.createBindGroupLayout({entries:[{binding:0,visibility:3,buffer:{type:'read-only-storage'}},{binding:1,visibility:1,buffer:{type:'read-only-storage'}}]});
    const instanceModule=instanceLayout?device.createShaderModule({code:instancedMaterialShader(materialSource,pipelinePlan.motionVectors)}):null;
    const instancePipelineLayout=instanceLayout?device.createPipelineLayout({bindGroupLayouts:[objectLayout,lightLayout,instanceLayout]}):null;
    const makeInstances=(cullMode:'back'|'none',code:number)=>createPipeline(`material instances ${code} ${cullMode}`,{layout:instancePipelineLayout,vertex:{...vertex,module:instanceModule},fragment:{module:instanceModule,entryPoint:'fs',constants:{MATERIAL_CLASS:code,...(opaqueDepthPrepass?{OPAQUE_DEPTH_PREPASS:true}:{})},targets:mainTargets()},primitive:{topology:'triangle-list',cullMode},depthStencil:{format:'depth32float',depthWriteEnabled:true,depthCompare:'less'}});
    const instanceCulled=instanceModule?new Map(materialClasses.map(code=>[code,makeInstances('back',code)])):null,instanceDouble=instanceModule?new Map(materialClasses.map(code=>[code,makeInstances('none',code)])):null;
    const opaqueDepthLayout=opaqueDepthPrepass?device.createPipelineLayout({bindGroupLayouts:[objectLayout,frameLayout]}):null;
    const opaqueDepthSharedLayout=opaqueDepthPrepass&&instanceLayout?device.createPipelineLayout({bindGroupLayouts:[objectLayout,frameLayout,instanceLayout]}):null;
    const makeOpaqueDepth=(cullMode:'back'|'none',kind:'single'|'instances'|'shared')=>createPipeline('opaque depth prepass '+kind+' '+cullMode,{
      layout:kind==='shared'?opaqueDepthSharedLayout:opaqueDepthLayout,
      vertex:kind==='shared'?{...vertex,module:instanceModule}:kind==='instances'?instancedVertex:vertex,
      fragment:{module:kind==='shared'?instanceModule:module,entryPoint:'opaqueDepthFS',targets:[]},
      primitive:{topology:'triangle-list',cullMode},depthStencil:{format:'depth32float',depthWriteEnabled:true,depthCompare:'less'}
    });
    const opaqueDepthCulled=opaqueDepthPrepass?makeOpaqueDepth('back','single'):null,opaqueDepthDouble=opaqueDepthPrepass?makeOpaqueDepth('none','single'):null;
    const opaqueDepthInstancedCulled=opaqueDepthPrepass?makeOpaqueDepth('back','instances'):null,opaqueDepthInstancedDouble=opaqueDepthPrepass?makeOpaqueDepth('none','instances'):null;
    const opaqueDepthSharedCulled=opaqueDepthSharedLayout?makeOpaqueDepth('back','shared'):null,opaqueDepthSharedDouble=opaqueDepthSharedLayout?makeOpaqueDepth('none','shared'):null;
    const visibility=instanceLayout?new GpuVisibility(device,pipelinePlan.motionVectors?INSTANCE_FLOATS:CURRENT_INSTANCE_FLOATS):null;
    const transparent=make(true,'none',-1);
    const glass=createPipeline('glass', {layout,vertex,fragment:{module,entryPoint:'fs',constants:{MATERIAL_CLASS:1},targets:mainTargets(true).map((target,index)=>index===0&&target?{format:target.format}:target)},primitive:{topology:'triangle-list',cullMode:'back'},depthStencil:{format:'depth32float',depthWriteEnabled:false,depthCompare:'less'}});
    const blitModule=device.createShaderModule({code:`
@group(0) @binding(0) var source:texture_2d<f32>;
@group(0) @binding(1) var sourceSampler:sampler;
@vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4<f32>{
 let p=array<vec2<f32>,3>(vec2<f32>(-1,-1),vec2<f32>(3,-1),vec2<f32>(-1,3));return vec4<f32>(p[i],0,1);
}
@fragment fn fs(@builtin(position) p:vec4<f32>)->@location(0) vec4<f32>{
 let size=vec2<f32>(textureDimensions(source));return vec4<f32>(textureSampleLevel(source,sourceSampler,p.xy/size,0).rgb,1);
}`});
    const colorOnlyTargets=()=>mainTargets().map((target,index)=>target?{...target,...(index>0?{writeMask:0}:{})}:null);
    const blit=createPipeline('blit', {layout:'auto',vertex:{module:blitModule,entryPoint:'vs'},fragment:{module:blitModule,entryPoint:'fs',targets:colorOnlyTargets()},primitive:{topology:'triangle-list'},depthStencil:{format:'depth32float',depthWriteEnabled:false,depthCompare:'always'}});
    const probeModule=device.createShaderModule({code:PROBE_SHADER}),probePipelineLayout=device.createPipelineLayout({bindGroupLayouts:[objectLayout,probeFrameLayout]});
    const makeProbe=(cullMode:'none'|'back')=>createPipeline(`probe ${cullMode}`,{layout:probePipelineLayout,vertex:{module:probeModule,entryPoint:'vs',buffers:vertex.buffers},fragment:{module:probeModule,entryPoint:'fs',targets:[{format:'rgba16float'}]},primitive:{topology:'triangle-list',cullMode},depthStencil:{format:'depth32float',depthWriteEnabled:true,depthCompare:'less'}});
    const probeCulled=makeProbe('back'),probeDouble=makeProbe('none');
    const probeFilterModule=device.createShaderModule({label:'GGX local probe filter',code:PROBE_FILTER_SHADER});
    const probeFilter=await createPipeline('probe filter', {layout:'auto',vertex:{module:probeFilterModule,entryPoint:'vs'},fragment:{module:probeFilterModule,entryPoint:'fs',targets:[{format:'rgba16float'}]},primitive:{topology:'triangle-list'}});
    const probeSource=localProbeCapture.createView({dimension:'cube',baseMipLevel:0,mipLevelCount:1});
    const probeFilterPasses=probeFilterPlan().map(capture=>{
      const params=device.createBuffer({size:16,usage:0x40,mappedAtCreation:true});
      new Float32Array(params.getMappedRange()).set([capture.face,capture.roughness,0,0]);params.unmap();
      const bind=device.createBindGroup({layout:probeFilter.getBindGroupLayout(0),entries:[{binding:0,resource:probeSource},{binding:1,resource:sampler},{binding:2,resource:{buffer:params}}]});
      const view=localProbeMap.createView({dimension:'2d',baseArrayLayer:capture.face,arrayLayerCount:1,baseMipLevel:capture.mip,mipLevelCount:1});
      return{bind,view,params};
    });

    // The reflection LOD shader has no material-class specialization. Passing
    // an unused override prevents WebKit from creating its fragment library.
    const makeReflected=(cullMode:'none'|'back')=>createPipeline(`reflection ${cullMode}`,{layout,vertex:{...vertex,module:reflectionModule,entryPoint:'reflectionVS'},fragment:{module:reflectionModule,entryPoint:'fs',targets:[{format:'rgba16float'}]},primitive:{topology:'triangle-list',cullMode},depthStencil:{format:'depth32float',depthWriteEnabled:true,depthCompare:'less'}});
    const reflectionCulled=makeReflected('back'),reflectionDouble=makeReflected('none');
    const reflectedCulled=new Map(materialClasses.map(code=>[code,reflectionCulled])),reflectedDouble=new Map(materialClasses.map(code=>[code,reflectionDouble]));
    const reflectionInstanceModule=instanceLayout?device.createShaderModule({code:instancedReflectionShader(reflectionSource,pipelinePlan.motionVectors)}):null;
    const makeReflectedInstances=(cullMode:'none'|'back')=>createPipeline(`reflection instances ${cullMode}`,{layout:instancePipelineLayout,vertex:{...vertex,module:reflectionInstanceModule,entryPoint:'reflectionVS'},fragment:{module:reflectionInstanceModule,entryPoint:'fs',targets:[{format:'rgba16float'}]},primitive:{topology:'triangle-list',cullMode},depthStencil:{format:'depth32float',depthWriteEnabled:true,depthCompare:'less'}});
    const reflectedInstancesCulled=reflectionInstanceModule?makeReflectedInstances('back'):null,reflectedInstancesDouble=reflectionInstanceModule?makeReflectedInstances('none'):null;
    const shadowLayout=device.createPipelineLayout({bindGroupLayouts:[objectLayout,frameLayout]});
    const surfacePassModules={shadow:device.createShaderModule({code:surfacePassShader('shadow',FRAME_WGSL)}),probe:device.createShaderModule({code:surfacePassShader('probe',FRAME_WGSL)}),reflection:device.createShaderModule({code:surfacePassShader('reflection',FRAME_WGSL)})};
    const surfacePasses:any={};for(const kind of ['shadow','probe','reflection'] as const)for(const cullMode of ['back','none'] as const){const module=surfacePassModules[kind];surfacePasses[kind+':'+cullMode]=createPipeline('surface '+kind+' '+cullMode,{layout:kind==='shadow'?shadowLayout:kind==='probe'?probePipelineLayout:layout,vertex:{module,entryPoint:'vs',buffers:kind==='shadow'?[geometryVertexBuffer]:vertex.buffers},fragment:{module,entryPoint:'fs',targets:kind==='shadow'?[]:[{format:'rgba16float'}]},primitive:{topology:'triangle-list',cullMode},depthStencil:{format:'depth32float',depthWriteEnabled:true,depthCompare:'less'}});}
    const shadowInstanceBuffer={arrayStride:64,stepMode:'instance',attributes:[{shaderLocation:2,offset:0,format:'float32x4'},{shaderLocation:3,offset:16,format:'float32x4'},{shaderLocation:4,offset:32,format:'float32x4'},{shaderLocation:5,offset:48,format:'float32x4'}]};
    const makeShadow=(cullMode:'none'|'back',instanced=false)=>createPipeline('shadow '+cullMode+(instanced?' instances':' single'),{layout:shadowLayout,vertex:{...vertex,entryPoint:instanced?'shadowVSInstanced':'shadowVS',buffers:instanced?[geometryVertexBuffer,shadowInstanceBuffer]:[geometryVertexBuffer]},primitive:{topology:'triangle-list',cullMode},depthStencil:{format:'depth32float',depthWriteEnabled:true,depthCompare:'less',depthBias:1,depthBiasSlopeScale:1.5}});
    const shadowCulled=makeShadow('back'),shadowDouble=makeShadow('none'),shadowCulledInstanced=makeShadow('back',true),shadowDoubleInstanced=makeShadow('none',true);
    const sharedShadowModule=instanceLayout?device.createShaderModule({code:instancedShadowShader(materialSource,pipelinePlan.motionVectors)}):null;
    const sharedShadowLayout=instanceLayout?device.createPipelineLayout({bindGroupLayouts:[objectLayout,frameLayout,instanceLayout]}):null;
    const makeSharedShadow=(cullMode:'none'|'back')=>createPipeline('shadow shared '+cullMode,{layout:sharedShadowLayout,vertex:{module:sharedShadowModule,entryPoint:'shadowVSShared',buffers:[geometryVertexBuffer]},primitive:{topology:'triangle-list',cullMode},depthStencil:{format:'depth32float',depthWriteEnabled:true,depthCompare:'less',depthBias:1,depthBiasSlopeScale:1.5}});
    const shadowSharedCulled=sharedShadowModule?makeSharedShadow('back'):null,shadowSharedDouble=sharedShadowModule?makeSharedShadow('none'):null;
    const skyModule=device.createShaderModule({code:SKY_SHADER}),sky=createPipeline('sky', {layout:device.createPipelineLayout({bindGroupLayouts:[frameLayout]}),vertex:{module:skyModule,entryPoint:'vs'},fragment:{module:skyModule,entryPoint:'fs',targets:colorOnlyTargets()},primitive:{topology:'triangle-list'},depthStencil:{format:'depth32float',depthWriteEnabled:false,depthCompare:'always'}});
    const effectsSource=pipelinePlan.features.screenSpace?EFFECTS_SHADER:BLOOM_COMPOSITE_SHADER;
    const effectsLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:2,texture:{sampleType:'float'}},...(pipelinePlan.features.screenSpace?[{binding:1,visibility:2,texture:{sampleType:'float'}},{binding:2,visibility:2,texture:{sampleType:'depth'}},{binding:4,visibility:2,buffer:{type:'uniform'}},{binding:5,visibility:2,texture:{sampleType:'float'}}]:[]),{binding:3,visibility:2,sampler:{type:'filtering'}},{binding:6,visibility:2,texture:{sampleType:'float'}}]});
    const effectsModule=device.createShaderModule({code:effectsSource}),effects=createPipeline('effects', {layout:device.createPipelineLayout({bindGroupLayouts:[effectsLayout]}),vertex:{module:effectsModule,entryPoint:'vs'},fragment:{module:effectsModule,entryPoint:'fs',targets:[{format:'rgba16float'}]},primitive:{topology:'triangle-list'}});
    const taaModule=device.createShaderModule({code:TAA_SHADER}),taa=createPipeline('taa', {layout:'auto',vertex:{module:taaModule,entryPoint:'vs'},fragment:{module:taaModule,entryPoint:'fs',targets:[{format:'rgba16float'}]},primitive:{topology:'triangle-list'}});
    const taaParams=device.createBuffer({size:32,usage:0x40|0x08});
    const motionModule=pipelinePlan.features.motionBlur?device.createShaderModule({code:MOTION_BLUR_SHADER}):null;
    const motionBlur=motionModule?createPipeline('motion blur',{layout:'auto',vertex:{module:motionModule,entryPoint:'vs'},fragment:{module:motionModule,entryPoint:'fs',targets:[{format:'rgba16float'}]},primitive:{topology:'triangle-list'}}):null;
    const motionParams=motionModule?device.createBuffer({size:48,usage:0x40|0x08}):null;
    const presentModule=device.createShaderModule({code:PRESENT_SHADER}),present=createPipeline('present', {layout:'auto',vertex:{module:presentModule,entryPoint:'vs'},fragment:{module:presentModule,entryPoint:'fs',targets:[{format}]},primitive:{topology:'triangle-list'}});
    const bloomModule=device.createShaderModule({code:BLOOM_SHADER}),bloomLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:2,texture:{sampleType:'float'}},{binding:1,visibility:2,sampler:{type:'filtering'}}]}),bloomPipelineLayout=device.createPipelineLayout({bindGroupLayouts:[bloomLayout]});
    const makeBloom=(entryPoint:string)=>createPipeline(`bloom ${entryPoint}`,{layout:bloomPipelineLayout,vertex:{module:bloomModule,entryPoint:'vs'},fragment:{module:bloomModule,entryPoint,targets:[{format:'rgba16float'}]},primitive:{topology:'triangle-list'}});
    const bloomDown=makeBloom('downsample'),bloomHorizontal=makeBloom('horizontal'),bloomVertical=makeBloom('vertical');
    const snowModule=device.createShaderModule({code:snowShader(logarithmic)}),snowLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:1,buffer:{type:'uniform'}}]});
    const snow=createPipeline('snow', {layout:device.createPipelineLayout({bindGroupLayouts:[snowLayout,lightLayout]}),vertex:{module:snowModule,entryPoint:'vs'},fragment:{module:snowModule,entryPoint:'fs',targets:mainTargets(false,true)},primitive:{topology:'triangle-list'},depthStencil:{format:'depth32float',depthWriteEnabled:false,depthCompare:'less'}});
    const snowUniform=device.createBuffer({size:176,usage:0x40|0x08}),snowBind=device.createBindGroup({layout:snowLayout,entries:[{binding:0,resource:{buffer:snowUniform}}]});
    const probeFrames=Array.from({length:6},(_,face)=>device.createBuffer({label:`reflection probe frame ${face}`,size:144,usage:0x40|0x08}));
    const probeFrameBinds=probeFrames.map(buffer=>device.createBindGroup({layout:probeFrameLayout,entries:[{binding:0,resource:{buffer}}]}));
    for(const shader of [module,reliefModule,...Object.values(surfacePassModules),reflectionModule,probeModule,probeFilterModule,skyModule,effectsModule,taaModule,...(motionModule?[motionModule]:[]),presentModule,snowModule,bloomModule,...(instanceModule?[instanceModule,reflectionInstanceModule!,visibility!.shader]:[])]){const info=await shader.getCompilationInfo();const errors=info.messages.filter((m:any)=>m.type==='error');if(errors.length)throw new Error(errors.map((m:any)=>m.message).join('\n'));}
    const readyMap=async(map:ReadonlyMap<number,GPUAny>|null)=>map?new Map(await Promise.all([...map].map(async([code,pipeline])=>[code,await pipeline] as const))):null;
    const readyObject=async(object:Record<string,GPUAny>)=>Object.fromEntries(await Promise.all(Object.entries(object).map(async([key,value])=>[key,await value])));
    const readyPipelines=await readyObject({...(opaqueDepthPrepass?{opaqueDepthCulled,opaqueDepthDouble,opaqueDepthInstancedCulled,opaqueDepthInstancedDouble,opaqueDepthSharedCulled,opaqueDepthSharedDouble}:{}),coatingCulled,coatingDouble,reliefCulled,reliefDouble,probeFilter,probeCulled,probeDouble,reflectedInstancesCulled,reflectedInstancesDouble,transparent,glass,blit,shadowCulled,shadowDouble,shadowCulledInstanced,shadowDoubleInstanced,shadowSharedCulled,shadowSharedDouble,sky,effects,taa,motionBlur,present,bloomDown,bloomHorizontal,bloomVertical,snow,opaqueCulled:readyMap(opaqueCulled),opaqueDouble:readyMap(opaqueDouble),opaqueInstancedCulled:readyMap(opaqueInstancedCulled),opaqueInstancedDouble:readyMap(opaqueInstancedDouble),instanceCulled:readyMap(instanceCulled),instanceDouble:readyMap(instanceDouble),reflectedCulled:readyMap(reflectedCulled),reflectedDouble:readyMap(reflectedDouble),surfacePasses:readyObject(surfacePasses)});
    const pipelineErrors=(await Promise.all(pipelineChecks)).filter((error):error is string=>!!error);
    const initializationError=await device.popErrorScope();initializationScopeOpen=false;
    if(pipelineErrors.length||initializationError)throw new Error(`WebGPU initialization: ${pipelineErrors.join('; ')||initializationError.message}`);
    return new WebGPURenderer(canvas,device,context,format,{opaqueDepthEmpty,spotShadowMap,spotShadowParams,spotFrames,spotFrameBinds,coatingCulled,coatingDouble,visibility,instanceLayout,instanceCulled,instanceDouble,reflectedInstancesCulled,reflectedInstancesDouble,surfacePasses,reliefCulled,reliefDouble,probeFilter,probeFilterPasses,localProbeMap,localProbeCapture,localProbeView,localProbeDepth,probeFrames,probeFrameBinds,probeCulled,probeDouble,noiseVolume,noiseSampler,environmentMap,environmentView,surfaceSampler,lightBuffer,cellBuffer,emptyField,emptyLabel,objectLayout,lightLayout,comparison,frame,shadow,dynamicShadow,sampler,frameBind,reflectionBind,reflectedCulled,reflectedDouble,lightBind:null,transparentLightBind:null,opaqueCulled,opaqueDouble,opaqueInstancedCulled,opaqueInstancedDouble,transparent,glass,blit,shadowCulled,shadowDouble,shadowCulledInstanced,shadowDoubleInstanced,shadowSharedCulled,shadowSharedDouble,sky,effects,taa,taaParams,motionBlur,motionParams,present,bloomLayout,bloomDown,bloomHorizontal,bloomVertical,snow,snowUniform,snowBind,...readyPipelines},profiling,timestampQueries,visibilityMode,pipelinePlan,depthConfiguration,opaqueDepthPrepass);
    }catch(error){
      try{if(initializationScopeOpen)await device.popErrorScope();}
      catch{/* Preserve the original initialization failure if the device is lost. */}
      finally{device.destroy();}throw error;
    }
  }
  private timelineFrame:number|null=null;
  private environmentWorker?:EnvironmentMapWorker;
  private environmentRequestedKey='';
  /** Background updates retain the preceding complete map until the next exact bake is ready. */
  setBackgroundEnvironmentMaps(enabled:boolean,create?:()=>EnvironmentWorker):void{
    this.environmentWorker?.dispose();delete this.environmentWorker;this.environmentRequestedKey='';
    if(this.disposed)return;
    if(enabled&&(create||typeof Worker!=='undefined'))this.environmentWorker=new EnvironmentMapWorker((key,data)=>{if(!this.disposed)this.publishEnvironmentMap(key,data);},create);
  }
  async settleEnvironmentMaps():Promise<void>{await this.environmentWorker?.idle();await this.flush();}
  /** Align temporal sampling when separate workers render ranges of one timeline. */
  setTimelineFrame(frame:number):void{
    if(!Number.isSafeInteger(frame)||frame<0)throw new RangeError('Timeline frame must be a non-negative integer');
    this.timelineFrame=frame;
  }
  resetTemporalHistory():void{this.historyValid=false;this.previousVp=null;this.previousJitter=null;this.previousCamera=null;this.previousTarget=null;this.previousModels.clear();this.clearCameraBatchTemporal();}
  configurePostProcessing(options:Partial<PostProcessingSettings>):Readonly<PostProcessingSettings>{
    const next=resolvePostProcessing(this.pipelinePlan.features,this.postProcessing,options);
    if(next.temporalAA!==this.postProcessing.temporalAA||next.bloom!==this.postProcessing.bloom)this.resetTemporalHistory();
    this.postProcessing=next;return {...next};
  }
  /** Debug/profiling A/B; authoritative Scene entities and simulation are unchanged. */
  setInstancingEnabled(enabled:boolean):void{
    this.instancingEnabled=enabled;
    if(!enabled){for(const batch of this.instanceBatches.values())batch.buffer.destroy();this.instanceBatches.clear();}
  }
  setSimulationProfile(profile:SimulationProfileInput):void{
    this.frameBuilder=this.frameFamily.compile(profile);
    this.renderFrame=null;this.collectedScene=null;this.collectedRevision=-1;this.shadowValid=false;
    this.visibilityPlan.clear();this.modelCache.clear();
  }
  setResolution(width:number,height:number):void{
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>4096||height>4096)throw new RangeError('Render dimensions must be integers in [1,4096]');
    this.fixedResolution=[width,height];this.resize();
  }
  resize():void{
    const ratio=Math.max(1,Math.min(2,devicePixelRatio||1)),width=this.fixedResolution?.[0]??Math.max(1,Math.floor(this.canvas.clientWidth*ratio)),height=this.fixedResolution?.[1]??Math.max(1,Math.floor(this.canvas.clientHeight*ratio));
    if(this.depthW===width&&this.depthH===height)return;
    this.canvas.width=width;this.canvas.height=height;this.depthW=width;this.depthH=height;
    for(const target of [this.opaqueDepthTarget,this.depth,this.hdr,this.opaqueScene,this.normal,this.specular,this.velocity,this.effectsHdr,this.taaA,this.taaB,this.reflection,this.reflectionDepth,this.bloomA,this.bloomB,this.blackBloom,this.motionHdr])target?.destroy();
    const texture=(format:string,count:number)=>this.device.createTexture({size:[width,height],format,sampleCount:count,usage:0x10|0x04|(format==='rgba16float'?0x01:0)});
    const plan=this.pipelinePlan??compileRenderPipeline();
    this.opaqueDepthTarget=this.opaqueDepthPrepass?texture('depth32float',1):null;this.depth=texture('depth32float',1);this.hdr=texture('rgba16float',1);this.opaqueScene=texture('rgba16float',1);this.normal=plan.features.screenSpace?texture('rgba16float',1):null;this.specular=plan.features.screenSpace?texture('rgba8unorm',1):null;this.velocity=plan.motionVectors?texture('rg16float',1):null;
    this.effectsHdr=plan.effects?texture('rgba16float',1):null;this.taaA=plan.features.temporalAA?texture('rgba16float',1):null;this.taaB=plan.features.temporalAA?texture('rgba16float',1):null;
    const reflectionScale=.625;const reflectionWidth=plan.features.planarReflections?Math.max(1,Math.floor(width*reflectionScale)):1,reflectionHeight=plan.features.planarReflections?Math.max(1,Math.floor(height*reflectionScale)):1;this.reflection=this.device.createTexture({size:[reflectionWidth,reflectionHeight],format:'rgba16float',usage:0x10|0x04|0x01});this.reflectionDepth=plan.features.planarReflections?this.device.createTexture({size:[reflectionWidth,reflectionHeight],format:'depth32float',usage:0x10}):null;
    const bloomTexture=()=>this.device.createTexture({size:[Math.max(1,Math.floor(width/2)),Math.max(1,Math.floor(height/2))],format:'rgba16float',usage:0x10|0x04});
    this.bloomA=plan.features.bloom?bloomTexture():plan.effects?this.device.createTexture({size:[1,1],format:'rgba16float',usage:0x04}):null;this.bloomB=plan.features.bloom?bloomTexture():null;
    this.blackBloom=plan.features.bloom?this.device.createTexture({size:[1,1],format:'rgba16float',usage:0x04}):null;
    this.motionHdr=plan.features.motionBlur?texture('rgba16float',1):null;
    const bloomBind=(texture:GPUAny)=>this.device.createBindGroup({layout:this.gpu.bloomLayout,entries:[{binding:0,resource:texture.createView()},{binding:1,resource:this.gpu.sampler}]});this.bloomDownBind=plan.features.bloom?bloomBind(this.hdr):null;this.bloomHorizontalBind=plan.features.bloom?bloomBind(this.bloomA):null;this.bloomVerticalBind=plan.features.bloom?bloomBind(this.bloomB):null;
    this.gpu.lightBind=this.device.createBindGroup({layout:this.gpu.lightLayout,entries:[{binding:0,resource:{buffer:this.gpu.frame}},{binding:1,resource:this.gpu.shadow.createView()},{binding:2,resource:this.gpu.comparison},{binding:3,resource:this.reflection.createView()},{binding:4,resource:this.gpu.sampler},{binding:5,resource:{buffer:this.gpu.lightBuffer}},{binding:6,resource:{buffer:this.gpu.cellBuffer}},{binding:7,resource:this.gpu.noiseVolume.createView()},{binding:8,resource:this.gpu.noiseSampler},{binding:9,resource:this.gpu.environmentView},{binding:10,resource:this.gpu.localProbeView},{binding:11,resource:this.gpu.dynamicShadow.createView()},{binding:12,resource:this.gpu.emptyLabel.createView()},{binding:13,resource:this.gpu.spotShadowMap.createView({dimension:'2d-array'})},{binding:14,resource:{buffer:this.gpu.spotShadowParams}},...(this.opaqueDepthPrepass?[{binding:15,resource:this.opaqueDepthTarget.createView()}]:[])]});
    this.gpu.transparentLightBind=this.device.createBindGroup({layout:this.gpu.lightLayout,entries:[{binding:0,resource:{buffer:this.gpu.frame}},{binding:1,resource:this.gpu.shadow.createView()},{binding:2,resource:this.gpu.comparison},{binding:3,resource:this.reflection.createView()},{binding:4,resource:this.gpu.sampler},{binding:5,resource:{buffer:this.gpu.lightBuffer}},{binding:6,resource:{buffer:this.gpu.cellBuffer}},{binding:7,resource:this.gpu.noiseVolume.createView()},{binding:8,resource:this.gpu.noiseSampler},{binding:9,resource:this.gpu.environmentView},{binding:10,resource:this.gpu.localProbeView},{binding:11,resource:this.gpu.dynamicShadow.createView()},{binding:12,resource:this.opaqueScene.createView()},{binding:13,resource:this.gpu.spotShadowMap.createView({dimension:'2d-array'})},{binding:14,resource:{buffer:this.gpu.spotShadowParams}},...(this.opaqueDepthPrepass?[{binding:15,resource:this.opaqueDepthTarget.createView()}]:[])]});
    this.opaqueBind=this.device.createBindGroup({layout:this.gpu.blit.getBindGroupLayout(0),entries:[{binding:0,resource:this.opaqueScene.createView()},{binding:1,resource:this.gpu.sampler}]});
    this.effectsBind=plan.effects?this.device.createBindGroup({layout:this.gpu.effects.getBindGroupLayout(0),entries:[{binding:0,resource:this.hdr.createView()},...(plan.features.screenSpace?[{binding:1,resource:this.normal.createView()},{binding:2,resource:this.depth.createView()},{binding:4,resource:{buffer:this.gpu.frame}},{binding:5,resource:this.specular.createView()}]:[]),{binding:3,resource:this.gpu.sampler},{binding:6,resource:this.bloomA.createView()}]}):null;
    this.effectsBindNoBloom=plan.effects?this.device.createBindGroup({layout:this.gpu.effects.getBindGroupLayout(0),entries:[{binding:0,resource:this.hdr.createView()},...(plan.features.screenSpace?[{binding:1,resource:this.normal.createView()},{binding:2,resource:this.depth.createView()},{binding:4,resource:{buffer:this.gpu.frame}},{binding:5,resource:this.specular.createView()}]:[]),{binding:3,resource:this.gpu.sampler},{binding:6,resource:(this.blackBloom??this.bloomA).createView()}]}):null;
    const taaSource=plan.temporalSource==='effects'?this.effectsHdr:this.hdr;
    const taaBind=(history:GPUAny)=>this.device.createBindGroup({layout:this.gpu.taa.getBindGroupLayout(0),entries:[{binding:0,resource:taaSource.createView()},{binding:1,resource:history.createView()},{binding:2,resource:this.velocity.createView()},{binding:3,resource:this.depth.createView()},{binding:4,resource:this.gpu.sampler},{binding:5,resource:{buffer:this.gpu.taaParams}}]});
    this.taaBindAB=plan.features.temporalAA?taaBind(this.taaA):null;this.taaBindBA=plan.features.temporalAA?taaBind(this.taaB):null;
    const presentBind=(source:GPUAny)=>this.device.createBindGroup({layout:this.gpu.present.getBindGroupLayout(0),entries:[{binding:0,resource:source.createView()},{binding:1,resource:this.gpu.sampler},{binding:2,resource:{buffer:this.gpu.frame}}]});
    this.presentBindA=plan.features.temporalAA?presentBind(this.taaA):null;this.presentBindB=plan.features.temporalAA?presentBind(this.taaB):null;this.presentBindDirect=presentBind(taaSource);
    const motionBind=(source:GPUAny)=>this.device.createBindGroup({layout:this.gpu.motionBlur.getBindGroupLayout(0),entries:[{binding:0,resource:source.createView()},{binding:1,resource:this.velocity.createView()},{binding:2,resource:this.depth.createView()},{binding:3,resource:this.gpu.sampler},{binding:4,resource:{buffer:this.gpu.motionParams}}]});
    this.motionBindA=plan.features.motionBlur&&plan.features.temporalAA?motionBind(this.taaA):null;this.motionBindB=plan.features.motionBlur&&plan.features.temporalAA?motionBind(this.taaB):null;this.motionBindDirect=plan.features.motionBlur?motionBind(taaSource):null;this.presentBindMotion=plan.features.motionBlur?presentBind(this.motionHdr):null;
    this.historyValid=false;this.taaHistoryIndex=0;this.previousVp=null;this.previousJitter=null;this.previousCamera=null;this.previousTarget=null;
  }
  render(scene:Scene,camera:CameraSpec=scene.camera):void{
    const frameId=this.profiler.beginFrame();
    this.renderFrame=this.profiler.measure('projection',()=>this.frameCache.build(scene,camera,this.frameBuilder,scene.spec.rendering?.environmentRadiance?undefined:this.radianceProjection));
    const appearanceChanged=this.appearanceScene!==scene||this.appearanceRevision!==scene.appearanceRevision;
    if(appearanceChanged){
      this.appearanceScene=scene;this.appearanceRevision=scene.appearanceRevision;
      // Material identities and physical surface revisions invalidate their own
      // uniforms/textures. Exposure and fog live in the frame uniform. Keep
      // unrelated objects resident when one material or frame setting changes.
      this.historyValid=false;
    }
    const structureChanged=this.profiler.measure('lifecycle',()=>this.collect(scene));
    this.profiler.measure('resize',()=>this.resize());
    this.lastScene=scene;
    const reflectionProbe=resolveReflectionProbe(scene);
    const previousPublishedProbe=this.probeCapture.published;
    const probeCapture=reflectionProbe?this.probeCapture.plan(reflectionProbe):null;
    if(!reflectionProbe)this.probeCapture.reset();
    // The completed sweep will be published before the material pass. Keep the
    // previous image's origin and bounds while the replacement is incomplete.
    const publishedProbe=probeCapture?.complete?probeCapture:this.probeCapture.published;
    this.localProbeKey=reflectionProbe?.key??'';this.localProbeMask=publishedProbe?63:0;
    this.localProbePosition=publishedProbe?.position??null;
    if(publishedProbe){const {position:p,boxHalfExtents:b}=publishedProbe;this.localProbeBounds={min:[p[0]-b[0],p[1]-b[1],p[2]-b[2]],max:[p[0]+b[0],p[1]+b[1],p[2]+b[2]]};}else this.localProbeBounds=null;
    const probeComplete=!!publishedProbe;
    if(probeComplete!==this.probeComplete||(previousPublishedProbe&&!this.probeCapture.published))this.historyValid=false;
    this.probeComplete=probeComplete;
    this.profiler.measure('materials',()=>{if(structureChanged||appearanceChanged)this.queueMaterialLoads(scene);});
    this.lastCamera=camera.position;this.lastLights=this.renderFrame.lights;
    const previousSpots=this.spotShadows;
    this.spotShadows=selectSpotShadows(this.lastLights,camera.position,previousSpots);
    const currentLightGridKey=lightGridCauseKey(this.lastLights,camera.position)+'|'+this.spotShadows.map(s=>s.source.id+':'+s.slot).join(',');
    const lightGrid=this.profiler.measure('lights',()=>{
      if(currentLightGridKey===this.lightGridKey)return undefined;
      this.lightGridKey=currentLightGridKey;
      if(!this.lastLights.length){this.pointLights=0;this.lightOverflow=0;return undefined;}
      const grid=buildLightGrid(this.lastLights,camera.position,new Map(this.spotShadows.map(s=>[s.source,s.slot])));this.pointLights=grid.count;this.lightOverflow=grid.overflow;
      this.device.queue.writeBuffer(this.gpu.lightBuffer,0,grid.lights);this.device.queue.writeBuffer(this.gpu.cellBuffer,0,grid.cells);
      this.profiler.addUpload(grid.lights.byteLength+grid.cells.byteLength,'light');return grid;
    });
    void lightGrid;
    this.profiler.measure('environment',()=>this.updateEnvironmentMap(scene,reflectionProbe?.position??scene.camera.target,!!reflectionProbe));
    const frameState=this.profiler.measure('frame',()=>{
      const cameraUp=camera.up??[0,1,0],cameraView=lookAt(camera.position,camera.target,cameraUp),projectionInfo=cameraProjection(camera,this.canvas.width,this.canvas.height,this.depthConfiguration.near,this.depthConfiguration.far),baseProjection=projectionInfo.matrix,cullVP=multiply4(baseProjection,cameraView),jitter=this.postProcessing.temporalAA?taaJitter(this.timelineFrame??frameId):[0,0],projection=new Float32Array(baseProjection);
      projection[8]=projection[8]!-2*jitter[0]/this.canvas.width;projection[9]=projection[9]!+2*jitter[1]/this.canvas.height;
      const vp=multiply4(projection,cameraView),jitterUV:readonly[number,number]=[jitter[0]!/this.canvas.width,jitter[1]!/this.canvas.height];
      const settings=scene.spec.rendering??{},sun=V3.normalize(settings.sunDirection??[-.55,.48,-.35]),target:Vec3=[camera.target[0],4,camera.target[2]],extent=settings.shadowExtent??65;
      const lightVP=sunShadowProjection(target,sun,extent,Math.min(SHADOW_MAP_SIZE,DYNAMIC_SHADOW_MAP_SIZE));
      const forward=V3.normalize(V3.sub(camera.target,camera.position)),right=V3.normalize(V3.cross(forward,cameraUp)),up=V3.normalize(V3.cross(right,forward)),frame=new Float32Array(FRAME_UNIFORM_WORDS);
      const reflectionVP=multiply4(baseProjection,lookAt([camera.position[0],.03-camera.position[1],camera.position[2]],[camera.target[0],.03-camera.target[1],camera.target[2]],[cameraUp[0],-cameraUp[1],cameraUp[2]]));
      frame.set(lightVP);frame.set([...sun,settings.sunIntensity??scene.environment.sunlight*3],16);frame.set([...(settings.sunColor??[1,.87,.72]),settings.exposure??1],20);
      const [projectionX,projectionY,projectionOffsetX,projectionOffsetY]=projectionInfo.ray,tanY=1/projectionY,aspectLike=projectionY/projectionX;
      frame.set([...(settings.skyColor??[.26,.34,.47]),settings.fogDensity??.0025],24);frame.set([...camera.position,0],28);frame.set([...forward,tanY],32);frame.set([...right,aspectLike],36);frame.set([...up,scene.time],40);frame.set([this.pointLights>0?1:0,reflectionProbe&&this.localProbeMask===63?1:0,camera.focusDistance??20,camera.aperture??0],44);
      frame.set(reflectionVP,48);
      frame.set(vp,64);frame.set(this.previousVp??vp,80);frame.set([scene.environment.temperatureC,scene.environment.sunlight,scene.environment.hour/24,scene.environment.humidity],96);frame.set([projectionX,projectionY,projectionOffsetX+2*jitterUV[0],projectionOffsetY-2*jitterUV[1]],100);frame.set(this.environmentIrradiance,104);if(this.localProbePosition&&this.localProbeBounds){frame.set([...this.localProbePosition,1],140);frame.set([...this.localProbeBounds.min,1],144);frame.set([...this.localProbeBounds.max,1],148);}else{frame.fill(0,140,152);}
      const fogColor=settings.fogColor??(settings.skyColor??[.26,.34,.47]).map((v,i)=>v*1.22+(settings.sunColor??[1,.87,.72])[i]!*(settings.sunIntensity??scene.environment.sunlight*3)*.027);
      frame.set([...fogColor,settings.fogBaseHeight??0],152);frame.set([settings.fogHeightFalloff??0,settings.fogColor?1:0,settings.fogStartDistance??0,settings.fogRampDistance??0],156);
       frame.set([...(settings.ambientIrradiance??[0,0,0]),0],160);
       frame.set([...(settings.backgroundColor??[0,0,0]),settings.backgroundColor?1:0],164);
      writeSurfaceWeather(frame,settings.surfaceWeather,settings.facadeNight);
      frame[180]=this.depthConfiguration.logarithmicDenominator;
      this.device.queue.writeBuffer(this.gpu.frame,0,frame);this.profiler.addUpload(frame.byteLength,'frame');
      return{vp,cullVP,reflectionVP,settings,lightVP,right,up,frame,jitterUV,depthProjection:[baseProjection[10]!,baseProjection[14]!,baseProjection[11]!,baseProjection[15]!]};
    });
    const {vp,cullVP,reflectionVP,lightVP,right,up,frame,jitterUV}=frameState;
    // Use the uploaded float32 light, including celestial/moon overrides. A
    // visual preset's sun intensity is not a certificate that this light is off.
    const sunShadowActive=frame[19]!==0;
    if(!sunShadowActive)this.shadowValid=false;
    const classified=this.profiler.measure('visibility',()=>({visible:this.collectedVisible,opaque:this.collectedOpaque,transparent:this.collectedTransparent}));
    // reflectionMap is sampled by the wet asphalt material only. With no
    // asphalt in the scene there is no receiver for this extra render pass.
    const needsPlanarReflection=this.pipelinePlan.features.planarReflections&&classified.opaque.some(e=>e.material.kind==='asphalt');
    this.profiler.setWork({entities:scene.entities.size,visible:classified.visible.length,opaque:classified.opaque.length,transparent:classified.transparent.length});
    if(this.previousVp&&((scene.time+1e-6<this.lastRenderTime)||(this.previousCamera&&distance2(this.previousCamera,camera.position)>9)||(this.previousTarget&&distance2(this.previousTarget,camera.target)>25)))this.historyValid=false;
    this.previousModels.beginFrame();
    const modelFor=(entity:RuntimeEntity):Mat4=>this.model(entity);
    const cameraBatches=this.profiler.measure('prepare',()=>this.prepareCameraBatches(classified.opaque,modelFor,this.frameCache.changedObjects()));
    const reflectionBatches=needsPlanarReflection?cameraBatches.filter(batch=>batch.reflection):[];
    const renderMoverIds=scene.renderMoverIds();
    const culled=this.profiler.measure('cull',()=>{
      this.visibilityPlan.prepare(scene,classified.visible,renderMoverIds,this.cameraBatchMembers,modelFor,this.frameCache.changedObjects());
      return this.visibilityPlan.project({camera:cullVP,reflection:needsPlanarReflection?reflectionVP:null,light:sunShadowActive?lightVP:null},camera.position,primitive=>this.mesh(primitive).bounds);
    });
    const {staticShadowDrawables,dynamicShadowDrawables}=culled;
    if(dynamicShadowDrawables.length){
      frame[31]=1;
      const dynamicShadowFlag=new Float32Array([1]);
      this.device.queue.writeBuffer(this.gpu.frame,31*4,dynamicShadowFlag);
      this.profiler.addUpload(dynamicShadowFlag.byteLength,'frame');
    }
    const shadowDirty=sunShadowActive&&(!this.shadowValid||this.shadowRevision!==culled.shadowRevision);
    const staticShadows=this.profiler.measure('prepare',()=>shadowDirty?this.prepareSharedShadows(staticShadowDrawables,'static'):{singles:[],batches:[],instances:0});
    const dynamicShadows=this.profiler.measure('prepare',()=>sunShadowActive?this.prepareSharedShadows(dynamicShadowDrawables,'dynamic'):{singles:[],batches:[],instances:0});
    const probeFaces:{face:number;vp:Mat4;entities:RuntimeEntity[]}[]=[];
    if(reflectionProbe&&probeCapture){
      const radius2=(reflectionProbe.radius+12)**2,candidates=classified.opaque.filter(e=>!reflectionProbe.exclude.has(e.id)&&distance2(e.position,probeCapture.position)<=radius2);
      for(const face of probeCapture.faces){
        const faceVp=probeVP(probeCapture.position,face,reflectionProbe.radius);
        const entities=candidates.filter(entity=>{multiply4Into(faceVp,modelFor(entity),this.cullScratch);return intersectsClip(this.mesh(renderPrimitive(entity)!).bounds,this.cullScratch);});
        probeFaces.push({face,vp:faceVp,entities});
        const data=probeUniform(scene,faceVp);this.device.queue.writeBuffer(this.gpu.probeFrames[face],0,data);this.profiler.addUpload(data.byteLength,'frame');
      }
    }
    const staticShadowPlan=shadowDirty?this.prepareShadowBatches(staticShadows.singles,modelFor,'static'):
      {singles:[] as RuntimeEntity[],batches:[] as ShadowBatchPlan[],instances:0};
    const dynamicShadowPlan=sunShadowActive?this.prepareShadowBatches(dynamicShadows.singles,modelFor,'dynamic'):{singles:[] as RuntimeEntity[],batches:[] as ShadowBatchPlan[],instances:0};
    const spotParams=this.spotShadows.length?new Float32Array(SPOT_SHADOW_LIMIT*20):null;
    const spotPlans=this.spotShadows.map(spot=>{
      const candidates=classified.opaque.filter(entity=>{
        if(!castsRenderShadow(entity))return false;
        multiply4Into(spot.matrix,modelFor(entity),this.cullScratch);
        return intersectsClip(this.mesh(renderPrimitive(entity)!).bounds,this.cullScratch);
      });
      const scope=spot.slot===0?'spot0':'spot1',shared=this.prepareSharedShadows(candidates,scope),plan=this.prepareShadowBatches(shared.singles,modelFor,scope);
      const spotFrame=frame.slice(),axis=V3.normalize(spot.source.light!.emission!.axis);
      spotFrame.set(spot.matrix,0);spotFrame.set([-axis[0],-axis[1],-axis[2],1],16);
      this.device.queue.writeBuffer(this.gpu.spotFrames[spot.slot],0,spotFrame);this.profiler.addUpload(spotFrame.byteLength,'frame');
      spotParams!.set(spot.matrix,spot.slot*20);spotParams![spot.slot*20+16]=spot.strength;
      return{spot,shared,plan,candidates};
    });
    if(spotParams){this.device.queue.writeBuffer(this.gpu.spotShadowParams,0,spotParams);this.profiler.addUpload(spotParams.byteLength,'frame');}
    for(const previous of previousSpots)if(!this.spotShadows.some(s=>s.slot===previous.slot))this.prepareShadowBatches([],modelFor,'spot'+previous.slot);
    const opaquePlan=this.visibilityMode==='cpu'&&this.instancingEnabled?this.prepareInstanceBatches(culled.cameraOpaque,modelFor):
      {singles:culled.cameraOpaque,batches:[] as InstancePlan[],instances:0};
    const prepared=new Map<string,RuntimeEntity>(),instanceMaterials=new Set<string>();
    for(const entity of [...opaquePlan.singles,...opaquePlan.batches.map(batch=>batch.first),...culled.cameraTransparent,
      ...staticShadowPlan.singles,...staticShadowPlan.batches.map(batch=>batch.items[0]!),
      ...dynamicShadowPlan.singles,...dynamicShadowPlan.batches.map(batch=>batch.items[0]!),
      ...spotPlans.flatMap(({plan})=>[...plan.singles,...plan.batches.map(batch=>batch.items[0]!)]),
      ...culled.reflectedObjects,...probeFaces.flatMap(face=>face.entities)])prepared.set(entity.id,entity);
    for(const batch of cameraBatches){const first=batch.items[0]!;if(!prepared.has(first.id)){prepared.set(first.id,first);instanceMaterials.add(first.id);}}
    this.profiler.measure('prepare',()=>{for(const entity of prepared.values()){const model=modelFor(entity),instanced=instanceMaterials.has(entity.id);if(this.needsPrepare(entity,model,instanced))this.prepare(entity,model,instanced);}});
    this.profiler.setWork({cameraOpaque:culled.cameraOpaque.length,cameraTransparent:culled.cameraTransparent.length,shadowCasters:staticShadowDrawables.length+dynamicShadowDrawables.length,reflected:culled.reflectedObjects.length,shadowBatchedInstances:staticShadowPlan.instances+dynamicShadowPlan.instances+staticShadows.instances+dynamicShadows.instances,instancedOpaque:opaquePlan.instances});
    const encoder=this.device.createCommandEncoder({label:`render frame ${frameId}`});
    const visibilityRequests:VisibilityRequest[]=cameraBatches.map(batch=>({batch:batch.visibility,count:batch.items.length,indexCount:batch.mesh.count,bounds:batch.mesh.bounds,viewProjection:cullVP,instances:batch.stream.data}));
    const reflectionRequests:VisibilityRequest[]=reflectionBatches.map(batch=>({batch:batch.reflection!.visibility,count:batch.items.length,indexCount:batch.mesh.count,bounds:batch.mesh.bounds,viewProjection:reflectionVP,instances:batch.stream.data}));
    if(this.gpu.visibility){
      this.profiler.measure('encode.visibility',()=>{
        this.gpu.visibility.encode(encoder,[...visibilityRequests,...reflectionRequests],this.visibilityMode,this.visibilityMode==='gpu'?this.profiler.timestampWrites('visibility'):undefined);
        this.batchVisible=this.visibilityMode==='gpu'?null:cameraBatches.reduce((sum,batch)=>sum+batch.visibility.cpuVisibleCount,0);
        this.profiler.addUpload(this.gpu.visibility.bufferUploadBytes,'visibility');
      });
      this.batchTriangles=cameraBatches.reduce((sum,batch)=>sum+(this.visibilityMode==='gpu'?batch.items.length:batch.visibility.cpuVisibleCount)*batch.mesh.triangles,0);
      this.profiler.setWork({cameraOpaque:culled.cameraOpaque.length+(this.batchVisible??cameraBatches.reduce((sum,batch)=>sum+batch.items.length,0))});
      this.profiler.setWork({reflected:culled.reflectedObjects.length+reflectionBatches.reduce((sum,batch)=>sum+(this.visibilityMode==='gpu'?batch.items.length:batch.reflection!.visibility.cpuVisibleCount),0)});
    }
    this.profiler.measure('encode.shadow',()=>{
      if(shadowDirty){
        const timing=this.profiler.timestampWrites('shadow');
        const staticPass=encoder.beginRenderPass({label:'render.shadow.static',...(timing?{timestampWrites:timing}:{}),colorAttachments:[],depthStencilAttachment:{view:this.gpu.shadow.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});
        staticPass.setBindGroup(1,this.gpu.frameBind);
        for(const [culled,group] of partitionByCull(staticShadowPlan.singles)){
          staticPass.setPipeline(culled?this.gpu.shadowCulled:this.gpu.shadowDouble);
          this.drawGroup(staticPass,group,culled?this.gpu.shadowCulled:this.gpu.shadowDouble,this.gpu.surfacePasses['shadow:'+(culled?'back':'none')],false,false);
        }
        for(const batch of staticShadowPlan.batches){
          staticPass.setPipeline(batch.culled?this.gpu.shadowCulledInstanced:this.gpu.shadowDoubleInstanced);
          this.drawShadowBatch(staticPass,batch);
        }
        this.drawSharedShadows(staticPass,staticShadows.batches);
        staticPass.end();
      }
      if(sunShadowActive){
      const timing=shadowDirty?undefined:this.profiler.timestampWrites('shadow'),occlusion=this.profiler.occlusionSet();
      const dynamicPass=encoder.beginRenderPass({label:'render.shadow.dynamic',...(timing?{timestampWrites:timing}:{}),...(occlusion?{occlusionQuerySet:occlusion}:{}),colorAttachments:[],depthStencilAttachment:{view:this.gpu.dynamicShadow.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});
      dynamicPass.setBindGroup(1,this.gpu.frameBind);const query=this.profiler.beginOcclusion(dynamicPass,'shadow');
      for(const [culled,group] of partitionByCull(dynamicShadowPlan.singles)){
        dynamicPass.setPipeline(culled?this.gpu.shadowCulled:this.gpu.shadowDouble);
        this.drawGroup(dynamicPass,group,culled?this.gpu.shadowCulled:this.gpu.shadowDouble,this.gpu.surfacePasses['shadow:'+(culled?'back':'none')],false,false);
      }
      for(const batch of dynamicShadowPlan.batches){
        dynamicPass.setPipeline(batch.culled?this.gpu.shadowCulledInstanced:this.gpu.shadowDoubleInstanced);
        this.drawShadowBatch(dynamicPass,batch);
      }
      this.drawSharedShadows(dynamicPass,dynamicShadows.batches);
      this.profiler.endOcclusion(dynamicPass,query);dynamicPass.end();
      }
      for(const {spot,shared,plan} of spotPlans){
        const timing=this.profiler.timestampWrites(spot.slot===0?'shadow.spot0':'shadow.spot1');
        const pass=encoder.beginRenderPass({label:`render.shadow.spot.${spot.slot}`,...(timing?{timestampWrites:timing}:{}),depthStencilAttachment:{view:this.gpu.spotShadowMap.createView({dimension:'2d',baseArrayLayer:spot.slot,arrayLayerCount:1}),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'},colorAttachments:[]});
        pass.setBindGroup(1,this.gpu.spotFrameBinds[spot.slot]);
        for(const [culled,group]of partitionByCull(plan.singles))this.drawGroup(pass,group,culled?this.gpu.shadowCulled:this.gpu.shadowDouble,this.gpu.surfacePasses['shadow:'+(culled?'back':'none')],false,false);
        for(const batch of plan.batches){pass.setPipeline(batch.culled?this.gpu.shadowCulledInstanced:this.gpu.shadowDoubleInstanced);this.drawShadowBatch(pass,batch);}
        this.drawSharedShadows(pass,shared.batches);pass.end();
      }
    });
    this.profiler.measure('encode.probe',()=>{
      const settings=scene.spec.rendering??{},sky=settings.skyColor??[.26,.34,.47];
      for(let index=0;index<probeFaces.length;index++){
        const capture=probeFaces[index]!,timing=index===0?this.profiler.timestampWrites('probe'):undefined;
        const view=this.gpu.localProbeCapture.createView({dimension:'2d',baseArrayLayer:capture.face,arrayLayerCount:1,baseMipLevel:0,mipLevelCount:1});
        const pass=encoder.beginRenderPass({label:`render.probe.${capture.face}`,...(timing?{timestampWrites:timing}:{}),colorAttachments:[{view,clearValue:{r:sky[0]*1.05,g:sky[1]*1.05,b:sky[2]*1.05,a:1},loadOp:'clear',storeOp:'store'}],depthStencilAttachment:{view:this.gpu.localProbeDepth.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'discard'}});
        pass.setBindGroup(1,this.gpu.probeFrameBinds[capture.face]);
        for(const [culled,group] of partitionByCull(capture.entities)){pass.setPipeline(culled?this.gpu.probeCulled:this.gpu.probeDouble);this.drawGroup(pass,group,culled?this.gpu.probeCulled:this.gpu.probeDouble,this.gpu.surfacePasses['probe:'+(culled?'back':'none')],false);}
        pass.end();
      }
    });
    // Publish all six sharp faces and roughness levels in the same submission.
    // Capturing into a separate cube prevents mixed old/new faces and LOD seams.
    if(probeCapture?.complete){
      this.profiler.measure('encode.probe',()=>{
        encoder.copyTextureToTexture({texture:this.gpu.localProbeCapture},{texture:this.gpu.localProbeMap},[192,192,6]);
        for(const {view,bind} of this.gpu.probeFilterPasses){
          const pass=encoder.beginRenderPass({label:'render.probe.filter',colorAttachments:[{view,loadOp:'clear',clearValue:{r:0,g:0,b:0,a:1},storeOp:'store'}]});
          pass.setPipeline(this.gpu.probeFilter);pass.setBindGroup(0,bind);pass.draw(3);pass.end();
        }
      });
    }
    if(needsPlanarReflection)this.profiler.measure('encode.reflection',()=>{
      const timing=this.profiler.timestampWrites('reflection'),occlusion=this.profiler.occlusionSet(),reflect=encoder.beginRenderPass({label:'render.reflection',...(timing?{timestampWrites:timing}:{}),...(occlusion?{occlusionQuerySet:occlusion}:{}),colorAttachments:[{view:this.reflection.createView(),clearValue:{r:frame[24]!*1.2,g:frame[25]!*1.2,b:frame[26]!*1.2,a:1},loadOp:'clear',storeOp:'store'}],depthStencilAttachment:{view:this.reflectionDepth.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'discard'}});
      reflect.setBindGroup(1,this.gpu.reflectionBind);const query=this.profiler.beginOcclusion(reflect,'reflection');
      for(const [key,group] of materialPipelineGroups(culled.reflectedObjects)){const [code,culled]=key;reflect.setPipeline((culled?this.gpu.reflectedCulled:this.gpu.reflectedDouble).get(code)!);this.drawGroup(reflect,group,(culled?this.gpu.reflectedCulled:this.gpu.reflectedDouble).get(code)!,this.gpu.surfacePasses['reflection:'+(culled?'back':'none')],false);}
      for(const batch of reflectionBatches){
        reflect.setPipeline(batch.culled?this.gpu.reflectedInstancesCulled:this.gpu.reflectedInstancesDouble);reflect.setBindGroup(0,this.objects.get(batch.items[0]!.id)!.bind);reflect.setBindGroup(2,batch.reflection!.bind);
        reflect.setVertexBuffer(0,batch.mesh.vertex);reflect.setVertexBuffer(1,batch.mesh.color);reflect.setIndexBuffer(batch.mesh.index,batch.mesh.format);reflect.drawIndexedIndirect(batch.reflection!.visibility.indirect,0);
      }
      this.profiler.endOcclusion(reflect,query);reflect.end();
    });
    if(this.opaqueDepthPrepass){
      const timing=this.profiler.timestampWrites('opaque.depth');
      const pass=encoder.beginRenderPass({label:'render.opaque.depth',...(timing?{timestampWrites:timing}:{}),colorAttachments:[],depthStencilAttachment:{view:this.opaqueDepthTarget.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});
      pass.setBindGroup(1,this.gpu.frameBind);
      const eligible=(entity:RuntimeEntity)=>!entity.material.decal&&!entity.material.texture?.heightUrl;
      for(const [back,group]of partitionByCull(opaquePlan.singles.filter(eligible))){
        pass.setPipeline(back?this.gpu.opaqueDepthCulled:this.gpu.opaqueDepthDouble);
        for(const entity of group)this.draw(pass,entity,false);
      }
      for(const batch of opaquePlan.batches){
        if(!batch.items.every(eligible))continue;
        pass.setPipeline(batch.culled?this.gpu.opaqueDepthInstancedCulled:this.gpu.opaqueDepthInstancedDouble);this.drawInstanceBatch(pass,batch);
      }
      for(const batch of cameraBatches){
        if(!batch.items.every(eligible))continue;
        pass.setPipeline(batch.culled?this.gpu.opaqueDepthSharedCulled:this.gpu.opaqueDepthSharedDouble);
        pass.setBindGroup(0,this.objects.get(batch.items[0]!.id)!.bind);pass.setBindGroup(2,batch.bind);
        pass.setVertexBuffer(0,batch.mesh.vertex);pass.setVertexBuffer(1,batch.mesh.color);pass.setIndexBuffer(batch.mesh.index,batch.mesh.format);pass.drawIndexedIndirect(batch.visibility.indirect,0);
      }
      pass.end();
    }
    let snowInstances=0;
    this.profiler.measure('encode.main',()=>{
      const timing=this.profiler.timestampWrites('main'),occlusion=this.profiler.occlusionSet(),pass=encoder.beginRenderPass({label:'render.main.opaque',...(timing?{timestampWrites:timing}:{}),...(occlusion?{occlusionQuerySet:occlusion}:{}),colorAttachments:[{view:this.opaqueScene.createView(),clearValue:{r:0,g:0,b:0,a:1},loadOp:'clear',storeOp:'store'},this.normal?{view:this.normal.createView(),clearValue:{r:.5,g:.5,b:1,a:1},loadOp:'clear',storeOp:'store'}:null,this.specular?{view:this.specular.createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}:null,this.velocity?{view:this.velocity.createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}:null],depthStencilAttachment:{view:this.depth.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});
      pass.setPipeline(this.gpu.sky);pass.setBindGroup(0,this.gpu.frameBind);pass.draw(3);
      this.drawCalls=0;this.triangles=0;pass.setBindGroup(1,this.gpu.lightBind);const query=this.profiler.beginOcclusion(pass,'mainOpaque');
      for(const [key,group] of materialPipelineGroups(opaquePlan.singles)){const [code,culled]=key;pass.setPipeline((culled?this.gpu.opaqueCulled:this.gpu.opaqueDouble).get(code)!);this.drawGroup(pass,group,(culled?this.gpu.opaqueCulled:this.gpu.opaqueDouble).get(code)!,culled?this.gpu.reliefCulled:this.gpu.reliefDouble,true,true,true);}
      for(const batch of opaquePlan.batches){
        const code=materialCode(batch.first.material.kind);
        pass.setPipeline((batch.culled?this.gpu.opaqueInstancedCulled:this.gpu.opaqueInstancedDouble).get(code)!);
        this.drawInstanceBatch(pass,batch);
      }
      for(const batch of cameraBatches){
        pass.setPipeline((batch.culled?this.gpu.instanceCulled:this.gpu.instanceDouble).get(batch.code));pass.setBindGroup(0,this.objects.get(batch.items[0]!.id)!.bind);pass.setBindGroup(2,batch.bind);
        pass.setVertexBuffer(0,batch.mesh.vertex);pass.setVertexBuffer(1,batch.mesh.color);pass.setIndexBuffer(batch.mesh.index,batch.mesh.format);pass.drawIndexedIndirect(batch.visibility.indirect,0);this.drawCalls++;
      }
      this.triangles+=this.batchTriangles;
      this.profiler.endOcclusion(pass,query);pass.end();
    });
    this.profiler.measure('encode.main',()=>{
      const timing=this.profiler.timestampWrites('main.transparent'),occlusion=this.profiler.occlusionSet(),pass=encoder.beginRenderPass({label:'render.main.transparent',...(timing?{timestampWrites:timing}:{}),...(occlusion?{occlusionQuerySet:occlusion}:{}),colorAttachments:[{view:this.hdr.createView(),clearValue:{r:0,g:0,b:0,a:1},loadOp:'clear',storeOp:'store'},this.normal?{view:this.normal.createView(),loadOp:'load',storeOp:'store'}:null,this.specular?{view:this.specular.createView(),loadOp:'load',storeOp:'store'}:null,this.velocity?{view:this.velocity.createView(),loadOp:'load',storeOp:'store'}:null],depthStencilAttachment:{view:this.depth.createView(),depthLoadOp:'load',depthStoreOp:'store'}});
      pass.setPipeline(this.gpu.blit);pass.setBindGroup(0,this.opaqueBind);pass.draw(3);
      pass.setBindGroup(1,this.gpu.transparentLightBind);let query=this.profiler.beginOcclusion(pass,'mainTransparent');
      pass.setPipeline(this.gpu.glass);for(const e of culled.cameraTransparent)if(e.material.kind==='glass')this.draw(pass,e,true);
      pass.setPipeline(this.gpu.transparent);for(const e of culled.cameraTransparent)if(e.material.kind!=='glass')this.draw(pass,e,true);
      this.profiler.endOcclusion(pass,query);
      const intensity=Math.min(1,scene.environment.snowfallRate/2.2e-5);query=this.profiler.beginOcclusion(pass,'snow');
      if(intensity>.001){
        const current={camera:camera.position,right,up,time:scene.time};
        const previousForward=V3.normalize(V3.sub(this.previousTarget??camera.target,this.previousCamera??camera.position));
        const previousRight=V3.normalize(V3.cross(previousForward,camera.up??[0,1,0])),previousUp=V3.normalize(V3.cross(previousRight,previousForward));
        const previous=this.historyValid&&this.previousCamera&&Number.isFinite(this.lastRenderTime)?{camera:this.previousCamera,right:previousRight,up:previousUp,time:this.lastRenderTime}:current;
        const snow=snowfallUniform(vp,current,intensity,scene.environment.wind,scene.spec.seed??1,previous);
        this.device.queue.writeBuffer(this.gpu.snowUniform,0,snow);this.profiler.addUpload(snow.byteLength,'snow');pass.setPipeline(this.gpu.snow);pass.setBindGroup(0,this.gpu.snowBind);pass.setBindGroup(1,this.gpu.transparentLightBind);snowInstances=Math.round(24000*intensity);pass.draw(6,snowInstances);
      }this.profiler.endOcclusion(pass,query);pass.end();
    });
    if(this.postProcessing.bloom)this.profiler.measure('encode.bloom',()=>{
      const stages=[['bloom.downsample',this.bloomA,this.gpu.bloomDown,this.bloomDownBind],['bloom.horizontal',this.bloomB,this.gpu.bloomHorizontal,this.bloomHorizontalBind],['bloom.vertical',this.bloomA,this.gpu.bloomVertical,this.bloomVerticalBind]] as const;
      for(const [name,target,pipeline,bind] of stages){const timing=this.profiler.timestampWrites(name),bloomPass=encoder.beginRenderPass({label:`render.${name}`,...(timing?{timestampWrites:timing}:{}),colorAttachments:[{view:target.createView(),loadOp:'clear',clearValue:{r:0,g:0,b:0,a:1},storeOp:'store'}]});bloomPass.setPipeline(pipeline);bloomPass.setBindGroup(0,bind);bloomPass.draw(3);bloomPass.end();}
    });
    if(this.pipelinePlan.effects)this.profiler.measure('encode.effects',()=>{
      const timing=this.profiler.timestampWrites('effects'),effectsPass=encoder.beginRenderPass({label:'render.effects',...(timing?{timestampWrites:timing}:{}),colorAttachments:[{view:this.effectsHdr.createView(),loadOp:'clear',clearValue:{r:0,g:0,b:0,a:1},storeOp:'store'}]});
      effectsPass.setPipeline(this.gpu.effects);effectsPass.setBindGroup(0,this.postProcessing.bloom?this.effectsBind:this.effectsBindNoBloom);effectsPass.draw(3);effectsPass.end();
    });
    const taaOutputIndex=this.taaHistoryIndex===0?1:0;
    if(this.postProcessing.temporalAA)this.device.queue.writeBuffer(this.gpu.taaParams,0,new Float32Array([this.historyValid?1:0,0,0,0,...jitterUV,...(this.previousJitter??jitterUV)]));
    if(this.postProcessing.temporalAA)this.profiler.measure('encode.taa',()=>{
      const timing=this.profiler.timestampWrites('taa'),target=taaOutputIndex===0?this.taaA:this.taaB,taaPass=encoder.beginRenderPass({label:'render.taa',...(timing?{timestampWrites:timing}:{}),colorAttachments:[{view:target.createView(),loadOp:'clear',clearValue:{r:0,g:0,b:0,a:1},storeOp:'store'}]});
      taaPass.setPipeline(this.gpu.taa);taaPass.setBindGroup(0,this.taaHistoryIndex===0?this.taaBindAB:this.taaBindBA);taaPass.draw(3);taaPass.end();
    });
    const motionEnabled=this.postProcessing.motionBlur>0;
    if(motionEnabled)this.profiler.measure('encode.motionBlur',()=>{
      this.device.queue.writeBuffer(this.gpu.motionParams,0,new Float32Array([this.postProcessing.motionBlur,this.historyValid?1:0,this.depthConfiguration.logarithmicDenominator,0,...jitterUV,...(this.previousJitter??jitterUV),...frameState.depthProjection]));this.profiler.addUpload(48,'frame');
      const timing=this.profiler.timestampWrites('motionBlur'),pass=encoder.beginRenderPass({label:'render.motionBlur',...(timing?{timestampWrites:timing}:{}),colorAttachments:[{view:this.motionHdr.createView(),loadOp:'clear',clearValue:{r:0,g:0,b:0,a:1},storeOp:'store'}]});
      pass.setPipeline(this.gpu.motionBlur);pass.setBindGroup(0,this.postProcessing.temporalAA?(taaOutputIndex===0?this.motionBindA:this.motionBindB):this.motionBindDirect);pass.draw(3);pass.end();
    });
    this.profiler.measure('encode.present',()=>{
      const timing=this.profiler.timestampWrites('present'),present=encoder.beginRenderPass({label:'render.present',...(timing?{timestampWrites:timing}:{}),colorAttachments:[{view:this.context.getCurrentTexture().createView(),loadOp:'clear',clearValue:{r:0,g:0,b:0,a:1},storeOp:'store'}]});present.setPipeline(this.gpu.present);present.setBindGroup(0,motionEnabled?this.presentBindMotion:this.postProcessing.temporalAA?(taaOutputIndex===0?this.presentBindA:this.presentBindB):this.presentBindDirect);present.draw(3);present.end();
    });
    this.profiler.setWork({drawCalls:this.drawCalls,triangles:this.triangles,snowInstances,mainIndirectDraws:cameraBatches.length,mainIndirectCandidates:cameraBatches.reduce((sum,batch)=>sum+batch.items.length,0),geometryCountBasis:this.visibilityMode==='gpu'&&cameraBatches.length?'candidate-upper-bound':'exact'});
    if(this.profiler.enabled){
      const sumTriangles=(entities:readonly RuntimeEntity[])=>entities.reduce((sum,e)=>sum+this.mesh(renderPrimitive(e)!).triangles,0);
      const materialDraws:Record<string,number>={},materialTriangles:Record<string,number>={};
      for(const e of [...opaquePlan.singles,...culled.cameraTransparent]){const kind=e.material.kind,triangles=this.mesh(renderPrimitive(e)!).triangles;materialDraws[kind]=(materialDraws[kind]??0)+1;materialTriangles[kind]=(materialTriangles[kind]??0)+triangles;}
      for(const batch of opaquePlan.batches){const kind=batch.first.material.kind;materialDraws[kind]=(materialDraws[kind]??0)+1;materialTriangles[kind]=(materialTriangles[kind]??0)+batch.items.length*this.mesh(renderPrimitive(batch.first)!).triangles;}
      for(const batch of cameraBatches){const kind=batch.items[0]!.material.kind;materialDraws[kind]=(materialDraws[kind]??0)+1;materialTriangles[kind]=(materialTriangles[kind]??0)+(this.visibilityMode==='gpu'?batch.items.length:batch.visibility.cpuVisibleCount)*batch.mesh.triangles;}
      const work=this.profiler.currentWork();
      this.profiler.setAtoms(buildRenderAtomReport({
        width:this.canvas.width,height:this.canvas.height,shadowMapSize:SHADOW_MAP_SIZE,shadowDraws:staticShadowPlan.singles.length+staticShadowPlan.batches.length+staticShadows.batches.length+dynamicShadowPlan.singles.length+dynamicShadowPlan.batches.length+dynamicShadows.batches.length+spotPlans.reduce((sum,p)=>sum+p.plan.singles.length+p.plan.batches.length+p.shared.batches.length,0),reflectionDraws:culled.reflectedObjects.length+reflectionBatches.length,shadowBatchedInstances:staticShadowPlan.instances+dynamicShadowPlan.instances+staticShadows.instances+dynamicShadows.instances,shadowBatchedDraws:staticShadowPlan.batches.length+staticShadows.batches.length+dynamicShadowPlan.batches.length+dynamicShadows.batches.length,
        mainOpaqueDraws:opaquePlan.singles.length+opaquePlan.batches.length+cameraBatches.length,mainTransparentDraws:culled.cameraTransparent.length,snowInstances,
        shadowTriangles:(shadowDirty?sumTriangles(staticShadowDrawables):0)+sumTriangles(dynamicShadowDrawables)+spotPlans.reduce((sum,p)=>sum+sumTriangles(p.candidates),0),reflectionTriangles:sumTriangles(culled.reflectedObjects)+reflectionBatches.reduce((sum,batch)=>sum+(this.visibilityMode==='gpu'?batch.items.length:batch.reflection!.visibility.cpuVisibleCount)*batch.mesh.triangles,0),
        spotShadowSize:SPOT_SHADOW_SIZE,spotShadowLayers:SPOT_SHADOW_LIMIT,spotShadowPasses:spotPlans.length,
        mainOpaqueTriangles:sumTriangles(culled.cameraOpaque)+this.batchTriangles,mainTransparentTriangles:sumTriangles(culled.cameraTransparent),
        materialDraws,materialTriangles,
        uploads:{total:work.uploadBytes,uniform:work.uniformUploadBytes,surface:work.surfaceUploadBytes,light:work.lightUploadBytes,frame:work.frameUploadBytes,snow:work.snowUploadBytes,environment:work.environmentUploadBytes,instance:work.instanceUploadBytes,visibility:work.visibilityUploadBytes},
        shaders:this.shaderAtoms,geometryCountBasis:work.geometryCountBasis,mainIndirectDraws:cameraBatches.length,pipeline:this.pipelinePlan,postProcessing:this.postProcessing,
      }));
    }
    if(this.profiler.enabled&&this.gpu.visibility)this.gpu.visibility.captureStats(encoder,visibilityRequests,frameId);
    this.profiler.resolve(encoder);
    this.profiler.measure('submit',()=>this.device.queue.submit([encoder.finish()]));this.profiler.submitted();
    if(probeCapture){this.probeCapture.commit(probeCapture);this.localProbeFace=this.probeCapture.face;}else this.localProbeFace=0;
    this.gpu.visibility?.afterSubmit();
    if(shadowDirty){
      this.shadowValid=true;this.shadowRevision=culled.shadowRevision;
    }
    this.taaHistoryIndex=taaOutputIndex;this.historyValid=true;this.previousVp=vp;this.previousJitter=jitterUV;this.previousCamera=[...camera.position];this.previousTarget=[...camera.target];this.lastRenderTime=scene.time;this.lastCamera=[...camera.position];
    for(const entity of prepared.values())this.previousModels.set(entity.id,modelFor(entity),entity);
    if(this.pipelinePlan.motionVectors)for(const batch of cameraBatches)for(const entity of batch.items)this.previousModels.set(entity.id,modelFor(entity),entity);
    // Commit every CPU instance pose for the next temporal observation.
    for(const batch of opaquePlan.batches)for(const entity of batch.items)this.previousModels.set(entity.id,modelFor(entity),entity);
  }
  private queueMaterialLoads(scene:Scene):void{
    if(this.disposed)return;
    const urls=new Set([...scene.entities.values()].flatMap(e=>{const t=e.material.texture;return t?[t.url,t.normalUrl,t.ormUrl,t.heightUrl].filter((url):url is string=>!!url):[];}));
    this.surfaceTextures.retain?.(urls);
    for(const url of this.failedMaterials)if(!urls.has(url))this.failedMaterials.delete(url);
    for(const url of urls){
      if(this.surfaceTextures.get(url)||this.materialLoads.has(url)||this.failedMaterials.has(url))continue;
      const pending=this.surfaceTextures.load(url).then(()=>this.materialTexturePublished(url)).catch(error=>{
        if(!this.disposed&&!this.failedMaterials.has(url)&&[...this.lastScene?.entities.values()??[]].some(e=>{const t=e.material.texture;return t&&(t.url===url||t.normalUrl===url||t.ormUrl===url||t.heightUrl===url);})){
          this.failedMaterials.add(url);this.errors.push(error instanceof Error?error.message:String(error));
        }
      }).finally(()=>{if(this.materialLoads.get(url)===pending)this.materialLoads.delete(url);});
      this.materialLoads.set(url,pending);
    }
  }
  private materialTexturePublished(url:string):void{
    if(this.disposed||!this.surfaceTextures.get(url))return;
    if(![...this.lastScene?.entities.values()??[]].some(entity=>entity.material.texture?.heightUrl===url))return;
    // Relief changes depth in every pass even though model/mesh identity stays
    // resident. Refresh maps/history only after a usable image was published.
    this.shadowValid=false;this.historyValid=false;this.probeCapture?.reset();
  }
  async prepareMaterials(scene:Scene):Promise<void>{
    const urls=new Set([...scene.entities.values()].flatMap(e=>{const t=e.material.texture;return t?[t.url,t.normalUrl,t.ormUrl,t.heightUrl].filter((url):url is string=>!!url):[];}));
    await Promise.all([...urls].map(async url=>{
      const ready=!!this.surfaceTextures.get(url);
      await this.surfaceTextures.load(url);this.failedMaterials.delete(url);
      if(!ready)this.materialTexturePublished(url);
    }));
  }
  async sampleLinearPixels(points:readonly (readonly [number,number])[],stage:import('./types.js').LinearPixelStage='hdr'):Promise<readonly import('./types.js').LinearPixelSample[]>{
    if(stage==='reflection'&&this.pipelinePlan&&!this.pipelinePlan.features.planarReflections)throw new Error('Linear reflection target unavailable: planar reflections disabled');
    const source=stage==='hdr'?this.hdr:stage==='reflection'?this.reflection:stage==='effects'?this.effectsHdr:stage==='motionBlur'?this.motionHdr:(this.taaHistoryIndex===0?this.taaA:this.taaB);
    if(!source)throw new Error(`Linear ${stage} target unavailable`);
    if(points.length>512)throw new RangeError('At most 512 linear pixel samples per readback');
    if(!points.length)return[];
    const sourceW=stage==='reflection'?source.width:this.depthW;
    const sourceH=stage==='reflection'?source.height:this.depthH;
    const stride=256,buffer=this.device.createBuffer({size:stride*points.length,usage:0x01|0x08});
    const encoder=this.device.createCommandEncoder({label:'render.linear-pixel-readback'});
    for(let index=0;index<points.length;index++){
      const [x,y]=points[index]!;
      if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>=this.depthW||y>=this.depthH){buffer.destroy();throw new RangeError(`Pixel (${x},${y}) outside ${this.depthW}x${this.depthH}`);}
      const sx=stage==='reflection'?Math.min(sourceW-1,Math.floor(x*sourceW/this.depthW)):x;
      const sy=stage==='reflection'?Math.min(sourceH-1,Math.floor(y*sourceH/this.depthH)):y;
      encoder.copyTextureToBuffer({texture:source,origin:[sx,sy,0]},{buffer,offset:index*stride,bytesPerRow:stride,rowsPerImage:1},[1,1,1]);
    }
    this.device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(0x01);
    const mapped=buffer.getMappedRange(),view=new DataView(mapped),result:import('./types.js').LinearPixelSample[]=[];
    for(let index=0;index<points.length;index++){
      const [x,y]=points[index]!,offset=index*stride;
      result.push({x,y,rgba:[halfToFloat(view.getUint16(offset,true)),halfToFloat(view.getUint16(offset+2,true)),halfToFloat(view.getUint16(offset+4,true)),halfToFloat(view.getUint16(offset+6,true))]});
    }
    buffer.unmap();buffer.destroy();return result;
  }
  async flush():Promise<void>{await this.device.queue.onSubmittedWorkDone();await this.gpu.visibility?.flush();}
  inspect(includeProfile=true):RenderStats{
    const validFaces=[0,1,2,3,4,5].reduce((count,face)=>count+((this.localProbeMask>>face)&1),0);
    const gpuObjects=[...this.objects.values()];
    const cpuStagingBytes=gpuObjects.reduce((sum,object)=>sum+
      (object.uniformStaging?.byteLength??0)+(object.surfaceStaging?.byteLength??0)+(object.deformationStaging?.byteLength??0),0);
    return{backend:'webgpu',width:this.canvas.width,height:this.canvas.height,drawCalls:this.drawCalls,triangles:this.triangles,geometryCountBasis:this.visibilityMode==='gpu'&&this.cameraBatches.size?'candidate-upper-bound':'exact',meshes:this.meshes.size,objects:this.objects.size,pointLights:this.pointLights,lightOverflow:this.lightOverflow,materialTextures:this.surfaceTextures.size,buffers:this.meshes.size*3+this.objects.size+this.shadowBatches.size+this.instanceBatches.size+this.cameraBatches.size*4+[...this.cameraBatches.values()].reduce((sum,batch)=>sum+Object.keys(batch.shadows??{}).length,0)+[...this.cameraBatches.values()].filter(batch=>batch.reflection).length*3+13+this.gpu.probeFilterPasses.length,textures:[...this.objects.values()].filter(o=>o.owned).length+this.labels.size+this.surfaceTextures.size+18,cpuStagingBytes,errors:[...this.errors],
      visibility:{mode:this.visibilityMode,batches:this.cameraBatches.size,candidates:[...this.cameraBatches.values()].reduce((sum,batch)=>sum+batch.items.length,0),currentVisible:this.batchVisible,...(this.gpu.visibility?{diagnostics:this.gpu.visibility.snapshot(),reflection:{batches:[...this.cameraBatches.values()].filter(batch=>batch.reflection).length,candidates:[...this.cameraBatches.values()].reduce((sum,batch)=>sum+(batch.reflection?batch.items.length:0),0),currentVisible:this.visibilityMode==='gpu'?null:[...this.cameraBatches.values()].reduce((sum,batch)=>sum+(batch.reflection?.visibility.cpuVisibleCount??0),0)}}:{})},
      preparation:{...this.frameCache.inspect(),radiance:this.radianceProjection.inspect(),batchPlanBuilds:this.cameraBatchPlanBuilds,batchCauseEntries:this.cameraBatchCauses.length,modelHistory:this.previousModels.inspect(),visibilityPlan:this.visibilityPlan.inspect()},pipeline:this.pipelinePlan,postProcessing:{...this.postProcessing},
      environmentBaking:this.environmentWorker?.inspect()??{active:false,queued:false,failed:false},
      spotLightShadows:{active:this.spotShadows.length,size:SPOT_SHADOW_SIZE,lights:this.spotShadows.map(s=>s.source.id)},
      cameraDepth:{...this.depthConfiguration},
      ...(this.opaqueDepthPrepass?{opaqueDepthPrepass:{enabled:true,sampleCount:1,encoding:this.depthConfiguration.encoding,excluded:['relief','coating']}}:{}),
      renderTargets:Object.fromEntries(Object.entries({opaqueDepth:this.opaqueDepthTarget,hdr:this.hdr,opaque:this.opaqueScene,depth:this.depth,normal:this.normal,specular:this.specular,velocity:this.velocity,effects:this.effectsHdr,taaA:this.taaA,taaB:this.taaB,bloomA:this.bloomA,bloomB:this.bloomB,motionBlur:this.motionHdr,reflection:this.reflection,reflectionDepth:this.reflectionDepth}).filter(([,texture])=>texture).map(([name,texture])=>[name,{width:texture.width,height:texture.height,format:texture.format}])),
      ...(this.profiler.enabled?{environmentCache:{updates:this.environmentUpdates,invalidations:Object.fromEntries(this.environmentInvalidations),...(this.lastScene?{causes:distantRadianceCacheStats(this.lastScene)}:{})}}:{}),
      ...(this.localProbeKey?{reflectionProbe:{validFaces,complete:this.localProbeMask===63,nextFace:this.localProbeFace,...(this.localProbePosition?{position:[...this.localProbePosition] as [number,number,number]}:{})}}:{}),...(includeProfile?{profile:this.profiler.inspect()}:{})};
  }
  /** Allocation-free counters for live presentation; inspect() builds diagnostic snapshots. */
  get frameDrawCalls():number{return this.drawCalls;}
  get frameTriangles():number{return this.triangles;}
  profileLatest(){return this.profiler.latest();}
  profile(){return this.profiler.inspect();}
  resetProfile():void{this.profiler.reset();this.gpu.visibility?.resetStats();}
  private clearCameraBatchTemporal():void{this.cameraBatchTemporalPending?.clear();this.cameraBatchTemporalNext?.clear();this.cameraBatchTemporalSeen?.clear();this.cameraBatchTemporalReset=true;}
  private clearPreparationCaches():void{this.frameCache?.clear();this.radianceProjection?.clear();this.visibilityPlan?.clear();this.renderFrame=null;this.cameraBatchCauses?.splice(0);this.cameraBatchPlans?.splice(0);this.cameraBatchScene=null;this.cameraBatchLocations?.clear();this.cameraBatchMaterialIds?.clear();this.clearCameraBatchTemporal();this.modelCache?.clear();this.previousModels?.clear();}
  dispose():void{if(this.disposed)return;this.disposed=true;this.environmentWorker?.dispose();for(const batch of this.instanceBatches.values())batch.buffer.destroy();this.instanceBatches.clear();for(const batch of this.shadowBatches.values())batch.buffer.destroy();this.shadowBatches.clear();this.clearPreparationCaches();this.environmentMapCache?.clear();this.profiler?.dispose();this.opaqueDepthTarget?.destroy();this.gpu.opaqueDepthEmpty?.destroy();this.materialLoads.clear();this.failedMaterials.clear();this.surfaceTextures.dispose();this.gpu.visibility?.destroy();for(const batch of this.cameraBatches?.values?.()??[]){batch.visibility.destroy();batch.reflection?.visibility.destroy();for(const view of Object.values(batch.shadows??{}))view.destroy();batch.buffer.destroy();}this.cameraBatches?.clear?.();this.cameraBatchMembers?.clear?.();this.cameraBatchLocations?.clear();for(const m of this.meshes.values()){m.vertex.destroy();m.color.destroy();m.index.destroy();}for(const o of this.objects.values()){o.uniform.destroy();if(o.owned!==false)o.texture.destroy();}for(const target of [this.depth,this.hdr,this.opaqueScene,this.normal,this.specular,this.velocity,this.effectsHdr,this.taaA,this.taaB,this.bloomA,this.bloomB,this.blackBloom,this.motionHdr,this.gpu.motionParams,this.gpu.taaParams,this.gpu.lightBuffer,this.gpu.cellBuffer,this.gpu.shadow,this.gpu.dynamicShadow,this.gpu.frame,this.gpu.snowUniform,this.gpu.spotShadowMap,this.gpu.spotShadowParams,...this.gpu.spotFrames,this.gpu.emptyField,this.gpu.emptyLabel,this.gpu.noiseVolume,this.gpu.environmentMap,this.gpu.localProbeMap,this.gpu.localProbeCapture,this.gpu.localProbeDepth,...this.gpu.probeFrames,...this.gpu.probeFilterPasses.map((pass:{params:GPUAny})=>pass.params),this.reflection,this.reflectionDepth,...this.labels.values()])target?.destroy();this.labels.clear();this.meshes.clear();this.objects.clear();}
  private updateEnvironmentMap(scene:Scene,origin:Vec3,localProbeOwnsNearby=false):void{
    const settings=scene.spec.rendering??{},sun=V3.normalize(settings.sunDirection??[-.55,.48,-.35]),sunColor=settings.sunColor??[1,.87,.72],sky=settings.skyColor??[.26,.34,.47],intensity=settings.sunIntensity??scene.environment.sunlight*3;
    if(this.environmentScene!==scene){this.environmentWorker?.reset();this.environmentRequestedKey='';this.environmentScene=scene;this.environmentKey='';this.environmentMapCache?.clear();}
    const measured=settings.environmentRadiance;
    if(measured){
      if(this.environmentRequestedKey){this.environmentWorker?.reset();this.environmentRequestedKey='';}
      if(this.measuredRadianceSpec!==measured){this.measuredRadiance=decodeMeasuredRadiance(measured);this.measuredRadianceSpec=measured;}
      const source=this.measuredRadiance!;
      const m=measured.worldToEnvironment??[1,0,0,0,1,0,0,0,1],sampleKey=[measured.width,measured.height,measured.rgb16fBase64.length,measured.rgb16fBase64.slice(0,24),measured.rgb16fBase64.slice(-24),measured.convention??'latlong-y-up',measured.intensity??1,...m].join(':');
      if(sampleKey===this.environmentKey)return;
      this.environmentKey=sampleKey;this.environmentUpdates++;
      const gain=measured.intensity??1;
      this.environmentIrradiance.set(buildDiffuseIrradianceSH(direction=>{
        const rgb=bilinearMeasured(measured,source,direction);
        return[rgb[0]*gain,rgb[1]*gain,rgb[2]*gain];
      }));
      const levels=9;
      for(let mip=0;mip<levels;mip++){
        const size=Math.max(1,256>>mip),roughness=mip/(levels-1),pixels=new Uint16Array(size*size*6*4);let offset=0;
        for(let face=0;face<6;face++)for(let y=0;y<size;y++)for(let x=0;x<size;x++){
          const u=((x+.5)/size)*2-1,v=((y+.5)/size)*2-1,dir=cubeDirection(face,u,v),rgb=sampleMeasuredRadiance(measured,source,dir,roughness);
          pixels[offset++]=float16(rgb[0]*gain);pixels[offset++]=float16(rgb[1]*gain);pixels[offset++]=float16(rgb[2]*gain);pixels[offset++]=float16(1);
        }
        this.device.queue.writeTexture({texture:this.gpu.environmentMap,mipLevel:mip,origin:[0,0,0]},pixels,{bytesPerRow:size*8,rowsPerImage:size},[size,size,6]);this.profiler.addUpload(pixels.byteLength,'environment');
      }
      return;
    }
    // Check the authoritative causes before building the expensive scene-radiance proxy.
    // Nearby dynamic detail is handled by SSR/local probes; the distant fallback only
    // needs rebuilding when its world-space origin, atmosphere or scene identity changes.
    const grid=settings.environmentProbeGridM??.5;
    const anchoredOrigin:Vec3=[Math.round(origin[0]/grid)*grid,Math.round(origin[1]/grid)*grid,Math.round(origin[2]/grid)*grid];
    const environmentOriginKey=localProbeOwnsNearby?[0,0,0]:anchoredOrigin;
    const causeKey=[
      this.radianceProjection?.value(scene)??distantRadianceKey(scene),scene.spec.seed??0,
      ...sun,...sunColor,...sky,
      ...environmentOriginKey,
      Math.round(intensity*20)/20,
      Math.round(scene.environment.sunlight*20)/20,
      Math.round(scene.environment.humidity*20)/20,
      Math.round(scene.environment.temperatureC*2)/2,
      Math.round(scene.environment.groundMoisture*20)/20,
      Math.round(scene.environment.snowfallRate*1e6)/1e6,
    ].map(value=>Number(value).toFixed(3)).join(':');
    if(causeKey===this.environmentRequestedKey)return;
    if(causeKey===this.environmentKey){if(this.environmentRequestedKey){this.environmentWorker?.reset();this.environmentRequestedKey='';}return;}
    if(this.profiler.enabled&&this.environmentKey){
      const causes=['staticRadiance','seed','sun.x','sun.y','sun.z','sunColor.r','sunColor.g','sunColor.b','sky.r','sky.g','sky.b','origin.x','origin.y','origin.z','intensity','sunlight','humidity','temperature','moisture','snowfall'];
      const before=this.environmentKey.split(':'),after=causeKey.split(':');
      for(let index=0;index<causes.length;index++)if(before[index]!==after[index]){
        const cause=causes[index]!;
        this.environmentInvalidations.set(cause,(this.environmentInvalidations.get(cause)??0)+1);
      }
    }
    const maps=this.environmentMapCache??=new Map(),cachedMap=maps.get(causeKey);
    if(cachedMap&&this.environmentRequestedKey){this.environmentWorker?.reset();this.environmentRequestedKey='';}
    if(cachedMap){maps.delete(causeKey);maps.set(causeKey,cachedMap);this.environmentIrradiance.set(cachedMap.irradiance);for(let mip=0;mip<cachedMap.mips.length;mip++){const size=Math.max(1,256>>mip),pixels=cachedMap.mips[mip]!;this.device.queue.writeTexture({texture:this.gpu.environmentMap,mipLevel:mip,origin:[0,0,0]},pixels,{bytesPerRow:size*8,rowsPerImage:size},[size,size,6]);this.profiler.addUpload(pixels.byteLength,'environment');}this.environmentKey=causeKey;this.environmentUpdates++;return;}
    const input={radiance:buildSceneRadianceProbe(scene,localProbeOwnsNearby?origin:anchoredOrigin,128,true),sun,sunColor,sky,intensity};
    if(this.environmentWorker&&this.environmentKey){this.environmentRequestedKey=causeKey;this.environmentWorker.request(causeKey,input);return;}
    const generated=bakeEnvironmentMap(input);
    this.publishEnvironmentMap(causeKey,generated);

  }

  private publishEnvironmentMap(key:string,data:EnvironmentMapData):void{
    // The worker serializes completions and rejects reset generations. Publish
    // forward progress even while the moving camera keeps requesting new cells;
    // latest-only publication would starve the environment until motion stops.
    const maps=this.environmentMapCache??=new Map();maps.set(key,data);while(maps.size>4)maps.delete(maps.keys().next().value!);
    this.environmentIrradiance.set(data.irradiance);
    for(let mip=0;mip<data.mips.length;mip++){
      const size=Math.max(1,256>>mip),pixels=data.mips[mip]!;
      this.device.queue.writeTexture({texture:this.gpu.environmentMap,mipLevel:mip,origin:[0,0,0]},pixels,{bytesPerRow:size*8,rowsPerImage:size},[size,size,6]);this.profiler.addUpload(pixels.byteLength,'environment');
    }
    this.environmentKey=key;if(this.environmentRequestedKey===key)this.environmentRequestedKey='';this.environmentUpdates++;
  }

  private needsPrepare(entity:RuntimeEntity,model:Mat4,instanced=false):boolean{
    const scene=this.lastScene,field=scene?.surfaces.field?.(entity.id),surfaceState=scene?.surfaceStateForRender(entity.id),body=scene?.surfaces.body(entity.id);
    if(field||surfaceState||body)return true;
    const object=this.objects.get(entity.id);
    if(!object?.uniformReady||object.source!==entity)return true;
    if(object.material!==entity.material)return true;
    if((object.instancedMaterial??false)!==instanced)return true;
    const texture=entity.material.texture;
    const materialTexture=texture?.url?this.surfaceTextures.get(texture.url):undefined;
    const normalTexture=texture?.normalUrl?this.surfaceTextures.get(texture.normalUrl):undefined;
    const heightTexture=texture?.heightUrl?this.surfaceTextures.get(texture.heightUrl):undefined;
    const ormTexture=texture?.ormUrl?this.surfaceTextures.get(texture.ormUrl):undefined;
    const materialKey=texture?[materialTexture&&texture.url?texture.url:'',normalTexture?texture.normalUrl:'',ormTexture?texture.ormUrl:'',heightTexture?texture.heightUrl:''].join('|'):undefined;
    const letteringKey=labelKey(entity.material.label??'',entity.material.labelColor),labelTexture=entity.material.label?this.labels?.get(letteringKey):this.gpu.emptyLabel;
    if(object.width!==0||object.height!==0||object.label!==letteringKey||object.materialKey!==materialKey||object.materialTexture!==materialTexture||object.normalTexture!==normalTexture||object.ormTexture!==ormTexture||object.heightTexture!==heightTexture||object.labelTexture!==labelTexture)return true;
    if(instanced)return false;
    const previousModel=this.previousModels.get(entity.id,entity)??model;
    return !matrixEqual(object.lastModel,model)||!matrixEqual(object.lastPrevModel,previousModel);
  }
  private prepare(entity:RuntimeEntity,model:Mat4=this.model(entity),instanced=false):void{
    const field=this.lastScene?.surfaces.field?.(entity.id),object=this.object(entity.id,field?.nx??0,field?.nz??0,entity.material.label??'',entity.material.texture,entity.material.labelColor);
    this.mesh(renderPrimitive(entity)!);
    const surfaceState=this.lastScene?.surfaceStateForRender(entity.id),surface=surfaceState??entity.material.surface,body=this.lastScene?.surfaces.body(entity.id),previousModel=this.previousModels.get(entity.id,entity)??model;
    const dynamic=!!field||!!surfaceState||!!body,modelChanged=!matrixEqual(object.lastModel,model),previousChanged=!matrixEqual(object.lastPrevModel,previousModel);
    if(!dynamic&&object.uniformReady&&object.source===entity&&object.material===entity.material&&(object.instancedMaterial??false)===instanced&&(instanced||(!modelChanged&&!previousChanged)))return;
    // WebGPU.writeBuffer copies its input during the call. Keep one staging
    // buffer per object instead of allocating a fresh array every frame.
    const uniform=object.uniformStaging??(object.uniformStaging=new Float32Array(MATERIAL_UNIFORM_WORDS));
    const appearance=entity.material.surfaceAppearance;
    uniform.set(model,0);uniform.set(previousModel,16);uniform.set(entity.material.color,32);uniform.set([surface.moss,appearance?.wetness??surface.wetness,surface.roughness,appearance?.darkening??surface.darkening],36);uniform.set([surface.dirt,surface.wear,entity.material.variationSeed??stableSeed(entity.id),materialCode(entity.material.kind)],40);
    const projectedSnow=surfaceState??appearance?.snow;
    uniform.set([projectedSnow?.snowDepthM??0,projectedSnow?.waterDepthM??0,projectedSnow?.slush??0,projectedSnow?.iceDepthM??0],44);uniform.set([surfaceState?.puddle??0,surfaceState?.trackMelt??0,body?.snowCoverage??0,body?.rearSnow??0],48);uniform.set([body?.directionX??1,body?.directionZ??0,body?.roadDirt??0,body?.wetness??0],52);uniform.set([surfaceUseCode(entity.environmental?.surfaceUse),treatmentCode(entity.material.treatment),entity.material.clearcoat??-1,entity.material.clearcoatRoughness??-1],56);
    uniform.set(field?[...field.center,...field.size]:[0,0,1,1],60);uniform.set([field?.nx??1,field?.nz??1,field?1:0,field?.deformation.hasStampedDeformation?1:0],64);
    uniform.set([entity.material.roughness??-1,entity.material.metalness??entity.material.profile.optical.metalness,entity.material.pattern==='brick'?1:entity.material.pattern==='plaster'?2:entity.material.pattern==='rubber'?3:entity.material.pattern==='window'?4:entity.material.pattern==='fabric'?5:0,entity.material.profile.optical.ior],68);uniform.set([...(entity.material.emissive??[0,0,0]),entity.material.profile.optical.transmission],72);
    const texture=entity.material.texture,normalReady=!!(texture?.normalUrl&&this.surfaceTextures.get(texture.normalUrl)),ormReady=!!(texture?.ormUrl&&this.surfaceTextures.get(texture.ormUrl));
    uniform.set([texture?.sizeM??1,texture?.heightUrl?0:texture?.bumpStrength??.5,texture?.albedoStrength??1,texture?.url&&this.surfaceTextures.get(texture.url)?texture.projection==='terrain-map'?2:1:0],76);
    uniform.set([texture?.normalStrength??1,normalReady?1:0,texture?.ormStrength??1,ormReady?1:0],80);
    uniform.set([texture?.heightScaleM??0,texture?.heightUrl&&this.surfaceTextures.get(texture.heightUrl)?1:0,entity.material.decal?.severity??-1,entity.material.decal?.seed??0],88);
    uniform.set([appearance?1:0,appearance&&entity.material.roughness!==undefined?1:0,entity.material.rainResponse?.kind==='ground'?1:entity.material.rainResponse?.kind==='paint'?2:0,entity.material.rainResponse?.kind==='paint'?(entity.material.rainResponse.mirrorX?-1:1):0],92);
    uniform.set([entity.material.groundCover==='turf'?4:entity.material.groundCover==='grass-blade'?5:entity.material.groundLitter?.kind==='asphalt'?1:entity.material.groundLitter?.kind==='paving'?2:entity.material.groundLitter?.kind==='tile'?3:0,entity.material.groundLitter?.baseRoughness??-1,entity.material.facade?.kind==='masonry'?1:entity.material.facade?.kind==='glazed'?2:0,entity.material.facade?.night??0],96);
    const snowpack=surfaceState?.snowpack??appearance?.snow;
    uniform.set([snowpack?.freshness??0,snowpack?.liquidFraction??0,snowpack?.crust??0,Math.min(1,(snowpack?.grainSizeMm??0)/4.5)],84);
    // Authority revision comes from surface physics; two renders without a
    // state transition must not re-upload hundreds of kilobytes of textures.
    if(field&&object.lastSurfaceRevision!==field.revision){
      const size=object.width*object.height*4;
      const pixels=object.surfaceStaging?.length===size?object.surfaceStaging:(object.surfaceStaging=new Float32Array(size));
      const deformationPixels=object.deformationStaging?.length===size?object.deformationStaging:(object.deformationStaging=new Float32Array(size));
      // Same exact scalar contents and texture uploads; no per-cell scratch arrays.
      for(let i=0;i<field.cells.length;i++){
        const cell=field.cells[i]!,at=i*4;
        pixels[at]=cell.trackMelt;pixels[at+1]=cell.snowDepthM;
        pixels[at+2]=cell.waterDepthM;pixels[at+3]=cell.slush;
      }
      for(let i=0;i<field.deformation.cells.length;i++){
        const cell=field.deformation.cells[i]!,at=i*4;
        deformationPixels[at]=cell.displacementM;deformationPixels[at+1]=cell.compaction;
        deformationPixels[at+2]=cell.shear;deformationPixels[at+3]=cell.history;
      }
      this.device.queue.writeTexture({texture:object.texture},pixels,{bytesPerRow:object.width*16},[object.width,object.height]);
      this.device.queue.writeTexture({texture:object.deformationTexture},deformationPixels,{bytesPerRow:object.width*16},[object.width,object.height]);
      this.profiler.addUpload(pixels.byteLength+deformationPixels.byteLength,'surface');
      object.lastSurfaceRevision=field.revision;
    }
    this.device.queue.writeBuffer(object.uniform,0,uniform);this.profiler.addUpload(uniform.byteLength,'uniform');object.uniformReady=true;object.source=entity;object.material=entity.material;if(!object.lastModel)object.lastModel=new Float32Array(16);if(!object.lastPrevModel)object.lastPrevModel=new Float32Array(16);object.lastModel.set(model);object.lastPrevModel.set(previousModel);object.instancedMaterial=instanced;
  }
  private drawInstanceBatch(pass:GPUAny,batch:InstancePlan):void{
    const mesh=this.mesh(renderPrimitive(batch.first)!),obj=this.objects.get(batch.first.id)!;
    pass.setBindGroup(0,obj.bind);
    pass.setVertexBuffer(0,mesh.vertex);
    pass.setVertexBuffer(1,mesh.color);
    pass.setVertexBuffer(2,batch.buffer);
    pass.setIndexBuffer(mesh.index,mesh.format);
    pass.drawIndexed(mesh.count,batch.items.length);
    this.drawCalls++;this.triangles+=mesh.triangles*batch.items.length;
  }
  private instanceIdentityFor(entity:RuntimeEntity):{key:string;seed:number}{
    const primitive=renderPrimitive(entity)!,material=entity.material;
    let cached=this.instanceIdentity.get(entity);
    if(cached&&cached.primitive===primitive&&cached.material===material)return cached;
    cached={primitive,material,key:opaqueInstanceKey(entity),seed:entity.material.variationSeed??stableSeed(entity.id)};
    this.instanceIdentity.set(entity,cached);
    return cached;
  }
  private prepareInstanceBatches(entities:readonly RuntimeEntity[],modelFor:(e:RuntimeEntity)=>Mat4):
    {singles:RuntimeEntity[];batches:InstancePlan[];instances:number}{
    const singles:RuntimeEntity[]=[],groups=new Map<string,RuntimeEntity[]>();
    for(const entity of entities){
      if(!canBatchOpaque(entity)){singles.push(entity);continue;}
      const key=this.instanceIdentityFor(entity).key;
      const list=groups.get(key);
      if(list)list.push(entity);else groups.set(key,[entity]);
    }
    const batches:InstancePlan[]=[];const used=new Set<string>();let instances=0;
    for(const [key,items] of groups){
      if(items.length<4){singles.push(...items);continue;}
      used.add(key);
      let batch=this.instanceBatches.get(key),capacity=1;
      while(capacity<items.length)capacity*=2;
      if(!batch||batch.capacity<items.length){
        batch?.buffer.destroy();
        batch={buffer:this.device.createBuffer({size:capacity*160,usage:0x20|0x08}),
          capacity,data:new Float32Array(capacity*40)};
        this.instanceBatches.set(key,batch);
      }
      const data=batch.data;
      for(let i=0;i<items.length;i++){
        const entity=items[i]!,current=modelFor(entity),previous=this.previousModels.get(entity.id,entity)??current;
        const offset=i*40;
        data.set(current,offset);data.set(previous,offset+16);
        data.set(entity.material.color,offset+32);
        data[offset+36]=this.instanceIdentityFor(entity).seed;
        data[offset+37]=0;data[offset+38]=0;data[offset+39]=0;
      }
      const bytes=data.subarray(0,items.length*40);
      this.device.queue.writeBuffer(batch.buffer,0,bytes);
      this.profiler.addUpload(bytes.byteLength,'instance');
      batches.push({key,items,first:items[0]!,culled:canCullBack(items[0]!),buffer:batch.buffer});
      instances+=items.length;
    }
    for(const [key,batch] of this.instanceBatches)
      if(!used.has(key)){batch.buffer.destroy();this.instanceBatches.delete(key);}
    return{singles,batches,instances};
  }
  private drawShadowBatch(pass:GPUAny,batch:ShadowBatchPlan):void{const first=batch.items[0]!,mesh=this.mesh(renderPrimitive(first)!),object=this.objects.get(first.id)!;pass.setBindGroup(0,object.bind);pass.setVertexBuffer(0,mesh.vertex);pass.setVertexBuffer(1,batch.buffer);pass.setIndexBuffer(mesh.index,mesh.format);pass.drawIndexed(mesh.count,batch.items.length);}
  private prepareShadowBatches(entities:readonly RuntimeEntity[],modelFor:(entity:RuntimeEntity)=>Mat4=(entity=>this.model(entity)),scope='shadow'):{singles:RuntimeEntity[];batches:ShadowBatchPlan[];instances:number}{
    const singles:RuntimeEntity[]=[],groups=new Map<string,{key:string;items:RuntimeEntity[];culled:boolean}>();
    for(const entity of entities){
      // Uniform shadow batching is valid only without per-object deformation.
      if(!entity.renderOnly||entity.environmental||entity.material.texture?.heightUrl||!canCullBack(entity)){
        singles.push(entity);continue;
      }
      const key=scope+'|'+shadowBatchKey(entity),culled=canCullBack(entity);
      let group=groups.get(key);
      if(!group){group={key,items:[],culled};groups.set(key,group);}
      group.items.push(entity);
    }
    const used=new Set<string>(),batches:ShadowBatchPlan[]=[];let instances=0;
    for(const group of groups.values()){
      if(group.items.length<4){singles.push(...group.items);continue;}
      used.add(group.key);let batch=this.shadowBatches.get(group.key),capacity=1;while(capacity<group.items.length)capacity<<=1;
      if(!batch||batch.capacity<group.items.length){batch?.buffer.destroy();batch={buffer:this.device.createBuffer({size:capacity*64,usage:0x20|0x08}),capacity};this.shadowBatches.set(group.key,batch);}
      const data=new Float32Array(group.items.length*16);group.items.forEach((entity,index)=>data.set(modelFor(entity),index*16));
      if(!floatArrayEqual(batch.data,data)){this.device.queue.writeBuffer(batch.buffer,0,data);this.profiler.addUpload(data.byteLength,'instance');batch.data=data;}
      instances+=group.items.length;batches.push({key:group.key,items:group.items,culled:group.culled,buffer:batch.buffer});
    }
    for(const [key,batch] of this.shadowBatches)if(key.startsWith(scope+'|')&&!used.has(key)){batch.buffer.destroy();this.shadowBatches.delete(key);}
    return{singles,batches,instances};
  }
  private drawGroup(pass:GPUAny,entities:readonly RuntimeEntity[],base:GPUAny,relief:GPUAny,count:boolean,withColor=true,coatings=false):void{let selected=base;pass.setPipeline(base);for(const entity of entities){const next=coatings&&entity.material.decal?(canCullBack(entity)?this.gpu.coatingCulled:this.gpu.coatingDouble):entity.material.texture?.heightUrl?relief:base;if(next!==selected){pass.setPipeline(next);selected=next;}this.draw(pass,entity,count,withColor);}}
  private prepareCameraBatches(entities:readonly RuntimeEntity[],modelFor:(entity:RuntimeEntity)=>Mat4,changes?:readonly RenderObjectIR[]):GPUCameraBatch[]{
    if(!this.gpu.visibility)return[];
    const scene=this.lastScene!,causes=this.cameraBatchCauses??=[],surfacePresence=scene.renderSurfaceStatePresence;let rebuild=this.cameraBatchScene!==scene||causes.length!==entities.length;
    for(let index=0;index<entities.length;index++){
      const entity=entities[index]!,primitive=renderPrimitive(entity),material=entity.material,surfaceUse=surfaceUseCode(entity.environmental?.surfaceUse);
      // Per-object fields, body weather, images and labels retain their current path.
      // A primary-camera mask keeps its source geometry in the independent
      // shadow/reflection plans, outside the shared camera instance stream.
      const eligible=entity.renderCameraVisible!==false&&!!primitive&&!material.texture&&!material.label&&!material.decal&&!(surfacePresence?surfacePresence(entity.id):scene.surfaces.field?.(entity.id)||scene.surfaceStateForRender(entity.id)||scene.surfaces.body(entity.id)),cause=causes[index];
      if(!cause||cause.entity!==entity||cause.primitive!==primitive||cause.material!==material||cause.surfaceUse!==surfaceUse||cause.eligible!==eligible){causes[index]={entity,primitive,material,surfaceUse,eligible};rebuild=true;}
    }
    causes.length=entities.length;
    if(rebuild){
      this.cameraBatchScene=scene;this.cameraBatchPlanBuilds=(this.cameraBatchPlanBuilds??0)+1;
      const previousMaterialIds=this.cameraBatchMaterialIds??new Map<string,number>(),materialIds=new Map<string,number>();
      const groups=new Map<string,{items:RuntimeEntity[];mesh:GPUMesh;code:number;culled:boolean}>();
      for(const {entity,eligible} of causes){
        if(!eligible)continue;
        let metadata=this.instanceMetadata.get(entity);
        if(!metadata||metadata.material!==entity.material){
          let materialKey=this.materialBatchKeys.get(entity.material);
          if(materialKey===undefined){const {color,variationSeed,...shared}=entity.material;materialKey=JSON.stringify(shared);this.materialBatchKeys.set(entity.material,materialKey);}
          metadata={material:entity.material,key:materialKey,weather:new Float32Array([entity.material.surface.dirt,entity.material.surface.wear,entity.material.variationSeed??stableSeed(entity.id),materialCode(entity.material.kind)])};this.instanceMetadata.set(entity,metadata);
        }
        // Keep the exact shared-material JSON equality without concatenating its
        // ~1 KB contents into a fresh hash key for every source on every rebuild.
        let materialId=materialIds.get(metadata.key);
        if(materialId===undefined){materialId=previousMaterialIds.get(metadata.key);if(materialId===undefined)materialId=this.cameraBatchMaterialSerial=(this.cameraBatchMaterialSerial??0)+1;materialIds.set(metadata.key,materialId);}
        const mesh=this.mesh(renderPrimitive(entity)!),culled=canCullBack(entity);
        const meshIds=this.cameraBatchMeshIds??=new WeakMap<GPUMesh,number>();let meshId=meshIds.get(mesh);
        if(meshId===undefined){meshId=this.cameraBatchMeshSerial=(this.cameraBatchMeshSerial??0)+1;meshIds.set(mesh,meshId);}
        const key=meshId+'|'+Number(culled)+'|'+materialId+'|'+surfaceUseCode(entity.environmental?.surfaceUse);
        let group=groups.get(key);if(!group){group={items:[],mesh,code:materialCode(entity.material.kind),culled};groups.set(key,group);}group.items.push(entity);
      }
      // Retain only material values used by this current eligible working set.
      this.cameraBatchMaterialIds=materialIds;
      const used=new Set<string>(),members=new Set<string>(),plans:GPUCameraBatch[]=[];
      const instanceFloats=this.gpu.visibility.instanceFloats??INSTANCE_FLOATS,instanceBytes=instanceFloats*4;
      const maxCapacity=Math.min(Math.floor((this.device.limits?.maxStorageBufferBindingSize??134217728)/instanceBytes),Math.floor((this.device.limits?.maxBufferSize??268435456)/instanceBytes),(this.device.limits?.maxComputeWorkgroupsPerDimension??65535)*64);
      for(const [key,group] of groups){
        if(group.items.length<4||group.items.length>maxCapacity)continue;used.add(key);
        let batch=this.cameraBatches.get(key);
        if(!batch||batch.stream.capacity<group.items.length){
          batch?.visibility.destroy();batch?.reflection?.visibility.destroy();for(const view of Object.values(batch?.shadows??{}))view.destroy();batch?.buffer.destroy();let capacity=1;while(capacity<group.items.length)capacity*=2;capacity=Math.min(capacity,maxCapacity);
          const buffer=this.device.createBuffer({label:'camera instance stream',size:capacity*instanceBytes,usage:0x80|0x08}),visibility=this.gpu.visibility.createBatch(buffer,capacity);
          const bind=this.device.createBindGroup({layout:this.gpu.instanceLayout,entries:[{binding:0,resource:{buffer}},{binding:1,resource:{buffer:visibility.visibleIndices}}]});
          batch={buffer,stream:new InstanceStream(capacity,instanceFloats),visibility,bind,records:[],...group};this.cameraBatches.set(key,batch);
          if((this.pipelinePlan?.features.planarReflections??true)&&group.items[0]!.material.kind!=='snow'&&group.items[0]!.material.kind!=='asphalt'){
            const reflectionVisibility=this.gpu.visibility.createBatch(buffer,capacity,'reflection');
            const reflectionBind=this.device.createBindGroup({layout:this.gpu.instanceLayout,entries:[{binding:0,resource:{buffer}},{binding:1,resource:{buffer:reflectionVisibility.visibleIndices}}]});
            batch.reflection={visibility:reflectionVisibility,bind:reflectionBind};
          }
        }
        batch.items=group.items;batch.mesh=group.mesh;batch.code=group.code;batch.culled=group.culled;
        for(const entity of group.items)members.add(entity.id);
        batch.records.length=group.items.length;plans.push(batch);
      }
      for(const [key,batch] of this.cameraBatches)if(!used.has(key)){batch.visibility.destroy();batch.reflection?.visibility.destroy();for(const view of Object.values(batch.shadows??{}))view.destroy();batch.buffer.destroy();this.cameraBatches.delete(key);}
      this.cameraBatchMembers.clear();for(const id of members)this.cameraBatchMembers.add(id);
      this.cameraBatchLocations??=new Map();this.cameraBatchLocations.clear();
      for(const batch of plans)batch.items.forEach((entity,index)=>this.cameraBatchLocations.set(entity.id,{batch,index}));
      this.cameraBatchPlans=plans;
    }
    // Live Render IR certifies every public pose vector. A temporal record also
    // needs one settling update after motion stops so its previous model catches
    // up. Retain entities, never the cache's reused changedObjects() array.
    const temporal=(this.gpu.visibility.instanceFloats??INSTANCE_FLOATS)===INSTANCE_FLOATS;
    const changedOnly=!rebuild&&changes!==undefined&&(!temporal||!this.cameraBatchTemporalReset);
    const pending=temporal?(this.cameraBatchTemporalPending??=new Set<RuntimeEntity>()):undefined;
    const next=temporal?(this.cameraBatchTemporalNext??=new Set<RuntimeEntity>()):undefined;
    const seen=temporal?(this.cameraBatchTemporalSeen??=new Set<RuntimeEntity>()):undefined;
    next?.clear();seen?.clear();
    // A failed preparation cannot certify the next frame's cached records.
    if(temporal)this.cameraBatchTemporalReset=true;
    if(changedOnly&&temporal){
      const update=(entity:RuntimeEntity,model:Mat4):void=>{
        const location=this.cameraBatchLocations.get(entity.id);
        if(!location||location.batch.items[location.index]!==entity||seen!.has(entity))return;
        seen!.add(entity);
        const {batch,index}=location,previous=this.previousModels.get(entity.id,entity)??model,record=batch.records[index];
        if(!record||record.entity!==entity||record.model!==model||record.previous!==previous||record.material!==entity.material){
          batch.stream.set(index,model,previous,entity.material.color,this.instanceMetadata.get(entity)!.weather);
          if(record&&record.entity===entity){record.model=model;record.previous=previous;record.material=entity.material;}else batch.records[index]={entity,model,previous,material:entity.material};
        }
        if(model!==previous)next!.add(entity);
      };
      for(const {entity,model} of changes)update(entity,model);
      for(const entity of pending!){
        const location=this.cameraBatchLocations.get(entity.id),record=location?.batch.records[location.index];
        if(record?.entity===entity&&!seen!.has(entity))update(entity,record.model);
      }
    }else if(changedOnly)for(const {entity,model} of changes){
      const location=this.cameraBatchLocations.get(entity.id);
      if(!location||location.batch.items[location.index]!==entity)continue;
      const {batch,index}=location;batch.stream.set(index,model,model,entity.material.color,this.instanceMetadata.get(entity)!.weather);
      const record=batch.records[index];if(record&&record.entity===entity){record.model=model;record.previous=model;record.material=entity.material;}else batch.records[index]={entity,model,previous:model,material:entity.material};
    }
    for(const batch of this.cameraBatchPlans){
      if(!changedOnly){
      for(let index=0;index<batch.items.length;index++){
        const entity=batch.items[index]!,model=modelFor(entity),previous=batch.stream.floats===CURRENT_INSTANCE_FLOATS?model:this.previousModels.get(entity.id,entity)??model,record=batch.records[index];
        if(!record||record.entity!==entity||record.model!==model||record.previous!==previous||record.material!==entity.material){batch.stream.set(index,model,previous,entity.material.color,this.instanceMetadata.get(entity)!.weather);if(record&&record.entity===entity){record.model=model;record.previous=previous;record.material=entity.material;}else batch.records[index]={entity,model,previous,material:entity.material};}
        if(temporal&&model!==previous)next!.add(entity);
      }
      }
      this.profiler.addUpload(batch.stream.upload(this.device.queue,batch.buffer,batch.items.length),'instance');
    }
    if(temporal){this.cameraBatchTemporalPending=next!;this.cameraBatchTemporalNext=pending!;pending!.clear();seen!.clear();this.cameraBatchTemporalReset=false;}
    return this.cameraBatchPlans;
  }
  private draw(pass:GPUAny,entity:RuntimeEntity,count:boolean,withColor=true):void{const mesh=this.mesh(renderPrimitive(entity)!),object=this.objects.get(entity.id)!;pass.setBindGroup(0,object.bind);pass.setVertexBuffer(0,mesh.vertex);if(withColor)pass.setVertexBuffer(1,mesh.color);pass.setIndexBuffer(mesh.index,mesh.format);pass.drawIndexed(mesh.count);if(count){this.drawCalls++;this.triangles+=mesh.triangles;}}
  private prepareSharedShadows(entities:readonly RuntimeEntity[],kind:'static'|'dynamic'|'spot0'|'spot1'):{singles:RuntimeEntity[];batches:SharedShadowPlan[];instances:number}{
    const singles:RuntimeEntity[]=[],groups=new Map<GPUCameraBatch,number[]>(),batches:SharedShadowPlan[]=[];let instances=0;
    for(const entity of entities){
      const location=this.cameraBatchLocations?.get(entity.id);
      if(!location||location.batch.items[location.index]!==entity){singles.push(entity);continue;}
      let indices=groups.get(location.batch);if(!indices){indices=[];groups.set(location.batch,indices);}indices.push(location.index);
    }
    for(const [batch,indices] of groups){
      batch.shadows??={};const view=batch.shadows[kind]??=new ShadowInstanceIndices(this.device,this.gpu.instanceLayout,batch.buffer,batch.stream.capacity);
      this.profiler.addUpload(view.update(this.device.queue,indices),'visibility');instances+=indices.length;batches.push({batch,view});
    }
    return{singles,batches,instances};
  }
  private drawSharedShadows(pass:GPUAny,plans:readonly SharedShadowPlan[]):void{
    for(const {batch,view} of plans){
      pass.setPipeline(batch.culled?this.gpu.shadowSharedCulled:this.gpu.shadowSharedDouble);
      pass.setBindGroup(0,this.objects.get(batch.items[0]!.id)!.bind);pass.setBindGroup(2,view.bind);
      pass.setVertexBuffer(0,batch.mesh.vertex);pass.setIndexBuffer(batch.mesh.index,batch.mesh.format);pass.drawIndexed(batch.mesh.count,view.count);
    }
  }
  private mesh(primitive:Primitive):GPUMesh{const byIdentity=this.meshByPrimitive.get(primitive as object);if(byIdentity&&this.meshes.get(byIdentity.key)===byIdentity)return byIdentity;const key=primitiveKey(primitive),found=this.meshes.get(key);if(found){this.meshByPrimitive.set(primitive as object,found);return found;}const data=primitiveMesh(primitive),mesh={key,bounds:meshBounds(data.vertices),vertex:this.buffer(data.vertices,0x20|0x08),color:this.buffer(meshVertexAttributes(data),0x20|0x08),index:this.buffer(data.indices,0x10|0x08),count:data.indices.length,format:data.indexFormat,triangles:data.indices.length/3};this.meshes.set(key,mesh);this.meshByPrimitive.set(primitive as object,mesh);return mesh;}
  private buffer(data:ArrayBufferView,usage:number):GPUAny{const buffer=this.device.createBuffer({size:Math.max(4,(data.byteLength+3)&~3),usage,mappedAtCreation:true});new Uint8Array(buffer.getMappedRange()).set(new Uint8Array(data.buffer,data.byteOffset,data.byteLength));buffer.unmap();return buffer;}
  private collect(scene:Scene):boolean{
    if(this.collectedScene===scene&&this.collectedRevision===scene.renderStructureRevision){
      // Numeric optical changes can cross the opaque boundary without changing
      // geometry membership. Remove them from GPU batches before the independent
      // visibility plan assigns transparent draws. Keep unchanged lists resident.
      if(this.collectedOpaque.some(e=>e.material.color[3]<.98)||this.collectedTransparent.some(e=>e.material.color[3]>=.98)){
        this.collectedOpaque=this.collectedVisible.filter(e=>e.material.color[3]>=.98);
        this.collectedTransparent=this.collectedVisible.filter(e=>e.material.color[3]<.98);
      }
      return false;
    }
    const sceneChanged=this.collectedScene!==scene;
    this.collectedScene=scene;this.collectedRevision=scene.renderStructureRevision;
    for(const [id,object]of this.objects)if(object.source!==scene.entities.get(id))object.uniformReady=false;
    if(sceneChanged){
      // Hot render-lab scene swaps deliberately retain GPU pipelines/mesh buffers,
      // but every scene-owned uniform/probe/culling cache must observe the new causes.
      for(const object of this.objects.values())object.uniformReady=false;
      this.localProbeMask=0;this.localProbeFace=0;this.localProbeKey='';this.localProbePosition=null;this.localProbeBounds=null;this.probeCapture?.reset();
      this.shadowValid=false;this.visibilityPlan?.clear();
      this.clearCameraBatchTemporal();
      this.cameraBatchMaterialIds?.clear();
      this.previousModels?.clear();
      this.historyValid=false;this.previousVp=null;this.previousJitter=null;this.previousCamera=null;this.previousTarget=null;
    }
    this.surfaceTextures?.retain(new Set([...scene.entities.values()].flatMap(e=>{const t=e.material?.texture;return t?[t.url,t.normalUrl,t.ormUrl,t.heightUrl].filter((url):url is string=>!!url):[];})));
    const live=[...scene.entities.values()].filter(e=>renderPrimitive(e)),ids=new Set(live.map(e=>e.id)),keys=new Set(live.map(e=>primitiveKey(renderPrimitive(e)!)));
    this.collectedVisible=live;this.collectedOpaque=live.filter(e=>e.material.color[3]>=.98);this.collectedTransparent=live.filter(e=>e.material.color[3]<.98);
    this.previousModels?.retain?.(scene.entities);
    if(this.labels){const labels=new Set(live.map(e=>labelKey(e.material?.label??'',e.material?.labelColor)));for(const [key,t] of this.labels)if(!labels.has(key)){t.destroy();this.labels.delete(key);}}
    for(const [id,o] of this.objects)if(!ids.has(id)){o.uniform.destroy();if(o.owned!==false){o.texture.destroy();o.deformationTexture.destroy();}this.objects.delete(id);}
    for(const id of this.modelCache?.keys?.()??[])if(!ids.has(id))this.modelCache.delete(id);
    for(const [key,m] of this.meshes)if(!keys.has(key)){m.vertex.destroy();m.color.destroy();m.index.destroy();this.meshes.delete(key);}
    return true;
  }
  private label(text:string,color?:Vec3):GPUAny{
    if(!text)return this.gpu.emptyLabel;const key=labelKey(text,color),cached=this.labels.get(key);if(cached)return cached;
    const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=128;const ctx=canvas.getContext('2d')!;ctx.clearRect(0,0,1024,128);ctx.fillStyle=color?`rgb(${color.map(v=>Math.round(v*255)).join(',')})`:'#e2d9bc';ctx.font='58px Georgia';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,512,64,940);
    const texture=this.device.createTexture({size:[1024,128],format:'rgba8unorm',usage:0x04|0x02|0x10});this.device.queue.copyExternalImageToTexture({source:canvas},{texture},[1024,128]);this.labels.set(key,texture);return texture;
  }
  private object(id:string,width:number,height:number,label:string,textureSpec?:SurfaceTextureSpec,labelColor?:Vec3):GPUObject{
    const materialTexture=textureSpec?.url?this.surfaceTextures.get(textureSpec.url):undefined;
    const normalTexture=textureSpec?.normalUrl?this.surfaceTextures.get(textureSpec.normalUrl):undefined;
    const heightTexture=textureSpec?.heightUrl?this.surfaceTextures.get(textureSpec.heightUrl):undefined;
    const ormTexture=textureSpec?.ormUrl?this.surfaceTextures.get(textureSpec.ormUrl):undefined;
    const materialKey=textureSpec?[materialTexture&&textureSpec.url?textureSpec.url:'',normalTexture?textureSpec.normalUrl:'',ormTexture?textureSpec.ormUrl:'',heightTexture?textureSpec.heightUrl:''].join('|'):undefined;
    const letteringKey=labelKey(label,labelColor),labelTexture=this.label(label,labelColor);
    // Residency may release and reload the same URL/label while this object is
    // outside every view. Reusing its old bind group would sample dead textures.
    const existing=this.objects.get(id);if(existing&&existing.width===width&&existing.height===height&&existing.label===letteringKey&&existing.materialKey===materialKey&&existing.materialTexture===materialTexture&&existing.normalTexture===normalTexture&&existing.ormTexture===ormTexture&&existing.heightTexture===heightTexture&&existing.labelTexture===labelTexture)return existing;
    if(existing){existing.uniform.destroy();if(existing.owned!==false){existing.texture.destroy();existing.deformationTexture.destroy();}}
    const uniform=this.device.createBuffer({size:MATERIAL_UNIFORM_BYTES,usage:0x40|0x08}),texture=width?this.device.createTexture({size:[width,height],format:'rgba32float',usage:0x04|0x02}):this.gpu.emptyField,deformationTexture=width?this.device.createTexture({size:[width,height],format:'rgba32float',usage:0x04|0x02}):this.gpu.emptyField;
    const fallback=this.gpu.emptyLabel;
    const bind=this.device.createBindGroup({layout:this.gpu.objectLayout,entries:[
      {binding:0,resource:{buffer:uniform}},{binding:1,resource:texture.createView()},{binding:2,resource:labelTexture.createView()},{binding:3,resource:this.gpu.sampler},
      {binding:4,resource:(materialTexture??fallback).createView()},{binding:5,resource:this.gpu.surfaceSampler},
      {binding:6,resource:(normalTexture??fallback).createView()},{binding:7,resource:(ormTexture??fallback).createView()},{binding:8,resource:deformationTexture.createView()},{binding:9,resource:(heightTexture??fallback).createView()},
    ]}),object={uniform,bind,texture,deformationTexture,width,height,owned:width>0,label:letteringKey,materialTexture,normalTexture,ormTexture,heightTexture,labelTexture,...(materialKey!==undefined?{materialKey}:{})};this.objects.set(id,object);return object;
  }
  private model(entity:RuntimeEntity):Mat4{
    const shared=this.renderFrame?.objectsById.get(entity.id);if(shared)return shared.model;
    const base=primitiveBaseScale(renderPrimitive(entity));
    const px=entity.position[0],py=entity.position[1],pz=entity.position[2],rx=entity.rotation[0],ry=entity.rotation[1],rz=entity.rotation[2],sx=entity.scale[0]*base[0],sy=entity.scale[1]*base[1],sz=entity.scale[2]*base[2],cached=this.modelCache.get(entity.id);
    if(cached&&cached.px===px&&cached.py===py&&cached.pz===pz&&cached.rx===rx&&cached.ry===ry&&cached.rz===rz&&cached.sx===sx&&cached.sy===sy&&cached.sz===sz)return cached.matrix;
    const matrix=renderModel(entity);
    this.modelCache.set(entity.id,{px,py,pz,rx,ry,rz,sx,sy,sz,matrix});return matrix;
  }
}
function floatArrayEqual(a:Float32Array|undefined,b:Float32Array):boolean{if(!a||a.length!==b.length)return false;for(let i=0;i<b.length;i++)if(a[i]!==b[i])return false;return true;}
function matrixEqual(a:Mat4|undefined,b:Mat4):boolean{if(!a)return false;for(let i=0;i<16;i++)if(a[i]!==b[i])return false;return true;}
function mix(a:number,b:number,t:number):number{return a+(b-a)*t;}
function cubeDirection(face:number,u:number,v:number):Vec3{
  const raw:Vec3=face===0?[1,-v,-u]:face===1?[-1,-v,u]:face===2?[u,1,v]:face===3?[u,-1,-v]:face===4?[u,-v,1]:[-u,-v,-1];
  return V3.normalize(raw);
}
const halfFloatScratch=new Float32Array(1),halfFloatBits=new Uint32Array(halfFloatScratch.buffer);
function halfToFloat(bits:number):number{
  const sign=(bits&0x8000)?-1:1,exp=(bits>>>10)&0x1f,fraction=bits&0x3ff;
  if(exp===0)return sign*Math.pow(2,-14)*(fraction/1024);
  if(exp===31)return fraction?NaN:sign*Infinity;
  return sign*Math.pow(2,exp-15)*(1+fraction/1024);
}
function float16(value:number):number{
  if(!Number.isFinite(value))return value<0?0xfc00:0x7c00;
  halfFloatScratch[0]=value;const x=halfFloatBits[0]!,sign=(x>>>16)&0x8000,exp=((x>>>23)&0xff)-127+15,mantissa=x&0x7fffff;
  if(exp<=0){if(exp<-10)return sign;return sign|((mantissa|0x800000)>>(14-exp));}
  if(exp>=31)return sign|0x7c00;
  return sign|(exp<<10)|(mantissa>>13);
}

function decodeMeasuredRadiance(spec:EnvironmentRadianceSpec):Float32Array{
  const binary=atob(spec.rgb16fBase64),expected=spec.width*spec.height*3*2;
  if(binary.length!==expected)throw new RangeError(`Measured radiance payload is ${binary.length} bytes; expected ${expected}`);
  const bytes=new Uint8Array(expected);for(let i=0;i<expected;i++)bytes[i]=binary.charCodeAt(i);
  const view=new DataView(bytes.buffer),rgb=new Float32Array(spec.width*spec.height*3);
  for(let i=0;i<rgb.length;i++)rgb[i]=Math.max(0,halfToFloat(view.getUint16(i*2,true)));
  return rgb;
}
function measuredDirection(spec:EnvironmentRadianceSpec,direction:Vec3):Vec3{
  const m=spec.worldToEnvironment??[1,0,0,0,1,0,0,0,1],d:Vec3=[
    m[0]*direction[0]+m[1]*direction[1]+m[2]*direction[2],
    m[3]*direction[0]+m[4]*direction[1]+m[5]*direction[2],
    m[6]*direction[0]+m[7]*direction[1]+m[8]*direction[2],
  ];
  return V3.normalize(d);
}
function bilinearMeasured(spec:EnvironmentRadianceSpec,rgb:Float32Array,direction:Vec3):[number,number,number]{
  const d=measuredDirection(spec,direction),pi=Math.PI;
  const u=spec.convention==='stanford-orb'
    ?(Math.atan2(d[0],-d[2])+pi)/(2*pi)
    :(Math.atan2(d[2],d[0])/(2*pi)+.5);
  const v=Math.acos(Math.max(-1,Math.min(1,d[1])))/pi,x=((u%1+1)%1)*spec.width-.5,y=Math.max(0,Math.min(spec.height-1,v*(spec.height-1))),x0=Math.floor(x),y0=Math.floor(y),tx=x-x0,ty=y-y0;
  const at=(xx:number,yy:number,channel:number)=>rgb[(Math.max(0,Math.min(spec.height-1,yy))*spec.width+((xx%spec.width)+spec.width)%spec.width)*3+channel]!;
  const out:[number,number,number]=[0,0,0];
  for(let ch=0;ch<3;ch++){const a=at(x0,y0,ch)*(1-tx)+at(x0+1,y0,ch)*tx,b=at(x0,y0+1,ch)*(1-tx)+at(x0+1,y0+1,ch)*tx;out[ch]=a*(1-ty)+b*ty;}
  return out;
}
const RADIANCE_TAPS:readonly (readonly [number,number,number])[]=[
  [0,0,2.5],[.34,0,1],[-.34,0,1],[0,.34,1],[0,-.34,1],
  [.62,.62,1],[-.62,.62,1],[.62,-.62,1],[-.62,-.62,1],
  [.92,0,.65],[-.92,0,.65],[0,.92,.65],[0,-.92,.65],
];
function sampleMeasuredRadiance(spec:EnvironmentRadianceSpec,rgb:Float32Array,direction:Vec3,roughness:number):[number,number,number]{
  if(roughness<.015)return bilinearMeasured(spec,rgb,direction);
  const up:Vec3=Math.abs(direction[1])>.96?[1,0,0]:[0,1,0],t=V3.normalize(V3.cross(up,direction)),b=V3.cross(direction,t),spread=Math.tan(Math.min(1.18,roughness*roughness*1.28));
  let r=0,g=0,bl=0,total=0;
  for(const [x,y,w] of RADIANCE_TAPS){
    const d=V3.normalize([direction[0]+(t[0]*x+b[0]*y)*spread,direction[1]+(t[1]*x+b[1]*y)*spread,direction[2]+(t[2]*x+b[2]*y)*spread]),s=bilinearMeasured(spec,rgb,d);
    r+=s[0]*w;g+=s[1]*w;bl+=s[2]*w;total+=w;
  }
  return[r/total,g/total,bl/total];
}


function halton(index:number,base:number):number{let f=1,result=0,i=index;while(i>0){f/=base;result+=f*(i%base);i=Math.floor(i/base);}return result;}
function taaJitter(frame:number):readonly[number,number]{const i=(frame%8)+1;return[halton(i,2)-.5,halton(i,3)-.5];}

function lightGridCauseKey(lights:readonly RuntimeEntity[],eye:Vec3):string{
  const values:(string|number)[]=[Math.floor(eye[0]/LIGHT_GRID_CELL),Math.floor(eye[2]/LIGHT_GRID_CELL),lights.length];
  for(const entity of lights){
    const light=entity.light!;
    values.push(entity.id,entity.position[0],entity.position[1],entity.position[2],light.range??12,light.intensity??1,...(light.color??[1,.78,.5]),light.castShadow?1:0);
    if(light.emission){const p=light.emission;values.push(...p.axis,p.innerAngle,p.outerAngle,p.panelCount??0,p.panelRotation??0,p.frameWidth??0,...(p.boxHalfSize??[0,0,0]),p.frameWidthM??.015);}
  }
  return values.join(':');
}
function distance2(a:Vec3,b:Vec3):number{const x=a[0]-b[0],y=a[1]-b[1],z=a[2]-b[2];return x*x+y*y+z*z;}
interface ResolvedReflectionProbe{position:Vec3;radius:number;facesPerFrame:number;exclude:ReadonlySet<string>;boxHalfExtents:Vec3;key:string}
const PROBE_FACE_DIRECTIONS:readonly Vec3[]=Object.freeze([[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]] as const);
const PROBE_FACE_UP:readonly Vec3[]=Object.freeze([[0,-1,0],[0,-1,0],[0,0,1],[0,0,-1],[0,-1,0],[0,-1,0]] as const);
function resolveReflectionProbe(scene:Scene):ResolvedReflectionProbe|undefined{
  const spec=scene.spec.rendering?.reflectionProbe;if(!spec)return;
  const offset=spec.offset??[0,0,0],anchor=spec.entity?scene.entities.get(spec.entity)?.position:spec.position;
  if(!anchor)return;
  const position:Vec3=[anchor[0]+offset[0],anchor[1]+offset[1],anchor[2]+offset[2]];
  const radius=Math.max(.5,Math.min(500,spec.radius??45)),facesPerFrame=Math.max(1,Math.min(6,Math.floor(spec.facesPerFrame??1))),exclude=new Set(spec.exclude??[]);
  const boxHalfExtents:Vec3=spec.boxHalfExtents?[...spec.boxHalfExtents] as Vec3:[8,3,5];
  const key=JSON.stringify([spec.entity??spec.position,offset,radius,boxHalfExtents,[...exclude].sort()]);
  return{position,radius,facesPerFrame,exclude,boxHalfExtents,key};
}
function probeVP(position:Vec3,face:number,radius:number):Mat4{
  const direction=PROBE_FACE_DIRECTIONS[face]!,up=PROBE_FACE_UP[face]!,target=V3.add(position,direction);
  return multiply4(perspective(Math.PI/2,1,.08,radius),lookAt(position,target,up));
}
function probeUniform(scene:Scene,vp:Mat4):Float32Array{
  const settings=scene.spec.rendering??{},sun=V3.normalize(settings.sunDirection??[-.55,.48,-.35]),data=new Float32Array(36);data[32]=scene.time;
  data.set(vp,0);data.set([...sun,settings.sunIntensity??scene.environment.sunlight*3],16);
  data.set([...(settings.sunColor??[1,.87,.72]),1],20);data.set([...(settings.skyColor??[.26,.34,.47]),1],24);writeProbeSurfaceWeather(data,settings.surfaceWeather,settings.facadeNight);return data;
}


const shadowPrimitiveIds=new WeakMap<object,number>();let nextShadowPrimitiveId=1;
function shadowGeometryKey(primitive:Primitive):string{
  if(primitive.kind==='box'||primitive.kind==='plane')return primitive.kind;
  if(primitive.kind==='shard')return 'shard:'+(primitive.axis??2)+':'+(primitive.skew??0);
  if(primitive.kind==='sphere')return 'sphere:'+(primitive.segments??20);
  if(primitive.kind==='cylinder')return 'cylinder:'+primitive.radius+':'+primitive.height+':'+(primitive.topRadius??primitive.radius)+':'+(primitive.segments??20);
  if(primitive.kind==='torus')return 'torus:'+primitive.radius+':'+primitive.tube+':'+(primitive.segments??40);
  let id=shadowPrimitiveIds.get(primitive as object);if(id===undefined){id=nextShadowPrimitiveId++;shadowPrimitiveIds.set(primitive as object,id);}
  return primitive.kind+':'+id;
}
function shadowBatchKey(entity:RuntimeEntity):string{return shadowGeometryKey(renderPrimitive(entity)!)+'|'+(canCullBack(entity)?1:0);}
function canCullBack(entity:RuntimeEntity):boolean{
  const kind=renderPrimitive(entity)?.kind;
  return kind==='box'||kind==='sphere'||kind==='cylinder'||kind==='torus'||kind==='polygon-prism';
}
function canBatchOpaque(e:RuntimeEntity):boolean{
  return e.renderOnly===true&&!!renderPrimitive(e)&&e.material.color[3]>=.98&&
    canCullBack(e)&&e.material.kind!=='glass'&&e.material.kind!=='snow'&&
    e.material.kind!=='asphalt'&&!e.environmental&&!e.light&&
    !e.material.texture&&!e.material.label&&!e.material.emissive&&!e.material.decal;
}
function opaqueInstanceKey(e:RuntimeEntity):string{
  const m=e.material;
  // All u-uniforms remain shared EXCEPT model, previous model, color and
  // material identity seed; those travel in the GPU instance stream.
  return JSON.stringify([primitiveKey(renderPrimitive(e)!),canCullBack(e),
    m.kind,m.roughness,m.metalness,m.clearcoat,m.clearcoatRoughness,
    m.pattern,m.finish,m.ageYears,m.treatment,m.profile.optical,m.surface,m.surfaceAppearance,m.rainResponse,m.groundLitter,m.groundCover,m.facade]);
}
function materialPipelineGroups(entities:readonly RuntimeEntity[]):Array<[[number,boolean],RuntimeEntity[]]>{
  const groups=new Map<string,{key:[number,boolean];items:RuntimeEntity[]}>();
  for(const entity of entities){
    const key:[number,boolean]=[materialCode(entity.material.kind),canCullBack(entity)],id=key[0]+':'+(key[1]?1:0);
    let group=groups.get(id);if(!group){group={key,items:[]};groups.set(id,group);}group.items.push(entity);
  }
  return [...groups.values()].sort((a,b)=>a.key[0]-b.key[0]||Number(b.key[1])-Number(a.key[1])).map(group=>[group.key,group.items]);
}
function partitionByCull(entities:readonly RuntimeEntity[]):Array<[boolean,RuntimeEntity[]]>{
  const culled:RuntimeEntity[]=[],double:RuntimeEntity[]=[];for(const entity of entities)(canCullBack(entity)?culled:double).push(entity);
  const groups:Array<[boolean,RuntimeEntity[]]>=[];if(culled.length)groups.push([true,culled]);if(double.length)groups.push([false,double]);return groups;
}

function materialCode(kind:string):number{return kind==='glass'?1:kind==='steel'?2:kind==='wood'?3:kind==='concrete'?4:kind==='asphalt'?5:kind==='snow'?6:kind==='rubber'?7:kind==='plastic'?8:kind==='aluminum'?9:kind==='mirror'?10:0;}
function stableSeed(value:string):number{let h=2166136261>>>0;for(let i=0;i<value.length;i++){h^=value.charCodeAt(i);h=Math.imul(h,16777619);}return(h>>>0)/4294967295;}

function surfaceUseCode(use:string|undefined):number{return use==='road'?1:use==='sidewalk'?2:use==='curb'?3:0;}
function treatmentCode(value:string|undefined):number{return value==='sealed'?1:value==='biocide'?2:value==='galvanized'?3:value==='painted'?4:0;}
