/** Cached GGX convolution of the actual local capture, never a roughness fade to sky. */
export const PROBE_MIP_LEVELS=8;
export const PROBE_FILTER_SAMPLES=32;
export function probeFilterPlan():readonly {face:number;mip:number;roughness:number}[]{
  return Array.from({length:PROBE_MIP_LEVELS-1},(_,index)=>index+1)
    .flatMap(mip=>Array.from({length:6},(_,face)=>({face,mip,roughness:mip/(PROBE_MIP_LEVELS-1)})));
}
export const PROBE_FILTER_SHADER=`
@group(0) @binding(0) var source:texture_cube<f32>;
@group(0) @binding(1) var sourceSampler:sampler;
struct Params { faceRoughness:vec4<f32> }
@group(0) @binding(2) var<uniform> params:Params;
struct Out { @builtin(position) position:vec4<f32>, @location(0) uv:vec2<f32> }
@vertex fn vs(@builtin(vertex_index) i:u32)->Out {
 let p=vec2<f32>(f32((i<<1u)&2u),f32(i&2u));var o:Out;
 o.position=vec4<f32>(p*2.0-1.0,0,1);o.uv=vec2<f32>(p.x,1.0-p.y);return o;
}
fn cubeDirection(face:u32,p:vec2<f32>)->vec3<f32>{
 switch face {
  case 0u: {return normalize(vec3<f32>(1,-p.y,-p.x));}
  case 1u: {return normalize(vec3<f32>(-1,-p.y,p.x));}
  case 2u: {return normalize(vec3<f32>(p.x,1,p.y));}
  case 3u: {return normalize(vec3<f32>(p.x,-1,-p.y));}
  case 4u: {return normalize(vec3<f32>(p.x,-p.y,1));}
  default: {return normalize(vec3<f32>(-p.x,-p.y,-1));}
 }
}
@fragment fn fs(in:Out)->@location(0) vec4<f32>{
 let n=cubeDirection(u32(params.faceRoughness.x),in.uv*2.0-1.0);
 let up=select(vec3<f32>(0,1,0),vec3<f32>(1,0,0),abs(n.y)>.99);
 let tangent=normalize(cross(up,n));let bitangent=cross(n,tangent);
 let a2=pow(params.faceRoughness.y,4.0);var sum=vec3<f32>(0);var total=0.0;
 for(var i=0u;i<${PROBE_FILTER_SAMPLES}u;i++){
  let xi=vec2<f32>(f32(i)/${PROBE_FILTER_SAMPLES}.0,f32(reverseBits(i))*2.3283064365386963e-10);
  let phi=6.28318530718*xi.x;let cosTheta=sqrt((1.0-xi.y)/(1.0+(a2-1.0)*xi.y));
  let sinTheta=sqrt(max(0.0,1.0-cosTheta*cosTheta));
  let h=tangent*(cos(phi)*sinTheta)+bitangent*(sin(phi)*sinTheta)+n*cosTheta;
  let l=reflect(-n,h);let weight=max(dot(n,l),0.0);
  sum+=textureSampleLevel(source,sourceSampler,l,0).rgb*weight;total+=weight;
 }
 return vec4<f32>(sum/max(total,.000001),1);
}
`;
