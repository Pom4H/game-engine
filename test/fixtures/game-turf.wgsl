
fn turf(p:vec2f,base:vec3f,foot:f32)->vec3f {
 let variation=noise(p*.72);let dry=smoothstep(.57,.84,noise(p*.23+vec2f(71.,19.)))*.065;
 var color=base*(.97+variation*.05);
 color=mix(color,vec3f(.34,.285,.13),dry);
 let detail=1.-smoothstep(.006,.038,foot);
 if(detail<=0.){return color;}
 let cell=floor(p/.045);let q=fract(p/.045)*.045;
 let a=hash(cell+vec2f(13.,37.));let b=hash(cell+vec2f(53.,11.));let c=hash(cell+vec2f(91.,23.));
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
