import {createNoiseVolume,NOISE_VOLUME_SIZE} from './noise-volume.js';
import {meshBounds,intersectsClip,type MeshBounds} from './visibility.js';
import {SurfaceTextures} from './surface-textures.js';
import {buildLightGrid,LIGHT_GRID_WGSL,MAX_RENDER_LIGHTS,LIGHT_GRID_SIDE,LIGHTS_PER_CELL} from './light-grid.js';
import {FRAME_WGSL,SKY_SHADER,POST_SHADER,BLOOM_SHADER,TAA_SHADER} from './lighting.js';
import {V3,compose,lookAt,multiply4,perspective,type Mat4,type Vec3} from '../math.js';
import {primitiveKey,primitiveMesh} from '../procedural/mesh.js';
import type {Primitive,CameraSpec} from '../scene/types.js';
import type {Scene,RuntimeEntity} from '../scene/scene.js';
import type {Renderer,RenderStats} from './types.js';
import {RenderProfiler} from './profiler.js';
import {analyzeWGSL,buildRenderAtomReport,type ShaderProgramAtoms} from './atoms.js';

type GPUAny=any;
export interface WebGPURendererOptions {profiling?:boolean}
interface GPUMesh{bounds:MeshBounds;vertex:GPUAny;index:GPUAny;count:number;format:'uint16'|'uint32';triangles:number}
interface GPUObject{uniform:GPUAny;bind:GPUAny;texture:GPUAny;width:number;height:number;owned?:boolean;label?:string;materialKey?:string}
const materialShader=(reflection=false)=>FRAME_WGSL+LIGHT_GRID_WGSL+`
override MATERIAL_CLASS:i32=-1;
struct U {
  mvp: mat4x4<f32>,
  model: mat4x4<f32>,
  color: vec4<f32>,
  surface: vec4<f32>,     // moss, wetness, roughness, darkening
  weather: vec4<f32>,     // dirt, wear, seed, material kind
  surfacePhase: vec4<f32>, // snow depth m, water depth m, slush, ice depth m
  surfaceDynamics: vec4<f32>, // puddle, track melt, body deposition, rear deposition
  environment: vec4<f32>, // air C, sunlight, hour/24, surface-use code
  motion: vec4<f32>,      // dir x, dir z, road dirt, body wetness
  camera: vec4<f32>,
  lightPos0: vec4<f32>,
  lightColor0: vec4<f32>,
  lightPos1: vec4<f32>,
  lightColor1: vec4<f32>,
  lightPos2: vec4<f32>,
  lightColor2: vec4<f32>,
  lightPos3: vec4<f32>,
  lightColor3: vec4<f32>,
  fieldFrame: vec4<f32>,
  fieldSize: vec4<f32>,
  pbr:vec4<f32>,
  emission:vec4<f32>,
  texture:vec4<f32>, // size metres, bump amount, albedo blend, enabled
  prevMvp:mat4x4<f32>,
}
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var fieldTexture: texture_2d<f32>;
@group(0) @binding(2) var labelTexture:texture_2d<f32>;
@group(0) @binding(3) var labelSampler:sampler;
@group(0) @binding(4) var surfaceTexture:texture_2d<f32>;
@group(0) @binding(5) var surfaceSampler:sampler;
@group(1) @binding(0) var<uniform> f:Frame;
@group(1) @binding(1) var shadowMap:texture_depth_2d;
@group(1) @binding(2) var shadowSampler:sampler_comparison;
@group(1) @binding(3) var reflectionMap:texture_2d<f32>;
@group(1) @binding(4) var reflectionSampler:sampler;
@group(1) @binding(7) var noiseVolume:texture_3d<f32>;
@group(1) @binding(8) var noiseSampler:sampler;
@vertex fn shadowVS(@location(0) position:vec3<f32>)->@builtin(position) vec4<f32>{return f.lightVP*u.model*vec4<f32>(position,1);}
fn shadowAt(p:vec3<f32>,n:vec3<f32>)->f32{
 let clip=f.lightVP*vec4<f32>(p+n*.003,1);let uv=clip.xy*.5*vec2<f32>(1,-1)+.5;
 if(any(uv<vec2<f32>(0))||any(uv>vec2<f32>(1))||clip.z>1.0||clip.z<0.0){return 1.0;}
 var value=0.0;let texel=1.0/vec2<f32>(textureDimensions(shadowMap));
 for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){value+=textureSampleCompareLevel(shadowMap,shadowSampler,uv+vec2<f32>(f32(x),f32(y))*texel*1.25,clip.z-.000025);}}
 let edge=min(min(uv.x,1.0-uv.x),min(uv.y,1.0-uv.y));return mix(1.0,value/9.0,smoothstep(0.0,.025,edge));
}

struct VOut {
  @builtin(position) position: vec4<f32>,
  @location(0) normal: vec3<f32>,
  @location(1) worldPos: vec3<f32>,
  @location(2) uv:vec2<f32>,
  @location(3) @interpolate(flat) reflected:u32,
  @location(4) velocity:vec2<f32>,
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

@vertex fn vs(@location(0) position: vec3<f32>, @location(1) normal: vec3<f32>) -> VOut {
  var out: VOut;out.reflected=0u;
  let world=u.model*vec4<f32>(position,1.0);
  out.position=u.mvp*vec4<f32>(position,1.0);let previous=u.prevMvp*vec4<f32>(position,1.0);
  let currentNdc=out.position.xy/max(abs(out.position.w),.00001);let previousNdc=previous.xy/max(abs(previous.w),.00001);
  out.velocity=vec2<f32>((currentNdc.x-previousNdc.x)*.5,(previousNdc.y-currentNdc.y)*.5);
  out.worldPos=world.xyz;out.uv=vec2<f32>(select(position.x+.5,.5-position.x,normal.z<-.5),.5-position.y);
  let a=u.model[0].xyz;let b=u.model[1].xyz;let c=u.model[2].xyz;
  out.normal=normalize(mat3x3<f32>(a/dot(a,a),b/dot(b,b),c/dot(c,c))*normal);
  return out;
}

@vertex fn reflectionVS(@location(0) position:vec3<f32>,@location(1) normal:vec3<f32>)->VOut{
 var out:VOut;let world=u.model*vec4<f32>(position,1);out.position=f.reflectionVP*world;out.worldPos=world.xyz;let a=u.model[0].xyz;let b=u.model[1].xyz;let c=u.model[2].xyz;out.normal=normalize(mat3x3<f32>(a/dot(a,a),b/dot(b,b),c/dot(c,c))*normal);out.uv=vec2<f32>(select(position.x+.5,.5-position.x,normal.z<-.5),.5-position.y);out.reflected=1u;out.velocity=vec2<f32>(0);return out;
}

fn pointLight(source:PointSource,world:vec3<f32>,n:vec3<f32>,viewDir:vec3<f32>,roughness:f32,base:vec3<f32>,f0:vec3<f32>,metal:f32)->vec3<f32>{
 let delta=source.position.xyz-world;let dist=length(delta);if(dist>=source.position.w){return vec3<f32>(0);}
 let l=delta/max(dist,.001);let nl=max(dot(n,l),0.0);let nv=max(dot(n,viewDir),.001);let h=normalize(l+viewDir);
 // Finite lamp size keeps specular stable at subpixel scale.
 let r=max(roughness,.08+.18/max(dist,1.0));let a2=pow(r,4.0);let nh=max(dot(n,h),0.0);
 let d=a2/(3.14159*pow(nh*nh*(a2-1.0)+1.0,2.0));let k=pow(r+1.0,2.0)/8.0;
 let g=nv/(nv*(1.0-k)+k)*nl/(nl*(1.0-k)+k);
 let fr=f0+(1.0-f0)*pow(1.0-max(dot(viewDir,h),0.0),5.0);
 let atten=pow(max(0.0,1.0-pow(dist/source.position.w,4.0)),2.0)/(1.0+dist*dist*.18);
 return (base*(1.0-fr)*(1.0-metal)/3.14159+d*g*fr/max(4.0*nv*nl,.001))*source.color.rgb*source.color.w*atten*nl;
}

fn texelAt(p:vec3<f32>,weights:vec3<f32>)->vec3<f32>{
 return textureSample(surfaceTexture,surfaceSampler,p.zy/u.texture.x).rgb*weights.x+textureSample(surfaceTexture,surfaceSampler,p.xz/u.texture.x).rgb*weights.y+textureSample(surfaceTexture,surfaceSampler,p.xy/u.texture.x).rgb*weights.z;
}
struct GOut{@location(0) color:vec4<f32>,@location(1) normal:vec4<f32>,@location(2) specular:vec4<f32>,@location(3) velocity:vec2<f32>}
@fragment fn fs(in: VOut) -> GOut {
  ${reflection?'if(in.worldPos.y<.04){discard;}':''}
  let fieldUV=(in.worldPos.xz-u.fieldFrame.xy)/max(u.fieldFrame.zw,vec2<f32>(0.001))+vec2<f32>(0.5);
  let cell=clamp(vec2<i32>(floor(fieldUV*u.fieldSize.xy)),vec2<i32>(0),vec2<i32>(u.fieldSize.xy)-vec2<i32>(1));
  let local=textureLoad(fieldTexture,cell,0);
  let hasField=u.fieldSize.z>0.5;
  let track=select(tyreTracks(in.worldPos.z)*u.surfaceDynamics.y,local.x,hasField);
  let snowDepth=select(u.surfacePhase.x,local.y,hasField);
  let waterDepth=select(u.surfacePhase.y,local.z,hasField);
  let slush=select(u.surfacePhase.z,local.w,hasField);

  let geometricNormal=normalize(in.normal);
  var n=geometricNormal;
  let eye=select(u.camera.xyz,vec3<f32>(u.camera.x,.03-u.camera.y,u.camera.z),in.reflected==1u);
  let viewDir=normalize(eye-in.worldPos);
  let sunlight=u.environment.y;
  let hour=u.environment.z*24.0;
  let sunrise=exp(-pow((hour-7.4)/1.15,2.0))*sunlight;
  let light=f.sun.xyz;
  let halfDir=normalize(light+viewDir);
  let ndl=max(dot(n,light),0.0);

  var albedo=u.color.rgb;
  let label=textureSample(labelTexture,labelSampler,in.uv);albedo=mix(albedo,label.rgb,label.a);
  let materialKind=select(u.weather.w,f32(MATERIAL_CLASS),MATERIAL_CLASS>=0);
  let surfaceUse=u.environment.w;
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
  if(materialKind>5.5){
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
  var snowMask=upward*snowBase*smoothstep(0.12,0.82,fbm(in.worldPos*1.9+seed*3.1)+snowBase*.74);
  if(surfaceUse>.5 && surfaceUse<1.5){
    snowMask*=1.0-track*.96;
  }
  if(surfaceUse>2.5 && surfaceUse<3.5){
    snowMask=clamp(snowMask+snowBase*.38,0.0,1.0);
  }
  let slushColor=mix(vec3<f32>(0.48,0.5,0.5),vec3<f32>(0.22,0.19,0.16),clamp(u.weather.x+u.motion.z,0.0,1.0));
  albedo=mix(albedo,slushColor,snowMask*slush*.52);
  albedo=mix(albedo,vec3<f32>(0.89,0.93,0.97),snowMask*(1.0-slush*.55));

  // Moving bodies accumulate fresh snow on upward and rear-facing surfaces.
  let motionDir=normalize(vec3<f32>(u.motion.x,0.0,u.motion.y)+vec3<f32>(0.0001,0.0,0.0));
  let rearFacing=smoothstep(0.05,0.9,dot(n,-motionDir));
  let bodySnow=clamp(u.surfaceDynamics.z*upward+u.surfaceDynamics.w*rearFacing,0.0,1.0);
  albedo=mix(albedo,vec3<f32>(0.91,0.945,0.98),bodySnow*smoothstep(.18,.78,fbm(in.worldPos*4.4+seed)+.25));

  if(u.texture.w>.5){
    let w=pow(abs(n),vec3<f32>(6));let weights=w/max(w.x+w.y+w.z,.001);let tex=texelAt(in.worldPos,weights);
    albedo*=mix(vec3<f32>(1),tex,u.texture.z);
    let e=u.texture.x/512.0;let center=dot(tex,vec3<f32>(.333333));
    let grad=vec3<f32>(dot(texelAt(in.worldPos+vec3<f32>(e,0,0),weights),vec3<f32>(.333333))-center,dot(texelAt(in.worldPos+vec3<f32>(0,e,0),weights),vec3<f32>(.333333))-center,dot(texelAt(in.worldPos+vec3<f32>(0,0,e),weights),vec3<f32>(.333333))-center);
    n=normalize(n-(grad-n*dot(n,grad))*u.texture.y*.012/e);
  }

  // Water is also state, not a material override. Procedural depressions localize
  // the scalar water volume into shallow puddles.
  let depression=1.0-fbm(in.worldPos*0.58+seed*6.0);
  let puddleMask=u.surfaceDynamics.x*smoothstep(0.7-u.surfaceDynamics.x*.35,0.9-u.surfaceDynamics.x*.12,depression)*upward;
  let wetness=clamp(u.surface.y+u.motion.w+waterDepth/0.006+puddleMask*.5,0.0,1.0);
  albedo*=1.0-u.surface.w-wetness*.24;

  var roughness=clamp(select(u.surface.z,u.pbr.x,u.pbr.x>=0.0)-wetness*.28,.08,1.0);
  var waterCoverage=1.0;
  if(materialKind>4.5&&materialKind<5.5){
    let hollows=noise3(in.worldPos*vec3<f32>(1.4,.1,2.3))*.78+noise3(in.worldPos*vec3<f32>(7.5,.1,9.3))*.22;
    // A damp film darkens stone but does not submerge the aggregate. Only
    // depressions filled by the local water column become smooth puddles.
    let fill=clamp(waterDepth/.006,0.0,1.0);
    waterCoverage=smoothstep(.64,.80,hollows+fill*.50)*smoothstep(.00015,.0012,waterDepth);
    let aggregate=noise3(in.worldPos*37.0+seed);
    let mineralRoughness=clamp(max(roughness,.60)+(aggregate-.5)*.24,.50,.93);
    roughness=mix(mineralRoughness,.11+noise3(in.worldPos*3.0)*.045,waterCoverage);
    albedo*=mix(1.0,.62,waterCoverage);
    // Millimetres of water level out the gravel; its normals must not turn the
    // planar reflection into waves across the entire road.
    n=normalize(mix(n,geometricNormal,waterCoverage*.94));
  }
  let metal=u.pbr.y;let base=pow(max(albedo,vec3<f32>(0)),vec3<f32>(2.2));
  let nv=max(dot(n,viewDir),.001);let nl=max(dot(n,light),0.0);let nh=max(dot(n,halfDir),0.0);let vh=max(dot(viewDir,halfDir),0.0);
  let a2=pow(roughness,4.0);let d=a2/(3.14159*pow(nh*nh*(a2-1.0)+1.0,2.0));
  let k=pow(roughness+1.0,2.0)/8.0;let g=(nv/(nv*(1.0-k)+k))*(nl/(nl*(1.0-k)+k));
  let f0=mix(vec3<f32>(.04),base,metal);let fresnel=f0+(1.0-f0)*pow(1.0-vh,5.0);
  let specular=d*g*fresnel/max(4.0*nv*nl,.001);
  let shadow=shadowAt(in.worldPos,n);
  let hemisphere=f.sky.rgb*(mix(.16,.38,smoothstep(-.65,0.0,n.y))+1.75*max(n.y,0.0));
  let bounce=vec3<f32>(.10,.105,.11)*(1.0-max(n.y,0.0))*sunlight;
  var color=base*(hemisphere+bounce)*(1.0-metal*.8);
  color+=(base*(1.0-fresnel)*(1.0-metal)/3.14159+specular)*f.sunColor.rgb*f.sun.w*nl*shadow;
  let environmentFresnel=f0+(1.0-f0)*pow(1.0-nv,5.0);
  color+=f.sky.rgb*environmentFresnel*(1.0-roughness)*.65;
  let bin=lightCell(in.worldPos);if(bin!=0xffffffffu){for(var j=0u;j<lightCells[bin];j++){color+=pointLight(lightGrid.sources[lightCells[bin+1u+j]],in.worldPos,n,viewDir,roughness,base,f0,metal);}}
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
  var out:GOut;out.color=vec4<f32>(color,select(u.color.a,mix(u.color.a*.25,.82,pow(1.0-nv,5.0)),materialKind>.5&&materialKind<1.5));out.normal=vec4<f32>(n*.5+.5,roughness);out.specular=vec4<f32>(environmentFresnel,select(1.0,0.0,materialKind>4.5&&materialKind<5.5));out.velocity=in.velocity;return out;
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

export class WebGPURenderer implements Renderer{
  private depth:GPUAny=null;private hdr:GPUAny=null;private normal:GPUAny=null;private specular:GPUAny=null;private velocity:GPUAny=null;private taaA:GPUAny=null;private taaB:GPUAny=null;private taaBindAB:GPUAny=null;private taaBindBA:GPUAny=null;private postBindA:GPUAny=null;private postBindB:GPUAny=null;private reflection:GPUAny=null;private reflectionDepth:GPUAny=null;private depthW=0;private depthH=0;
  private fixedResolution:readonly [number,number]|undefined;
  private bloomA:GPUAny=null;private bloomB:GPUAny=null;private bloomDownBind:GPUAny=null;private bloomHorizontalBind:GPUAny=null;private bloomVerticalBind:GPUAny=null;
  private readonly meshes=new Map<string,GPUMesh>();private readonly objects=new Map<string,GPUObject>();private readonly errors:string[]=[];private readonly labels=new Map<string,GPUAny>();
  private readonly surfaceTextures:SurfaceTextures;
  private readonly materialLoads=new Map<string,Promise<void>>();private readonly failedMaterials=new Set<string>();private disposed=false;
  private pointLights=0;private lightOverflow=0;
  private drawCalls=0;private triangles=0;private lastCamera:Vec3=[0,0,0];private lastScene:Scene|null=null;private lastLights:RuntimeEntity[]=[];private previousVp:Mat4|null=null;private previousModels=new Map<string,Mat4>();private historyValid=false;private taaHistoryIndex=0;private lastRenderTime=-Infinity;
  private readonly profiler:RenderProfiler;
  private readonly shaderAtoms:Readonly<Record<string,ShaderProgramAtoms>>;
  private constructor(private readonly canvas:HTMLCanvasElement,private readonly device:GPUAny,private readonly context:GPUAny,private readonly format:string,private readonly gpu:GPUAny,profiling:boolean,timestampQueries:boolean){
    this.surfaceTextures=new SurfaceTextures(device);this.profiler=new RenderProfiler(device,{enabled:profiling,timestampQueries});
    this.shaderAtoms=profiling?Object.freeze({
      material:analyzeWGSL('material',materialShader(),['vs','fs','shadowVS']),
      reflection:analyzeWGSL('reflection',materialShader(true),['reflectionVS','fs']),
      sky:analyzeWGSL('sky',SKY_SHADER,['vs','fs']),
      snow:analyzeWGSL('snow',SNOW_SHADER,['vs','fs']),
      bloom:analyzeWGSL('bloom',BLOOM_SHADER,['vs','downsample','horizontal','vertical']),
      taa:analyzeWGSL('taa',TAA_SHADER,['vs','fs']),
      post:analyzeWGSL('post',POST_SHADER,['vs','fs']),
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
    const module=device.createShaderModule({code:materialShader()}),reflectionModule=device.createShaderModule({code:materialShader(true)}),vertex={module,entryPoint:'vs',buffers:[{arrayStride:24,attributes:[{shaderLocation:0,offset:0,format:'float32x3'},{shaderLocation:1,offset:12,format:'float32x3'}]}]};
    const objectLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:3,buffer:{type:'uniform'}},{binding:1,visibility:2,texture:{sampleType:'unfilterable-float'}},{binding:2,visibility:2,texture:{sampleType:'float'}},{binding:3,visibility:2,sampler:{type:'filtering'}},{binding:4,visibility:2,texture:{sampleType:'float'}},{binding:5,visibility:2,sampler:{type:'filtering'}}]});
    const frameLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:3,buffer:{type:'uniform'}}]});
    const lightLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:3,buffer:{type:'uniform'}},{binding:1,visibility:2,texture:{sampleType:'depth'}},{binding:2,visibility:2,sampler:{type:'comparison'}},{binding:3,visibility:2,texture:{sampleType:'float'}},{binding:4,visibility:2,sampler:{type:'filtering'}},{binding:5,visibility:3,buffer:{type:'read-only-storage'}},{binding:6,visibility:3,buffer:{type:'read-only-storage'}},{binding:7,visibility:2,texture:{viewDimension:'3d'}},{binding:8,visibility:2,sampler:{type:'filtering'}}]});
    const lightBuffer=device.createBuffer({size:(4+MAX_RENDER_LIGHTS*8)*4,usage:0x80|0x08}),cellBuffer=device.createBuffer({size:LIGHT_GRID_SIDE**2*(LIGHTS_PER_CELL+1)*4,usage:0x80|0x08});
    const frame=device.createBuffer({size:256,usage:0x40|0x08}),shadow=device.createTexture({size:[4096,4096],format:'depth32float',usage:0x10|0x04});
    const comparison=device.createSampler({compare:'less-equal',minFilter:'linear',magFilter:'linear'}),sampler=device.createSampler({minFilter:'linear',magFilter:'linear'});
    const noiseVolume=createNoiseVolume(device),noiseSampler=device.createSampler({minFilter:'linear',magFilter:'linear',addressModeU:'repeat',addressModeV:'repeat',addressModeW:'repeat'});
    const surfaceSampler=device.createSampler({minFilter:'linear',magFilter:'linear',mipmapFilter:'linear',addressModeU:'repeat',addressModeV:'repeat',maxAnisotropy:8});
    const emptyField=device.createTexture({size:[1,1],format:'rgba32float',usage:0x04|0x02}),emptyLabel=device.createTexture({size:[1,1],format:'rgba8unorm',usage:0x04|0x02});device.queue.writeTexture({texture:emptyField},new Float32Array(4),{bytesPerRow:16},[1,1]);device.queue.writeTexture({texture:emptyLabel},new Uint8Array(4),{bytesPerRow:4},[1,1]);
    const frameBind=device.createBindGroup({layout:frameLayout,entries:[{binding:0,resource:{buffer:frame}}]});
    const reflectionBind=device.createBindGroup({layout:lightLayout,entries:[{binding:0,resource:{buffer:frame}},{binding:1,resource:shadow.createView()},{binding:2,resource:comparison},{binding:3,resource:emptyLabel.createView()},{binding:4,resource:sampler},{binding:5,resource:{buffer:lightBuffer}},{binding:6,resource:{buffer:cellBuffer}},{binding:7,resource:noiseVolume.createView()},{binding:8,resource:noiseSampler}]});
    const layout=device.createPipelineLayout({bindGroupLayouts:[objectLayout,lightLayout]});
    const blend={color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}};
    const materialClasses=[0,1,2,3,4,5,6] as const;
    const make=(transparent:boolean,cullMode:'none'|'back',materialClass=-1)=>device.createRenderPipeline({layout,vertex,fragment:{module,entryPoint:'fs',constants:{MATERIAL_CLASS:materialClass},targets:[{format:'rgba16float',...(transparent?{blend}:{})},{format:'rgba16float',...(transparent?{writeMask:0}:{})},{format:'rgba8unorm',...(transparent?{writeMask:0}:{})},{format:'rg16float',...(transparent?{writeMask:0}:{})}]},primitive:{topology:'triangle-list',cullMode},depthStencil:{format:'depth32float',depthWriteEnabled:!transparent,depthCompare:'less'}});
    const opaqueCulled=new Map(materialClasses.map(code=>[code,make(false,'back',code)])),opaqueDouble=new Map(materialClasses.map(code=>[code,make(false,'none',code)]));
    const transparent=make(true,'none',-1);
    const makeReflected=(cullMode:'none'|'back',materialClass:number)=>device.createRenderPipeline({layout,vertex:{...vertex,module:reflectionModule,entryPoint:'reflectionVS'},fragment:{module:reflectionModule,entryPoint:'fs',constants:{MATERIAL_CLASS:materialClass},targets:[{format:'rgba16float'}]},primitive:{topology:'triangle-list',cullMode},depthStencil:{format:'depth32float',depthWriteEnabled:true,depthCompare:'less'}});
    const reflectedCulled=new Map(materialClasses.map(code=>[code,makeReflected('back',code)])),reflectedDouble=new Map(materialClasses.map(code=>[code,makeReflected('none',code)]));
    const shadowLayout=device.createPipelineLayout({bindGroupLayouts:[objectLayout,frameLayout]});
    const makeShadow=(cullMode:'none'|'back')=>device.createRenderPipeline({layout:shadowLayout,vertex:{...vertex,entryPoint:'shadowVS'},primitive:{topology:'triangle-list',cullMode},depthStencil:{format:'depth32float',depthWriteEnabled:true,depthCompare:'less',depthBias:1,depthBiasSlopeScale:1.5}});
    const shadowCulled=makeShadow('back'),shadowDouble=makeShadow('none');
    const skyModule=device.createShaderModule({code:SKY_SHADER}),sky=device.createRenderPipeline({layout:device.createPipelineLayout({bindGroupLayouts:[frameLayout]}),vertex:{module:skyModule,entryPoint:'vs'},fragment:{module:skyModule,entryPoint:'fs',targets:[{format:'rgba16float'},{format:'rgba16float',writeMask:0},{format:'rgba8unorm',writeMask:0},{format:'rg16float',writeMask:0}]},primitive:{topology:'triangle-list'},depthStencil:{format:'depth32float',depthWriteEnabled:false,depthCompare:'always'}});
    const taaModule=device.createShaderModule({code:TAA_SHADER}),taa=device.createRenderPipeline({layout:'auto',vertex:{module:taaModule,entryPoint:'vs'},fragment:{module:taaModule,entryPoint:'fs',targets:[{format:'rgba16float'}]},primitive:{topology:'triangle-list'}});
    const taaParams=device.createBuffer({size:16,usage:0x40|0x08});
    const postModule=device.createShaderModule({code:POST_SHADER}),post=device.createRenderPipeline({layout:'auto',vertex:{module:postModule,entryPoint:'vs'},fragment:{module:postModule,entryPoint:'fs',targets:[{format}]},primitive:{topology:'triangle-list'}});
    const bloomModule=device.createShaderModule({code:BLOOM_SHADER}),bloomLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:2,texture:{sampleType:'float'}},{binding:1,visibility:2,sampler:{type:'filtering'}}]}),bloomPipelineLayout=device.createPipelineLayout({bindGroupLayouts:[bloomLayout]});
    const makeBloom=(entryPoint:string)=>device.createRenderPipeline({layout:bloomPipelineLayout,vertex:{module:bloomModule,entryPoint:'vs'},fragment:{module:bloomModule,entryPoint,targets:[{format:'rgba16float'}]},primitive:{topology:'triangle-list'}});
    const bloomDown=makeBloom('downsample'),bloomHorizontal=makeBloom('horizontal'),bloomVertical=makeBloom('vertical');
    const snowModule=device.createShaderModule({code:SNOW_SHADER}),snowLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:1,buffer:{type:'uniform'}}]});
    const snow=device.createRenderPipeline({layout:device.createPipelineLayout({bindGroupLayouts:[snowLayout,lightLayout]}),vertex:{module:snowModule,entryPoint:'vs'},fragment:{module:snowModule,entryPoint:'fs',targets:[{format:'rgba16float',blend},{format:'rgba16float',writeMask:0},{format:'rgba8unorm',writeMask:0},{format:'rg16float',writeMask:0}]},primitive:{topology:'triangle-list'},depthStencil:{format:'depth32float',depthWriteEnabled:false,depthCompare:'less'}});
    const snowUniform=device.createBuffer({size:128,usage:0x40|0x08}),snowBind=device.createBindGroup({layout:snowLayout,entries:[{binding:0,resource:{buffer:snowUniform}}]});
    for(const shader of [module,reflectionModule,skyModule,taaModule,postModule,snowModule,bloomModule]){const info=await shader.getCompilationInfo();const errors=info.messages.filter((m:any)=>m.type==='error');if(errors.length)throw new Error(errors.map((m:any)=>m.message).join('\n'));}
    return new WebGPURenderer(canvas,device,context,format,{noiseVolume,noiseSampler,surfaceSampler,lightBuffer,cellBuffer,emptyField,emptyLabel,objectLayout,lightLayout,comparison,frame,shadow,sampler,frameBind,reflectionBind,reflectedCulled,reflectedDouble,lightBind:null,opaqueCulled,opaqueDouble,transparent,shadowCulled,shadowDouble,sky,taa,taaParams,post,bloomLayout,bloomDown,bloomHorizontal,bloomVertical,snow,snowUniform,snowBind},profiling,timestampQueries);
  }
  setResolution(width:number,height:number):void{
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>4096||height>4096)throw new RangeError('Render dimensions must be integers in [1,4096]');
    this.fixedResolution=[width,height];this.resize();
  }
  resize():void{
    const ratio=Math.max(1,Math.min(2,devicePixelRatio||1)),width=this.fixedResolution?.[0]??Math.max(1,Math.floor(this.canvas.clientWidth*ratio)),height=this.fixedResolution?.[1]??Math.max(1,Math.floor(this.canvas.clientHeight*ratio));
    if(this.depthW===width&&this.depthH===height)return;
    this.canvas.width=width;this.canvas.height=height;this.depthW=width;this.depthH=height;
    for(const target of [this.depth,this.hdr,this.normal,this.specular,this.velocity,this.taaA,this.taaB,this.reflection,this.reflectionDepth,this.bloomA,this.bloomB])target?.destroy();
    const texture=(format:string,count:number)=>this.device.createTexture({size:[width,height],format,sampleCount:count,usage:0x10|0x04});
    this.depth=texture('depth32float',1);this.hdr=texture('rgba16float',1);this.normal=texture('rgba16float',1);this.specular=texture('rgba8unorm',1);this.velocity=texture('rg16float',1);this.taaA=texture('rgba16float',1);this.taaB=texture('rgba16float',1);
    this.reflection=this.device.createTexture({size:[Math.max(1,Math.floor(width/2)),Math.max(1,Math.floor(height/2))],format:'rgba16float',usage:0x10|0x04});this.reflectionDepth=this.device.createTexture({size:[Math.max(1,Math.floor(width/2)),Math.max(1,Math.floor(height/2))],format:'depth32float',usage:0x10});
    const bloomTexture=()=>this.device.createTexture({size:[Math.max(1,Math.floor(width/4)),Math.max(1,Math.floor(height/4))],format:'rgba16float',usage:0x10|0x04});this.bloomA=bloomTexture();this.bloomB=bloomTexture();
    const bloomBind=(texture:GPUAny)=>this.device.createBindGroup({layout:this.gpu.bloomLayout,entries:[{binding:0,resource:texture.createView()},{binding:1,resource:this.gpu.sampler}]});this.bloomDownBind=bloomBind(this.hdr);this.bloomHorizontalBind=bloomBind(this.bloomA);this.bloomVerticalBind=bloomBind(this.bloomB);
    this.gpu.lightBind=this.device.createBindGroup({layout:this.gpu.lightLayout,entries:[{binding:0,resource:{buffer:this.gpu.frame}},{binding:1,resource:this.gpu.shadow.createView()},{binding:2,resource:this.gpu.comparison},{binding:3,resource:this.reflection.createView()},{binding:4,resource:this.gpu.sampler},{binding:5,resource:{buffer:this.gpu.lightBuffer}},{binding:6,resource:{buffer:this.gpu.cellBuffer}},{binding:7,resource:this.gpu.noiseVolume.createView()},{binding:8,resource:this.gpu.noiseSampler}]});
    const taaBind=(history:GPUAny)=>this.device.createBindGroup({layout:this.gpu.taa.getBindGroupLayout(0),entries:[{binding:0,resource:this.hdr.createView()},{binding:1,resource:history.createView()},{binding:2,resource:this.velocity.createView()},{binding:3,resource:this.depth.createView()},{binding:4,resource:this.gpu.sampler},{binding:5,resource:{buffer:this.gpu.taaParams}}]});
    this.taaBindAB=taaBind(this.taaA);this.taaBindBA=taaBind(this.taaB);
    const postBind=(source:GPUAny)=>this.device.createBindGroup({layout:this.gpu.post.getBindGroupLayout(0),entries:[{binding:0,resource:source.createView()},{binding:1,resource:this.normal.createView()},{binding:2,resource:this.depth.createView()},{binding:3,resource:this.gpu.sampler},{binding:4,resource:{buffer:this.gpu.frame}},{binding:5,resource:this.specular.createView()},{binding:6,resource:this.bloomA.createView()}]});
    this.postBindA=postBind(this.taaA);this.postBindB=postBind(this.taaB);this.historyValid=false;this.taaHistoryIndex=0;this.previousVp=null;
  }
  render(scene:Scene,camera:CameraSpec=scene.camera):void{
    const frameId=this.profiler.beginFrame();
    this.profiler.measure('lifecycle',()=>this.collect(scene));
    this.profiler.measure('resize',()=>this.resize());
    this.lastScene=scene;
    this.profiler.measure('materials',()=>this.queueMaterialLoads(scene));
    this.lastCamera=camera.position;this.lastLights=[...scene.entities.values()].filter(e=>e.light);
    const lightGrid=this.profiler.measure('lights',()=>{
      const grid=buildLightGrid(this.lastLights,camera.position);this.pointLights=grid.count;this.lightOverflow=grid.overflow;
      this.device.queue.writeBuffer(this.gpu.lightBuffer,0,grid.lights);this.device.queue.writeBuffer(this.gpu.cellBuffer,0,grid.cells);
      this.profiler.addUpload(grid.lights.byteLength+grid.cells.byteLength,'light');return grid;
    });
    void lightGrid;
    const frameState=this.profiler.measure('frame',()=>{
      const projection=perspective((camera.fov??55)*Math.PI/180,this.canvas.width/this.canvas.height),jitter=taaJitter(frameId);
      projection[8]=-2*jitter[0]/this.canvas.width;projection[9]=2*jitter[1]/this.canvas.height;
      const vp=multiply4(projection,lookAt(camera.position,camera.target));
      const settings=scene.spec.rendering??{},sun=V3.normalize(settings.sunDirection??[-.55,.48,-.35]),target:Vec3=[camera.target[0],4,camera.target[2]],extent=settings.shadowExtent??65;
      const lightVP=multiply4(orthographic(extent,1,400),lookAt(V3.add(target,V3.scale(sun,180)),target));
      lightVP[12]=Math.round(lightVP[12]!*2048)/2048;lightVP[13]=Math.round(lightVP[13]!*2048)/2048;
      const forward=V3.normalize(V3.sub(camera.target,camera.position)),right=V3.normalize(Math.abs(forward[1])>.9999?[1,0,0]:V3.cross(forward,[0,1,0])),up=V3.cross(right,forward),frame=new Float32Array(64);
      frame.set(lightVP);frame.set([...sun,settings.sunIntensity??scene.environment.sunlight*3],16);frame.set([...(settings.sunColor??[1,.87,.72]),settings.exposure??1],20);
      frame.set([...(settings.skyColor??[.26,.34,.47]),settings.fogDensity??.0025],24);frame.set([...camera.position,1],28);frame.set([...forward,Math.tan((camera.fov??55)*Math.PI/360)],32);frame.set([...right,this.canvas.width/this.canvas.height],36);frame.set([...up,scene.time],40);frame.set([scene.environment.sunlight,0,camera.focusDistance??20,camera.aperture??0],44);
      frame.set(multiply4(perspective((camera.fov??55)*Math.PI/180,this.canvas.width/this.canvas.height),lookAt([camera.position[0],.03-camera.position[1],camera.position[2]],[camera.target[0],.03-camera.target[1],camera.target[2]],[0,-1,0])),48);
      this.device.queue.writeBuffer(this.gpu.frame,0,frame);this.profiler.addUpload(frame.byteLength,'frame');
      return{vp,settings,lightVP,right,up,frame};
    });
    const {vp,lightVP,right,up,frame}=frameState;
    const classified=this.profiler.measure('visibility',()=>{
      const visible=[...scene.entities.values()].filter(e=>e.mesh),opaque=visible.filter(e=>e.material.color[3]>=.98),transparent=visible.filter(e=>e.material.color[3]<.98).sort((a,b)=>distance2(b.position,camera.position)-distance2(a.position,camera.position));
      return{visible,opaque,transparent};
    });
    this.profiler.setWork({entities:scene.entities.size,visible:classified.visible.length,opaque:classified.opaque.length,transparent:classified.transparent.length});
    if(this.previousVp&&((scene.time+1e-6<this.lastRenderTime)||distance2(this.lastCamera,camera.position)>100))this.historyValid=false;
    const previousVp=this.previousVp??vp;
    this.profiler.measure('prepare',()=>{for(const e of classified.visible)this.prepare(e,vp,previousVp);});
    const culled=this.profiler.measure('cull',()=>{
      const inView=(entity:RuntimeEntity,matrix:Mat4)=>intersectsClip(this.mesh(entity.mesh!).bounds,multiply4(matrix,this.model(entity)));
      const cameraOpaque=classified.opaque.filter(e=>inView(e,vp)).sort((a,b)=>distance2(a.position,camera.position)-distance2(b.position,camera.position));
      const cameraTransparent=classified.transparent.filter(e=>inView(e,vp));
      const shadowCasters=classified.opaque.filter(e=>inView(e,lightVP));
      const reflectionVP=frame.subarray(48,64),reflectedObjects=classified.opaque.filter(e=>e.material.kind!=='snow'&&e.material.kind!=='asphalt'&&inView(e,reflectionVP));
      return{cameraOpaque,cameraTransparent,shadowCasters,reflectedObjects};
    });
    const shadowDrawables=culled.shadowCasters.filter(e=>!(e.material.emissive&&Math.max(...e.material.emissive)>1));
    this.profiler.setWork({cameraOpaque:culled.cameraOpaque.length,cameraTransparent:culled.cameraTransparent.length,shadowCasters:shadowDrawables.length,reflected:culled.reflectedObjects.length});
    const encoder=this.device.createCommandEncoder({label:`render frame ${frameId}`});
    this.profiler.measure('encode.shadow',()=>{
      const timing=this.profiler.timestampWrites('shadow'),occlusion=this.profiler.occlusionSet(),shadow=encoder.beginRenderPass({label:'render.shadow',...(timing?{timestampWrites:timing}:{}),...(occlusion?{occlusionQuerySet:occlusion}:{}),colorAttachments:[],depthStencilAttachment:{view:this.gpu.shadow.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});
      shadow.setBindGroup(1,this.gpu.frameBind);const query=this.profiler.beginOcclusion(shadow,'shadow');
      for(const [culled,group] of partitionByCull(shadowDrawables)){shadow.setPipeline(culled?this.gpu.shadowCulled:this.gpu.shadowDouble);for(const e of group)this.draw(shadow,e,false);}
      this.profiler.endOcclusion(shadow,query);shadow.end();
    });
    this.profiler.measure('encode.reflection',()=>{
      const timing=this.profiler.timestampWrites('reflection'),occlusion=this.profiler.occlusionSet(),reflect=encoder.beginRenderPass({label:'render.reflection',...(timing?{timestampWrites:timing}:{}),...(occlusion?{occlusionQuerySet:occlusion}:{}),colorAttachments:[{view:this.reflection.createView(),clearValue:{r:frame[24]!*1.2,g:frame[25]!*1.2,b:frame[26]!*1.2,a:1},loadOp:'clear',storeOp:'store'}],depthStencilAttachment:{view:this.reflectionDepth.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'discard'}});
      reflect.setBindGroup(1,this.gpu.reflectionBind);const query=this.profiler.beginOcclusion(reflect,'reflection');
      for(const [key,group] of materialPipelineGroups(culled.reflectedObjects)){const [code,culled]=key;reflect.setPipeline((culled?this.gpu.reflectedCulled:this.gpu.reflectedDouble).get(code)!);for(const e of group)this.draw(reflect,e,false);}
      this.profiler.endOcclusion(reflect,query);reflect.end();
    });
    let snowInstances=0;
    this.profiler.measure('encode.main',()=>{
      const timing=this.profiler.timestampWrites('main'),occlusion=this.profiler.occlusionSet(),pass=encoder.beginRenderPass({label:'render.main',...(timing?{timestampWrites:timing}:{}),...(occlusion?{occlusionQuerySet:occlusion}:{}),colorAttachments:[{view:this.hdr.createView(),clearValue:{r:0,g:0,b:0,a:1},loadOp:'clear',storeOp:'store'},{view:this.normal.createView(),clearValue:{r:.5,g:.5,b:1,a:1},loadOp:'clear',storeOp:'store'},{view:this.specular.createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'},{view:this.velocity.createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}],depthStencilAttachment:{view:this.depth.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});
      pass.setPipeline(this.gpu.sky);pass.setBindGroup(0,this.gpu.frameBind);pass.draw(3);
      this.drawCalls=0;this.triangles=0;pass.setBindGroup(1,this.gpu.lightBind);let query=this.profiler.beginOcclusion(pass,'mainOpaque');
      for(const [key,group] of materialPipelineGroups(culled.cameraOpaque)){const [code,culled]=key;pass.setPipeline((culled?this.gpu.opaqueCulled:this.gpu.opaqueDouble).get(code)!);for(const e of group)this.draw(pass,e,true);}
      this.profiler.endOcclusion(pass,query);
      pass.setPipeline(this.gpu.transparent);query=this.profiler.beginOcclusion(pass,'mainTransparent');for(const e of culled.cameraTransparent)this.draw(pass,e,true);this.profiler.endOcclusion(pass,query);
      const intensity=Math.min(1,scene.environment.snowfallRate/2.2e-5);query=this.profiler.beginOcclusion(pass,'snow');
      if(intensity>.001){const snow=new Float32Array(32);snow.set(vp);snow.set([...camera.position,1],16);snow.set([scene.time,intensity,scene.environment.wind[0],scene.environment.wind[2]],20);snow.set([...right,0],24);snow.set([...up,0],28);this.device.queue.writeBuffer(this.gpu.snowUniform,0,snow);this.profiler.addUpload(snow.byteLength,'snow');pass.setPipeline(this.gpu.snow);pass.setBindGroup(0,this.gpu.snowBind);pass.setBindGroup(1,this.gpu.lightBind);snowInstances=Math.round(24000*intensity);pass.draw(6,snowInstances);}this.profiler.endOcclusion(pass,query);
      pass.end();
    });
    this.profiler.measure('encode.bloom',()=>{
      const stages=[['bloom.downsample',this.bloomA,this.gpu.bloomDown,this.bloomDownBind],['bloom.horizontal',this.bloomB,this.gpu.bloomHorizontal,this.bloomHorizontalBind],['bloom.vertical',this.bloomA,this.gpu.bloomVertical,this.bloomVerticalBind]] as const;
      for(const [name,target,pipeline,bind] of stages){const timing=this.profiler.timestampWrites(name),bloomPass=encoder.beginRenderPass({label:`render.${name}`,...(timing?{timestampWrites:timing}:{}),colorAttachments:[{view:target.createView(),loadOp:'clear',clearValue:{r:0,g:0,b:0,a:1},storeOp:'store'}]});bloomPass.setPipeline(pipeline);bloomPass.setBindGroup(0,bind);bloomPass.draw(3);bloomPass.end();}
    });
    const taaOutputIndex=this.taaHistoryIndex===0?1:0;
    this.device.queue.writeBuffer(this.gpu.taaParams,0,new Float32Array([this.historyValid?1:0,0,0,0]));
    this.profiler.measure('encode.taa',()=>{
      const timing=this.profiler.timestampWrites('taa'),target=taaOutputIndex===0?this.taaA:this.taaB,taaPass=encoder.beginRenderPass({label:'render.taa',...(timing?{timestampWrites:timing}:{}),colorAttachments:[{view:target.createView(),loadOp:'clear',clearValue:{r:0,g:0,b:0,a:1},storeOp:'store'}]});
      taaPass.setPipeline(this.gpu.taa);taaPass.setBindGroup(0,this.taaHistoryIndex===0?this.taaBindAB:this.taaBindBA);taaPass.draw(3);taaPass.end();
    });
    this.profiler.measure('encode.post',()=>{
      const timing=this.profiler.timestampWrites('post'),post=encoder.beginRenderPass({label:'render.post',...(timing?{timestampWrites:timing}:{}),colorAttachments:[{view:this.context.getCurrentTexture().createView(),loadOp:'clear',clearValue:{r:0,g:0,b:0,a:1},storeOp:'store'}]});post.setPipeline(this.gpu.post);post.setBindGroup(0,taaOutputIndex===0?this.postBindA:this.postBindB);post.draw(3);post.end();
    });
    this.profiler.setWork({drawCalls:this.drawCalls,triangles:this.triangles,snowInstances});
    if(this.profiler.enabled){
      const sumTriangles=(entities:readonly RuntimeEntity[])=>entities.reduce((sum,e)=>sum+this.mesh(e.mesh!).triangles,0);
      const materialDraws:Record<string,number>={},materialTriangles:Record<string,number>={};
      for(const e of [...culled.cameraOpaque,...culled.cameraTransparent]){const kind=e.material.kind,triangles=this.mesh(e.mesh!).triangles;materialDraws[kind]=(materialDraws[kind]??0)+1;materialTriangles[kind]=(materialTriangles[kind]??0)+triangles;}
      const work=this.profiler.currentWork();
      this.profiler.setAtoms(buildRenderAtomReport({
        width:this.canvas.width,height:this.canvas.height,shadowDraws:shadowDrawables.length,reflectionDraws:culled.reflectedObjects.length,
        mainOpaqueDraws:culled.cameraOpaque.length,mainTransparentDraws:culled.cameraTransparent.length,snowInstances,
        shadowTriangles:sumTriangles(shadowDrawables),reflectionTriangles:sumTriangles(culled.reflectedObjects),
        mainOpaqueTriangles:sumTriangles(culled.cameraOpaque),mainTransparentTriangles:sumTriangles(culled.cameraTransparent),
        materialDraws,materialTriangles,
        uploads:{total:work.uploadBytes,uniform:work.uniformUploadBytes,surface:work.surfaceUploadBytes,light:work.lightUploadBytes,frame:work.frameUploadBytes,snow:work.snowUploadBytes},
        shaders:this.shaderAtoms,
      }));
    }
    this.profiler.resolve(encoder);
    this.profiler.measure('submit',()=>this.device.queue.submit([encoder.finish()]));this.profiler.submitted();
    this.taaHistoryIndex=taaOutputIndex;this.historyValid=true;this.previousVp=vp;this.lastRenderTime=scene.time;this.lastCamera=[...camera.position];
    const liveIds=new Set<string>();for(const entity of classified.visible){this.previousModels.set(entity.id,this.model(entity));liveIds.add(entity.id);}for(const id of this.previousModels.keys())if(!liveIds.has(id))this.previousModels.delete(id);
  }
  private queueMaterialLoads(scene:Scene):void{
    if(this.disposed)return;
    const urls=new Set([...scene.entities.values()].flatMap(e=>e.material.texture?[e.material.texture.url]:[]));
    for(const url of this.failedMaterials)if(!urls.has(url))this.failedMaterials.delete(url);
    for(const url of urls){
      if(this.surfaceTextures.get(url)||this.materialLoads.has(url)||this.failedMaterials.has(url))continue;
      const pending=this.surfaceTextures.load(url).catch(error=>{
        if(!this.disposed&&!this.failedMaterials.has(url)&&[...this.lastScene?.entities.values()??[]].some(e=>e.material.texture?.url===url)){
          this.failedMaterials.add(url);this.errors.push(error instanceof Error?error.message:String(error));
        }
      }).finally(()=>{if(this.materialLoads.get(url)===pending)this.materialLoads.delete(url);});
      this.materialLoads.set(url,pending);
    }
  }
  async prepareMaterials(scene:Scene):Promise<void>{const urls=new Set([...scene.entities.values()].map(e=>e.material.texture?.url).filter((url):url is string=>!!url));await Promise.all([...urls].map(async url=>{await this.surfaceTextures.load(url);this.failedMaterials.delete(url);}));}
  async flush():Promise<void>{await this.device.queue.onSubmittedWorkDone();}
  inspect():RenderStats{return{backend:'webgpu',width:this.canvas.width,height:this.canvas.height,drawCalls:this.drawCalls,triangles:this.triangles,meshes:this.meshes.size,objects:this.objects.size,pointLights:this.pointLights,lightOverflow:this.lightOverflow,materialTextures:this.surfaceTextures.size,buffers:this.meshes.size*2+this.objects.size+4,textures:[...this.objects.values()].filter(o=>o.owned).length+this.labels.size+this.surfaceTextures.size+15,errors:[...this.errors],profile:this.profiler.inspect()};}
  profile(){return this.profiler.inspect();}
  resetProfile():void{this.profiler.reset();}
  dispose():void{if(this.disposed)return;this.disposed=true;this.profiler?.dispose();this.materialLoads.clear();this.failedMaterials.clear();this.surfaceTextures.dispose();for(const m of this.meshes.values()){m.vertex.destroy();m.index.destroy();}for(const o of this.objects.values()){o.uniform.destroy();if(o.owned!==false)o.texture.destroy();}for(const target of [this.depth,this.hdr,this.normal,this.specular,this.velocity,this.taaA,this.taaB,this.bloomA,this.bloomB,this.gpu.taaParams,this.gpu.lightBuffer,this.gpu.cellBuffer,this.gpu.shadow,this.gpu.frame,this.gpu.snowUniform,this.gpu.emptyField,this.gpu.emptyLabel,this.gpu.noiseVolume,this.reflection,this.reflectionDepth,...this.labels.values()])target?.destroy();this.labels.clear();this.meshes.clear();this.objects.clear();}
  private prepare(entity:RuntimeEntity,vp:Mat4,previousVp:Mat4):void{
    const field=this.lastScene?.surfaces.field?.(entity.id),object=this.object(entity.id,field?.nx??0,field?.nz??0,entity.material.label??'',entity.material.texture?.url),model=this.model(entity),uniform=new Float32Array(132),surface=entity.material.surface;
    this.mesh(entity.mesh!);
    const surfaceState=this.lastScene?.surfaces.surface(entity.id),body=this.lastScene?.surfaces.body(entity.id),environment=this.lastScene?.environment,previousModel=this.previousModels.get(entity.id)??model;
    uniform.set(multiply4(vp,model));uniform.set(model,16);uniform.set(entity.material.color,32);uniform.set([surface.moss,surface.wetness,surface.roughness,surface.darkening],36);uniform.set([surface.dirt,surface.wear,stableSeed(entity.id),materialCode(entity.material.kind)],40);
    uniform.set([surfaceState?.snowDepthM??0,surfaceState?.waterDepthM??0,surfaceState?.slush??0,surfaceState?.iceDepthM??0],44);uniform.set([surfaceState?.puddle??0,surfaceState?.trackMelt??0,body?.snowCoverage??0,body?.rearSnow??0],48);uniform.set([environment?.temperatureC??18,environment?.sunlight??.65,(environment?.hour??12)/24,surfaceUseCode(entity.environmental?.surfaceUse)],52);uniform.set([body?.directionX??1,body?.directionZ??0,body?.roadDirt??0,body?.wetness??0],56);uniform.set([...this.lastCamera,1],60);
    uniform.set(field?[...field.center,...field.size]:[0,0,1,1],96);uniform.set([field?.nx??1,field?.nz??1,field?1:0,0],100);
    uniform.set([entity.material.roughness??-1,entity.material.metalness??(entity.material.kind==='steel'?.6:0),entity.material.pattern==='brick'?1:entity.material.pattern==='plaster'?2:entity.material.pattern==='rubber'?3:entity.material.pattern==='window'?4:entity.material.pattern==='fabric'?5:0,0],104);uniform.set([...(entity.material.emissive??[0,0,0]),0],108);
    const texture=entity.material.texture;uniform.set([texture?.sizeM??1,texture?.bumpStrength??.5,texture?.albedoStrength??1,texture&&this.surfaceTextures.get(texture.url)?1:0],112);uniform.set(multiply4(previousVp,previousModel),116);
    if(field){const pixels=new Float32Array(object.width*object.height*4);field.cells.forEach((c,i)=>pixels.set([c.trackMelt,c.snowDepthM,c.waterDepthM,c.slush],i*4));this.device.queue.writeTexture({texture:object.texture},pixels,{bytesPerRow:object.width*16},[object.width,object.height]);this.profiler.addUpload(pixels.byteLength,'surface');}this.device.queue.writeBuffer(object.uniform,0,uniform);this.profiler.addUpload(uniform.byteLength,'uniform');
  }
  private draw(pass:GPUAny,entity:RuntimeEntity,count:boolean):void{const mesh=this.mesh(entity.mesh!),object=this.objects.get(entity.id)!;pass.setBindGroup(0,object.bind);pass.setVertexBuffer(0,mesh.vertex);pass.setIndexBuffer(mesh.index,mesh.format);pass.drawIndexed(mesh.count);if(count){this.drawCalls++;this.triangles+=mesh.triangles;}}
  private mesh(primitive:Primitive):GPUMesh{const key=primitiveKey(primitive),found=this.meshes.get(key);if(found)return found;const data=primitiveMesh(primitive),mesh={bounds:meshBounds(data.vertices),vertex:this.buffer(data.vertices,0x20|0x08),index:this.buffer(data.indices,0x10|0x08),count:data.indices.length,format:data.indexFormat,triangles:data.indices.length/3};this.meshes.set(key,mesh);return mesh;}
  private buffer(data:ArrayBufferView,usage:number):GPUAny{const buffer=this.device.createBuffer({size:Math.max(4,(data.byteLength+3)&~3),usage,mappedAtCreation:true});new Uint8Array(buffer.getMappedRange()).set(new Uint8Array(data.buffer,data.byteOffset,data.byteLength));buffer.unmap();return buffer;}
  private collect(scene:Scene):void{this.surfaceTextures?.retain(new Set([...scene.entities.values()].flatMap(e=>e.material?.texture?[e.material.texture.url]:[])));const live=[...scene.entities.values()].filter(e=>e.mesh),ids=new Set(live.map(e=>e.id)),keys=new Set(live.map(e=>primitiveKey(e.mesh!)));if(this.labels){const labels=new Set(live.map(e=>e.material?.label));for(const [key,t] of this.labels)if(!labels.has(key)){t.destroy();this.labels.delete(key);}}for(const [id,o] of this.objects)if(!ids.has(id)){o.uniform.destroy();if(o.owned!==false)o.texture.destroy();this.objects.delete(id);}for(const [key,m] of this.meshes)if(!keys.has(key)){m.vertex.destroy();m.index.destroy();this.meshes.delete(key);}}
  private label(text:string):GPUAny{
    if(!text)return this.gpu.emptyLabel;const cached=this.labels.get(text);if(cached)return cached;
    const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=128;const ctx=canvas.getContext('2d')!;ctx.clearRect(0,0,1024,128);ctx.fillStyle='#e2d9bc';ctx.font='58px Georgia';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,512,64,940);
    const texture=this.device.createTexture({size:[1024,128],format:'rgba8unorm',usage:0x04|0x02|0x10});this.device.queue.copyExternalImageToTexture({source:canvas},{texture},[1024,128]);this.labels.set(text,texture);return texture;
  }
  private object(id:string,width:number,height:number,label:string,materialUrl?:string):GPUObject{
    const materialTexture=materialUrl?this.surfaceTextures.get(materialUrl):undefined,materialKey=materialTexture?materialUrl:undefined;
    const existing=this.objects.get(id);if(existing&&existing.width===width&&existing.height===height&&existing.label===label&&existing.materialKey===materialKey)return existing;
    if(existing){existing.uniform.destroy();if(existing.owned!==false)existing.texture.destroy();}
    const uniform=this.device.createBuffer({size:528,usage:0x40|0x08}),texture=width?this.device.createTexture({size:[width,height],format:'rgba32float',usage:0x04|0x02}):this.gpu.emptyField;
    const bind=this.device.createBindGroup({layout:this.gpu.objectLayout,entries:[{binding:0,resource:{buffer:uniform}},{binding:1,resource:texture.createView()},{binding:2,resource:this.label(label).createView()},{binding:3,resource:this.gpu.sampler},{binding:4,resource:(materialTexture??this.gpu.emptyLabel).createView()},{binding:5,resource:this.gpu.surfaceSampler}]}),object={uniform,bind,texture,width,height,owned:width>0,label,...(materialKey?{materialKey}:{})};this.objects.set(id,object);return object;
  }
  private model(entity:RuntimeEntity):Mat4{const mesh=entity.mesh,scale:Vec3=mesh?.kind==='box'||mesh?.kind==='shard'?mesh.size??[1,1,1]:mesh?.kind==='sphere'?[2*(mesh.radius??1),2*(mesh.radius??1),2*(mesh.radius??1)]:mesh?.kind==='plane'?[mesh.size?.[0]??1,1,mesh.size?.[1]??1]:[1,1,1];return compose(entity.position,entity.rotation,[entity.scale[0]*scale[0],entity.scale[1]*scale[1],entity.scale[2]*scale[2]]);}
}
function orthographic(extent:number,near:number,far:number):Mat4{return new Float32Array([1/extent,0,0,0,0,1/extent,0,0,0,0,1/(near-far),0,0,0,near/(near-far),1]);}

function halton(index:number,base:number):number{let f=1,result=0,i=index;while(i>0){f/=base;result+=f*(i%base);i=Math.floor(i/base);}return result;}
function taaJitter(frame:number):readonly[number,number]{const i=(frame%8)+1;return[halton(i,2)-.5,halton(i,3)-.5];}

function distance2(a:Vec3,b:Vec3):number{const x=a[0]-b[0],y=a[1]-b[1],z=a[2]-b[2];return x*x+y*y+z*z;}

function canCullBack(entity:RuntimeEntity):boolean{
  const kind=entity.mesh?.kind;
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

function materialCode(kind:string):number{return kind==='glass'?1:kind==='steel'?2:kind==='wood'?3:kind==='concrete'?4:kind==='asphalt'?5:kind==='snow'?6:0;}
function stableSeed(value:string):number{let h=2166136261>>>0;for(let i=0;i<value.length;i++){h^=value.charCodeAt(i);h=Math.imul(h,16777619);}return(h>>>0)/4294967295;}

function surfaceUseCode(use:string|undefined):number{return use==='road'?1:use==='sidewalk'?2:use==='curb'?3:0;}
