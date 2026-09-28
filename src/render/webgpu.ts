import {createNoiseVolume,NOISE_VOLUME_SIZE} from './noise-volume.js';
import {PROBE_MIP_LEVELS,PROBE_FILTER_SHADER,probeFilterPlan} from './probe-filter.js';
import {buildDirectionalProxyTiles} from './proxy-tiles.js';
import {meshBounds,intersectsClip,type MeshBounds} from './visibility.js';
import {SurfaceTextures} from './surface-textures.js';
import {buildLightGrid,LIGHT_GRID_WGSL,MAX_RENDER_LIGHTS,LIGHT_GRID_SIDE,LIGHT_GRID_CELL,LIGHTS_PER_CELL} from './light-grid.js';
import {FRAME_WGSL,SKY_SHADER,EFFECTS_SHADER,PRESENT_SHADER,BLOOM_SHADER,TAA_SHADER} from './lighting.js';
import {V3,compose,lookAt,multiply4,perspective,type Mat4,type Vec3} from '../math.js';
import {primitiveKey,primitiveMesh} from '../procedural/mesh.js';
import type {Primitive,CameraSpec,SurfaceTextureSpec,EnvironmentRadianceSpec} from '../scene/types.js';
import type {Scene,RuntimeEntity} from '../scene/scene.js';
import type {Renderer,RenderStats} from './types.js';
import {RenderProfiler} from './profiler.js';
import {analyzeWGSL,buildRenderAtomReport,type ShaderProgramAtoms} from './atoms.js';
import {buildSceneRadianceProbe} from './radiance.js';
import {cameraProjection} from './calibrated-camera.js';
import {renderPrimitive,renderModel,primitiveBaseScale} from './frame.js';
import {buildDiffuseIrradianceSH} from './irradiance.js';

type GPUAny=any;
const SHADOW_MAP_SIZE=2048;
const DYNAMIC_SHADOW_MAP_SIZE=1024;
export interface WebGPURendererOptions {profiling?:boolean}
interface GPUMesh{bounds:MeshBounds;vertex:GPUAny;color:GPUAny;index:GPUAny;count:number;format:'uint16'|'uint32';triangles:number}
interface GPUObject{uniform:GPUAny;bind:GPUAny;texture:GPUAny;width:number;height:number;owned?:boolean;label?:string;materialKey?:string;uniformReady?:boolean;lastModel?:Mat4;lastPrevModel?:Mat4}
interface GPUShadowBatch{buffer:GPUAny;capacity:number;data?:Float32Array}
interface ShadowBatchPlan{key:string;items:RuntimeEntity[];culled:boolean;buffer:GPUAny}
const materialShader=(reflection=false)=>FRAME_WGSL+LIGHT_GRID_WGSL+`
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
}
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var fieldTexture: texture_2d<f32>;
@group(0) @binding(2) var labelTexture:texture_2d<f32>;
@group(0) @binding(3) var labelSampler:sampler;
@group(0) @binding(4) var surfaceTexture:texture_2d<f32>;
@group(0) @binding(5) var surfaceSampler:sampler;
@group(0) @binding(6) var normalTexture:texture_2d<f32>;
@group(0) @binding(7) var ormTexture:texture_2d<f32>;
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
@vertex fn shadowVS(@location(0) position:vec3<f32>)->@builtin(position) vec4<f32>{return f.lightVP*u.model*vec4<f32>(position,1);}
@vertex fn shadowVSInstanced(
 @location(0) position:vec3<f32>,
 @location(2) m0:vec4<f32>,@location(3) m1:vec4<f32>,@location(4) m2:vec4<f32>,@location(5) m3:vec4<f32>
)->@builtin(position) vec4<f32>{return f.lightVP*mat4x4<f32>(m0,m1,m2,m3)*vec4<f32>(position,1);}
fn shadowAt(p:vec3<f32>,n:vec3<f32>)->f32{
 let clip=f.lightVP*vec4<f32>(p+n*.003,1);let uv=clip.xy*.5*vec2<f32>(1,-1)+.5;
 if(any(uv<vec2<f32>(0))||any(uv>vec2<f32>(1))||clip.z>1.0||clip.z<0.0){return 1.0;}
 var staticValue=0.0;var dynamicValue=2.0;
 let staticTexel=1.0/vec2<f32>(textureDimensions(shadowMap));
 // Stable world-space PCF rotation: changing the pattern every frame makes
 // contact shadows crawl even when both the light and the receiver are still.
 let phase=fract(sin(dot(floor(p.xz*2.0),vec2<f32>(12.9898,78.233)))*43758.5453)*6.2831853;
 let cs=cos(phase);let sn=sin(phase);let rot=mat2x2<f32>(cs,-sn,sn,cs);
 let taps=array<vec2<f32>,4>(
  vec2<f32>(-.78,-.26),vec2<f32>(.80,.30),
  vec2<f32>(-.24,.82),vec2<f32>(.36,-.76)
 );
 for(var i=0;i<4;i++){
  staticValue+=textureSampleCompareLevel(shadowMap,shadowSampler,uv+rot*taps[i]*staticTexel*2.05,clip.z-.000025);
 }
 if(f.eye.w>.5){
  dynamicValue=0.0;
  let dynamicTexel=1.0/vec2<f32>(textureDimensions(dynamicShadowMap));
  for(var i=0;i<2;i++){
   dynamicValue+=textureSampleCompareLevel(dynamicShadowMap,shadowSampler,uv+rot*taps[i]*dynamicTexel*1.55,clip.z-.000025);
  }
 }
 let visibility=min(staticValue,dynamicValue)*.5;
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

@vertex fn vs(@location(0) position: vec3<f32>, @location(1) normal: vec3<f32>, @location(6) vertexColor:vec4<f32>) -> VOut {
  var out: VOut;out.reflected=0u;out.vertexColor=vertexColor;
  let world=u.model*vec4<f32>(position,1.0);
  out.position=f.viewVP*world;let previous=f.previousVP*u.prevModel*vec4<f32>(position,1.0);
  let currentNdc=out.position.xy/max(abs(out.position.w),.00001);let previousNdc=previous.xy/max(abs(previous.w),.00001);
  out.velocity=vec2<f32>((currentNdc.x-previousNdc.x)*.5,(previousNdc.y-currentNdc.y)*.5);
  out.worldPos=world.xyz;out.uv=vec2<f32>(select(position.x+.5,.5-position.x,normal.z<-.5),.5-position.y);
  let a=u.model[0].xyz;let b=u.model[1].xyz;let c=u.model[2].xyz;
  out.normal=normalize(mat3x3<f32>(a/dot(a,a),b/dot(b,b),c/dot(c,c))*normal);
  return out;
}

@vertex fn reflectionVS(@location(0) position:vec3<f32>,@location(1) normal:vec3<f32>,@location(6) vertexColor:vec4<f32>)->VOut{
 var out:VOut;out.vertexColor=vertexColor;let world=u.model*vec4<f32>(position,1);out.position=f.reflectionVP*world;out.worldPos=world.xyz;let a=u.model[0].xyz;let b=u.model[1].xyz;let c=u.model[2].xyz;out.normal=normalize(mat3x3<f32>(a/dot(a,a),b/dot(b,b),c/dot(c,c))*normal);out.uv=vec2<f32>(select(position.x+.5,.5-position.x,normal.z<-.5),.5-position.y);out.reflected=1u;out.velocity=vec2<f32>(0);return out;
}

fn pointLight(source:PointSource,world:vec3<f32>,n:vec3<f32>,viewDir:vec3<f32>,roughness:f32,base:vec3<f32>,f0:vec3<f32>,metal:f32,coat:f32,coatRoughness:f32)->vec3<f32>{
 let delta=source.position.xyz-world;let dist=length(delta);if(dist>=source.position.w){return vec3<f32>(0);}
 let l=delta/max(dist,.001);let nl=max(dot(n,l),0.0);let nv=max(dot(n,viewDir),.001);let h=normalize(l+viewDir);
 // Finite lamp size keeps specular stable at subpixel scale.
 let r=max(roughness,.08+.18/max(dist,1.0));let a2=pow(r,4.0);let nh=max(dot(n,h),0.0);
 let d=a2/(3.14159*pow(nh*nh*(a2-1.0)+1.0,2.0));let k=pow(r+1.0,2.0)/8.0;
 let g=nv/(nv*(1.0-k)+k)*nl/(nl*(1.0-k)+k);
 let fr=f0+(1.0-f0)*pow(1.0-max(dot(viewDir,h),0.0),5.0);
 let atten=pow(max(0.0,1.0-pow(dist/source.position.w,4.0)),2.0)/(1.0+dist*dist*.18);
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
struct GOut{@location(0) color:vec4<f32>,@location(1) normal:vec4<f32>,@location(2) specular:vec4<f32>,@location(3) velocity:vec2<f32>}
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

@fragment fn fs(in: VOut) -> GOut {
  ${reflection?'if(in.worldPos.y<.04){discard;}':''}
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

  let geometricNormal=normalize(in.normal);
  var n=geometricNormal;
  let eye=select(f.eye.xyz,vec3<f32>(f.eye.x,.03-f.eye.y,f.eye.z),in.reflected==1u);
  let viewDir=normalize(eye-in.worldPos);
  let sunlight=f.environment.y;
  let hour=f.environment.z*24.0;
  let sunrise=exp(-pow((hour-7.4)/1.15,2.0))*sunlight;
  let light=f.sun.xyz;
  let halfDir=normalize(light+viewDir);
  let ndl=max(dot(n,light),0.0);

  var albedo=u.color.rgb*in.vertexColor.rgb;
  let label=textureSample(labelTexture,labelSampler,in.uv);albedo=mix(albedo,label.rgb,label.a);
  let materialKind=select(u.weather.w,f32(MATERIAL_CLASS),MATERIAL_CLASS>=0);
  let surfaceUse=u.objectState.x;
  let treatment=u.objectState.y;
  let treatmentClearcoat=select(0.0,.82,treatment>3.5&&treatment<4.5);
  let clearcoat=select(treatmentClearcoat,clamp(u.objectState.z,0.0,1.0),u.objectState.z>=0.0);
  let clearcoatRoughness=select(.075,clamp(u.objectState.w,.02,1.0),u.objectState.w>=0.0);
  // Paint microflake stays procedural: no texture fetch, but it modulates both
  // the base coat and its roughness so the clearcoat catches fine metallic breakup.
  let paintMicro=select(0.0,hash3(floor(in.worldPos*420.0))-.5,treatment>3.5&&treatment<4.5);
  let seed=vec3<f32>(u.weather.z*13.7,u.weather.z*7.1,u.weather.z*3.9);
  let upward=smoothstep(0.05,0.82,n.y);

  if(u.pbr.z>.5&&u.pbr.z<1.5&&u.texture.w<.5){
    let horizontal=select(in.worldPos.x,in.worldPos.z,abs(n.x)>abs(n.z));
    let row=floor(in.worldPos.y/.09);let uv=vec2<f32>(horizontal/.26+fract(row*.5),in.worldPos.y/.09);
    let cell=fract(uv);let edge=min(cell,1.0-cell);let aa=max(fwidth(uv.x),fwidth(uv.y))*.6;let seam=1.0-smoothstep(.035-aa,.035+aa,min(edge.x,edge.y));
    albedo*=.79+hash3(vec3<f32>(floor(uv),u.weather.z*100.0))*.27;
    albedo=mix(albedo,vec3<f32>(.40,.39,.37),seam*.50);
    let tangent=select(vec3<f32>(1,0,0),vec3<f32>(0,0,1),abs(n.x)>abs(n.z));
    let bevel=(smoothstep(vec2<f32>(.025),vec2<f32>(.075),edge)-smoothstep(vec2<f32>(.075),vec2<f32>(.14),edge))*(vec2<f32>(1)-2.0*step(vec2<f32>(.5),cell));
    let clay=noise3(in.worldPos*39.0);n=normalize(n+tangent*bevel.x*.20+vec3<f32>(0,bevel.y*.18,0)+tangent*(clay-.5)*.06);
    albedo*=.93+noise3(in.worldPos*21.0)*.10;
  }
  if(materialKind>5.5&&materialKind<6.5){
    let dirty=(1.0-smoothstep(.03,.42,in.worldPos.y))*(.55+.45*noise3(in.worldPos*vec3<f32>(2.7,3.0,5.0)));let crystals=noise3(in.worldPos*22.0);
    albedo=mix(u.color.rgb,vec3<f32>(.37,.34,.30),dirty*.30);
    albedo*=.94+noise3(in.worldPos*5.0)*.06;
    let grad=vec3<f32>(noise3(in.worldPos*22.0+vec3<f32>(.3,0,0))-crystals,noise3(in.worldPos*22.0+vec3<f32>(0,.3,0))-crystals,noise3(in.worldPos*22.0+vec3<f32>(0,0,.3))-crystals);
    n=normalize(n+(grad-n*dot(grad,n))*.48);
    let clusters=noise3(in.worldPos*8.0);albedo*=.91+clusters*.12;
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
    let mineral=noise3(in.worldPos*5.0+seed);let streak=noise3(in.worldPos*vec3<f32>(3.4,.19,3.4)+seed);
    albedo*=.87+mineral*.065+streak*.07;
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

    let sheltered=1.0-smoothstep(0.42,0.96,abs(n.y));
    let growthField=fbm(in.worldPos*1.35+seed*4.2)*0.72+fbm(in.worldPos*5.7+seed)*0.28;
    let moistureBias=u.surface.y*0.28+upward*0.22+sheltered*0.07;
    let threshold=0.94-u.surface.x*0.62;
    let mossMask=smoothstep(threshold-0.16,threshold+0.04,growthField+moistureBias);
    let mossVariation=fbm(in.worldPos*8.5+seed*8.0);
    let mossColor=mix(vec3<f32>(0.035,0.075,0.02),vec3<f32>(0.16,0.27,0.065),mossVariation);
    albedo=mix(albedo,mossColor,mossMask*u.surface.x);
  }

  // Asphalt is synthesized from aggregate and binder. Traffic only reveals tracks
  // after the physics/environment system has accumulated trackMelt.
  if(materialKind>4.5 && materialKind<5.5){
    let aggregate=noise3(in.worldPos*37.0+seed);
    let grainAA=1.0-smoothstep(.6,2.0,max(length(dpdx(in.worldPos)),length(dpdy(in.worldPos)))*37.0);
    // Aggregate contrast disappears continuously below a pixel instead of
    // becoming the regular high-frequency bands of a distant water surface.
    albedo*=mix(.93,.66+aggregate*.58,grainAA);
    let mineral=noise3(in.worldPos*95.0);albedo=mix(albedo,albedo*1.7,smoothstep(.68,.9,mineral)*.26*grainAA);
    let scale=vec3<f32>(27,27,27);let gravel=noise3(in.worldPos*scale);
    let gradient=vec3<f32>(noise3(in.worldPos*scale+vec3<f32>(.12,0,0))-gravel,0,noise3(in.worldPos*scale+vec3<f32>(0,0,.12))-gravel);
    n=normalize(n+gradient*.55*grainAA);

    albedo=mix(albedo,albedo*0.48,track*(0.35+slush*.35));
  }

  // Snow accumulation is derived from mass balance. Road tracks expose wet/slushy
  // asphalt only if traffic actually supplied enough contact work.
  let snowBase=clamp(snowDepth/0.055,0.0,1.0);
  var snowMask=0.0;
  // Most objects have no deposited snow. Skip nine 3D-noise reads on those
  // fragments instead of evaluating an FBM that will later be multiplied by zero.
  if(snowBase>.001){
    snowMask=upward*snowBase*smoothstep(0.12,0.82,fbm(in.worldPos*1.9+seed*3.1)+snowBase*.74);
    if(surfaceUse>.5 && surfaceUse<1.5){snowMask*=1.0-track*.96;}
    if(surfaceUse>2.5 && surfaceUse<3.5){snowMask=clamp(snowMask+snowBase*.38,0.0,1.0);}
    let slushColor=mix(vec3<f32>(0.48,0.5,0.5),vec3<f32>(0.22,0.19,0.16),clamp(u.weather.x+u.motion.z,0.0,1.0));
    albedo=mix(albedo,slushColor,snowMask*slush*.52);
    albedo=mix(albedo,vec3<f32>(0.89,0.93,0.97),snowMask*(1.0-slush*.55));
  }

  // Bulk snow needs scale separation even when no authored texture is present.
  // One procedural sample supplies both centimetre-scale tonal breakup and a
  // screen-space micro-normal derivative, avoiding the smooth plaster look of
  // large snow banks without adding geometry or scene-specific knowledge.
  if(materialKind>5.5&&materialKind<6.5){
    let snowMacro=noise3(in.worldPos*5.2+seed*7.1);
    let snowGrain=noise3(in.worldPos*82.0+seed*19.7);
    albedo*=.91+snowMacro*.085+snowGrain*.035;
    let tx=normalize(dpdx(in.worldPos)+vec3<f32>(.000001,0,0));
    let ty=normalize(dpdy(in.worldPos)+vec3<f32>(0,.000001,0));
    n=normalize(n+(tx*dpdx(snowGrain)+ty*dpdy(snowGrain))*.24);
  }

  // Moving bodies accumulate fresh snow on upward and rear-facing surfaces.
  let bodyDeposit=max(u.surfaceDynamics.z,u.surfaceDynamics.w);
  if(bodyDeposit>.001){
    let motionDir=normalize(vec3<f32>(u.motion.x,0.0,u.motion.y)+vec3<f32>(0.0001,0.0,0.0));
    let rearFacing=smoothstep(0.05,0.9,dot(n,-motionDir));
    let bodySnow=clamp(u.surfaceDynamics.z*upward+u.surfaceDynamics.w*rearFacing,0.0,1.0);
    albedo=mix(albedo,vec3<f32>(0.91,0.945,0.98),bodySnow*smoothstep(.18,.78,fbm(in.worldPos*4.4+seed)+.25));
  }

  var materialAO=1.0;var mappedRoughness=-1.0;var mappedMetalness=-1.0;
  if(u.texture.w>.5||u.detail.y>.5||u.detail.w>.5){
    let w=pow(abs(n),vec3<f32>(6));let weights=w/max(w.x+w.y+w.z,.001);
    if(u.texture.w>.5){
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

  // Water is also state, not a material override. Procedural depressions localize
  // the scalar water volume into shallow puddles.
  var puddleMask=0.0;
  if(u.surfaceDynamics.x>.001){
    let depression=1.0-fbm(in.worldPos*0.58+seed*6.0);
    puddleMask=u.surfaceDynamics.x*smoothstep(0.7-u.surfaceDynamics.x*.35,0.9-u.surfaceDynamics.x*.12,depression)*upward;
  }
  let wetness=clamp(u.surface.y+u.motion.w+waterDepth/0.006+puddleMask*.5,0.0,1.0);
  albedo*=1.0-u.surface.w-wetness*.24;

  var roughness=clamp(select(select(u.surface.z,u.pbr.x,u.pbr.x>=0.0),mappedRoughness,mappedRoughness>=0.0)-wetness*.28+paintMicro*.018,.08,1.0);
  if(treatment>3.5&&treatment<4.5){
    // Sub-percent tonal variation keeps the flake visible only inside the
    // clearcoat highlight; it is intentionally below the level of a noisy paint texture.
    albedo*=1.0+paintMicro*.010;
  }
  let automotivePaint=treatment>3.5&&treatment<4.5;
  // Two-scale procedural automotive finish. The broad component is the subtle
  // orange-peel of real clearcoat; the fine component breaks up pin-sharp probe
  // reflections without changing the underlying body geometry.
  if(automotivePaint){
    let peel=noise3(in.worldPos*92.0);
    let peelX=noise3((in.worldPos+vec3<f32>(.006,0,0))*92.0)-peel;
    let peelY=noise3((in.worldPos+vec3<f32>(0,.006,0))*92.0)-peel;
    let peelZ=noise3((in.worldPos+vec3<f32>(0,0,.006))*92.0)-peel;
    let peelGrad=vec3<f32>(peelX,peelY,peelZ);
    n=normalize(n+(peelGrad-n*dot(peelGrad,n))*.035);
  }
  let ndx=dpdx(n);let ndy=dpdy(n);let normalVariance=max(dot(ndx,ndx),dot(ndy,ndy));
  roughness=clamp(sqrt(roughness*roughness+min(.06,normalVariance*.04)),.08,1.0);
  var waterCoverage=1.0;
  if(materialKind>4.5&&materialKind<5.5){
    let hollows=noise3(in.worldPos*vec3<f32>(1.4,.1,2.3))*.78+noise3(in.worldPos*vec3<f32>(7.5,.1,9.3))*.22;
    // A damp film darkens stone but does not submerge the aggregate. Only
    // depressions filled by the local water column become smooth puddles.
    let fill=clamp(waterDepth/.006,0.0,1.0);
    // A damp film changes roughness before it fills every depression as a
    // mirror. Scale subpixel puddle coverage by the available water volume.
    waterCoverage=smoothstep(.64,.80,hollows+fill*.50)*smoothstep(.00015,.0012,waterDepth)*sqrt(fill);
    let aggregate=noise3(in.worldPos*37.0+seed);
    let mineralRoughness=clamp(max(roughness,.60)+(aggregate-.5)*.24,.50,.93);
    roughness=mix(mineralRoughness,.21+noise3(in.worldPos*3.0)*.045,waterCoverage);
    albedo*=mix(1.0,.75,waterCoverage);
    // Millimetres of water level out the gravel; its normals must not turn the
    // planar reflection into waves across the entire road.
    n=normalize(mix(n,geometricNormal,waterCoverage*.94));
  }
  let metal=select(u.pbr.y,mappedMetalness,mappedMetalness>=0.0);let base=pow(max(albedo,vec3<f32>(0)),vec3<f32>(2.2));
  let nv=max(dot(n,viewDir),.001);let nl=max(dot(n,light),0.0);let nh=max(dot(n,halfDir),0.0);let vh=max(dot(viewDir,halfDir),0.0);
  let a2=pow(roughness,4.0);let d=a2/(3.14159*pow(nh*nh*(a2-1.0)+1.0,2.0));
  let k=pow(roughness+1.0,2.0)/8.0;let g=(nv/(nv*(1.0-k)+k))*(nl/(nl*(1.0-k)+k));
  // The engine's dielectric base assumes IOR 1.5: under an IOR 1.5 coat
  // that interface is index-matched, rather than a second air/paint reflection.
  let f0=mix(vec3<f32>(.04*(1.0-clearcoat)),base,metal);let fresnel=f0+(1.0-f0)*pow(1.0-vh,5.0);
  let specular=d*g*fresnel/max(4.0*nv*nl,.001);
  let shadow=shadowAt(in.worldPos,n);
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
  // Filter the coat normal distribution too; a sharp second lobe must not
  // bypass the base layer's anti-aliasing on curved/subpixel panel edges.
  let paintCoatFloor=select(.0,.105,automotivePaint);
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
  let paintProbeScale=select(1.0,.58,automotivePaint);
  let localProbeWeight=f.params.y*(1.0-smoothstep(.035,.28,roughness))*.68*mix(1.0,1.16,sideReflection)*paintProbeScale;
  let localProbeLod=roughness*f32(textureNumLevels(localProbeMap)-1u)*.72;
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
      let coatLocal=textureSampleLevel(localProbeMap,reflectionSampler,parallaxProbeDirection(in.worldPos,reflectionDir),coatRough*f32(textureNumLevels(localProbeMap)-1u)).rgb;
      let coatProbeWeight=f.params.y*select(1.0,.62,automotivePaint);
      coatEnvironment=mix(coatEnvironment,coatLocal,coatProbeWeight);
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
    transmitted*=mix(vec3<f32>(1.0),u.color.rgb,clamp(1.0-transmission,.0,.35));
    let reflectionTint=mix(vec3<f32>(1.0),u.color.rgb*.92+.08,clamp(glassF,.0,.72));
    color=mix(transmitted,glassReflection*reflectionTint,glassF);
  }
  if(materialKind>9.5){
    color=mix(color,environmentRadiance,.58+.32*pow(1.0-nv,5.0));
  }
  // Rough dry asphalt is an absorber, not a sky-colored mirror. Keep the broad
  // dielectric lobe subdued until actual water/ice state creates local coverage.
  if(materialKind>4.5&&materialKind<5.5){color*=mix(.52,1.0,max(waterCoverage,clamp(u.surfacePhase.w/.0015,0.0,1.0)*.35));}

  if(f.params.x>.5){let bin=lightCell(in.worldPos);if(bin!=0xffffffffu){for(var j=0u;j<lightCells[bin];j++){color+=pointLight(lightGrid.sources[lightCells[bin+1u+j]],in.worldPos,n,viewDir,roughness,base,f0,metal,clearcoat,coatRough);}}}
  color+=u.emission.rgb;
  if(materialKind>4.5&&materialKind<5.5&&n.y>.8&&in.reflected==0u){
    let p=f.reflectionVP*vec4<f32>(in.worldPos,1);let uv=p.xy/p.w*vec2<f32>(.5,-.5)+.5;
    let ripple=vec2<f32>(noise3(in.worldPos*vec3<f32>(7,1,3))-.5,noise3(in.worldPos*vec3<f32>(3,1,9)+9.0)-.5)*.000075;let blur=vec2<f32>(.0011,.0021)*(roughness+.2);var reflection=textureSampleLevel(reflectionMap,reflectionSampler,clamp(uv+ripple,vec2<f32>(.001),vec2<f32>(.999)),0).rgb*.28;
    for(var k=0;k<6;k++){let a=f32(k)*1.0472;reflection+=textureSampleLevel(reflectionMap,reflectionSampler,clamp(uv+ripple+vec2<f32>(cos(a),sin(a))*blur,vec2<f32>(.001),vec2<f32>(.999)),0).rgb*.12;}
    let icePatch=smoothstep(.58,.77,noise3(in.worldPos*vec3<f32>(.35,.1,1.1)))*clamp(u.surfacePhase.w/.002,0.0,1.0);
    let fres=.02+.96*pow(1.0-nv,5.0);
    color=mix(color,reflection,fres*max(waterCoverage,icePatch*.45));
  }
  let fog=1.0-exp(-distance(eye,in.worldPos)*f.sky.w);
  color=mix(color,f.sky.rgb*1.22+f.sunColor.rgb*f.sun.w*.027,clamp(fog,0.0,.96));
  let grazing=pow(1.0-nv,5.0);
  let screenReflectance=environmentFresnel*pow(1.0-coatViewF,2.0)+vec3<f32>(coatViewF);
  // Pack independent SSR roughness in reflectance.a; normal.a stays the base
  // roughness for diffuse/AO. Zero alpha still disables asphalt SSR.
  let screenRoughness=mix(roughness,min(roughness,coatRough),clearcoat);
  let glassOpacity=mix(clamp(u.color.a*.90,.22,.55),.82,grazing);var out:GOut;out.color=vec4<f32>(color,select(u.color.a,glassOpacity,materialKind>.5&&materialKind<1.5));out.normal=vec4<f32>(n*.5+.5,roughness);out.specular=vec4<f32>(screenReflectance,select(.5+.5*screenRoughness,0.0,materialKind>4.5&&materialKind<5.5));out.velocity=in.velocity;return out;
}`;

