/** Single scattering in a homogeneous medium. Equiangular quadrature includes
 * housing emission and attenuation from lamp to sample to eye. No added halo.
 * HG phase: https://pbr-book.org/4ed/Volume_Scattering/Phase_Functions
 * Bounded approximation; does not trace volumetric scene shadows.
 */
import type {Vec3} from '../math.js';

/** Exact column through an exponential ground layer, including its flat base. */
export function fogOpticalDepth(origin:Vec3,position:Vec3,density:number,falloff=0,baseHeight=0):number{
 const distance=Math.hypot(...position.map((v,k)=>v-origin[k]!));
 if(falloff<=1e-5)return distance*density;
 const low=Math.min(origin[1],position[1])-baseHeight,high=Math.max(origin[1],position[1])-baseHeight,delta=high-low;
 if(delta<.0001)return distance*density*Math.exp(-Math.max(0,low)*falloff);
 const below=Math.max(0,Math.min(1,-low/delta)),a=Math.max(0,low),b=Math.max(0,high);
 return distance*density*(below+Math.exp(-a*falloff)*(-Math.expm1(-(b-a)*falloff))/(falloff*delta));
}
export function fogViewOpticalDepth(origin:Vec3,position:Vec3,density:number,falloff=0,baseHeight=0,start=0,ramp=0):number{
 const distance=Math.hypot(...position.map((v,k)=>v-origin[k]!)),after=Math.max(0,distance-start);
 const integral=ramp<=.0001?after:after<ramp?after*after/(2*ramp):after-ramp*.5;
 return fogOpticalDepth(origin,position,density,falloff,baseHeight)*integral/Math.max(distance,.0001);
}
export const FOG_MEDIUM_WGSL=`
fn fogRampAverage(distance:f32,start:f32,ramp:f32)->f32{
 let after=max(0.0,distance-start);
 if(ramp<=.0001){return after/max(distance,.0001);}
 let integral=select(after*after/(2.0*ramp),after-ramp*.5,after>=ramp);
 return integral/max(distance,.0001);
}
fn fogOpticalDepth(origin:vec3<f32>,position:vec3<f32>,density:f32)->f32{
 let distance=length(position-origin);let falloff=f.fogMedium.x;
 if(falloff<=.00001){return distance*density;}
 let low=min(origin.y,position.y)-f.fogColor.w;let high=max(origin.y,position.y)-f.fogColor.w;let delta=high-low;
 if(delta<.0001){return distance*density*exp(-max(0.0,low)*falloff);}
 let below=clamp(-low/delta,0.0,1.0);let a=max(0.0,low);let b=max(0.0,high);
 return distance*density*(below+exp(-a*falloff)*(1.0-exp(-(b-a)*falloff))/(falloff*delta));
}
fn fogLocalDensity(position:vec3<f32>,density:f32)->f32{
 return density*exp(-max(0.0,position.y-f.fogColor.w)*f.fogMedium.x);
}
fn fogViewDepth(origin:vec3<f32>,position:vec3<f32>,density:f32)->f32{
 return fogOpticalDepth(origin,position,density)*fogRampAverage(length(position-origin),f.fogMedium.z,f.fogMedium.w);
}
`;
export const FOG_WGSL=FOG_MEDIUM_WGSL+`
fn pointFogIntegral(source:PointSource,origin:vec3<f32>,ray:vec3<f32>,rayLength:f32,density:f32)->vec3<f32>{
 let radius=source.position.w;let delta=source.position.xyz-origin;let along=dot(delta,ray);
 let perpendicular2=max(0.0,dot(delta,delta)-along*along);
 if(radius<=0.0||perpendicular2>=radius*radius){return vec3<f32>(0);}
 let extent=sqrt(max(0.0,radius*radius-perpendicular2));
 let begin=max(0.0,along-extent);let end=min(rayLength,along+extent);
 if(end<=begin){return vec3<f32>(0);}
 let core=sqrt(perpendicular2+.0144);
 let a=atan((begin-along)/core);let b=atan((end-along)/core);
 let count=select(2u,4u,dot(source.axis.xyz,source.axis.xyz)>.5);
 var sum=0.0;
 for(var i=0u;i<count;i++){
  let t=along+core*tan(mix(a,b,(f32(i)+.5)/f32(count)));
  let fromLight=origin+ray*t-source.position.xyz;let distance=length(fromLight);
  let rangeWeight=pow(max(0.0,1.0-distance/radius),2.0);
  let cosine=dot(fromLight/max(distance,.0001),-ray);let g=.45;
  let denominator=max(.001,1.0+g*g-2.0*g*cosine);
  let phase=(1.0-g*g)/(12.5663706*denominator*sqrt(denominator));
  let samplePosition=origin+ray*t;
  let attenuation=exp(-fogViewDepth(origin,samplePosition,density)-fogOpticalDepth(source.position.xyz,samplePosition,density));
  let ramp=clamp((t-f.fogMedium.z)/max(f.fogMedium.w,.0001),0.0,1.0);
  sum+=emissionWeight(source,fromLight)*rangeWeight*attenuation*phase*fogLocalDensity(samplePosition,density)*ramp;
 }
 return source.color.rgb*source.color.w*.78*(b-a)/core*sum/f32(count);
}
fn pointFog(origin:vec3<f32>,position:vec3<f32>,density:f32)->vec3<f32>{
 if(density<=.00001){return vec3<f32>(0);}
 let delta=position-origin;let rayLength=length(delta);
 if(rayLength<=.00001){return vec3<f32>(0);}
 let ray=delta/rayLength;var result=vec3<f32>(0);var seen:array<u32,8>;
 for(var sample=0u;sample<3u;sample++){
  let cell=lightCell(origin+delta*(f32(sample)*.5));if(cell==0xffffffffu){continue;}
  let count=min(lightCells[cell],16u);
  for(var j=0u;j<count;j++){
   let index=lightCells[cell+1u+j];let word=index>>5u;let bit=1u<<(index&31u);
   if((seen[word]&bit)!=0u){continue;}
   seen[word]|=bit;result+=pointFogIntegral(lightGrid.sources[index],origin,ray,rayLength,density);
  }
 }
 return result;
}
`;
