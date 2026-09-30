/** Single scattering from existing world-space point emitters. Analytic ray /
 * finite-light-sphere integration avoids a froxel allocation and a raymarch.
 * Isotropic phase; attenuation is evaluated at closest approach. This is an
 * unshadowed approximation, not multiple scattering or volumetric shadowing.
 * Three spatial-light-grid cells supply candidates, with duplicates removed.
 */
export const FOG_WGSL=`
fn pointFogIntegral(source:PointSource,origin:vec3<f32>,ray:vec3<f32>,rayLength:f32,density:f32)->vec3<f32>{
 let radius=source.position.w;
 let delta=source.position.xyz-origin;
 let along=dot(delta,ray);
 let perpendicular2=max(0.0,dot(delta,delta)-along*along);
 if(radius<=0.0||perpendicular2>=radius*radius){return vec3<f32>(0);}
 let extent=sqrt(max(0.0,radius*radius-perpendicular2));
 let begin=max(0.0,along-extent);let end=min(rayLength,along+extent);
 if(end<=begin){return vec3<f32>(0);}
 // A finite 12 cm emitter core keeps the integral bounded through a lamp.
 let softDistance=sqrt(perpendicular2+.0144);
 let integral=(atan((end-along)/softDistance)-atan((begin-along)/softDistance))/softDistance;
 let rangeWeight=pow(max(0.0,1.0-sqrt(perpendicular2)/radius),2.0);
 let transmittance=exp(-density*clamp(along,begin,end));
 let axial=clamp(along/max(rayLength,.001),0.0,1.0);
 let core=exp(-perpendicular2/max(.08,radius*radius*.010));
 // Dense near-emitter aureole + a broader halo. Both are radiance from the
 // actual point emitter, so the glow stays causal and disappears with it.
 let aureole=core*2.25+pow(rangeWeight,.42)*.42;
 return source.color.rgb*source.color.w*integral*rangeWeight*transmittance*density*.22
      +source.color.rgb*source.color.w*aureole*transmittance*density*.12*(1.0-axial*.18);
}
fn pointFog(origin:vec3<f32>,position:vec3<f32>,density:f32)->vec3<f32>{
 if(density<=.00001){return vec3<f32>(0);}
 let delta=position-origin;let rayLength=length(delta);
 if(rayLength<=.00001){return vec3<f32>(0);}
 let ray=delta/rayLength;
 var result=vec3<f32>(0);var seen:array<u32,8>;
 // A light need not illuminate the final surface to scatter along this ray.
 for(var sample=0u;sample<3u;sample++){
  let cell=lightCell(origin+delta*(f32(sample)*.5));
  if(cell==0xffffffffu){continue;}
  let count=min(lightCells[cell],16u);
  for(var j=0u;j<count;j++){
   let index=lightCells[cell+1u+j];let word=index>>5u;let bit=1u<<(index&31u);
   if((seen[word]&bit)!=0u){continue;}
   seen[word]|=bit;
   result+=pointFogIntegral(lightGrid.sources[index],origin,ray,rayLength,density);
  }
 }
 return result;
}
`;
