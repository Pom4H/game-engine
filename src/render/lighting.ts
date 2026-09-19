/** Camera/exposure controls and lighting are independent of simulation cadence. */
export const FRAME_WGSL=`
struct Frame {
 lightVP:mat4x4<f32>, sun:vec4<f32>, sunColor:vec4<f32>, sky:vec4<f32>,
 eye:vec4<f32>, forward:vec4<f32>, right:vec4<f32>, up:vec4<f32>, params:vec4<f32>, reflectionVP:mat4x4<f32>
}
`;
export const SKY_SHADER=FRAME_WGSL+`
@group(0) @binding(0) var<uniform> f:Frame;
struct Out {@builtin(position) position:vec4<f32>,@location(0) uv:vec2<f32>}
@vertex fn vs(@builtin(vertex_index) i:u32)->Out {let p=vec2<f32>(f32((i<<1u)&2u),f32(i&2u));var o:Out;o.position=vec4<f32>(p*2.0-1.0,.999999,1.0);o.uv=p;return o;}
fn hash(p:vec2<f32>)->f32 {return fract(sin(dot(p,vec2<f32>(127.1,311.7)))*43758.54);}
fn noise(p:vec2<f32>)->f32{let i=floor(p);let v=fract(p);let q=v*v*(3.0-2.0*v);return mix(mix(hash(i),hash(i+vec2<f32>(1,0)),q.x),mix(hash(i+vec2<f32>(0,1)),hash(i+vec2<f32>(1,1)),q.x),q.y);}
@fragment fn fs(i:Out)->@location(0) vec4<f32>{
 let p=i.uv*2.0-1.0;let ray=normalize(f.forward.xyz+f.right.xyz*p.x*f.right.w*f.forward.w+f.up.xyz*p.y*f.forward.w);
 let horizon=f.sky.rgb*1.22+f.sunColor.rgb*f.sun.w*.027;
 var color=mix(horizon,f.sky.rgb*.45,pow(max(ray.y,0.0),.5));
 let sun=max(dot(ray,f.sun.xyz),0.0);color+=f.sunColor.rgb*f.sun.w*(pow(sun,90.0)*.1+smoothstep(.99972,.9999,sun)*1.8);
 let q=ray.xz/max(.10,ray.y)*.8+vec2<f32>(f.up.w*.001,0);
 let clouds=noise(q)*.55+noise(q*2.1)*.29+noise(q*4.2)*.16;
 color=mix(color,f.sky.rgb*1.30,smoothstep(.52,.86,clouds)*smoothstep(.02,.35,ray.y)*.36);
 return vec4<f32>(color,1);
}`;
export const POST_SHADER=FRAME_WGSL+`
@group(0) @binding(0) var hdr:texture_2d<f32>;
@group(0) @binding(1) var normals:texture_2d<f32>;
@group(0) @binding(2) var depth:texture_depth_multisampled_2d;
@group(0) @binding(3) var linearSampler:sampler;
@group(0) @binding(4) var<uniform> f:Frame;
struct Out {@builtin(position) position:vec4<f32>,@location(0) uv:vec2<f32>}
@vertex fn vs(@builtin(vertex_index) i:u32)->Out{let p=vec2<f32>(f32((i<<1u)&2u),f32(i&2u));var o:Out;o.position=vec4<f32>(p*2.0-1.0,0,1);o.uv=vec2<f32>(p.x,1.0-p.y);return o;}
fn linearDepth(d:f32)->f32{return 500.0/(10000.0-d*9999.95);}
fn viewPos(uv:vec2<f32>,z:f32)->vec3<f32>{return vec3<f32>((uv.x*2.0-1.0)*f.right.w*f.forward.w*z,(1.0-uv.y*2.0)*f.forward.w*z,-z);}
fn aces(x:vec3<f32>)->vec3<f32>{return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),vec3<f32>(0),vec3<f32>(1));}
@fragment fn fs(in:Out)->@location(0) vec4<f32>{
 let dims=vec2<i32>(textureDimensions(hdr));let size=vec2<f32>(dims);let uv=in.uv;let pixel=clamp(vec2<i32>(uv*size),vec2<i32>(0),dims-1);
 let d=textureLoad(depth,pixel,0);let z=linearDepth(d);let pos=viewPos(uv,z);
 let wn=textureLoad(normals,pixel,0).xyz*2.0-1.0;
 let n=normalize(vec3<f32>(dot(wn,f.right.xyz),dot(wn,f.up.xyz),-dot(wn,f.forward.xyz)));
 let offsets=array<vec2<f32>,12>(vec2<f32>(1,0),vec2<f32>(.5,.86),vec2<f32>(-.5,.86),vec2<f32>(-1,0),vec2<f32>(-.5,-.86),vec2<f32>(.5,-.86),vec2<f32>(.4,.3),vec2<f32>(-.4,.3),vec2<f32>(.4,-.3),vec2<f32>(-.4,-.3),vec2<f32>(0,.6),vec2<f32>(0,-.6));
 var occlusion=0.0;
 let radius=clamp(.65*size.y/(max(z,.1)*f.forward.w*2.0),2.0,70.0);
 if(d<.99999){for(var k=0;k<12;k++){
  let coord=clamp(pixel+vec2<i32>(offsets[k]*radius),vec2<i32>(0),dims-1);let other=linearDepth(textureLoad(depth,coord,0));
  let delta=viewPos((vec2<f32>(coord)+.5)/size,other)-pos;let distance=length(delta);
  occlusion+=max(dot(n,delta/max(distance,.001))-.16,0.0)*exp(-distance*distance*2.0);
 }}
 let coc=min(6.0,abs(z-f.params.z)/max(z,.1)*f.params.w);
 var base=textureSampleLevel(hdr,linearSampler,uv,0).rgb;
 if(coc>.15){var sum=base;for(var k=0;k<12;k++){sum+=textureSampleLevel(hdr,linearSampler,uv+offsets[k]*coc/size,0).rgb;}base=sum/13.0;}
 var color=base*(1.0-min(.55,occlusion*.24));
 var bloom=vec3<f32>(0);
 for(var k=0;k<12;k++){let c=textureSampleLevel(hdr,linearSampler,uv+offsets[k]*vec2<f32>(9.0,9.0)/size,0).rgb;bloom+=max(c-vec3<f32>(1.0),vec3<f32>(0));}
 color+=bloom*.035;
 color*=f.sunColor.w;
 color=pow(aces(color),vec3<f32>(1.0/2.2));
 let vignette=1.0-.13*pow(length((uv-.5)*vec2<f32>(1.1,1.0)),1.8);color*=vignette;
 return vec4<f32>(color,1);
}`;
