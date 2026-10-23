/** Optional optical detail for authored turf and near-ground blades. No simulation or meshes. */
export type GroundCover='turf'|'grass-blade';
export function validateGroundCover(value:unknown):asserts value is GroundCover{
 if(value!=='turf'&&value!=='grass-blade')throw new TypeError('groundCover must be turf or grass-blade');
}
/** Same metre-based filtered kernel as TheGame. Independent names avoid host shader collisions. */
export const GROUND_COVER_WGSL=/* wgsl */`
fn turfHash(p:vec2f)->f32 {return fract(sin(dot(p,vec2f(127.1,311.7)))*43758.5453);}
fn turfNoise(p:vec2f)->f32 {let i=floor(p);var f=fract(p);f=f*f*(3.-2.*f);return mix(mix(turfHash(i),turfHash(i+vec2f(1,0)),f.x),mix(turfHash(i+vec2f(0,1)),turfHash(i+vec2f(1,1)),f.x),f.y);}

fn turf(p:vec2f,base:vec3f,foot:f32)->vec3f {
 let variation=turfNoise(p*.72);let dry=smoothstep(.57,.84,turfNoise(p*.23+vec2f(71.,19.)))*.065;
 var color=base*(.97+variation*.05);
 color=mix(color,vec3f(.34,.285,.13),dry);
 let detail=1.-smoothstep(.006,.038,foot);
 if(detail<=0.){return color;}
 let cell=floor(p/.045);let q=fract(p/.045)*.045;
 let a=turfHash(cell+vec2f(13.,37.));let b=turfHash(cell+vec2f(53.,11.));let c=turfHash(cell+vec2f(91.,23.));
 let center=(vec2f(a,b)*.48+.26)*.045;
 let dir=normalize(vec2f(a-.5,b-.5)+vec2f(.001,.003));
 let relative=q-center;let along=dot(relative,dir);let side=dot(relative,vec2f(-dir.y,dir.x));
 let len=.009+c*.013;let t=clamp((along+len)/(2.*len),0.,1.);
 let width=.0009+.0018*(1.-t);let aa=max(.0007,foot*.65);
 let ends=(1.-smoothstep(len-aa,len+aa,abs(along)));
 let blade=(1.-smoothstep(width-aa,width+aa,abs(side)))*ends;
 let shade=(1.-smoothstep(width-aa,width+aa,abs(side-.0035)))*ends;
 color*=1.-shade*.16*detail;
 let bladeColor=base*(.76+t*.32+c*.13)+vec3f(.028,.032,.003)*t;
 color=mix(color,bladeColor,blade*detail*.88);
 return color;
}

`;
