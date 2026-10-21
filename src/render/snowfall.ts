import type {Mat4,Vec3} from '../math.js';

type SnowCamera={camera:Vec3;right:Vec3;up:Vec3;time:number};
/** Current and previous absolute simulation times; no worker-local frame clock. */
export function snowfallUniform(vp:Mat4,current:SnowCamera,intensity:number,wind:Vec3,seed:number,previous:SnowCamera=current):Float32Array{
 const data=new Float32Array(44);
 data.set(vp);data.set([...current.camera,(seed>>>0)&0xffffff],16);
 data.set([current.time,intensity,wind[0],wind[2]],20);
 data.set([...current.right,0],24);data.set([...current.up,0],28);
 data.set([...previous.camera,previous.time],32);
 data.set([...previous.right,0],36);data.set([...previous.up,0],40);
 return data;
}

export function snowfallShader(logarithmic=false):string{return `
@group(1) @binding(0) var<uniform> f:Frame;
struct S {vp:mat4x4<f32>,camera:vec4<f32>,params:vec4<f32>,right:vec4<f32>,up:vec4<f32>,previousCamera:vec4<f32>,previousRight:vec4<f32>,previousUp:vec4<f32>}
@group(0) @binding(0) var<uniform> s:S;
struct O {@builtin(position) position:vec4<f32>,@location(0) alpha:f32,@location(1) uv:vec2<f32>,@location(2) tone:vec3<f32>,@location(3) currentClip:vec4<f32>,@location(4) previousClip:vec4<f32>}
// Integer mixing keeps particle identity stable across GPU sin implementations.
fn hash1(value:u32)->f32{var h=value^u32(s.camera.w);h=(h^(h>>16u))*0x7feb352du;h=(h^(h>>15u))*0x846ca68bu;h=h^(h>>16u);return f32(h&0xffffffu)/16777216.0;}
fn center(i:u32,t:f32,camera:vec3<f32>)->vec3<f32>{
 let rx=hash1(i*13u);let rz=hash1(i*79u);let ry=hash1(i*31u);let phase=hash1(i*43u)*6.2831853;
 let wx=rx*52.0+s.params.z*t*.32+sin(t*.8+phase)*.17;
 let wz=rz*52.0+s.params.w*t*.32+cos(t*.63+phase)*.15;
 return vec3<f32>(camera.x+fract((wx-camera.x+26.0)/52.0)*52.0-26.0,fract(ry-t*(.024+hash1(i*5u)*.025))*20.0,camera.z+fract((wz-camera.z+26.0)/52.0)*52.0-26.0);
}
fn corner(q:vec2<f32>,i:u32,t:f32)->vec2<f32>{let a=t*.45+hash1(i*47u)*6.2831853;return vec2<f32>(q.x*cos(a)-q.y*sin(a),q.x*sin(a)+q.y*cos(a));}
@vertex fn vs(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->O{
 let i=instance+1u;let t=s.params.x;let world=center(i,t,s.camera.xyz);
 var corners=array<vec2<f32>,6>(vec2<f32>(-1,-1),vec2<f32>(1,-1),vec2<f32>(1,1),vec2<f32>(-1,-1),vec2<f32>(1,1),vec2<f32>(-1,1));let q=corners[vertex];
 let distance=length(world-s.camera.xyz);let size=.008+pow(hash1(i*9u),3.0)*.022;
 let local=corner(q,i,t);let previousLocal=corner(q,i,s.previousCamera.w);
 let before=center(i,s.previousCamera.w,s.previousCamera.xyz);
 var out:O;out.position=s.vp*vec4<f32>(world+(s.right.xyz*local.x+s.up.xyz*local.y)*size,1);
 out.currentClip=out.position;out.previousClip=f.previousVP*vec4<f32>(before+(s.previousRight.xyz*previousLocal.x+s.previousUp.xyz*previousLocal.y)*size,1);
 // A wrapped flake is a new sample, not a 52-metre motion trail.
 if(length(before-world)>5.0){out.previousClip=out.currentClip;}
 out.uv=q;out.alpha=(.38+hash1(i*3u)*.5)*smoothstep(.3,1.4,distance)*(1.0-smoothstep(21.0,26.0,max(abs(world.x-s.camera.x),abs(world.z-s.camera.z))));
 var incident=f.sky.rgb*1.8+f.sunColor.rgb*f.sun.w*.12;let cell=lightCell(world);
 if(cell!=0xffffffffu){for(var k=0u;k<lightCells[cell];k++){let source=lightGrid.sources[lightCells[cell+1u+k]];let delta=world-source.position.xyz;let d=length(delta);incident+=source.color.rgb*source.color.w*pow(max(0.0,1.0-d/source.position.w),2.0)*emissionWeight(source,delta)/max(1.0,d*d*.4);}}
 let transmittance=exp(-fogViewDepth(s.camera.xyz,world,f.sky.w));
 out.tone=mix(vec3<f32>(.86,.92,1)*incident*(.77+hash1(i*7u)*.23),f.fogColor.rgb,1.0-transmittance);return out;
}
struct F {@location(0) color:vec4<f32>,@location(3) velocity:vec4<f32>${logarithmic?',@builtin(frag_depth) depth:f32':''}}
@fragment fn fs(in:O)->F{
 let r=length(in.uv);let lobes=.84+.06*cos(atan2(in.uv.y,in.uv.x)*6.0);let alpha=in.alpha*(1.0-smoothstep(.15,lobes,r));
 if(alpha<.005){discard;}
 let now=in.currentClip.xy/max(in.currentClip.w,.001);let before=in.previousClip.xy/max(in.previousClip.w,.001);
 var out:F;out.color=vec4<f32>(in.tone,alpha);out.velocity=vec4<f32>((now-before)*vec2<f32>(.5,-.5),0,alpha);${logarithmic?'out.depth=logarithmicCameraDepth(in.currentClip.w,f.cameraDepth.x);':''}return out;
}
`;}
export const SNOWFALL_WGSL=snowfallShader();
