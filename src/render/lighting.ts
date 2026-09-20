/** Camera/exposure controls and lighting are independent of simulation cadence. */
export const FRAME_WGSL=`
struct Frame {
 lightVP:mat4x4<f32>, sun:vec4<f32>, sunColor:vec4<f32>, sky:vec4<f32>,
 eye:vec4<f32>, forward:vec4<f32>, right:vec4<f32>, up:vec4<f32>, params:vec4<f32>, reflectionVP:mat4x4<f32>,
 viewVP:mat4x4<f32>, previousVP:mat4x4<f32>, environment:vec4<f32>
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
 let clear=smoothstep(.58,.92,f.environment.y);
 let authoredHorizon=f.sky.rgb*1.22+f.sunColor.rgb*f.sun.w*.027;
 let clearHorizon=vec3<f32>(.56,.73,.94);let clearZenith=vec3<f32>(.10,.28,.62);
 let horizon=mix(authoredHorizon,clearHorizon,clear*.58);
 let zenith=mix(f.sky.rgb*.45,clearZenith,clear*.68);
 var color=mix(horizon,zenith,pow(max(ray.y,0.0),.55));
 let sun=max(dot(ray,f.sun.xyz),0.0);color+=f.sunColor.rgb*f.sun.w*(pow(sun,110.0)*.085+smoothstep(.99976,.99993,sun)*1.65);
 let q=ray.xz/max(.10,ray.y)*.8+vec2<f32>(f.up.w*.001,0);
 let clouds=noise(q)*.55+noise(q*2.1)*.29+noise(q*4.2)*.16;
 let cloudOpacity=(1.0-clear*.82)*smoothstep(.52,.86,clouds)*smoothstep(.02,.35,ray.y)*.32;
 color=mix(color,mix(f.sky.rgb*1.24,vec3<f32>(.88,.92,.97),clear*.35),cloudOpacity);
 // Bright clear winter horizons retain aerial perspective without grey fogging the whole frame.
 color+=clear*vec3<f32>(.08,.10,.13)*pow(1.0-max(ray.y,0.0),5.0);
 return vec4<f32>(color,1);
}`;
/** Threshold/downsample followed by two separable Gaussian passes. Sampling a
 * blurred low-resolution texture prevents the shifted emitter silhouettes of
 * sparse full-resolution bloom taps and bounds the post-process cost. */
