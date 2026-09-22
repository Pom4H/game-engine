/** Camera/exposure controls and lighting are independent of simulation cadence. */
export const FRAME_WGSL=`
struct Frame {
 lightVP:mat4x4<f32>, sun:vec4<f32>, sunColor:vec4<f32>, sky:vec4<f32>,
 eye:vec4<f32>, forward:vec4<f32>, right:vec4<f32>, up:vec4<f32>, params:vec4<f32>, reflectionVP:mat4x4<f32>,
 viewVP:mat4x4<f32>, previousVP:mat4x4<f32>, environment:vec4<f32>, projection:vec4<f32>,
 irradiance0:vec4<f32>, irradiance1:vec4<f32>, irradiance2:vec4<f32>, irradiance3:vec4<f32>, irradiance4:vec4<f32>,
 irradiance5:vec4<f32>, irradiance6:vec4<f32>, irradiance7:vec4<f32>, irradiance8:vec4<f32>
}
`;
export const SKY_SHADER=FRAME_WGSL+`
@group(0) @binding(0) var<uniform> f:Frame;
struct Out {@builtin(position) position:vec4<f32>,@location(0) uv:vec2<f32>}
@vertex fn vs(@builtin(vertex_index) i:u32)->Out {let p=vec2<f32>(f32((i<<1u)&2u),f32(i&2u));var o:Out;o.position=vec4<f32>(p*2.0-1.0,.999999,1.0);o.uv=p;return o;}
fn hash(p:vec2<f32>)->f32 {return fract(sin(dot(p,vec2<f32>(127.1,311.7)))*43758.54);}
fn noise(p:vec2<f32>)->f32{let i=floor(p);let v=fract(p);let q=v*v*(3.0-2.0*v);return mix(mix(hash(i),hash(i+vec2<f32>(1,0)),q.x),mix(hash(i+vec2<f32>(0,1)),hash(i+vec2<f32>(1,1)),q.x),q.y);}
@fragment fn fs(i:Out)->@location(0) vec4<f32>{
 let p=i.uv*2.0-1.0;let ray=normalize(f.forward.xyz+f.right.xyz*((p.x-f.projection.z)/f.projection.x)+f.up.xyz*((p.y-f.projection.w)/f.projection.y));
 let humidity=clamp(f.environment.w,0.0,1.0);
 let sunlight=clamp(f.environment.y,0.0,1.0);
 let haze=smoothstep(.55,.98,humidity)*(1.0-.35*sunlight);
 let horizon=f.sky.rgb*(1.12+.12*haze)+f.sunColor.rgb*f.sun.w*.018;
 let zenith=f.sky.rgb*mix(.42,.58,haze);
 var color=mix(horizon,zenith,pow(max(ray.y,0.0),.58));
 let sun=max(dot(ray,f.sun.xyz),0.0);color+=f.sunColor.rgb*f.sun.w*(pow(sun,150.0)*.070+smoothstep(.99980,.99995,sun)*1.55);
 let q=ray.xz/max(.10,ray.y)*.8+vec2<f32>(f.up.w*.001,0);
 let clouds=noise(q)*.55+noise(q*2.1)*.29+noise(q*4.2)*.16;
 let cloudDrive=smoothstep(.48,.88,humidity)*(1.0-.55*sunlight);
 let cloudOpacity=cloudDrive*smoothstep(.50,.84,clouds)*smoothstep(.02,.35,ray.y)*.38;
 color=mix(color,mix(f.sky.rgb*1.18,vec3<f32>(.82,.86,.90),haze*.55),cloudOpacity);
 color+=f.sky.rgb*(.035+.055*haze)*pow(1.0-max(ray.y,0.0),5.0);
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
 // Preserve sub-pixel decals, trim and material boundaries. Static high-contrast
 // pixels already have strong current-frame evidence; accumulating 90% bilinear
 // history there turns real detail into a stable blur.
 let localRange=max(max(hi.r-lo.r,hi.g-lo.g),hi.b-lo.b);
 let detail=smoothstep(.035,.20,localRange);
 weight*=mix(1.0,.58,detail);
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
fn viewPos(uv:vec2<f32>,z:f32)->vec3<f32>{let ndc=vec2<f32>(uv.x*2.0-1.0,1.0-uv.y*2.0);return vec3<f32>((ndc.x-f.projection.z)/f.projection.x*z,(ndc.y-f.projection.w)/f.projection.y*z,-z);}
fn project(p:vec3<f32>)->vec2<f32>{let ndc=vec2<f32>(f.projection.x*p.x/max(-p.z,.0001)+f.projection.z,f.projection.y*p.y/max(-p.z,.0001)+f.projection.w);return vec2<f32>(ndc.x*.5+.5,.5-ndc.y*.5);}
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
 let d=textureLoad(depth,pixel,0);
 // Background with a pinhole camera cannot contribute AO/GI/SSR and has zero
 // circle-of-confusion. Return the mathematically identical HDR+bloom result
 // before normal/depth-neighbour work; large sky regions become almost free.
 if(d>=.99999){
  let backgroundZ=linearDepth(d);
  let backgroundCoc=min(6.0,abs(backgroundZ-f.params.z)/max(backgroundZ,.1)*f.params.w);
  if(backgroundCoc<=.15){
   let background=textureSampleLevel(hdr,linearSampler,uv,0).rgb+textureSampleLevel(bloom,linearSampler,uv,0).rgb*.28;
   return vec4<f32>(background,1);
  }
 }
 let z=linearDepth(d);let pos=viewPos(uv,z);
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
  let baseDirections=array<vec2<f32>,4>(vec2<f32>(1,0),vec2<f32>(0,1),vec2<f32>(-1,0),vec2<f32>(0,-1));
  let phaseIndex=(u32(pixel.x)&1u)|((u32(pixel.y)&1u)<<1u);
  let phaseCos=array<f32,4>(1.0,.92387953,.70710678,.38268343);
  let phaseSin=array<f32,4>(0.0,.38268343,.70710678,.92387953);
  let cs=phaseCos[phaseIndex];
  let sn=phaseSin[phaseIndex];
  let radii=array<f32,2>(.035,.24);let weights=array<f32,2>(.58,.42);
  for(var ring=0;ring<2;ring++){
   let worldRadius=radii[ring];let radius=clamp(worldRadius*size.y*f.projection.y/(max(z,.1)*2.0),1.0,64.0);
   for(var k=0;k<4;k++){
    let baseDirection=baseDirections[k];
    let direction=vec2<f32>(baseDirection.x*cs-baseDirection.y*sn,baseDirection.x*sn+baseDirection.y*cs);
    let delta=positionAt(pixel+vec2<i32>(round(direction*radius)),size)-pos;let separation=length(delta);
    let horizon=max(dot(geometric,delta/max(separation,.001))-.06,0.0);
    let range=1.0-smoothstep(worldRadius*.30,worldRadius*1.25,separation);
    // A 2x2 pixel quad covers four angular phases while each pixel pays 4 directions.
    occlusion+=horizon*range*weights[ring]*1.5*smoothstep(.0015,.004,separation);
   }
  }
 }
 let coc=min(6.0,abs(z-f.params.z)/max(z,.1)*f.params.w);
 var base=textureSampleLevel(hdr,linearSampler,uv,0).rgb;
 if(coc>.15){var sum=base;for(var k=0;k<8;k++){sum+=textureSampleLevel(hdr,linearSampler,uv+offsets[k]*coc/size,0).rgb;}base=sum/9.0;}
 var color=base*(1.0-min(.58,occlusion*.34));
 // One-ring screen-space diffuse bounce. Samples are projected in world metres,
 // so the effect is stable across resolution and naturally rejects same-plane
 // neighbours through the hemisphere term. This gives cheap local colour bleed
 // under cars, beside warm masonry and around shop recesses without scene probes.
 if(d<.99999){
  let giDirs=array<vec2<f32>,6>(vec2<f32>(1,0),vec2<f32>(.5,.866),vec2<f32>(-.5,.866),vec2<f32>(-1,0),vec2<f32>(-.5,-.866),vec2<f32>(.5,-.866));
  let giRadius=clamp(.42*size.y*f.projection.y/(max(z,.1)*2.0),3.0,42.0);
  var indirect=vec3<f32>(0);var indirectWeight=0.0;
  for(var gi=0;gi<6;gi++){
   let q=clamp(pixel+vec2<i32>(round(giDirs[gi]*giRadius)),vec2<i32>(0),dims-1);
   let qp=positionAt(q,size);let delta=qp-pos;let separation=length(delta);
   if(separation>.035&&separation<.82){
    let direction=delta/separation;
    let qWorldNormal=textureLoad(normals,q,0).xyz*2.0-1.0;
    let qn=viewNormal(qWorldNormal);
    let receive=max(dot(n,direction)-.04,0.0);
    let emit=max(dot(qn,-direction),0.0);
    let range=1.0-smoothstep(.08,.82,separation);
    let weight=receive*(.35+.65*emit)*range;
    indirect+=textureLoad(hdr,q,0).rgb*weight;indirectWeight+=weight;
   }
  }
  if(indirectWeight>.001){color+=indirect/indirectWeight*.034*(.72+.28*normalSample.a);}
 }
 // Screen-space radiance for smooth materials, with explicit misses. Wet ground
 // uses its geometry reflection pass; rough/offscreen surfaces keep sky fallback.
 let coating=textureLoad(reflectance,pixel,0);let rough=normalSample.a;
 // Only smooth reflective pixels pay the neighbourhood-depth and ray-march cost.
 if(d<.99999&&rough<.55&&coating.a>.5&&length(wn)>.92){
  let coverage=depthSpan(pixel);
  if(coverage.y-coverage.x<.015+z*.001){
   let ray=reflect(normalize(pos),n);let origin=pos+n*.035;var previous=origin;var previousDelta=-.1;
   for(var step=1;step<=28;step++){
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
      let strength=edge*pow(1.0-rough,1.55)*smoothstep(.04,.34,facing)*(1.0-smoothstep(thickness*.5,thickness,gap));
      let radius=clamp(rough*rough*t/max(hitZ,.1)*size.y/(f.forward.w*2.0)*.18,.5,10.0);
      var radiance=textureSampleLevel(hdr,linearSampler,hitUV,0).rgb*.40;
      for(var tap=0;tap<6;tap++){radiance+=textureSampleLevel(hdr,linearSampler,hitUV+offsets[tap]*radius/size,0).rgb*.10;}
      color=color*(1.0-coating.rgb*strength*.72)+radiance*coating.rgb*strength*.90;break;
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
fn linearToSrgb(x:vec3<f32>)->vec3<f32>{
 let lo=x*12.92;let hi=1.055*pow(max(x,vec3<f32>(0)),vec3<f32>(1.0/2.4))-.055;
 return select(hi,lo,x<=vec3<f32>(.0031308));
}
@fragment fn fs(in:Out)->@location(0) vec4<f32>{
 let texel=1.0/vec2<f32>(textureDimensions(source));
 let center=textureSampleLevel(source,linearSampler,in.uv,0).rgb;
 let neighbourhood=(textureSampleLevel(source,linearSampler,in.uv+vec2<f32>(texel.x,0),0).rgb+
                    textureSampleLevel(source,linearSampler,in.uv-vec2<f32>(texel.x,0),0).rgb+
                    textureSampleLevel(source,linearSampler,in.uv+vec2<f32>(0,texel.y),0).rgb+
                    textureSampleLevel(source,linearSampler,in.uv-vec2<f32>(0,texel.y),0).rgb)*.25;
 // Presentation is deliberately neutral: exposure + reconstruction + display
 // transform only. Scene mood must come from radiance, materials and the camera.
 let reconstructed=max(vec3<f32>(0),center+(center-neighbourhood)*.15)*f.sunColor.w;
 var mapped=acesPresent(reconstructed);
 let luma=dot(mapped,vec3<f32>(.2126,.7152,.0722));
 mapped=mix(vec3<f32>(luma),mapped,1.015);
 return vec4<f32>(clamp(linearToSrgb(mapped),vec3<f32>(0),vec3<f32>(1)),1);
}
`;

/** @deprecated Use EFFECTS_SHADER for HDR effects and PRESENT_SHADER for display conversion. */
export const POST_SHADER=EFFECTS_SHADER;