const SNOW_SHADER=FRAME_WGSL+LIGHT_GRID_WGSL+`
@group(1) @binding(0) var<uniform> f:Frame;
struct S {vp:mat4x4<f32>,camera:vec4<f32>,params:vec4<f32>,right:vec4<f32>,up:vec4<f32>}
@group(0) @binding(0) var<uniform> s:S;
struct O {@builtin(position) position:vec4<f32>,@location(0) alpha:f32,@location(1) uv:vec2<f32>,@location(2) tone:vec3<f32>}
fn hash1(n:f32)->f32{return fract(sin(n)*43758.5453123);}
@vertex fn vs(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->O{
 let i=f32(instance)+1.0;let rx=hash1(i*12.9898);let rz=hash1(i*78.233);let ry=hash1(i*31.731);let t=s.params.x;
 // Wrapping moves only the far boundary. Inside the volume flakes stay in world
 // space as the camera travels, with individual fall speed and lateral flutter.
 let wx=rx*52.0+s.params.z*t*.32+sin(t*.8+i)*.17;let wz=rz*52.0+s.params.w*t*.32+cos(t*.63+i*1.7)*.15;
 let world=vec3<f32>(s.camera.x+fract((wx-s.camera.x+26.0)/52.0)*52.0-26.0,fract(ry-t*(.024+hash1(i*5.17)*.025))*20.0,s.camera.z+fract((wz-s.camera.z+26.0)/52.0)*52.0-26.0);
 var corners=array<vec2<f32>,6>(vec2<f32>(-1,-1),vec2<f32>(1,-1),vec2<f32>(1,1),vec2<f32>(-1,-1),vec2<f32>(1,1),vec2<f32>(-1,1));let q=corners[vertex];
 let distance=length(world-s.camera.xyz);let size=.008+pow(hash1(i*9.13),3.0)*.022;
 let angle=t*.45+i;let local=vec2<f32>(q.x*cos(angle)-q.y*sin(angle),q.x*sin(angle)+q.y*cos(angle));
 var out:O;out.position=s.vp*vec4<f32>(world+(s.right.xyz*local.x+s.up.xyz*local.y)*size,1);
 out.uv=q;out.alpha=(.38+hash1(i*3.77)*.5)*smoothstep(.3,1.4,distance)*(1.0-smoothstep(21.0,26.0,max(abs(world.x-s.camera.x),abs(world.z-s.camera.z))));var incident=f.sky.rgb*2.0+vec3<f32>(.08);let cell=lightCell(world);
 if(cell!=0xffffffffu){for(var k=0u;k<lightCells[cell];k++){let source=lightGrid.sources[lightCells[cell+1u+k]];let d=length(world-source.position.xyz);incident+=source.color.rgb*source.color.w*pow(max(0.0,1.0-d/source.position.w),2.0)/max(1.0,d*d*.4);}}
 out.tone=incident*(.77+hash1(i*6.8)*.23);return out;
}
@fragment fn fs(in:O)->@location(0) vec4<f32>{
 let r=length(in.uv);let lobes=.84+.06*cos(atan2(in.uv.y,in.uv.x)*6.0);let fade=1.0-smoothstep(.15,lobes,r);return vec4<f32>(vec3<f32>(.86,.92,1)*in.tone,in.alpha*fade);
}
`;