export const BLOOM_SHADER=`
@group(0) @binding(0) var source:texture_2d<f32>;
@group(0) @binding(1) var imageSampler:sampler;
struct Out {@builtin(position) position:vec4<f32>,@location(0) uv:vec2<f32>}
@vertex fn vs(@builtin(vertex_index) i:u32)->Out{let p=vec2<f32>(f32((i<<1u)&2u),f32(i&2u));var o:Out;o.position=vec4<f32>(p*2.0-1.0,0,1);o.uv=vec2<f32>(p.x,1.0-p.y);return o;}
@fragment fn downsample(in:Out)->@location(0) vec4<f32>{
 let texel=1.0/vec2<f32>(textureDimensions(source));var color=vec3<f32>(0);
 for(var y=0;y<4;y++){for(var x=0;x<4;x++){
  let value=textureSampleLevel(source,imageSampler,in.uv+(vec2<f32>(f32(x),f32(y))-1.5)*texel,0).rgb;
  let brightness=max(max(value.r,value.g),value.b);let soft=clamp(brightness-.5,0.0,1.0);
  color+=value*max(brightness-1.0,soft*soft*.5)/max(brightness,.0001);
 }}return vec4<f32>(color/16.0,1);
}
fn gaussian(uv:vec2<f32>,axis:vec2<f32>)->vec4<f32>{
 let texel=axis/vec2<f32>(textureDimensions(source));var sum=vec3<f32>(0);var total=0.0;
 for(var k=-8;k<=8;k++){let x=f32(k);let weight=exp(-x*x/20.48);sum+=textureSampleLevel(source,imageSampler,uv+texel*x,0).rgb*weight;total+=weight;}
 return vec4<f32>(sum/total,1);
}
@fragment fn horizontal(in:Out)->@location(0) vec4<f32>{return gaussian(in.uv,vec2<f32>(1,0));}
@fragment fn vertical(in:Out)->@location(0) vec4<f32>{return gaussian(in.uv,vec2<f32>(0,1));}
`;
export const TAA_SHADER=`
@group(0) @binding(0) var currentColor:texture_2d<f32>;
@group(0) @binding(1) var historyColor:texture_2d<f32>;
@group(0) @binding(2) var velocityTex:texture_2d<f32>;
@group(0) @binding(3) var depthTex:texture_depth_2d;
@group(0) @binding(4) var linearSampler:sampler;
struct TaaParams { history:vec4<f32> }
@group(0) @binding(5) var<uniform> taa:TaaParams;
struct Out {@builtin(position) position:vec4<f32>,@location(0) uv:vec2<f32>}
@vertex fn vs(@builtin(vertex_index) i:u32)->Out{let p=vec2<f32>(f32((i<<1u)&2u),f32(i&2u));var o:Out;o.position=vec4<f32>(p*2.0-1.0,0,1);o.uv=vec2<f32>(p.x,1.0-p.y);return o;}
@fragment fn fs(in:Out)->@location(0) vec4<f32>{
 let dims=vec2<i32>(textureDimensions(currentColor));
 let size=vec2<f32>(dims);
 let pixel=clamp(vec2<i32>(in.uv*size),vec2<i32>(0),dims-1);
 let current=textureLoad(currentColor,pixel,0).rgb;
 let velocity=textureLoad(velocityTex,pixel,0).xy;
 let historyUV=in.uv-velocity;
 var lo=current;var hi=current;
 for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){let q=clamp(pixel+vec2<i32>(x,y),vec2<i32>(0),dims-1);let v=textureLoad(currentColor,q,0).rgb;lo=min(lo,v);hi=max(hi,v);}}
 let valid=taa.history.x>0.5&&all(historyUV>vec2<f32>(.001))&&all(historyUV<vec2<f32>(.999));
 let previous=clamp(textureSampleLevel(historyColor,linearSampler,clamp(historyUV,vec2<f32>(.001),vec2<f32>(.999)),0).rgb,lo,hi);
 let speed=length(velocity)*size.y;
 let depth=textureLoad(depthTex,pixel,0);
 var weight=select(0.0,mix(.90,.72,smoothstep(.35,10.0,speed)),valid);
 if(depth>.99999){weight=min(weight,.55);}
 let delta=max(max(abs(previous.r-current.r),abs(previous.g-current.g)),abs(previous.b-current.b));
 weight*=1.0-smoothstep(.12,.55,delta);
 return vec4<f32>(mix(current,previous,weight),1);
}
`;
export const EFFECTS_SHADER=FRAME_WGSL+`
@group(0) @binding(0) var hdr:texture_2d<f32>;
@group(0) @binding(1) var normals:texture_2d<f32>;
@group(0) @binding(2) var depth:texture_depth_2d;
@group(0) @binding(3) var linearSampler:sampler;
@group(0) @binding(4) var<uniform> f:Frame;
@group(0) @binding(5) var reflectance:texture_2d<f32>;
@group(0) @binding(6) var bloom:texture_2d<f32>;
struct Out {@builtin(position) position:vec4<f32>,@location(0) uv:vec2<f32>}
@vertex fn vs(@builtin(vertex_index) i:u32)->Out{let p=vec2<f32>(f32((i<<1u)&2u),f32(i&2u));var o:Out;o.position=vec4<f32>(p*2.0-1.0,0,1);o.uv=vec2<f32>(p.x,1.0-p.y);return o;}
fn linearDepth(d:f32)->f32{return 500.0/(10000.0-d*9999.95);}
fn viewPos(uv:vec2<f32>,z:f32)->vec3<f32>{return vec3<f32>((uv.x*2.0-1.0)*f.right.w*f.forward.w*z,(1.0-uv.y*2.0)*f.forward.w*z,-z);}
fn project(p:vec3<f32>)->vec2<f32>{return vec2<f32>(p.x/(-p.z*f.forward.w*f.right.w)*.5+.5,.5-p.y/(-p.z*f.forward.w)*.5);}
fn viewNormal(n:vec3<f32>)->vec3<f32>{return normalize(vec3<f32>(dot(n,f.right.xyz),dot(n,f.up.xyz),-dot(n,f.forward.xyz)));}
fn depthSpan(pixel:vec2<i32>)->vec2<f32>{
 let dims=vec2<i32>(textureDimensions(depth));let p=clamp(pixel,vec2<i32>(0),dims-1);
 var near=linearDepth(textureLoad(depth,p,0));var far=near;
 let offsets=array<vec2<i32>,4>(vec2<i32>(1,0),vec2<i32>(-1,0),vec2<i32>(0,1),vec2<i32>(0,-1));
 for(var i=0;i<4;i++){let q=clamp(p+offsets[i],vec2<i32>(0),dims-1);let z=linearDepth(textureLoad(depth,q,0));near=min(near,z);far=max(far,z);}return vec2<f32>(near,far);
}
fn positionAt(pixel:vec2<i32>,size:vec2<f32>)->vec3<f32>{
 let coord=clamp(pixel,vec2<i32>(0),vec2<i32>(size)-1);return viewPos((vec2<f32>(coord)+.5)/size,linearDepth(textureLoad(depth,coord,0)));
}
fn aces(x:vec3<f32>)->vec3<f32>{return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),vec3<f32>(0),vec3<f32>(1));}
@fragment fn fs(in:Out)->@location(0) vec4<f32>{
 let dims=vec2<i32>(textureDimensions(hdr));let size=vec2<f32>(dims);let uv=in.uv;let pixel=clamp(vec2<i32>(uv*size),vec2<i32>(0),dims-1);
 let d=textureLoad(depth,pixel,0);let z=linearDepth(d);let pos=viewPos(uv,z);
 let normalSample=textureLoad(normals,pixel,0);let wn=normalSample.xyz*2.0-1.0;
 let n=viewNormal(wn);
 let offsets=array<vec2<f32>,12>(vec2<f32>(1,0),vec2<f32>(.5,.86),vec2<f32>(-.5,.86),vec2<f32>(-1,0),vec2<f32>(-.5,-.86),vec2<f32>(.5,-.86),vec2<f32>(.4,.3),vec2<f32>(-.4,.3),vec2<f32>(.4,-.3),vec2<f32>(-.4,-.3),vec2<f32>(0,.6),vec2<f32>(0,-.6));
 var occlusion=0.0;
 if(d<.99999){
  // Recover the geometric normal from the nearest same-surface neighbours.
  // Bump normals cause self-darkening, while a derivative across a silhouette
  // causes a dark halo on otherwise open ground behind the object.
  let xr=positionAt(pixel+vec2<i32>(1,0),size)-pos;let xl=pos-positionAt(pixel-vec2<i32>(1,0),size);
  let yd=positionAt(pixel+vec2<i32>(0,1),size)-pos;let yu=pos-positionAt(pixel-vec2<i32>(0,1),size);
  let dx=select(xr,xl,dot(xl,xl)<dot(xr,xr));let dy=select(yd,yu,dot(yu,yu)<dot(yd,yd));
  var geometric=cross(dy,dx);geometric=normalize(geometric+n*.00000001);geometric*=select(-1.0,1.0,dot(geometric,n)>0.0);
  let directions=array<vec2<f32>,6>(vec2<f32>(1,0),vec2<f32>(.5,.866),vec2<f32>(-.5,.866),vec2<f32>(-1,0),vec2<f32>(-.5,-.866),vec2<f32>(.5,-.866));
  let radii=array<f32,2>(.035,.24);let weights=array<f32,2>(.58,.42);
  for(var ring=0;ring<2;ring++){
   let worldRadius=radii[ring];let radius=clamp(worldRadius*size.y/(max(z,.1)*f.forward.w*2.0),1.0,64.0);
   for(var k=0;k<6;k++){
    let delta=positionAt(pixel+vec2<i32>(round(directions[k]*radius)),size)-pos;let separation=length(delta);
    let horizon=max(dot(geometric,delta/max(separation,.001))-.06,0.0);
    let range=1.0-smoothstep(worldRadius*.30,worldRadius*1.25,separation);
    // The inner ring strengthens boot/snow and trim/wall contacts without
    // spreading the darkness over the broad foreground/background gap.
    occlusion+=horizon*range*weights[ring]*smoothstep(.0015,.004,separation);
   }
  }
 }
 let coc=min(6.0,abs(z-f.params.z)/max(z,.1)*f.params.w);
 var base=textureSampleLevel(hdr,linearSampler,uv,0).rgb;
 if(coc>.15){var sum=base;for(var k=0;k<8;k++){sum+=textureSampleLevel(hdr,linearSampler,uv+offsets[k]*coc/size,0).rgb;}base=sum/9.0;}
 var color=base*(1.0-min(.52,occlusion*.29));
 // Screen-space radiance for smooth materials, with explicit misses. Wet ground
 // uses its geometry reflection pass; rough/offscreen surfaces keep sky fallback.
 let coating=textureLoad(reflectance,pixel,0);let rough=normalSample.a;
 // Only smooth reflective pixels pay the neighbourhood-depth and ray-march cost.
 if(d<.99999&&rough<.55&&coating.a>.5&&length(wn)>.92){
  let coverage=depthSpan(pixel);
  if(coverage.y-coverage.x<.015+z*.001){
   let ray=reflect(normalize(pos),n);let origin=pos+n*.035;var previous=origin;var previousDelta=-.1;
   for(var step=1;step<=20;step++){
    let t=.05*f32(step)+.028*f32(step*step);let q=origin+ray*t;if(q.z>-.08){break;}
    let ruv=project(q);
    if(any(ruv<vec2<f32>(.005))||any(ruv>vec2<f32>(.995))){break;}
    let coord=clamp(vec2<i32>(ruv*size),vec2<i32>(0),dims-1);let sceneZ=linearDepth(textureLoad(depth,coord,0));let delta=-q.z-sceneZ;
    if(delta>0.0&&previousDelta<=0.0&&t>.20){
     var lo=previous;var hi=q;var hitUV=ruv;
     for(var refine=0;refine<3;refine++){let mid=(lo+hi)*.5;hitUV=project(mid);let hp=clamp(vec2<i32>(hitUV*size),vec2<i32>(0),dims-1);if(-mid.z>linearDepth(textureLoad(depth,hp,0))){hi=mid;}else{lo=mid;}}
     hitUV=project(hi);let hp=clamp(vec2<i32>(hitUV*size),vec2<i32>(0),dims-1);let hitCoverage=depthSpan(hp);let hitZ=linearDepth(textureLoad(depth,hp,0));
     let hitWorldNormal=textureLoad(normals,hp,0).xyz*2.0-1.0;let facing=dot(viewNormal(hitWorldNormal),-ray);let gap=abs(-hi.z-hitZ);let thickness=min(.08,.025+t*.004);
     if(gap<thickness&&facing>.05&&hitCoverage.y-hitCoverage.x<.015+hitZ*.001&&length(hitWorldNormal)>.92&&distance(hitUV,uv)*size.y>3.0){
      let edge=smoothstep(0.0,.08,min(min(hitUV.x,1.0-hitUV.x),min(hitUV.y,1.0-hitUV.y)));
      let strength=edge*pow(1.0-rough,2.0)*smoothstep(.05,.4,facing)*(1.0-smoothstep(thickness*.5,thickness,gap));
      let radius=clamp(rough*rough*t/max(hitZ,.1)*size.y/(f.forward.w*2.0)*.18,.5,10.0);
      var radiance=textureSampleLevel(hdr,linearSampler,hitUV,0).rgb*.34;
      for(var tap=0;tap<6;tap++){radiance+=textureSampleLevel(hdr,linearSampler,hitUV+offsets[tap]*radius/size,0).rgb*.11;}
      color=color*(1.0-coating.rgb*strength*.55)+radiance*coating.rgb*strength;break;
     }
    }
    previous=q;previousDelta=delta;
   }
  }
 }
 color+=textureSampleLevel(bloom,linearSampler,uv,0).rgb*.28;
 return vec4<f32>(color,1);
}`;

