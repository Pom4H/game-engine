/** Shared camera/shadow/probe intersection. A height map describes a bounded
 * inward relief in metres: white is the raster shell, black is its full depth.
 * It cannot represent overhangs or extend the silhouette outside that shell. */
export const SURFACE_HIT_WGSL=`
@group(0) @binding(9) var heightTexture:texture_2d<f32>;
struct SurfaceHit {position:vec3<f32>,previousPosition:vec3<f32>,normal:vec3<f32>}
fn surfaceBasis()->mat3x3<f32>{return mat3x3<f32>(normalize(u.model[0].xyz),normalize(u.model[1].xyz),normalize(u.model[2].xyz));}
fn surfacePoint(p:vec3<f32>)->vec3<f32>{return transpose(surfaceBasis())*(p-u.model[3].xyz);}
fn surfaceDepth(p:vec3<f32>,weights:vec3<f32>)->f32{
 let scale=max(u.texture.x,.001);
 let h=textureSampleLevel(heightTexture,surfaceSampler,p.zy/scale,0).r*weights.x+textureSampleLevel(heightTexture,surfaceSampler,p.xz/scale,0).r*weights.y+textureSampleLevel(heightTexture,surfaceSampler,p.xy/scale,0).r*weights.z;
 return (1.0-h)*u.relief.x;
}
fn surfacePrevious(local:vec3<f32>)->vec3<f32>{let scale=vec3<f32>(length(u.model[0].xyz),length(u.model[1].xyz),length(u.model[2].xyz));return (u.prevModel*vec4<f32>(local/max(scale,vec3<f32>(.00001)),1)).xyz;}
fn intersectSurface(base:vec3<f32>,worldNormal:vec3<f32>,ray:vec3<f32>,pixels:f32)->SurfaceHit{
 let basis=surfaceBasis();let origin=surfacePoint(base);let n=normalize(transpose(basis)*worldNormal);let d=normalize(transpose(basis)*ray);
 var result:SurfaceHit;result.position=base;result.previousPosition=surfacePrevious(origin);result.normal=worldNormal;
 if(u.relief.x<=0.0||u.relief.y<.5||dot(n,d)>-.04){return result;}
 let weight0=pow(abs(n),vec3<f32>(4));let weights=weight0/max(dot(weight0,vec3<f32>(1)),.0001);
 // Error is projected size, rather than a fixed distance threshold. Below a
 // fraction of a pixel the displacement smoothly converges to the base shell.
 let accuracy=smoothstep(.35,2.0,pixels);let extent=u.relief.x*accuracy;
 if(extent<.000001){return result;}
 let steps=select(8u,16u,pixels>6.0);let end=extent/max(.04,-dot(n,d));var lo=0.0;var hi=end;
 for(var i=1u;i<=16u;i++){if(i>steps){break;}let t=end*f32(i)/f32(steps);let p=origin+d*t;let f=dot(p-origin,n)+surfaceDepth(p,weights)*accuracy;if(f<=0.0){hi=t;break;}lo=t;}
 for(var i=0u;i<4u;i++){let t=(lo+hi)*.5;let p=origin+d*t;if(dot(p-origin,n)+surfaceDepth(p,weights)*accuracy>0.0){lo=t;}else{hi=t;}}
 let p=origin+d*(lo+hi)*.5;let axis=select(vec3<f32>(0,1,0),vec3<f32>(1,0,0),abs(n.y)>.9);let tangent=normalize(cross(axis,n));let bitangent=cross(n,tangent);
 let e=max(.00005,u.texture.x/f32(max(textureDimensions(heightTexture).x,textureDimensions(heightTexture).y)));
 let du=(surfaceDepth(p+tangent*e,weights)-surfaceDepth(p-tangent*e,weights))*accuracy/(2.0*e);
 let dv=(surfaceDepth(p+bitangent*e,weights)-surfaceDepth(p-bitangent*e,weights))*accuracy/(2.0*e);
 result.position=u.model[3].xyz+basis*p;result.previousPosition=surfacePrevious(p);result.normal=normalize(basis*(n+tangent*du+bitangent*dv));return result;
}
fn surfaceVisibility(hit:vec3<f32>,shell:vec3<f32>,normal:vec3<f32>,light:vec3<f32>)->f32{
 if(u.relief.x<=0.0||u.relief.y<.5){return 1.0;}
 let basis=surfaceBasis();let n=normalize(transpose(basis)*normal);let d=normalize(transpose(basis)*light);if(dot(n,d)<=.02){return 1.0;}
 let origin=surfacePoint(shell);let start=surfacePoint(hit);let weight0=pow(abs(n),vec3<f32>(4));let weights=weight0/max(dot(weight0,vec3<f32>(1)),.0001);
 let distance=max(0.0,-dot(start-origin,n))/max(.02,dot(n,d));
 for(var i=1u;i<=8u;i++){let p=start+d*distance*f32(i)/8.0;if(dot(p-origin,n)+surfaceDepth(p,weights)<-max(.0001,u.relief.x*.015)){return .12;}}
 return 1.0;
}
`;