const REFLECTION_LOD_SHADER=FRAME_WGSL+`
override MATERIAL_CLASS:i32=-1;
struct U {
  model:mat4x4<f32>,prevModel:mat4x4<f32>,color:vec4<f32>,surface:vec4<f32>,weather:vec4<f32>,
  surfacePhase:vec4<f32>,surfaceDynamics:vec4<f32>,motion:vec4<f32>,objectState:vec4<f32>,
  fieldFrame:vec4<f32>,fieldSize:vec4<f32>,pbr:vec4<f32>,emission:vec4<f32>,texture:vec4<f32>,detail:vec4<f32>
}
@group(0) @binding(0) var<uniform> u:U;
@group(1) @binding(0) var<uniform> f:Frame;
struct O {@builtin(position) position:vec4<f32>,@location(0) normal:vec3<f32>,@location(1) worldPos:vec3<f32>,@location(2) vertexColor:vec3<f32>}
@vertex fn reflectionVS(@location(0) position:vec3<f32>,@location(1) normal:vec3<f32>,@location(6) vertexColor:vec4<f32>)->O{
  let world=u.model*vec4<f32>(position,1);let a=u.model[0].xyz;let b=u.model[1].xyz;let c=u.model[2].xyz;
  var out:O;out.position=f.reflectionVP*world;out.worldPos=world.xyz;out.vertexColor=vertexColor.rgb;
  out.normal=normalize(mat3x3<f32>(a/dot(a,a),b/dot(b,b),c/dot(c,c))*normal);return out;
}
@fragment fn fs(in:O)->@location(0) vec4<f32>{
  if(in.worldPos.y<.04){discard;}
  let n=normalize(in.normal);
  let base=pow(max(u.color.rgb*in.vertexColor,vec3<f32>(0)),vec3<f32>(2.2));
  let ndl=max(dot(n,f.sun.xyz),0.0);
  let sky=f.sky.rgb*(.18+.60*max(n.y,0.0));
  let direct=f.sunColor.rgb*f.sun.w*ndl*.318309886;
  let radiance=base*(sky+direct)+u.emission.rgb;
  return vec4<f32>(radiance,1);
}
`;

const PROBE_SHADER=`
struct U {
  model:mat4x4<f32>,prevModel:mat4x4<f32>,color:vec4<f32>,surface:vec4<f32>,weather:vec4<f32>,
  surfacePhase:vec4<f32>,surfaceDynamics:vec4<f32>,motion:vec4<f32>,objectState:vec4<f32>,
  fieldFrame:vec4<f32>,fieldSize:vec4<f32>,pbr:vec4<f32>,emission:vec4<f32>,texture:vec4<f32>,detail:vec4<f32>
}
struct P {vp:mat4x4<f32>,sun:vec4<f32>,sunColor:vec4<f32>,sky:vec4<f32>}
@group(0) @binding(0) var<uniform> u:U;
@group(1) @binding(0) var<uniform> p:P;
struct O {@builtin(position) position:vec4<f32>,@location(0) normal:vec3<f32>,@location(1) vertexColor:vec3<f32>}
@vertex fn vs(@location(0) position:vec3<f32>,@location(1) normal:vec3<f32>,@location(6) vertexColor:vec4<f32>)->O{
 let world=u.model*vec4<f32>(position,1);let a=u.model[0].xyz;let b=u.model[1].xyz;let c=u.model[2].xyz;
 var out:O;out.position=p.vp*world;out.vertexColor=vertexColor.rgb;out.normal=normalize(mat3x3<f32>(a/dot(a,a),b/dot(b,b),c/dot(c,c))*normal);return out;
}
@fragment fn fs(in:O)->@location(0) vec4<f32>{
 let n=normalize(in.normal);let ndl=max(dot(n,p.sun.xyz),0.0);let up=.35+1.15*max(n.y,0.0);
 let base=pow(max(u.color.rgb*in.vertexColor,vec3<f32>(0)),vec3<f32>(2.2));
 let radiance=base*(p.sky.rgb*up+p.sunColor.rgb*p.sun.w*ndl*.72)+u.emission.rgb;
 return vec4<f32>(radiance,1);
}
`;

