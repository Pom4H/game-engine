/** UV-space coating abrasion. UVs are signed along/across the original surface;
 * seed and severity are stable authoring data, independent of camera and pose. */
export const COATING_LOSS_WGSL=/* wgsl */`
fn coatingHash(p:vec2f)->f32{return fract(sin(dot(p,vec2f(127.1,311.7)))*43758.5453);}
fn coatingNoise(p:vec2f)->f32{
 let i=floor(p);var f=fract(p);f=f*f*(3.-2.*f);
 return mix(mix(coatingHash(i),coatingHash(i+vec2f(1,0)),f.x),mix(coatingHash(i+vec2f(0,1)),coatingHash(i+vec2f(1,1)),f.x),f.y);
}
fn coatingLoss(uv:vec2f,width:vec2f,seed:f32,severity:f32)->vec2f{
 let edgeNoise=coatingNoise(uv*vec2f(9.,5.)+seed*.17)-.5;
 let tip=1.-smoothstep(.55,1.,abs(uv.x));
 let edge=min(1.-abs(uv.x),.38+.48*tip-abs(uv.y)+edgeNoise*.25);
 let aa=clamp(max(width.x,width.y),.015,.3);
 let coverage=smoothstep(-aa,aa,edge);
 let streak=coatingNoise(uv*vec2f(3.,32.)+seed*.31);
 let bare=coverage*smoothstep(.18,.70,severity)*smoothstep(.05,.42,edge+(streak-.5)*.15)*(.22+.78*smoothstep(.28,.72,streak));
 return vec2f(coverage,bare);
}
`;