export const SURFACE_UNIFORM_WGSL=`
struct U {model:mat4x4<f32>,prevModel:mat4x4<f32>,color:vec4<f32>,surface:vec4<f32>,weather:vec4<f32>,surfacePhase:vec4<f32>,surfaceDynamics:vec4<f32>,motion:vec4<f32>,objectState:vec4<f32>,fieldFrame:vec4<f32>,fieldSize:vec4<f32>,pbr:vec4<f32>,emission:vec4<f32>,texture:vec4<f32>,detail:vec4<f32>,snowpack:vec4<f32>,relief:vec4<f32>,surfaceOverride:vec4<f32>,groundDetail:vec4<f32>}
@group(0) @binding(0) var<uniform> u:U;
@group(0) @binding(5) var surfaceSampler:sampler;
`;

/** Auxiliary passes use the identical material intersection and normal. */
export function surfacePassShader(kind:'shadow'|'probe'|'reflection',frameWGSL:string):string{
 const shadow=kind==='shadow',probe=kind==='probe';
 const projection=probe?'p.vp':shadow?'f.lightVP':'f.reflectionVP';
 const ray=shadow?'-f.sun.xyz':probe?'normalize(in.worldPos-p.eye.xyz)':'normalize(in.worldPos-vec3<f32>(f.eye.x,.03-f.eye.y,f.eye.z))';
 return (probe?'struct P {vp:mat4x4<f32>,sun:vec4<f32>,sunColor:vec4<f32>,sky:vec4<f32>,eye:vec4<f32>}':frameWGSL)+SURFACE_UNIFORM_WGSL+SURFACE_HIT_WGSL+`
 @group(1) @binding(0) var<uniform> ${probe?'p:P':'f:Frame'};
 struct O {@builtin(position) position:vec4<f32>,@location(0) normal:vec3<f32>,@location(1) worldPos:vec3<f32>,@location(2) color:vec3<f32>}
 @vertex fn vs(@location(0) position:vec3<f32>,@location(1) normal:vec3<f32>${shadow?'':',@location(6) color:vec4<f32>'})->O{
  let world=u.model*vec4<f32>(position,1);let a=u.model[0].xyz;let b=u.model[1].xyz;let c=u.model[2].xyz;
  var o:O;o.position=${projection}*world;o.worldPos=world.xyz;o.normal=normalize(mat3x3<f32>(a/dot(a,a),b/dot(b,b),c/dot(c,c))*normal);o.color=${shadow?'vec3<f32>(1)':'color.rgb'};return o;
 }
 ${shadow?'':'struct R {@location(0) color:vec4<f32>,@builtin(frag_depth) depth:f32}'}
 @fragment fn fs(in:O)->${shadow?'@builtin(frag_depth) f32':'R'}{
  let pixels=u.relief.x/max(.000001,max(length(dpdx(in.worldPos)),length(dpdy(in.worldPos))));
  let hit=intersectSurface(in.worldPos,normalize(in.normal),${ray},pixels);let clip=${projection}*vec4<f32>(hit.position,1);let depth=clamp(clip.z/clip.w,0.0,1.0);
  ${shadow?'return depth;':`
   ${probe?'':'if(hit.position.y<.04){discard;}'}
   let sun=${probe?'p':'f'}.sun;let sky=${probe?'p':'f'}.sky.rgb;let sunColor=${probe?'p':'f'}.sunColor.rgb;
   let ndl=max(dot(hit.normal,sun.xyz),0.0)*surfaceVisibility(hit.position,in.worldPos,normalize(in.normal),sun.xyz);
   let base=pow(max(u.color.rgb*in.color*(1.0-select(0.0,u.surface.w,u.surfaceOverride.x>.5)),vec3<f32>(0)),vec3<f32>(2.2));var out:R;out.depth=depth;
   out.color=vec4<f32>(base*(sky*(.35+1.15*max(hit.normal.y,0.0))+sunColor*sun.w*ndl*.72)+u.emission.rgb,1);return out;`}
 }
 `;
}