export class WebGPURenderer implements Renderer{
  private depth:GPUAny=null;private hdr:GPUAny=null;private opaqueScene:GPUAny=null;private opaqueBind:GPUAny=null;private normal:GPUAny=null;private specular:GPUAny=null;private velocity:GPUAny=null;private effectsHdr:GPUAny=null;private effectsBind:GPUAny=null;private taaA:GPUAny=null;private taaB:GPUAny=null;private taaBindAB:GPUAny=null;private taaBindBA:GPUAny=null;private presentBindA:GPUAny=null;private presentBindB:GPUAny=null;private reflection:GPUAny=null;private reflectionDepth:GPUAny=null;private depthW=0;private depthH=0;
  private fixedResolution:readonly [number,number]|undefined;
  private bloomA:GPUAny=null;private bloomB:GPUAny=null;private bloomDownBind:GPUAny=null;private bloomHorizontalBind:GPUAny=null;private bloomVerticalBind:GPUAny=null;
  private readonly meshes=new Map<string,GPUMesh>();private readonly meshByPrimitive=new WeakMap<object,GPUMesh>();private readonly objects=new Map<string,GPUObject>();private readonly shadowBatches=new Map<string,GPUShadowBatch>();private readonly errors:string[]=[];private readonly labels=new Map<string,GPUAny>();
  private readonly surfaceTextures:SurfaceTextures;
  private appearanceScene:Scene|null=null;private appearanceRevision=-1;
  private readonly materialLoads=new Map<string,Promise<void>>();private readonly failedMaterials=new Set<string>();private disposed=false;
  private pointLights=0;private lightOverflow=0;private lightGridKey='';private environmentKey='';private environmentUpdates=0;private readonly environmentInvalidations=new Map<string,number>();private environmentScene:Scene|null=null;private measuredRadianceSpec:EnvironmentRadianceSpec|null=null;private measuredRadiance:Float32Array|null=null;private readonly environmentIrradiance=new Float32Array(36);private collectedScene:Scene|null=null;private collectedRevision=-1;private collectedVisible:RuntimeEntity[]=[];private collectedOpaque:RuntimeEntity[]=[];private collectedTransparent:RuntimeEntity[]=[];
  private shadowValid=false;private shadowLightVP:Mat4|null=null;private readonly shadowState=new Map<string,{primitive:Primitive;model:Mat4}>();
  private localProbeMask=0;private localProbeFace=0;private localProbePosition:Vec3|null=null;private localProbeBounds:{min:Vec3;max:Vec3}|null=null;private localProbeKey='';private localProbeCause='';private probeComplete=false;
  private drawCalls=0;private triangles=0;private lastCamera:Vec3=[0,0,0];private lastScene:Scene|null=null;private lastLights:RuntimeEntity[]=[];private previousVp:Mat4|null=null;private previousCamera:Vec3|null=null;private previousTarget:Vec3|null=null;private previousModels=new Map<string,Mat4>();private readonly modelCache=new Map<string,{px:number;py:number;pz:number;rx:number;ry:number;rz:number;sx:number;sy:number;sz:number;matrix:Mat4}>();private readonly frameModels=new Map<string,Mat4>();private readonly cullScratch=new Float32Array(16);private readonly cullCache=new Map<string,{primitive:Primitive;model:Mat4;camera:boolean;shadow:boolean;reflection:boolean}>();private cullCameraVP:Mat4|null=null;private cullLightVP:Mat4|null=null;private cullReflectionVP:Mat4|null=null;private staticCullRevision=-1;private staticCameraOpaque:RuntimeEntity[]=[];private staticCameraTransparent:RuntimeEntity[]=[];private staticShadowCasters:RuntimeEntity[]=[];private staticReflectedObjects:RuntimeEntity[]=[];private historyValid=false;private taaHistoryIndex=0;private lastRenderTime=-Infinity;
  private readonly profiler:RenderProfiler;
  private readonly shaderAtoms:Readonly<Record<string,ShaderProgramAtoms>>;
  private constructor(private readonly canvas:HTMLCanvasElement,private readonly device:GPUAny,private readonly context:GPUAny,private readonly format:string,private readonly gpu:GPUAny,profiling:boolean,timestampQueries:boolean){
    this.surfaceTextures=new SurfaceTextures(device);this.profiler=new RenderProfiler(device,{enabled:profiling,timestampQueries});
    this.shaderAtoms=profiling?Object.freeze({
      material:analyzeWGSL('material',materialShader(),['vs','fs','shadowVS']),
      reflection:analyzeWGSL('reflection',REFLECTION_LOD_SHADER,['reflectionVS','fs']),
      sky:analyzeWGSL('sky',SKY_SHADER,['vs','fs']),
      snow:analyzeWGSL('snow',SNOW_SHADER,['vs','fs']),
      bloom:analyzeWGSL('bloom',BLOOM_SHADER,['vs','downsample','horizontal','vertical']),
      effects:analyzeWGSL('effects',EFFECTS_SHADER,['vs','fs']),
      taa:analyzeWGSL('taa',TAA_SHADER,['vs','fs']),
      present:analyzeWGSL('present',PRESENT_SHADER,['vs','fs']),
    }):Object.freeze({});
    device.addEventListener?.('uncapturederror',(event:any)=>{const message=event?.error?.message??String(event?.error);this.errors.push(message);console.error('Game Engine WebGPU:',message);});device.lost?.then((info:any)=>this.errors.push(`Device lost: ${info?.message??'unknown'}`));
  }
  static async create(canvas:HTMLCanvasElement,options:WebGPURendererOptions={}):Promise<WebGPURenderer>{
    const gpu=(navigator as any).gpu;if(!gpu)throw new Error('WebGPU unavailable');
    const adapter=await gpu.requestAdapter({powerPreference:'high-performance'});if(!adapter)throw new Error('No WebGPU adapter');
    const profiling=options.profiling??false,timestampQueries=profiling&&!!adapter.features?.has?.('timestamp-query');
    const device=await adapter.requestDevice(timestampQueries?{requiredFeatures:['timestamp-query']}:undefined),context=canvas.getContext('webgpu') as any,format=gpu.getPreferredCanvasFormat();context.configure({device,format,alphaMode:'opaque'});
    // The reflection plane clip uses discard. Keep it out of the main material
    // pipeline so opaque geometry can use early depth rejection on tile GPUs.
    const module=device.createShaderModule({code:materialShader()}),reflectionModule=device.createShaderModule({code:REFLECTION_LOD_SHADER}),geometryVertexBuffer={arrayStride:24,attributes:[{shaderLocation:0,offset:0,format:'float32x3'},{shaderLocation:1,offset:12,format:'float32x3'}]},colorVertexBuffer={arrayStride:4,attributes:[{shaderLocation:6,offset:0,format:'unorm8x4'}]},vertex={module,entryPoint:'vs',buffers:[geometryVertexBuffer,colorVertexBuffer]};
    const objectLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:3,buffer:{type:'uniform'}},{binding:1,visibility:2,texture:{sampleType:'unfilterable-float'}},{binding:2,visibility:2,texture:{sampleType:'float'}},{binding:3,visibility:2,sampler:{type:'filtering'}},{binding:4,visibility:2,texture:{sampleType:'float'}},{binding:5,visibility:2,sampler:{type:'filtering'}},{binding:6,visibility:2,texture:{sampleType:'float'}},{binding:7,visibility:2,texture:{sampleType:'float'}}]});
    const frameLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:3,buffer:{type:'uniform'}}]});
    const probeFrameLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:3,buffer:{type:'uniform'}}]});
    const lightLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:3,buffer:{type:'uniform'}},{binding:1,visibility:2,texture:{sampleType:'depth'}},{binding:2,visibility:2,sampler:{type:'comparison'}},{binding:3,visibility:2,texture:{sampleType:'float'}},{binding:4,visibility:2,sampler:{type:'filtering'}},{binding:5,visibility:3,buffer:{type:'read-only-storage'}},{binding:6,visibility:3,buffer:{type:'read-only-storage'}},{binding:7,visibility:2,texture:{viewDimension:'3d'}},{binding:8,visibility:2,sampler:{type:'filtering'}},{binding:9,visibility:2,texture:{sampleType:'float',viewDimension:'cube'}},{binding:10,visibility:2,texture:{sampleType:'float',viewDimension:'cube'}},{binding:11,visibility:2,texture:{sampleType:'depth'}},{binding:12,visibility:2,texture:{sampleType:'float'}}]});
    const lightBuffer=device.createBuffer({size:(4+MAX_RENDER_LIGHTS*8)*4,usage:0x80|0x08}),cellBuffer=device.createBuffer({size:LIGHT_GRID_SIDE**2*(LIGHTS_PER_CELL+1)*4,usage:0x80|0x08});
    const frame=device.createBuffer({size:608,usage:0x40|0x08}),shadow=device.createTexture({size:[SHADOW_MAP_SIZE,SHADOW_MAP_SIZE],format:'depth32float',usage:0x10|0x04}),dynamicShadow=device.createTexture({size:[DYNAMIC_SHADOW_MAP_SIZE,DYNAMIC_SHADOW_MAP_SIZE],format:'depth32float',usage:0x10|0x04});
    const comparison=device.createSampler({compare:'less-equal',minFilter:'linear',magFilter:'linear'}),sampler=device.createSampler({minFilter:'linear',magFilter:'linear',mipmapFilter:'linear'});
    const noiseVolume=createNoiseVolume(device),noiseSampler=device.createSampler({minFilter:'linear',magFilter:'linear',addressModeU:'repeat',addressModeV:'repeat',addressModeW:'repeat'});
    const environmentMap=device.createTexture({label:'prefiltered environment',size:[256,256,6],mipLevelCount:9,format:'rgba16float',usage:0x04|0x02}),environmentView=environmentMap.createView({dimension:'cube'});
    // 192px local capture: 2.25x the linear sampling detail of the old 128px probe,
    // while keeping the capture cheap enough to avoid a full-resolution reflection pass.
    const localProbeMap=device.createTexture({label:'local reflection probe',size:[192,192,6],mipLevelCount:PROBE_MIP_LEVELS,format:'rgba16float',usage:0x10|0x04}),localProbeView=localProbeMap.createView({dimension:'cube'});
    const localProbeDepth=device.createTexture({label:'local reflection probe depth',size:[192,192],format:'depth32float',usage:0x10});
    const surfaceSampler=device.createSampler({minFilter:'linear',magFilter:'linear',mipmapFilter:'linear',addressModeU:'repeat',addressModeV:'repeat',maxAnisotropy:8});
    const emptyField=device.createTexture({size:[1,1],format:'rgba32float',usage:0x04|0x02}),emptyLabel=device.createTexture({size:[1,1],format:'rgba8unorm',usage:0x04|0x02});device.queue.writeTexture({texture:emptyField},new Float32Array(4),{bytesPerRow:16},[1,1]);device.queue.writeTexture({texture:emptyLabel},new Uint8Array(4),{bytesPerRow:4},[1,1]);
    const frameBind=device.createBindGroup({layout:frameLayout,entries:[{binding:0,resource:{buffer:frame}}]});
    const reflectionBind=device.createBindGroup({layout:lightLayout,entries:[{binding:0,resource:{buffer:frame}},{binding:1,resource:shadow.createView()},{binding:2,resource:comparison},{binding:3,resource:emptyLabel.createView()},{binding:4,resource:sampler},{binding:5,resource:{buffer:lightBuffer}},{binding:6,resource:{buffer:cellBuffer}},{binding:7,resource:noiseVolume.createView()},{binding:8,resource:noiseSampler},{binding:9,resource:environmentView},{binding:10,resource:localProbeView},{binding:11,resource:dynamicShadow.createView()},{binding:12,resource:emptyLabel.createView()}]});
    const layout=device.createPipelineLayout({bindGroupLayouts:[objectLayout,lightLayout]});
    const blend={color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}};
    const materialClasses=[0,1,2,3,4,5,6,7,8,9,10] as const;
    const make=(transparent:boolean,cullMode:'none'|'back',materialClass=-1)=>device.createRenderPipeline({layout,vertex,fragment:{module,entryPoint:'fs',constants:{MATERIAL_CLASS:materialClass},targets:[{format:'rgba16float',...(transparent?{blend}:{})},{format:'rgba16float',...(transparent?{writeMask:0}:{})},{format:'rgba8unorm',...(transparent?{writeMask:0}:{})},{format:'rg16float',...(transparent?{writeMask:0}:{})}]},primitive:{topology:'triangle-list',cullMode},depthStencil:{format:'depth32float',depthWriteEnabled:!transparent,depthCompare:'less'}});
    const opaqueCulled=new Map(materialClasses.map(code=>[code,make(false,'back',code)])),opaqueDouble=new Map(materialClasses.map(code=>[code,make(false,'none',code)]));
    const transparent=make(true,'none',-1);
    const glass=device.createRenderPipeline({layout,vertex,fragment:{module,entryPoint:'fs',constants:{MATERIAL_CLASS:1},targets:[{format:'rgba16float'},{format:'rgba16float',writeMask:0},{format:'rgba8unorm',writeMask:0},{format:'rg16float',writeMask:0}]},primitive:{topology:'triangle-list',cullMode:'back'},depthStencil:{format:'depth32float',depthWriteEnabled:false,depthCompare:'less'}});
    const blitModule=device.createShaderModule({code:`
@group(0) @binding(0) var source:texture_2d<f32>;
@group(0) @binding(1) var sourceSampler:sampler;
@vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4<f32>{
 let p=array<vec2<f32>,3>(vec2<f32>(-1,-1),vec2<f32>(3,-1),vec2<f32>(-1,3));return vec4<f32>(p[i],0,1);
}
@fragment fn fs(@builtin(position) p:vec4<f32>)->@location(0) vec4<f32>{
 let size=vec2<f32>(textureDimensions(source));return vec4<f32>(textureSampleLevel(source,sourceSampler,p.xy/size,0).rgb,1);
}`});
    const blit=device.createRenderPipeline({layout:'auto',vertex:{module:blitModule,entryPoint:'vs'},fragment:{module:blitModule,entryPoint:'fs',targets:[{format:'rgba16float'},{format:'rgba16float',writeMask:0},{format:'rgba8unorm',writeMask:0},{format:'rg16float',writeMask:0}]},primitive:{topology:'triangle-list'},depthStencil:{format:'depth32float',depthWriteEnabled:false,depthCompare:'always'}});
    const probeModule=device.createShaderModule({code:PROBE_SHADER}),probePipelineLayout=device.createPipelineLayout({bindGroupLayouts:[objectLayout,probeFrameLayout]});
    const makeProbe=(cullMode:'none'|'back')=>device.createRenderPipeline({layout:probePipelineLayout,vertex:{module:probeModule,entryPoint:'vs',buffers:vertex.buffers},fragment:{module:probeModule,entryPoint:'fs',targets:[{format:'rgba16float'}]},primitive:{topology:'triangle-list',cullMode},depthStencil:{format:'depth32float',depthWriteEnabled:true,depthCompare:'less'}});
    const probeCulled=makeProbe('back'),probeDouble=makeProbe('none');
    const probeFilterModule=device.createShaderModule({label:'GGX local probe filter',code:PROBE_FILTER_SHADER});
    const probeFilter=device.createRenderPipeline({layout:'auto',vertex:{module:probeFilterModule,entryPoint:'vs'},fragment:{module:probeFilterModule,entryPoint:'fs',targets:[{format:'rgba16float'}]},primitive:{topology:'triangle-list'}});
    const probeSource=localProbeMap.createView({dimension:'cube',baseMipLevel:0,mipLevelCount:1});
    const probeFilterPasses=probeFilterPlan().map(capture=>{
      const params=device.createBuffer({size:16,usage:0x40,mappedAtCreation:true});
      new Float32Array(params.getMappedRange()).set([capture.face,capture.roughness,0,0]);params.unmap();
      const bind=device.createBindGroup({layout:probeFilter.getBindGroupLayout(0),entries:[{binding:0,resource:probeSource},{binding:1,resource:sampler},{binding:2,resource:{buffer:params}}]});
      const view=localProbeMap.createView({dimension:'2d',baseArrayLayer:capture.face,arrayLayerCount:1,baseMipLevel:capture.mip,mipLevelCount:1});
      return{bind,view,params};
    });

    const makeReflected=(cullMode:'none'|'back',materialClass:number)=>device.createRenderPipeline({layout,vertex:{...vertex,module:reflectionModule,entryPoint:'reflectionVS'},fragment:{module:reflectionModule,entryPoint:'fs',constants:{MATERIAL_CLASS:materialClass},targets:[{format:'rgba16float'}]},primitive:{topology:'triangle-list',cullMode},depthStencil:{format:'depth32float',depthWriteEnabled:true,depthCompare:'less'}});
    const reflectedCulled=new Map(materialClasses.map(code=>[code,makeReflected('back',code)])),reflectedDouble=new Map(materialClasses.map(code=>[code,makeReflected('none',code)]));
    const shadowLayout=device.createPipelineLayout({bindGroupLayouts:[objectLayout,frameLayout]});
    const shadowInstanceBuffer={arrayStride:64,stepMode:'instance',attributes:[{shaderLocation:2,offset:0,format:'float32x4'},{shaderLocation:3,offset:16,format:'float32x4'},{shaderLocation:4,offset:32,format:'float32x4'},{shaderLocation:5,offset:48,format:'float32x4'}]};
    const makeShadow=(cullMode:'none'|'back',instanced=false)=>device.createRenderPipeline({layout:shadowLayout,vertex:{...vertex,entryPoint:instanced?'shadowVSInstanced':'shadowVS',buffers:instanced?[geometryVertexBuffer,shadowInstanceBuffer]:[geometryVertexBuffer]},primitive:{topology:'triangle-list',cullMode},depthStencil:{format:'depth32float',depthWriteEnabled:true,depthCompare:'less',depthBias:1,depthBiasSlopeScale:1.5}});
    const shadowCulled=makeShadow('back'),shadowDouble=makeShadow('none'),shadowCulledInstanced=makeShadow('back',true),shadowDoubleInstanced=makeShadow('none',true);
    const skyModule=device.createShaderModule({code:SKY_SHADER}),sky=device.createRenderPipeline({layout:device.createPipelineLayout({bindGroupLayouts:[frameLayout]}),vertex:{module:skyModule,entryPoint:'vs'},fragment:{module:skyModule,entryPoint:'fs',targets:[{format:'rgba16float'},{format:'rgba16float',writeMask:0},{format:'rgba8unorm',writeMask:0},{format:'rg16float',writeMask:0}]},primitive:{topology:'triangle-list'},depthStencil:{format:'depth32float',depthWriteEnabled:false,depthCompare:'always'}});
    const effectsModule=device.createShaderModule({code:EFFECTS_SHADER}),effects=device.createRenderPipeline({layout:'auto',vertex:{module:effectsModule,entryPoint:'vs'},fragment:{module:effectsModule,entryPoint:'fs',targets:[{format:'rgba16float'}]},primitive:{topology:'triangle-list'}});
    const taaModule=device.createShaderModule({code:TAA_SHADER}),taa=device.createRenderPipeline({layout:'auto',vertex:{module:taaModule,entryPoint:'vs'},fragment:{module:taaModule,entryPoint:'fs',targets:[{format:'rgba16float'}]},primitive:{topology:'triangle-list'}});
    const taaParams=device.createBuffer({size:16,usage:0x40|0x08});
    const presentModule=device.createShaderModule({code:PRESENT_SHADER}),present=device.createRenderPipeline({layout:'auto',vertex:{module:presentModule,entryPoint:'vs'},fragment:{module:presentModule,entryPoint:'fs',targets:[{format}]},primitive:{topology:'triangle-list'}});
    const bloomModule=device.createShaderModule({code:BLOOM_SHADER}),bloomLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:2,texture:{sampleType:'float'}},{binding:1,visibility:2,sampler:{type:'filtering'}}]}),bloomPipelineLayout=device.createPipelineLayout({bindGroupLayouts:[bloomLayout]});
    const makeBloom=(entryPoint:string)=>device.createRenderPipeline({layout:bloomPipelineLayout,vertex:{module:bloomModule,entryPoint:'vs'},fragment:{module:bloomModule,entryPoint,targets:[{format:'rgba16float'}]},primitive:{topology:'triangle-list'}});
    const bloomDown=makeBloom('downsample'),bloomHorizontal=makeBloom('horizontal'),bloomVertical=makeBloom('vertical');
    const snowModule=device.createShaderModule({code:SNOW_SHADER}),snowLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:1,buffer:{type:'uniform'}}]});
    const snow=device.createRenderPipeline({layout:device.createPipelineLayout({bindGroupLayouts:[snowLayout,lightLayout]}),vertex:{module:snowModule,entryPoint:'vs'},fragment:{module:snowModule,entryPoint:'fs',targets:[{format:'rgba16float',blend},{format:'rgba16float',writeMask:0},{format:'rgba8unorm',writeMask:0},{format:'rg16float',writeMask:0}]},primitive:{topology:'triangle-list'},depthStencil:{format:'depth32float',depthWriteEnabled:false,depthCompare:'less'}});
    const snowUniform=device.createBuffer({size:128,usage:0x40|0x08}),snowBind=device.createBindGroup({layout:snowLayout,entries:[{binding:0,resource:{buffer:snowUniform}}]});
    const probeFrames=Array.from({length:6},(_,face)=>device.createBuffer({label:`reflection probe frame ${face}`,size:112,usage:0x40|0x08}));
    const probeFrameBinds=probeFrames.map(buffer=>device.createBindGroup({layout:probeFrameLayout,entries:[{binding:0,resource:{buffer}}]}));
    for(const shader of [module,reflectionModule,probeModule,probeFilterModule,skyModule,effectsModule,taaModule,presentModule,snowModule,bloomModule]){const info=await shader.getCompilationInfo();const errors=info.messages.filter((m:any)=>m.type==='error');if(errors.length)throw new Error(errors.map((m:any)=>m.message).join('\n'));}
    return new WebGPURenderer(canvas,device,context,format,{probeFilter,probeFilterPasses,localProbeMap,localProbeView,localProbeDepth,probeFrames,probeFrameBinds,probeCulled,probeDouble,noiseVolume,noiseSampler,environmentMap,environmentView,surfaceSampler,lightBuffer,cellBuffer,emptyField,emptyLabel,objectLayout,lightLayout,comparison,frame,shadow,dynamicShadow,sampler,frameBind,reflectionBind,reflectedCulled,reflectedDouble,lightBind:null,transparentLightBind:null,opaqueCulled,opaqueDouble,transparent,glass,blit,shadowCulled,shadowDouble,shadowCulledInstanced,shadowDoubleInstanced,sky,effects,taa,taaParams,present,bloomLayout,bloomDown,bloomHorizontal,bloomVertical,snow,snowUniform,snowBind},profiling,timestampQueries);
  }
  setResolution(width:number,height:number):void{
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>4096||height>4096)throw new RangeError('Render dimensions must be integers in [1,4096]');
    this.fixedResolution=[width,height];this.resize();
  }
  resize():void{
    const ratio=Math.max(1,Math.min(2,devicePixelRatio||1)),width=this.fixedResolution?.[0]??Math.max(1,Math.floor(this.canvas.clientWidth*ratio)),height=this.fixedResolution?.[1]??Math.max(1,Math.floor(this.canvas.clientHeight*ratio));
    if(this.depthW===width&&this.depthH===height)return;
    this.canvas.width=width;this.canvas.height=height;this.depthW=width;this.depthH=height;
    for(const target of [this.depth,this.hdr,this.opaqueScene,this.normal,this.specular,this.velocity,this.effectsHdr,this.taaA,this.taaB,this.reflection,this.reflectionDepth,this.bloomA,this.bloomB])target?.destroy();
    const texture=(format:string,count:number)=>this.device.createTexture({size:[width,height],format,sampleCount:count,usage:0x10|0x04|(format==='rgba16float'?0x01:0)});
    this.depth=texture('depth32float',1);this.hdr=texture('rgba16float',1);this.opaqueScene=texture('rgba16float',1);this.normal=texture('rgba16float',1);this.specular=texture('rgba8unorm',1);this.velocity=texture('rg16float',1);this.effectsHdr=texture('rgba16float',1);this.taaA=texture('rgba16float',1);this.taaB=texture('rgba16float',1);
    const reflectionScale=.625;const reflectionWidth=Math.max(1,Math.floor(width*reflectionScale)),reflectionHeight=Math.max(1,Math.floor(height*reflectionScale));this.reflection=this.device.createTexture({size:[reflectionWidth,reflectionHeight],format:'rgba16float',usage:0x10|0x04|0x01});this.reflectionDepth=this.device.createTexture({size:[reflectionWidth,reflectionHeight],format:'depth32float',usage:0x10});
    const bloomTexture=()=>this.device.createTexture({size:[Math.max(1,Math.floor(width/2)),Math.max(1,Math.floor(height/2))],format:'rgba16float',usage:0x10|0x04});this.bloomA=bloomTexture();this.bloomB=bloomTexture();
    const bloomBind=(texture:GPUAny)=>this.device.createBindGroup({layout:this.gpu.bloomLayout,entries:[{binding:0,resource:texture.createView()},{binding:1,resource:this.gpu.sampler}]});this.bloomDownBind=bloomBind(this.hdr);this.bloomHorizontalBind=bloomBind(this.bloomA);this.bloomVerticalBind=bloomBind(this.bloomB);
    this.gpu.lightBind=this.device.createBindGroup({layout:this.gpu.lightLayout,entries:[{binding:0,resource:{buffer:this.gpu.frame}},{binding:1,resource:this.gpu.shadow.createView()},{binding:2,resource:this.gpu.comparison},{binding:3,resource:this.reflection.createView()},{binding:4,resource:this.gpu.sampler},{binding:5,resource:{buffer:this.gpu.lightBuffer}},{binding:6,resource:{buffer:this.gpu.cellBuffer}},{binding:7,resource:this.gpu.noiseVolume.createView()},{binding:8,resource:this.gpu.noiseSampler},{binding:9,resource:this.gpu.environmentView},{binding:10,resource:this.gpu.localProbeView},{binding:11,resource:this.gpu.dynamicShadow.createView()},{binding:12,resource:this.gpu.emptyLabel.createView()}]});
    this.gpu.transparentLightBind=this.device.createBindGroup({layout:this.gpu.lightLayout,entries:[{binding:0,resource:{buffer:this.gpu.frame}},{binding:1,resource:this.gpu.shadow.createView()},{binding:2,resource:this.gpu.comparison},{binding:3,resource:this.reflection.createView()},{binding:4,resource:this.gpu.sampler},{binding:5,resource:{buffer:this.gpu.lightBuffer}},{binding:6,resource:{buffer:this.gpu.cellBuffer}},{binding:7,resource:this.gpu.noiseVolume.createView()},{binding:8,resource:this.gpu.noiseSampler},{binding:9,resource:this.gpu.environmentView},{binding:10,resource:this.gpu.localProbeView},{binding:11,resource:this.gpu.dynamicShadow.createView()},{binding:12,resource:this.opaqueScene.createView()}]});
    this.opaqueBind=this.device.createBindGroup({layout:this.gpu.blit.getBindGroupLayout(0),entries:[{binding:0,resource:this.opaqueScene.createView()},{binding:1,resource:this.gpu.sampler}]});
    this.effectsBind=this.device.createBindGroup({layout:this.gpu.effects.getBindGroupLayout(0),entries:[{binding:0,resource:this.hdr.createView()},{binding:1,resource:this.normal.createView()},{binding:2,resource:this.depth.createView()},{binding:3,resource:this.gpu.sampler},{binding:4,resource:{buffer:this.gpu.frame}},{binding:5,resource:this.specular.createView()},{binding:6,resource:this.bloomA.createView()}]});
    const taaBind=(history:GPUAny)=>this.device.createBindGroup({layout:this.gpu.taa.getBindGroupLayout(0),entries:[{binding:0,resource:this.effectsHdr.createView()},{binding:1,resource:history.createView()},{binding:2,resource:this.velocity.createView()},{binding:3,resource:this.depth.createView()},{binding:4,resource:this.gpu.sampler},{binding:5,resource:{buffer:this.gpu.taaParams}}]});
    this.taaBindAB=taaBind(this.taaA);this.taaBindBA=taaBind(this.taaB);
    const presentBind=(source:GPUAny)=>this.device.createBindGroup({layout:this.gpu.present.getBindGroupLayout(0),entries:[{binding:0,resource:source.createView()},{binding:1,resource:this.gpu.sampler},{binding:2,resource:{buffer:this.gpu.frame}}]});
    this.presentBindA=presentBind(this.taaA);this.presentBindB=presentBind(this.taaB);this.historyValid=false;this.taaHistoryIndex=0;this.previousVp=null;this.previousCamera=null;this.previousTarget=null;
  }
  render(scene:Scene,camera:CameraSpec=scene.camera):void{
    const frameId=this.profiler.beginFrame();
    const appearanceChanged=this.appearanceScene!==scene||this.appearanceRevision!==scene.appearanceRevision;
    if(appearanceChanged){
      this.appearanceScene=scene;this.appearanceRevision=scene.appearanceRevision;
      // Material/exposure hypotheses only require uniform refresh and fresh TAA.
      // Keep geometry, shadow maps, environment cubemaps, probes and culling hot.
      for(const object of this.objects.values())object.uniformReady=false;
      this.historyValid=false;
    }
    const structureChanged=this.profiler.measure('lifecycle',()=>this.collect(scene));
    this.profiler.measure('resize',()=>this.resize());
    this.lastScene=scene;
    const reflectionProbe=resolveReflectionProbe(scene);
    if(!reflectionProbe){this.localProbeMask=0;this.localProbeKey='';this.localProbeCause='';this.localProbePosition=null;this.localProbeBounds=null;}
    else{
      const settings=scene.spec.rendering??{},probeCause=[reflectionProbe.key,...reflectionProbe.position,scene.renderStructureRevision,scene.appearanceRevision,...(settings.sunDirection??[-.55,.48,-.35]),settings.sunIntensity??scene.environment.sunlight*3,...(settings.sunColor??[1,.87,.72]),...(settings.skyColor??[.26,.34,.47])].join(':');
      const reset=this.localProbeCause!==probeCause;
      if(reset){this.localProbeMask=0;this.localProbeFace=0;this.localProbeCause=probeCause;}
      this.localProbeKey=reflectionProbe.key;this.localProbePosition=[...reflectionProbe.position];this.localProbeBounds={min:[reflectionProbe.position[0]-reflectionProbe.boxHalfExtents[0],reflectionProbe.position[1]-reflectionProbe.boxHalfExtents[1],reflectionProbe.position[2]-reflectionProbe.boxHalfExtents[2]],max:[reflectionProbe.position[0]+reflectionProbe.boxHalfExtents[0],reflectionProbe.position[1]+reflectionProbe.boxHalfExtents[1],reflectionProbe.position[2]+reflectionProbe.boxHalfExtents[2]]};
    }
    // The sixth face enables local radiance on the following frame. Invalidate
    // TAA at that boundary so an incomplete-probe image cannot linger in glass
    // and clearcoat for several frames. The same rule covers moving probe resets.
    const probeComplete=!!reflectionProbe&&this.localProbeMask===63;
    if(probeComplete!==this.probeComplete)this.historyValid=false;
    this.probeComplete=probeComplete;
    this.profiler.measure('materials',()=>{if(structureChanged)this.queueMaterialLoads(scene);});
    this.lastCamera=camera.position;this.lastLights=[...scene.entities.values()].filter(e=>e.light);
    const currentLightGridKey=lightGridCauseKey(this.lastLights,camera.position);
    const lightGrid=this.profiler.measure('lights',()=>{
      if(currentLightGridKey===this.lightGridKey)return undefined;
      this.lightGridKey=currentLightGridKey;
      if(!this.lastLights.length){this.pointLights=0;this.lightOverflow=0;return undefined;}
      const grid=buildLightGrid(this.lastLights,camera.position);this.pointLights=grid.count;this.lightOverflow=grid.overflow;
      this.device.queue.writeBuffer(this.gpu.lightBuffer,0,grid.lights);this.device.queue.writeBuffer(this.gpu.cellBuffer,0,grid.cells);
      this.profiler.addUpload(grid.lights.byteLength+grid.cells.byteLength,'light');return grid;
    });
    void lightGrid;
    this.profiler.measure('environment',()=>this.updateEnvironmentMap(scene,reflectionProbe?.position??scene.camera.target,!!reflectionProbe));
    const frameState=this.profiler.measure('frame',()=>{
      const cameraUp=camera.up??[0,1,0],cameraView=lookAt(camera.position,camera.target,cameraUp),projectionInfo=cameraProjection(camera,this.canvas.width,this.canvas.height),baseProjection=projectionInfo.matrix,cullVP=multiply4(baseProjection,cameraView),jitter=taaJitter(frameId),projection=new Float32Array(baseProjection);
      projection[8]=projection[8]!-2*jitter[0]/this.canvas.width;projection[9]=projection[9]!+2*jitter[1]/this.canvas.height;
      const vp=multiply4(projection,cameraView);
      const settings=scene.spec.rendering??{},sun=V3.normalize(settings.sunDirection??[-.55,.48,-.35]),target:Vec3=[camera.target[0],4,camera.target[2]],extent=settings.shadowExtent??65;
      const lightVP=multiply4(orthographic(extent,1,400),lookAt(V3.add(target,V3.scale(sun,180)),target));
      lightVP[12]=Math.round(lightVP[12]!*SHADOW_MAP_SIZE)/SHADOW_MAP_SIZE;lightVP[13]=Math.round(lightVP[13]!*SHADOW_MAP_SIZE)/SHADOW_MAP_SIZE;
      const forward=V3.normalize(V3.sub(camera.target,camera.position)),right=V3.normalize(V3.cross(forward,cameraUp)),up=V3.normalize(V3.cross(right,forward)),frame=new Float32Array(152);
      const reflectionVP=multiply4(baseProjection,lookAt([camera.position[0],.03-camera.position[1],camera.position[2]],[camera.target[0],.03-camera.target[1],camera.target[2]],[cameraUp[0],-cameraUp[1],cameraUp[2]]));
      frame.set(lightVP);frame.set([...sun,settings.sunIntensity??scene.environment.sunlight*3],16);frame.set([...(settings.sunColor??[1,.87,.72]),settings.exposure??1],20);
      const [projectionX,projectionY,projectionOffsetX,projectionOffsetY]=projectionInfo.ray,tanY=1/projectionY,aspectLike=projectionY/projectionX;
      frame.set([...(settings.skyColor??[.26,.34,.47]),settings.fogDensity??.0025],24);frame.set([...camera.position,0],28);frame.set([...forward,tanY],32);frame.set([...right,aspectLike],36);frame.set([...up,scene.time],40);frame.set([this.pointLights>0?1:0,reflectionProbe&&this.localProbeMask===63?1:0,camera.focusDistance??20,camera.aperture??0],44);
      frame.set(reflectionVP,48);
      frame.set(vp,64);frame.set(this.previousVp??vp,80);frame.set([scene.environment.temperatureC,scene.environment.sunlight,scene.environment.hour/24,scene.environment.humidity],96);frame.set([projectionX,projectionY,projectionOffsetX,projectionOffsetY],100);frame.set(this.environmentIrradiance,104);if(this.localProbePosition&&this.localProbeBounds){frame.set([...this.localProbePosition,1],140);frame.set([...this.localProbeBounds.min,1],144);frame.set([...this.localProbeBounds.max,1],148);}else{frame.fill(0,140,152);}
      this.device.queue.writeBuffer(this.gpu.frame,0,frame);this.profiler.addUpload(frame.byteLength,'frame');
      return{vp,cullVP,reflectionVP,settings,lightVP,right,up,frame};
    });
    const {vp,cullVP,reflectionVP,lightVP,right,up,frame}=frameState;
    const classified=this.profiler.measure('visibility',()=>({visible:this.collectedVisible,opaque:this.collectedOpaque,transparent:this.collectedTransparent}));
    this.profiler.setWork({entities:scene.entities.size,visible:classified.visible.length,opaque:classified.opaque.length,transparent:classified.transparent.length});
    if(this.previousVp&&((scene.time+1e-6<this.lastRenderTime)||(this.previousCamera&&distance2(this.previousCamera,camera.position)>9)||(this.previousTarget&&distance2(this.previousTarget,camera.target)>25)))this.historyValid=false;
    const frameModels=this.frameModels;frameModels.clear();
    const modelFor=(entity:RuntimeEntity):Mat4=>{let model=frameModels.get(entity.id);if(!model){model=this.model(entity);frameModels.set(entity.id,model);}return model;};
    const renderMoverIds=scene.renderMoverIds();
    const culled=this.profiler.measure('cull',()=>{
      const viewsChanged=!matrixEqual(this.cullCameraVP??undefined,cullVP)||!matrixEqual(this.cullLightVP??undefined,lightVP)||!matrixEqual(this.cullReflectionVP??undefined,reflectionVP);
      if(viewsChanged){
        this.cullCache.clear();
        this.cullCameraVP=new Float32Array(cullVP);this.cullLightVP=new Float32Array(lightVP);this.cullReflectionVP=new Float32Array(reflectionVP);
      }
      const visibilityFor=(entity:RuntimeEntity)=>{
        const primitive=renderPrimitive(entity)!,model=modelFor(entity),cached=this.cullCache.get(entity.id);
        if(cached&&cached.primitive===primitive&&cached.model===model)return cached;
        const test=(matrix:Mat4)=>{multiply4Into(matrix,model,this.cullScratch);return intersectsClip(this.mesh(primitive).bounds,this.cullScratch);};
        const value={primitive,model,camera:test(cullVP),shadow:test(lightVP),reflection:entity.material.kind!=='snow'&&entity.material.kind!=='asphalt'&&test(reflectionVP)};
        this.cullCache.set(entity.id,value);return value;
      };
      const staticDirty=viewsChanged||this.staticCullRevision!==scene.renderStructureRevision;
      if(staticDirty){
        const cameraOpaque:RuntimeEntity[]=[],cameraTransparent:RuntimeEntity[]=[],shadowCasters:RuntimeEntity[]=[],reflectedObjects:RuntimeEntity[]=[];
        for(const entity of classified.visible){
          if(renderMoverIds.has(entity.id))continue;
          const visible=visibilityFor(entity),opaque=entity.material.color[3]>=.98;
          if(visible.camera)(opaque?cameraOpaque:cameraTransparent).push(entity);
          if(opaque&&visible.shadow)shadowCasters.push(entity);
          if(opaque&&visible.reflection)reflectedObjects.push(entity);
        }
        this.staticCameraOpaque=cameraOpaque;this.staticCameraTransparent=cameraTransparent;this.staticShadowCasters=shadowCasters;this.staticReflectedObjects=reflectedObjects;
        this.staticCullRevision=scene.renderStructureRevision;
      }
      const cameraOpaque=[...this.staticCameraOpaque],cameraTransparent=[...this.staticCameraTransparent],shadowCasters=[...this.staticShadowCasters],reflectedObjects=[...this.staticReflectedObjects];
      for(const id of renderMoverIds){
        const entity=scene.entities.get(id);if(!entity||!renderPrimitive(entity))continue;
        const visible=visibilityFor(entity),opaque=entity.material.color[3]>=.98;
        if(visible.camera)(opaque?cameraOpaque:cameraTransparent).push(entity);
        if(opaque&&visible.shadow)shadowCasters.push(entity);
        if(opaque&&visible.reflection)reflectedObjects.push(entity);
      }
      cameraOpaque.sort((a,b)=>distance2(a.position,camera.position)-distance2(b.position,camera.position));
      cameraTransparent.sort((a,b)=>distance2(b.position,camera.position)-distance2(a.position,camera.position));
      return{cameraOpaque,cameraTransparent,shadowCasters,reflectedObjects};
    });
    const shadowDrawables=culled.shadowCasters.filter(e=>!(e.material.emissive&&Math.max(...e.material.emissive)>1));
    const staticShadowDrawables=shadowDrawables.filter(entity=>isStaticShadowCaster(entity,renderMoverIds));
    const dynamicShadowDrawables=shadowDrawables.filter(entity=>!isStaticShadowCaster(entity,renderMoverIds));
    if(dynamicShadowDrawables.length){
      frame[31]=1;
      const dynamicShadowFlag=new Float32Array([1]);
      this.device.queue.writeBuffer(this.gpu.frame,31*4,dynamicShadowFlag);
      this.profiler.addUpload(dynamicShadowFlag.byteLength,'frame');
    }
    const shadowDirty=!this.shadowValid||!matrixEqual(this.shadowLightVP??undefined,lightVP)||staticShadowDrawables.length!==this.shadowState.size||staticShadowDrawables.some(entity=>{
      const previous=this.shadowState.get(entity.id),primitive=renderPrimitive(entity)!;
      return !previous||previous.primitive!==primitive||!matrixEqual(previous.model,modelFor(entity));
    });
    const probeFaces:{face:number;vp:Mat4;entities:RuntimeEntity[]}[]=[];
    if(reflectionProbe&&this.localProbeMask!==63){
      const radius2=(reflectionProbe.radius+12)**2,candidates=classified.opaque.filter(e=>!reflectionProbe.exclude.has(e.id)&&distance2(e.position,reflectionProbe.position)<=radius2);
      for(let index=0;index<reflectionProbe.facesPerFrame;index++){
        const face=(this.localProbeFace+index)%6,faceVp=probeVP(reflectionProbe.position,face,reflectionProbe.radius);
        const entities=candidates.filter(entity=>{multiply4Into(faceVp,modelFor(entity),this.cullScratch);return intersectsClip(this.mesh(renderPrimitive(entity)!).bounds,this.cullScratch);});
        probeFaces.push({face,vp:faceVp,entities});
        const data=probeUniform(scene,reflectionProbe.position,faceVp);this.device.queue.writeBuffer(this.gpu.probeFrames[face],0,data);this.profiler.addUpload(data.byteLength,'frame');
      }
    }
    const prepared=new Map<string,RuntimeEntity>();
    for(const entity of [...culled.cameraOpaque,...culled.cameraTransparent,...(shadowDirty?staticShadowDrawables:[]),...dynamicShadowDrawables,...culled.reflectedObjects,...probeFaces.flatMap(face=>face.entities)])prepared.set(entity.id,entity);
    this.profiler.measure('prepare',()=>{for(const entity of prepared.values()){const model=modelFor(entity);if(this.needsPrepare(entity,model))this.prepare(entity,model);}});
    this.profiler.setWork({cameraOpaque:culled.cameraOpaque.length,cameraTransparent:culled.cameraTransparent.length,shadowCasters:shadowDrawables.length,reflected:culled.reflectedObjects.length,shadowBatchedInstances:0});
    const encoder=this.device.createCommandEncoder({label:`render frame ${frameId}`});
    this.profiler.measure('encode.shadow',()=>{
      if(shadowDirty){
        const timing=this.profiler.timestampWrites('shadow');
        const staticPass=encoder.beginRenderPass({label:'render.shadow.static',...(timing?{timestampWrites:timing}:{}),colorAttachments:[],depthStencilAttachment:{view:this.gpu.shadow.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});
        staticPass.setBindGroup(1,this.gpu.frameBind);
        for(const [culled,group] of partitionByCull(staticShadowDrawables)){
          staticPass.setPipeline(culled?this.gpu.shadowCulled:this.gpu.shadowDouble);
          for(const entity of group)this.draw(staticPass,entity,false,false);
        }
        staticPass.end();
      }
      const timing=shadowDirty?undefined:this.profiler.timestampWrites('shadow'),occlusion=this.profiler.occlusionSet();
      const dynamicPass=encoder.beginRenderPass({label:'render.shadow.dynamic',...(timing?{timestampWrites:timing}:{}),...(occlusion?{occlusionQuerySet:occlusion}:{}),colorAttachments:[],depthStencilAttachment:{view:this.gpu.dynamicShadow.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});
      dynamicPass.setBindGroup(1,this.gpu.frameBind);const query=this.profiler.beginOcclusion(dynamicPass,'shadow');
      for(const [culled,group] of partitionByCull(dynamicShadowDrawables)){
        dynamicPass.setPipeline(culled?this.gpu.shadowCulled:this.gpu.shadowDouble);
        for(const entity of group)this.draw(dynamicPass,entity,false,false);
      }
      this.profiler.endOcclusion(dynamicPass,query);dynamicPass.end();
    });
    this.profiler.measure('encode.probe',()=>{
      const settings=scene.spec.rendering??{},sky=settings.skyColor??[.26,.34,.47];
      for(let index=0;index<probeFaces.length;index++){
        const capture=probeFaces[index]!,timing=index===0?this.profiler.timestampWrites('probe'):undefined;
        const view=this.gpu.localProbeMap.createView({dimension:'2d',baseArrayLayer:capture.face,arrayLayerCount:1,baseMipLevel:0,mipLevelCount:1});
        const pass=encoder.beginRenderPass({label:`render.probe.${capture.face}`,...(timing?{timestampWrites:timing}:{}),colorAttachments:[{view,clearValue:{r:sky[0]*1.05,g:sky[1]*1.05,b:sky[2]*1.05,a:1},loadOp:'clear',storeOp:'store'}],depthStencilAttachment:{view:this.gpu.localProbeDepth.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'discard'}});
        pass.setBindGroup(1,this.gpu.probeFrameBinds[capture.face]);
        for(const [culled,group] of partitionByCull(capture.entities)){pass.setPipeline(culled?this.gpu.probeCulled:this.gpu.probeDouble);for(const entity of group)this.draw(pass,entity,false);}
        pass.end();
      }
    });
    if(probeFaces.length){for(const capture of probeFaces)this.localProbeMask|=1<<capture.face;this.localProbeFace=(probeFaces.at(-1)!.face+1)%6;}
    // Refilter after a complete capture cycle, never per material or slider value.
    // Source view is level 0 only; attachment views are disjoint roughness levels.
    if(probeFaces.length&&this.localProbeMask===63&&(!this.probeComplete||this.localProbeFace===0)){
      this.profiler.measure('encode.probe',()=>{
        for(const {view,bind} of this.gpu.probeFilterPasses){
          const pass=encoder.beginRenderPass({label:'render.probe.filter',colorAttachments:[{view,loadOp:'clear',clearValue:{r:0,g:0,b:0,a:1},storeOp:'store'}]});
          pass.setPipeline(this.gpu.probeFilter);pass.setBindGroup(0,bind);pass.draw(3);pass.end();
        }
      });
    }
    this.profiler.measure('encode.reflection',()=>{
      const timing=this.profiler.timestampWrites('reflection'),occlusion=this.profiler.occlusionSet(),reflect=encoder.beginRenderPass({label:'render.reflection',...(timing?{timestampWrites:timing}:{}),...(occlusion?{occlusionQuerySet:occlusion}:{}),colorAttachments:[{view:this.reflection.createView(),clearValue:{r:frame[24]!*1.2,g:frame[25]!*1.2,b:frame[26]!*1.2,a:1},loadOp:'clear',storeOp:'store'}],depthStencilAttachment:{view:this.reflectionDepth.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'discard'}});
      reflect.setBindGroup(1,this.gpu.reflectionBind);const query=this.profiler.beginOcclusion(reflect,'reflection');
      for(const [key,group] of materialPipelineGroups(culled.reflectedObjects)){const [code,culled]=key;reflect.setPipeline((culled?this.gpu.reflectedCulled:this.gpu.reflectedDouble).get(code)!);for(const e of group)this.draw(reflect,e,false);}
      this.profiler.endOcclusion(reflect,query);reflect.end();
    });
    let snowInstances=0;
    this.profiler.measure('encode.main',()=>{
      const timing=this.profiler.timestampWrites('main'),occlusion=this.profiler.occlusionSet(),pass=encoder.beginRenderPass({label:'render.main.opaque',...(timing?{timestampWrites:timing}:{}),...(occlusion?{occlusionQuerySet:occlusion}:{}),colorAttachments:[{view:this.opaqueScene.createView(),clearValue:{r:0,g:0,b:0,a:1},loadOp:'clear',storeOp:'store'},{view:this.normal.createView(),clearValue:{r:.5,g:.5,b:1,a:1},loadOp:'clear',storeOp:'store'},{view:this.specular.createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'},{view:this.velocity.createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}],depthStencilAttachment:{view:this.depth.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});
      pass.setPipeline(this.gpu.sky);pass.setBindGroup(0,this.gpu.frameBind);pass.draw(3);
      this.drawCalls=0;this.triangles=0;pass.setBindGroup(1,this.gpu.lightBind);const query=this.profiler.beginOcclusion(pass,'mainOpaque');
      for(const [key,group] of materialPipelineGroups(culled.cameraOpaque)){const [code,culled]=key;pass.setPipeline((culled?this.gpu.opaqueCulled:this.gpu.opaqueDouble).get(code)!);for(const e of group)this.draw(pass,e,true);}
      this.profiler.endOcclusion(pass,query);pass.end();
    });
    this.profiler.measure('encode.main',()=>{
      const timing=this.profiler.timestampWrites('main.transparent'),occlusion=this.profiler.occlusionSet(),pass=encoder.beginRenderPass({label:'render.main.transparent',...(timing?{timestampWrites:timing}:{}),...(occlusion?{occlusionQuerySet:occlusion}:{}),colorAttachments:[{view:this.hdr.createView(),clearValue:{r:0,g:0,b:0,a:1},loadOp:'clear',storeOp:'store'},{view:this.normal.createView(),loadOp:'load',storeOp:'store'},{view:this.specular.createView(),loadOp:'load',storeOp:'store'},{view:this.velocity.createView(),loadOp:'load',storeOp:'store'}],depthStencilAttachment:{view:this.depth.createView(),depthLoadOp:'load',depthStoreOp:'store'}});
      pass.setPipeline(this.gpu.blit);pass.setBindGroup(0,this.opaqueBind);pass.draw(3);
      pass.setBindGroup(1,this.gpu.transparentLightBind);let query=this.profiler.beginOcclusion(pass,'mainTransparent');
      pass.setPipeline(this.gpu.glass);for(const e of culled.cameraTransparent)if(e.material.kind==='glass')this.draw(pass,e,true);
      pass.setPipeline(this.gpu.transparent);for(const e of culled.cameraTransparent)if(e.material.kind!=='glass')this.draw(pass,e,true);
      this.profiler.endOcclusion(pass,query);
      const intensity=Math.min(1,scene.environment.snowfallRate/2.2e-5);query=this.profiler.beginOcclusion(pass,'snow');
      if(intensity>.001){const snow=new Float32Array(32);snow.set(vp);snow.set([...camera.position,1],16);snow.set([scene.time,intensity,scene.environment.wind[0],scene.environment.wind[2]],20);snow.set([...right,0],24);snow.set([...up,0],28);this.device.queue.writeBuffer(this.gpu.snowUniform,0,snow);this.profiler.addUpload(snow.byteLength,'snow');pass.setPipeline(this.gpu.snow);pass.setBindGroup(0,this.gpu.snowBind);pass.setBindGroup(1,this.gpu.transparentLightBind);snowInstances=Math.round(24000*intensity);pass.draw(6,snowInstances);}this.profiler.endOcclusion(pass,query);pass.end();
    });
    this.profiler.measure('encode.bloom',()=>{
      const stages=[['bloom.downsample',this.bloomA,this.gpu.bloomDown,this.bloomDownBind],['bloom.horizontal',this.bloomB,this.gpu.bloomHorizontal,this.bloomHorizontalBind],['bloom.vertical',this.bloomA,this.gpu.bloomVertical,this.bloomVerticalBind]] as const;
      for(const [name,target,pipeline,bind] of stages){const timing=this.profiler.timestampWrites(name),bloomPass=encoder.beginRenderPass({label:`render.${name}`,...(timing?{timestampWrites:timing}:{}),colorAttachments:[{view:target.createView(),loadOp:'clear',clearValue:{r:0,g:0,b:0,a:1},storeOp:'store'}]});bloomPass.setPipeline(pipeline);bloomPass.setBindGroup(0,bind);bloomPass.draw(3);bloomPass.end();}
    });
    this.profiler.measure('encode.effects',()=>{
      const timing=this.profiler.timestampWrites('effects'),effectsPass=encoder.beginRenderPass({label:'render.effects',...(timing?{timestampWrites:timing}:{}),colorAttachments:[{view:this.effectsHdr.createView(),loadOp:'clear',clearValue:{r:0,g:0,b:0,a:1},storeOp:'store'}]});
      effectsPass.setPipeline(this.gpu.effects);effectsPass.setBindGroup(0,this.effectsBind);effectsPass.draw(3);effectsPass.end();
    });
    const taaOutputIndex=this.taaHistoryIndex===0?1:0;
    this.device.queue.writeBuffer(this.gpu.taaParams,0,new Float32Array([this.historyValid?1:0,0,0,0]));
    this.profiler.measure('encode.taa',()=>{
      const timing=this.profiler.timestampWrites('taa'),target=taaOutputIndex===0?this.taaA:this.taaB,taaPass=encoder.beginRenderPass({label:'render.taa',...(timing?{timestampWrites:timing}:{}),colorAttachments:[{view:target.createView(),loadOp:'clear',clearValue:{r:0,g:0,b:0,a:1},storeOp:'store'}]});
      taaPass.setPipeline(this.gpu.taa);taaPass.setBindGroup(0,this.taaHistoryIndex===0?this.taaBindAB:this.taaBindBA);taaPass.draw(3);taaPass.end();
    });
    this.profiler.measure('encode.present',()=>{
      const timing=this.profiler.timestampWrites('present'),present=encoder.beginRenderPass({label:'render.present',...(timing?{timestampWrites:timing}:{}),colorAttachments:[{view:this.context.getCurrentTexture().createView(),loadOp:'clear',clearValue:{r:0,g:0,b:0,a:1},storeOp:'store'}]});present.setPipeline(this.gpu.present);present.setBindGroup(0,taaOutputIndex===0?this.presentBindA:this.presentBindB);present.draw(3);present.end();
    });
    this.profiler.setWork({drawCalls:this.drawCalls,triangles:this.triangles,snowInstances});
    if(this.profiler.enabled){
      const sumTriangles=(entities:readonly RuntimeEntity[])=>entities.reduce((sum,e)=>sum+this.mesh(renderPrimitive(e)!).triangles,0);
      const materialDraws:Record<string,number>={},materialTriangles:Record<string,number>={};
      for(const e of [...culled.cameraOpaque,...culled.cameraTransparent]){const kind=e.material.kind,triangles=this.mesh(renderPrimitive(e)!).triangles;materialDraws[kind]=(materialDraws[kind]??0)+1;materialTriangles[kind]=(materialTriangles[kind]??0)+triangles;}
      const work=this.profiler.currentWork();
      this.profiler.setAtoms(buildRenderAtomReport({
        width:this.canvas.width,height:this.canvas.height,shadowMapSize:SHADOW_MAP_SIZE,shadowDraws:(shadowDirty?staticShadowDrawables.length:0)+dynamicShadowDrawables.length,reflectionDraws:culled.reflectedObjects.length,shadowBatchedInstances:0,shadowBatchedDraws:0,
        mainOpaqueDraws:culled.cameraOpaque.length,mainTransparentDraws:culled.cameraTransparent.length,snowInstances,
        shadowTriangles:(shadowDirty?sumTriangles(staticShadowDrawables):0)+sumTriangles(dynamicShadowDrawables),reflectionTriangles:sumTriangles(culled.reflectedObjects),
        mainOpaqueTriangles:sumTriangles(culled.cameraOpaque),mainTransparentTriangles:sumTriangles(culled.cameraTransparent),
        materialDraws,materialTriangles,
        uploads:{total:work.uploadBytes,uniform:work.uniformUploadBytes,surface:work.surfaceUploadBytes,light:work.lightUploadBytes,frame:work.frameUploadBytes,snow:work.snowUploadBytes,environment:work.environmentUploadBytes,instance:work.instanceUploadBytes},
        shaders:this.shaderAtoms,
      }));
    }
    this.profiler.resolve(encoder);
    this.profiler.measure('submit',()=>this.device.queue.submit([encoder.finish()]));this.profiler.submitted();
    if(shadowDirty){
      this.shadowValid=true;this.shadowLightVP=new Float32Array(lightVP);this.shadowState.clear();
      for(const entity of staticShadowDrawables)this.shadowState.set(entity.id,{primitive:renderPrimitive(entity)!,model:new Float32Array(modelFor(entity))});
    }
    this.taaHistoryIndex=taaOutputIndex;this.historyValid=true;this.previousVp=vp;this.previousCamera=[...camera.position];this.previousTarget=[...camera.target];this.lastRenderTime=scene.time;this.lastCamera=[...camera.position];
    this.previousModels.clear();for(const entity of prepared.values())this.previousModels.set(entity.id,modelFor(entity));
  }
  private queueMaterialLoads(scene:Scene):void{
    if(this.disposed)return;
    const urls=new Set([...scene.entities.values()].flatMap(e=>{const t=e.material.texture;return t?[t.url,t.normalUrl,t.ormUrl].filter((url):url is string=>!!url):[];}));
    for(const url of this.failedMaterials)if(!urls.has(url))this.failedMaterials.delete(url);
    for(const url of urls){
      if(this.surfaceTextures.get(url)||this.materialLoads.has(url)||this.failedMaterials.has(url))continue;
      const pending=this.surfaceTextures.load(url).catch(error=>{
        if(!this.disposed&&!this.failedMaterials.has(url)&&[...this.lastScene?.entities.values()??[]].some(e=>{const t=e.material.texture;return t&&(t.url===url||t.normalUrl===url||t.ormUrl===url);})){
          this.failedMaterials.add(url);this.errors.push(error instanceof Error?error.message:String(error));
        }
      }).finally(()=>{if(this.materialLoads.get(url)===pending)this.materialLoads.delete(url);});
      this.materialLoads.set(url,pending);
    }
  }
  async prepareMaterials(scene:Scene):Promise<void>{const urls=new Set([...scene.entities.values()].flatMap(e=>{const t=e.material.texture;return t?[t.url,t.normalUrl,t.ormUrl].filter((url):url is string=>!!url):[];}));await Promise.all([...urls].map(async url=>{await this.surfaceTextures.load(url);this.failedMaterials.delete(url);}));}
  async sampleLinearPixels(points:readonly (readonly [number,number])[],stage:import('./types.js').LinearPixelStage='hdr'):Promise<readonly import('./types.js').LinearPixelSample[]>{
    const source=stage==='hdr'?this.hdr:stage==='reflection'?this.reflection:stage==='effects'?this.effectsHdr:(this.taaHistoryIndex===0?this.taaA:this.taaB);
    if(!source)throw new Error(`Linear ${stage} target unavailable`);
    if(points.length>512)throw new RangeError('At most 512 linear pixel samples per readback');
    if(!points.length)return[];
    const sourceW=stage==='reflection'?Math.max(1,Math.floor(this.depthW/2)):this.depthW;
    const sourceH=stage==='reflection'?Math.max(1,Math.floor(this.depthH/2)):this.depthH;
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
  async flush():Promise<void>{await this.device.queue.onSubmittedWorkDone();}
  inspect():RenderStats{
    const validFaces=[0,1,2,3,4,5].reduce((count,face)=>count+((this.localProbeMask>>face)&1),0);
    return{backend:'webgpu',width:this.canvas.width,height:this.canvas.height,drawCalls:this.drawCalls,triangles:this.triangles,meshes:this.meshes.size,objects:this.objects.size,pointLights:this.pointLights,lightOverflow:this.lightOverflow,materialTextures:this.surfaceTextures.size,buffers:this.meshes.size*3+this.objects.size+this.shadowBatches.size+10+this.gpu.probeFilterPasses.length,textures:[...this.objects.values()].filter(o=>o.owned).length+this.labels.size+this.surfaceTextures.size+17,errors:[...this.errors],
      ...(this.profiler.enabled?{environmentCache:{updates:this.environmentUpdates,invalidations:Object.fromEntries(this.environmentInvalidations)}}:{}),
      ...(this.localProbeKey?{reflectionProbe:{validFaces,complete:this.localProbeMask===63,nextFace:this.localProbeFace,...(this.localProbePosition?{position:[...this.localProbePosition] as [number,number,number]}:{})}}:{}),profile:this.profiler.inspect()};
  }
  profile(){return this.profiler.inspect();}
  resetProfile():void{this.profiler.reset();}
  dispose():void{if(this.disposed)return;this.disposed=true;this.profiler?.dispose();this.materialLoads.clear();this.failedMaterials.clear();this.surfaceTextures.dispose();for(const m of this.meshes.values()){m.vertex.destroy();m.color.destroy();m.index.destroy();}for(const o of this.objects.values()){o.uniform.destroy();if(o.owned!==false)o.texture.destroy();}for(const batch of this.shadowBatches?.values?.()??[])batch.buffer.destroy();for(const target of [this.depth,this.hdr,this.opaqueScene,this.normal,this.specular,this.velocity,this.effectsHdr,this.taaA,this.taaB,this.bloomA,this.bloomB,this.gpu.taaParams,this.gpu.lightBuffer,this.gpu.cellBuffer,this.gpu.shadow,this.gpu.dynamicShadow,this.gpu.frame,this.gpu.snowUniform,this.gpu.emptyField,this.gpu.emptyLabel,this.gpu.noiseVolume,this.gpu.environmentMap,this.gpu.localProbeMap,this.gpu.localProbeDepth,...this.gpu.probeFrames,...this.gpu.probeFilterPasses.map((pass:{params:GPUAny})=>pass.params),this.reflection,this.reflectionDepth,...this.labels.values()])target?.destroy();this.labels.clear();this.meshes.clear();this.objects.clear();this.shadowBatches?.clear?.();}
  private updateEnvironmentMap(scene:Scene,origin:Vec3,localProbeOwnsNearby=false):void{
    const settings=scene.spec.rendering??{},sun=V3.normalize(settings.sunDirection??[-.55,.48,-.35]),sunColor=settings.sunColor??[1,.87,.72],sky=settings.skyColor??[.26,.34,.47],intensity=settings.sunIntensity??scene.environment.sunlight*3;
    if(this.environmentScene!==scene){this.environmentScene=scene;this.environmentKey='';}
    const measured=settings.environmentRadiance;
    if(measured){
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
    if(this.environmentIrradiance[3]!==0)this.environmentIrradiance.fill(0);
    // Check the authoritative causes before building the expensive scene-radiance proxy.
    // Nearby dynamic detail is handled by SSR/local probes; the distant fallback only
    // needs rebuilding when its world-space origin, atmosphere or scene identity changes.
    const environmentOriginKey=localProbeOwnsNearby?[0,0,0]:[
      Math.round(origin[0]*2)/2,Math.round(origin[1]*2)/2,Math.round(origin[2]*2)/2,
    ];
    const causeKey=[
      scene.entities.size,scene.spec.seed??0,
      ...sun,...sunColor,...sky,
      ...environmentOriginKey,
      Math.round(intensity*20)/20,
      Math.round(scene.environment.sunlight*20)/20,
      Math.round(scene.environment.humidity*20)/20,
      Math.round(scene.environment.temperatureC*2)/2,
      Math.round(scene.environment.groundMoisture*20)/20,
      Math.round(scene.environment.snowfallRate*1e6)/1e6,
    ].map(value=>Number(value).toFixed(3)).join(':');
    if(causeKey===this.environmentKey)return;
    if(this.profiler.enabled&&this.environmentKey){
      const causes=['entities','seed','sun.x','sun.y','sun.z','sunColor.r','sunColor.g','sunColor.b','sky.r','sky.g','sky.b','origin.x','origin.y','origin.z','intensity','sunlight','humidity','temperature','moisture','snowfall'];
      const before=this.environmentKey.split(':'),after=causeKey.split(':');
      for(let index=0;index<causes.length;index++)if(before[index]!==after[index]){
        const cause=causes[index]!;
        this.environmentInvalidations.set(cause,(this.environmentInvalidations.get(cause)??0)+1);
      }
    }
    const radiance=buildSceneRadianceProbe(scene,origin,128);
    const urbanColor=radiance.background,groundColor=radiance.ground,probe=radiance.origin;
    const proxies=radiance.proxies.map(proxy=>({dir:proxy.direction,color:proxy.color,threshold:proxy.threshold,strength:proxy.strength}));
    this.environmentKey=causeKey;this.environmentUpdates++;
    const levels=9;
    for(let mip=0;mip<levels;mip++){
      const size=Math.max(1,256>>mip),roughness=mip/(levels-1),pixels=new Uint16Array(size*size*6*4);let offset=0;
      const tiles=roughness<.74?buildDirectionalProxyTiles(proxies,size,cubeDirection):null;
      for(let face=0;face<6;face++)for(let y=0;y<size;y++)for(let x=0;x<size;x++){
        const u=((x+.5)/size)*2-1,v=((y+.5)/size)*2-1,dir=cubeDirection(face,u,v),up=Math.max(dir[1],0),down=Math.max(-dir[1],0);
        const horizon:[number,number,number]=[sky[0]*1.22,sky[1]*1.22,sky[2]*1.22],zenith:[number,number,number]=[sky[0]*.45,sky[1]*.45,sky[2]*.45],ground:[number,number,number]=[groundColor[0]*.62,groundColor[1]*.62,groundColor[2]*.62];
        const t=Math.sqrt(up);let base:[number,number,number]=down>0?[mix(horizon[0],ground[0],down),mix(horizon[1],ground[1],down),mix(horizon[2],ground[2],down)]:[mix(horizon[0],zenith[0],t),mix(horizon[1],zenith[1],t),mix(horizon[2],zenith[2],t)];
        const horizontal=Math.pow(Math.max(0,1-Math.abs(dir[1])),3)*(1-roughness*.72);
        const urbanMix=horizontal*.28;
        base=[mix(base[0],urbanColor[0]*.78,urbanMix),mix(base[1],urbanColor[1]*.78,urbanMix),mix(base[2],urbanColor[2]*.78,urbanMix)];
        if(roughness<.74){
          let pr=0,pg=0,pb=0,total=0;
          const candidates=tiles!.buckets[(face*tiles!.side+(y>>4))*tiles!.side+(x>>4)]!;
          for(const proxy of candidates){
            const alignment=V3.dot(dir,proxy.dir);if(alignment<=proxy.threshold)continue;
            const q=(alignment-proxy.threshold)/Math.max(1e-5,1-proxy.threshold),sharp=mix(5.5,1.2,roughness*roughness),weight=Math.pow(q,sharp)*proxy.strength*(1-roughness*.62);
            pr+=proxy.color[0]*weight;pg+=proxy.color[1]*weight;pb+=proxy.color[2]*weight;total+=weight;
          }
          if(total>.001){const amount=Math.min(.86,total/(.58+total));base=[mix(base[0],pr/total,amount),mix(base[1],pg/total,amount),mix(base[2],pb/total,amount)];}
        }
        const sunDot=Math.max(0,dir[0]*sun[0]+dir[1]*sun[1]+dir[2]*sun[2]),exponent=mix(900,2.4,roughness*roughness),sunLobe=Math.pow(sunDot,exponent)*intensity*mix(1.0,.12,roughness);
        const average:[number,number,number]=[mix(sky[0]*.62,urbanColor[0]*.55,.22),mix(sky[1]*.66,urbanColor[1]*.55,.22),mix(sky[2]*.72,urbanColor[2]*.55,.22)],blur=roughness*roughness*.68;
        for(let channel=0;channel<3;channel++)pixels[offset++]=float16(mix(base[channel]!+sunColor[channel]!*sunLobe,average[channel]!,blur));
        pixels[offset++]=float16(1);
      }
      const bytesPerRow=size*8,rowsPerImage=size;
      this.device.queue.writeTexture({texture:this.gpu.environmentMap,mipLevel:mip,origin:[0,0,0]},pixels,{bytesPerRow,rowsPerImage},[size,size,6]);this.profiler.addUpload(pixels.byteLength,'environment');
    }
  }

  private needsPrepare(entity:RuntimeEntity,model:Mat4):boolean{
    const scene=this.lastScene,field=scene?.surfaces.field?.(entity.id),surfaceState=scene?.surfaces.surface(entity.id),body=scene?.surfaces.body(entity.id);
    if(field||surfaceState||body)return true;
    const object=this.objects.get(entity.id);
    if(!object?.uniformReady)return true;
    const texture=entity.material.texture;
    const materialTexture=texture?.url?this.surfaceTextures.get(texture.url):undefined;
    const normalTexture=texture?.normalUrl?this.surfaceTextures.get(texture.normalUrl):undefined;
    const ormTexture=texture?.ormUrl?this.surfaceTextures.get(texture.ormUrl):undefined;
    const materialKey=texture?[materialTexture&&texture.url?texture.url:'',normalTexture?texture.normalUrl:'',ormTexture?texture.ormUrl:''].join('|'):undefined;
    if(object.width!==0||object.height!==0||object.label!==(entity.material.label??'')||object.materialKey!==materialKey)return true;
    const previousModel=this.previousModels.get(entity.id)??model;
    return !matrixEqual(object.lastModel,model)||!matrixEqual(object.lastPrevModel,previousModel);
  }
  private prepare(entity:RuntimeEntity,model:Mat4=this.model(entity)):void{
    const field=this.lastScene?.surfaces.field?.(entity.id),object=this.object(entity.id,field?.nx??0,field?.nz??0,entity.material.label??'',entity.material.texture);
    this.mesh(renderPrimitive(entity)!);
    const surfaceState=this.lastScene?.surfaces.surface(entity.id),surface=surfaceState??entity.material.surface,body=this.lastScene?.surfaces.body(entity.id),previousModel=this.previousModels.get(entity.id)??model;
    const dynamic=!!field||!!surfaceState||!!body,modelChanged=!matrixEqual(object.lastModel,model),previousChanged=!matrixEqual(object.lastPrevModel,previousModel);
    if(!dynamic&&object.uniformReady&&!modelChanged&&!previousChanged)return;
    const uniform=new Float32Array(84);
    uniform.set(model,0);uniform.set(previousModel,16);uniform.set(entity.material.color,32);uniform.set([surface.moss,surface.wetness,surface.roughness,surface.darkening],36);uniform.set([surface.dirt,surface.wear,stableSeed(entity.id),materialCode(entity.material.kind)],40);
    uniform.set([surfaceState?.snowDepthM??0,surfaceState?.waterDepthM??0,surfaceState?.slush??0,surfaceState?.iceDepthM??0],44);uniform.set([surfaceState?.puddle??0,surfaceState?.trackMelt??0,body?.snowCoverage??0,body?.rearSnow??0],48);uniform.set([body?.directionX??1,body?.directionZ??0,body?.roadDirt??0,body?.wetness??0],52);uniform.set([surfaceUseCode(entity.environmental?.surfaceUse),treatmentCode(entity.material.treatment),entity.material.clearcoat??-1,entity.material.clearcoatRoughness??-1],56);
    uniform.set(field?[...field.center,...field.size]:[0,0,1,1],60);uniform.set([field?.nx??1,field?.nz??1,field?1:0,0],64);
    uniform.set([entity.material.roughness??-1,entity.material.metalness??entity.material.profile.optical.metalness,entity.material.pattern==='brick'?1:entity.material.pattern==='plaster'?2:entity.material.pattern==='rubber'?3:entity.material.pattern==='window'?4:entity.material.pattern==='fabric'?5:0,entity.material.profile.optical.ior],68);uniform.set([...(entity.material.emissive??[0,0,0]),entity.material.profile.optical.transmission],72);
    const texture=entity.material.texture,normalReady=!!(texture?.normalUrl&&this.surfaceTextures.get(texture.normalUrl)),ormReady=!!(texture?.ormUrl&&this.surfaceTextures.get(texture.ormUrl));
    uniform.set([texture?.sizeM??1,texture?.bumpStrength??.5,texture?.albedoStrength??1,texture?.url&&this.surfaceTextures.get(texture.url)?1:0],76);
    uniform.set([texture?.normalStrength??1,normalReady?1:0,texture?.ormStrength??1,ormReady?1:0],80);
    if(field){const pixels=new Float32Array(object.width*object.height*4);field.cells.forEach((cell,i)=>pixels.set([cell.trackMelt,cell.snowDepthM,cell.waterDepthM,cell.slush],i*4));this.device.queue.writeTexture({texture:object.texture},pixels,{bytesPerRow:object.width*16},[object.width,object.height]);this.profiler.addUpload(pixels.byteLength,'surface');}
    this.device.queue.writeBuffer(object.uniform,0,uniform);this.profiler.addUpload(uniform.byteLength,'uniform');object.uniformReady=true;object.lastModel=new Float32Array(model);object.lastPrevModel=new Float32Array(previousModel);
  }
  private draw(pass:GPUAny,entity:RuntimeEntity,count:boolean,withColor=true):void{const mesh=this.mesh(renderPrimitive(entity)!),object=this.objects.get(entity.id)!;pass.setBindGroup(0,object.bind);pass.setVertexBuffer(0,mesh.vertex);if(withColor)pass.setVertexBuffer(1,mesh.color);pass.setIndexBuffer(mesh.index,mesh.format);pass.drawIndexed(mesh.count);if(count){this.drawCalls++;this.triangles+=mesh.triangles;}}
  private drawShadowBatch(pass:GPUAny,batch:ShadowBatchPlan):void{const first=batch.items[0]!,mesh=this.mesh(renderPrimitive(first)!),object=this.objects.get(first.id)!;pass.setBindGroup(0,object.bind);pass.setVertexBuffer(0,mesh.vertex);pass.setVertexBuffer(1,batch.buffer);pass.setIndexBuffer(mesh.index,mesh.format);pass.drawIndexed(mesh.count,batch.items.length);}
  private prepareShadowBatches(entities:readonly RuntimeEntity[],modelFor:(entity:RuntimeEntity)=>Mat4=(entity=>this.model(entity))):{singles:RuntimeEntity[];batches:ShadowBatchPlan[];instances:number}{
    const singles:RuntimeEntity[]=[],groups=new Map<string,{key:string;items:RuntimeEntity[];culled:boolean}>();
    for(const entity of entities){const key=shadowBatchKey(entity),culled=canCullBack(entity);let group=groups.get(key);if(!group){group={key,items:[],culled};groups.set(key,group);}group.items.push(entity);}
    const used=new Set<string>(),batches:ShadowBatchPlan[]=[];let instances=0;
    for(const group of groups.values()){
      if(group.items.length<4){singles.push(...group.items);continue;}
      used.add(group.key);let batch=this.shadowBatches.get(group.key),capacity=1;while(capacity<group.items.length)capacity<<=1;
      if(!batch||batch.capacity<group.items.length){batch?.buffer.destroy();batch={buffer:this.device.createBuffer({size:capacity*64,usage:0x20|0x08}),capacity};this.shadowBatches.set(group.key,batch);}
      const data=new Float32Array(group.items.length*16);group.items.forEach((entity,index)=>data.set(modelFor(entity),index*16));
      if(!floatArrayEqual(batch.data,data)){this.device.queue.writeBuffer(batch.buffer,0,data);this.profiler.addUpload(data.byteLength,'instance');batch.data=data;}
      instances+=group.items.length;batches.push({key:group.key,items:group.items,culled:group.culled,buffer:batch.buffer});
    }
    for(const [key,batch] of this.shadowBatches)if(!used.has(key)){batch.buffer.destroy();this.shadowBatches.delete(key);}
    return{singles,batches,instances};
  }
  private mesh(primitive:Primitive):GPUMesh{const byIdentity=this.meshByPrimitive.get(primitive as object);if(byIdentity)return byIdentity;const key=primitiveKey(primitive),found=this.meshes.get(key);if(found){this.meshByPrimitive.set(primitive as object,found);return found;}const data=primitiveMesh(primitive),mesh={bounds:meshBounds(data.vertices),vertex:this.buffer(data.vertices,0x20|0x08),color:this.buffer(data.colors,0x20|0x08),index:this.buffer(data.indices,0x10|0x08),count:data.indices.length,format:data.indexFormat,triangles:data.indices.length/3};this.meshes.set(key,mesh);this.meshByPrimitive.set(primitive as object,mesh);return mesh;}
  private buffer(data:ArrayBufferView,usage:number):GPUAny{const buffer=this.device.createBuffer({size:Math.max(4,(data.byteLength+3)&~3),usage,mappedAtCreation:true});new Uint8Array(buffer.getMappedRange()).set(new Uint8Array(data.buffer,data.byteOffset,data.byteLength));buffer.unmap();return buffer;}
  private collect(scene:Scene):boolean{
    if(this.collectedScene===scene&&this.collectedRevision===scene.renderStructureRevision)return false;
    const sceneChanged=this.collectedScene!==scene,revisionChanged=this.collectedRevision!==scene.renderStructureRevision;
    this.collectedScene=scene;this.collectedRevision=scene.renderStructureRevision;
    if(sceneChanged||revisionChanged){
      // Hot render-lab scene swaps deliberately retain GPU pipelines/mesh buffers,
      // but every scene-owned uniform/probe/culling cache must observe the new causes.
      for(const object of this.objects.values())object.uniformReady=false;
      this.localProbeMask=0;this.localProbeFace=0;this.localProbeKey='';this.localProbeCause='';this.localProbePosition=null;this.localProbeBounds=null;
      this.shadowValid=false;this.staticCullRevision=-1;this.cullCameraVP=null;this.cullLightVP=null;this.cullReflectionVP=null;
      this.historyValid=false;this.previousVp=null;this.previousCamera=null;this.previousTarget=null;
    }
    this.surfaceTextures?.retain(new Set([...scene.entities.values()].flatMap(e=>{const t=e.material?.texture;return t?[t.url,t.normalUrl,t.ormUrl].filter((url):url is string=>!!url):[];})));
    const live=[...scene.entities.values()].filter(e=>renderPrimitive(e)),ids=new Set(live.map(e=>e.id)),keys=new Set(live.map(e=>primitiveKey(renderPrimitive(e)!)));
    this.collectedVisible=live;this.collectedOpaque=live.filter(e=>e.material.color[3]>=.98);this.collectedTransparent=live.filter(e=>e.material.color[3]<.98);
    if(this.labels){const labels=new Set(live.map(e=>e.material?.label));for(const [key,t] of this.labels)if(!labels.has(key)){t.destroy();this.labels.delete(key);}}
    for(const [id,o] of this.objects)if(!ids.has(id)){o.uniform.destroy();if(o.owned!==false)o.texture.destroy();this.objects.delete(id);}
    for(const id of this.modelCache?.keys?.()??[])if(!ids.has(id)){this.modelCache.delete(id);this.cullCache.delete(id);}
    for(const [key,m] of this.meshes)if(!keys.has(key)){m.vertex.destroy();m.color.destroy();m.index.destroy();this.meshes.delete(key);}
    return true;
  }
  private label(text:string):GPUAny{
    if(!text)return this.gpu.emptyLabel;const cached=this.labels.get(text);if(cached)return cached;
    const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=128;const ctx=canvas.getContext('2d')!;ctx.clearRect(0,0,1024,128);ctx.fillStyle='#e2d9bc';ctx.font='58px Georgia';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,512,64,940);
    const texture=this.device.createTexture({size:[1024,128],format:'rgba8unorm',usage:0x04|0x02|0x10});this.device.queue.copyExternalImageToTexture({source:canvas},{texture},[1024,128]);this.labels.set(text,texture);return texture;
  }
  private object(id:string,width:number,height:number,label:string,textureSpec?:SurfaceTextureSpec):GPUObject{
    const materialTexture=textureSpec?.url?this.surfaceTextures.get(textureSpec.url):undefined;
    const normalTexture=textureSpec?.normalUrl?this.surfaceTextures.get(textureSpec.normalUrl):undefined;
    const ormTexture=textureSpec?.ormUrl?this.surfaceTextures.get(textureSpec.ormUrl):undefined;
    const materialKey=textureSpec?[materialTexture&&textureSpec.url?textureSpec.url:'',normalTexture?textureSpec.normalUrl:'',ormTexture?textureSpec.ormUrl:''].join('|'):undefined;
    const existing=this.objects.get(id);if(existing&&existing.width===width&&existing.height===height&&existing.label===label&&existing.materialKey===materialKey)return existing;
    if(existing){existing.uniform.destroy();if(existing.owned!==false)existing.texture.destroy();}
    const uniform=this.device.createBuffer({size:336,usage:0x40|0x08}),texture=width?this.device.createTexture({size:[width,height],format:'rgba32float',usage:0x04|0x02}):this.gpu.emptyField;
    const fallback=this.gpu.emptyLabel;
    const bind=this.device.createBindGroup({layout:this.gpu.objectLayout,entries:[
      {binding:0,resource:{buffer:uniform}},{binding:1,resource:texture.createView()},{binding:2,resource:this.label(label).createView()},{binding:3,resource:this.gpu.sampler},
      {binding:4,resource:(materialTexture??fallback).createView()},{binding:5,resource:this.gpu.surfaceSampler},
      {binding:6,resource:(normalTexture??fallback).createView()},{binding:7,resource:(ormTexture??fallback).createView()},
    ]}),object={uniform,bind,texture,width,height,owned:width>0,label,...(materialKey!==undefined?{materialKey}:{})};this.objects.set(id,object);return object;
  }
  private model(entity:RuntimeEntity):Mat4{
    const shared=this.renderFrame?.objectsById.get(entity.id),base=primitiveBaseScale(renderPrimitive(entity)),matrix=shared?.model??renderModel(entity);
    const px=entity.position[0],py=entity.position[1],pz=entity.position[2],rx=entity.rotation[0],ry=entity.rotation[1],rz=entity.rotation[2],sx=entity.scale[0]*base[0],sy=entity.scale[1]*base[1],sz=entity.scale[2]*base[2],cached=this.modelCache.get(entity.id);
    if(cached&&cached.px===px&&cached.py===py&&cached.pz===pz&&cached.rx===rx&&cached.ry===ry&&cached.rz===rz&&cached.sx===sx&&cached.sy===sy&&cached.sz===sz)return cached.matrix;
    this.modelCache.set(entity.id,{px,py,pz,rx,ry,rz,sx,sy,sz,matrix});return matrix;
  }
}
function multiply4Into(a:ArrayLike<number>,b:ArrayLike<number>,out:Float32Array):void{
  for(let column=0;column<4;column++)for(let row=0;row<4;row++)out[column*4+row]=a[row]!*b[column*4]!+a[4+row]!*b[column*4+1]!+a[8+row]!*b[column*4+2]!+a[12+row]!*b[column*4+3]!;
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

function orthographic(extent:number,near:number,far:number):Mat4{return new Float32Array([1/extent,0,0,0,0,1/extent,0,0,0,0,1/(near-far),0,0,0,near/(near-far),1]);}

function halton(index:number,base:number):number{let f=1,result=0,i=index;while(i>0){f/=base;result+=f*(i%base);i=Math.floor(i/base);}return result;}
function taaJitter(frame:number):readonly[number,number]{const i=(frame%8)+1;return[halton(i,2)-.5,halton(i,3)-.5];}

function lightGridCauseKey(lights:readonly RuntimeEntity[],eye:Vec3):string{
  const values:(string|number)[]=[Math.floor(eye[0]/LIGHT_GRID_CELL),Math.floor(eye[2]/LIGHT_GRID_CELL),lights.length];
  for(const entity of lights){
    const light=entity.light!;
    values.push(entity.id,entity.position[0],entity.position[1],entity.position[2],light.range??12,light.intensity??1,...(light.color??[1,.78,.5]));
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
  const key=JSON.stringify([spec.entity??spec.position,radius,boxHalfExtents,[...exclude].sort()]);
  return{position,radius,facesPerFrame,exclude,boxHalfExtents,key};
}
function probeVP(position:Vec3,face:number,radius:number):Mat4{
  const direction=PROBE_FACE_DIRECTIONS[face]!,up=PROBE_FACE_UP[face]!,target=V3.add(position,direction);
  return multiply4(perspective(Math.PI/2,1,.08,radius),lookAt(position,target,up));
}
function probeUniform(scene:Scene,position:Vec3,vp:Mat4):Float32Array{
  const settings=scene.spec.rendering??{},sun=V3.normalize(settings.sunDirection??[-.55,.48,-.35]),data=new Float32Array(28);
  data.set(vp,0);data.set([...sun,settings.sunIntensity??scene.environment.sunlight*3],16);
  data.set([...(settings.sunColor??[1,.87,.72]),1],20);data.set([...(settings.skyColor??[.26,.34,.47]),1],24);return data;
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
function isStaticShadowCaster(entity:RuntimeEntity,movers:ReadonlySet<string>):boolean{
  if(movers.has(entity.id))return false;
  const body=entity.body;
  return !body||(!body.kinematic&&body.invMass===0);
}
function canCullBack(entity:RuntimeEntity):boolean{
  const kind=renderPrimitive(entity)?.kind;
  return kind==='box'||kind==='sphere'||kind==='cylinder'||kind==='torus'||kind==='polygon-prism';
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
