import {lookAt,multiply4,perspective,V3,type Mat4,type Vec3} from '../math.js';
import type {RenderLight} from './light-grid.js';

export const SPOT_SHADOW_LIMIT=2;
export const SPOT_SHADOW_SIZE=512;
export interface ShadowSpot extends RenderLight {id:string}
export interface SpotShadow {source:ShadowSpot;slot:number;matrix:Mat4;strength:number}
/** Bounded spotlight shadows, independent of the camera and sun frusta. Stable
 * slots keep a car's left/right maps from swapping as the camera turns. */
export function selectSpotShadows(sources:readonly ShadowSpot[],eye:Vec3,previous:readonly SpotShadow[]=[]):SpotShadow[]{
 const eligible=sources.filter(s=>s.light?.castShadow&&s.light.emission&&!s.light.emission.boxHalfSize&&s.light.emission.outerAngle<Math.PI/2&&(s.light.range??12)>.08&&(s.light.intensity??1)>.01)
  .map(source=>({source,distance:V3.length(V3.sub(source.position,eye))})).filter(c=>c.distance<45)
  .sort((a,b)=>a.distance-b.distance||a.source.id.localeCompare(b.source.id));
 const chosen=eligible.slice(0,SPOT_SHADOW_LIMIT),used=new Set<number>();
 const slots=new Map<string,number>();
 for(const old of previous)if(chosen.some(c=>c.source.id===old.source.id)){slots.set(old.source.id,old.slot);used.add(old.slot);}
 for(const c of chosen)if(!slots.has(c.source.id)){const slot=Array.from({length:SPOT_SHADOW_LIMIT},(_,i)=>i).find(i=>!used.has(i))!;slots.set(c.source.id,slot);used.add(slot);}
 return chosen.map(({source,distance})=>{
  const light=source.light!,emission=light.emission!,axis=V3.normalize(emission.axis),up:Vec3=Math.abs(axis[1])>.95?[0,0,1]:[0,1,0];
  const matrix=multiply4(perspective(emission.outerAngle*2,1,.08,light.range??12),lookAt(source.position,V3.add(source.position,axis),up));
  const fade=Math.max(0,Math.min(1,(distance-25)/20));
  return{source,slot:slots.get(source.id)!,matrix,strength:1-fade*fade*(3-2*fade)};
 });
}

export const SPOT_SHADOW_WGSL=`
struct ShadowSpot {vp:mat4x4<f32>,params:vec4<f32>}
@group(1) @binding(13) var spotShadowMap:texture_depth_2d_array;
@group(1) @binding(14) var<uniform> shadowSpots:array<ShadowSpot,2>;
fn spotShadowVisibility(source:PointSource,world:vec3<f32>,normal:vec3<f32>)->f32{
 // housing.w is a 1-based shadow slot only for polar sources without a box.
 if(source.housing.x>0.0||source.housing.w<.5){return 1.0;}
 let slot=i32(source.housing.w)-1;let shadow=shadowSpots[slot];
 let clip=shadow.vp*vec4<f32>(world+normal*.008,1);
 if(clip.w<=0.0){return 1.0;}
 let ndc=clip.xyz/clip.w;let uv=ndc.xy*vec2<f32>(.5,-.5)+.5;
 if(any(uv<vec2<f32>(0))||any(uv>vec2<f32>(1))||ndc.z<0.0||ndc.z>1.0){return 1.0;}
 // A grazing receiver changes depth even inside one hardware-linear PCF
 // sample. Compare against its plane at each gathered texel centre, retaining
 // the same four bilinear taps without a slope-dependent light-leaking bias.
 // Analytic tangents work inside the divergent, bounded local-light loop;
 // screen derivatives there would violate WebGPU derivative uniformity.
 let tangent=normalize(cross(normal,select(vec3<f32>(0,1,0),vec3<f32>(1,0,0),abs(normal.y)>.9)));
 let bitangent=cross(normal,tangent);
 let dx=shadow.vp*vec4<f32>(tangent,0);let dy=shadow.vp*vec4<f32>(bitangent,0);
 let px=(dx.xyz*clip.w-clip.xyz*dx.w)/(clip.w*clip.w);
 let py=(dy.xyz*clip.w-clip.xyz*dy.w)/(clip.w*clip.w);
 let gradient=shadowReceiverGradient(vec3<f32>(px.xy*vec2<f32>(.5,-.5),px.z),vec3<f32>(py.xy*vec2<f32>(.5,-.5),py.z));
 let size=vec2<f32>(textureDimensions(spotShadowMap));let texel=1.0/size;var visibility=0.0;
 for(var i=0u;i<4u;i++){
  let sampleUV=uv+SHADOW_TAPS[i]*texel;let pixel=sampleUV*size-.5;let base=floor(pixel);let blend=fract(pixel);
  let low=clamp(vec2<i32>(base),vec2<i32>(0),vec2<i32>(size)-1);
  let high=clamp(vec2<i32>(base)+1,vec2<i32>(0),vec2<i32>(size)-1);
  // Depth gather requires a non-filtering sampler. Explicit loads preserve the
  // existing frame bind layout and all 16 depth texels of the old linear PCF.
  let depths=vec4<f32>(
   textureLoad(spotShadowMap,vec2<i32>(low.x,high.y),slot,0),
   textureLoad(spotShadowMap,high,slot,0),
   textureLoad(spotShadowMap,vec2<i32>(high.x,low.y),slot,0),
   textureLoad(spotShadowMap,low,slot,0)
  );
  let refs=vec4<f32>(
   dot(gradient,(vec2<f32>(f32(low.x),f32(high.y))+.5)*texel-uv),
   dot(gradient,(vec2<f32>(high)+.5)*texel-uv),
   dot(gradient,(vec2<f32>(f32(high.x),f32(low.y))+.5)*texel-uv),
   dot(gradient,(vec2<f32>(low)+.5)*texel-uv)
  )+ndc.z-.000002;
  // A cleared far texel contains no occluder. A receiver plane extrapolated
  // past the light's far plane must not turn that empty texel into a shadow.
  let lit=select(select(vec4<f32>(0),vec4<f32>(1),refs<=depths),vec4<f32>(1),depths>=vec4<f32>(1));
  visibility+=mix(mix(lit.w,lit.z,blend.x),mix(lit.x,lit.y,blend.x),blend.y);
 }
 return mix(1.0,visibility*.25,shadow.params.x);
}
`;