export const PRESENT_SHADER=FRAME_WGSL+`
@group(0) @binding(0) var source:texture_2d<f32>;
@group(0) @binding(1) var linearSampler:sampler;
@group(0) @binding(2) var<uniform> f:Frame;
struct Out {@builtin(position) position:vec4<f32>,@location(0) uv:vec2<f32>}
@vertex fn vs(@builtin(vertex_index) i:u32)->Out{let p=vec2<f32>(f32((i<<1u)&2u),f32(i&2u));var o:Out;o.position=vec4<f32>(p*2.0-1.0,0,1);o.uv=vec2<f32>(p.x,1.0-p.y);return o;}
fn acesPresent(x:vec3<f32>)->vec3<f32>{return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),vec3<f32>(0),vec3<f32>(1));}
@fragment fn fs(in:Out)->@location(0) vec4<f32>{
 let texel=1.0/vec2<f32>(textureDimensions(source));
 let center=textureSampleLevel(source,linearSampler,in.uv,0).rgb;
 let neighbourhood=(textureSampleLevel(source,linearSampler,in.uv+vec2<f32>(texel.x,0),0).rgb+
                    textureSampleLevel(source,linearSampler,in.uv-vec2<f32>(texel.x,0),0).rgb+
                    textureSampleLevel(source,linearSampler,in.uv+vec2<f32>(0,texel.y),0).rgb+
                    textureSampleLevel(source,linearSampler,in.uv-vec2<f32>(0,texel.y),0).rgb)*.25;
 // Small display-space reconstruction sharpens TAA without reintroducing shimmer.
 var color=max(vec3<f32>(0),center+(center-neighbourhood)*.17)*f.sunColor.w;
 color=pow(acesPresent(color),vec3<f32>(1.0/2.2));
 let luma=dot(color,vec3<f32>(.2126,.7152,.0722));
 color=mix(vec3<f32>(luma),color,1.075);
 color=clamp((color-.5)*1.045+.5,vec3<f32>(0),vec3<f32>(1));
 // Cool reflected winter fill and warm sun highlights produce photographic
 // separation while retaining the physical HDR light ratios.
 color+=vec3<f32>(-.006,.001,.010)*(1.0-smoothstep(.22,.55,luma));
 color+=vec3<f32>(.010,.004,-.004)*smoothstep(.58,.92,luma);
 let vignette=1.0-.032*pow(length((in.uv-.5)*vec2<f32>(1.1,1.0)),1.8);
 return vec4<f32>(clamp(color,vec3<f32>(0),vec3<f32>(1))*vignette,1);
}
`;

/** @deprecated Use EFFECTS_SHADER for HDR effects and PRESENT_SHADER for display conversion. */
export const POST_SHADER=EFFECTS_SHADER;
