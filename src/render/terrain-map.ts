/** Original Game finite-map water optics. This is a presentation kernel; it
 * neither displaces terrain nor creates water/physics state. */
export const TERRAIN_MAP_WGSL=/* wgsl */`
fn terrainMapUV(sourceXZ:vec2f,size:f32,dimensions:vec2u)->vec2f{
 let edge=.5/vec2f(dimensions);
 return clamp(sourceXZ/size+.5,edge,vec2f(1.)-edge);
}
fn terrainWaterMask(color:vec3f)->f32{
 return step(color.r*1.42,color.b)*step(color.g*1.06,color.b);
}
// Absolute source UV derivatives recover the original horizontal axes even
// after a rigid Office rotation or a large render-origin change.
fn terrainSourceAxes(dpX:vec3f,dpY:vec3f,uvX:vec2f,uvY:vec2f)->mat2x2f{
 let determinant=uvX.x*uvY.y-uvX.y*uvY.x;
 if(abs(determinant)<1e-10){return mat2x2f(vec2f(1.,0.),vec2f(0.,1.));}
 let x=(dpX*uvY.y-dpY*uvX.y)/determinant;
 let z=(dpY*uvX.x-dpX*uvY.x)/determinant;
 return mat2x2f(x.xz/max(length(x.xz),1e-10),z.xz/max(length(z.xz),1e-10));
}
fn terrainWaterNormal(geometricNormal:vec3f,sourceXZ:vec2f,time:f32,axes:mat2x2f)->vec3f{
 let wave=axes*vec2f(sin(sourceXZ.x*.3+time)*.025,cos(sourceXZ.y*.4+time)*.025);
 let n=geometricNormal+vec3f(wave.x,0.,wave.y);
 return select(geometricNormal,n*inverseSqrt(max(dot(n,n),1e-12)),dot(n,n)>1e-12);
}
`;
