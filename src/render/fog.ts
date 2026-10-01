/** Single scattering in a homogeneous medium. Equiangular quadrature includes
 * housing emission and attenuation from lamp to sample to eye. No added halo.
 * HG phase: https://pbr-book.org/4ed/Volume_Scattering/Phase_Functions
 * Bounded approximation; does not trace volumetric scene shadows.
 */
export const FOG_WGSL=`
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
  sum+=emissionWeight(source,fromLight)*rangeWeight*exp(-density*(t+distance))*phase;
 }
 return source.color.rgb*source.color.w*density*.78*(b-a)/core*sum/f32(count);
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
