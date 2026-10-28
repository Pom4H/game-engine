
fn groundLitter(p:vec2f,cellSize:f32,chance:f32,footprint:f32,seed:f32,wind:vec2f,time:f32)->vec4f{
 // One candidate per metre cell. Subpixel footprints fade before the shape aliases.
 let cell=floor(p/cellSize);let roll=hash(cell+seed*11.);
 let fade=(1.-smoothstep(.035,.2,footprint))*step(roll,chance);if(fade<=0.){return vec4f(0);}
 let kind=hash(cell+seed*3.17);
 // Leaves and scrap dominate; newspapers stay sparse so roads are not tiled with flyers.
 let mobility=select(select(1.15,.95,kind>=.18),.42,kind>=.78);
 let speed=length(wind);let dir=wind/max(speed,.001);
 // Continuous advection along free wind XZ (along / across / diagonal — whatever airAt blows).
 // fract wrap keeps travel endless inside the placement cell ("recursive").
 let rate=mobility*(.65+.7*hash(cell+9.));
 let slide=wind*(time*rate*.09);
 // Surge only while a rare gust spike elevates instantaneous speed (CPU rareWindGust).
 let surge=smoothstep(7.,18.,speed);
 let kick=dir*surge*mobility*(.8+hash(cell+11.)*1.4);
 let local=(fract((p-slide-kick)/cellSize)-.5)*cellSize;
 // Tumble with travel distance; brief extra twist only during surge — no timed sine flutter.
 let ang=hash(cell+seed*5.91)*6.2831853+dot(slide,vec2f(.031,.029))+surge*hash(cell+13.)*.9;
 let cs=cos(ang);let sn=sin(ang);
 let q=vec2f(local.x*cs-local.y*sn,local.x*sn+local.y*cs);let aa=max(.004,footprint*.85);
 var cover=0.;var tint=vec3f(.55);
 if(kind<.18){
  // Folded newspaper / flyer: thin rectangle with print grain.
  let half=vec2f(.10+.04*hash(cell+17.),.14+.05*hash(cell+19.));
  let box=max(abs(q.x)-half.x,abs(q.y)-half.y);cover=1.-smoothstep(-aa,aa,box);
  let print=smoothstep(.35,.75,noise(q*48.+cell));tint=mix(vec3f(.78,.76,.70),vec3f(.42,.40,.36),print*.55);
 }else if(kind<.78){
  // Leaf / dry leaf cluster: soft ellipse, olive→brown.
  let half=vec2f(.045+.035*hash(cell+23.),.07+.04*hash(cell+29.));
  let d=length(q/max(half,vec2f(.02)));cover=1.-smoothstep(1.-aa*8.,1.+aa*8.,d);
  tint=mix(vec3f(.34,.42,.18),vec3f(.42,.28,.12),hash(cell+31.));
 }else{
  // Crumpled scrap / wrapper: small irregular blob.
  let r=.028+.022*hash(cell+37.);let d=length(q)*(1.+.35*noise(q*36.+cell));
  cover=1.-smoothstep(r-aa,r+aa,d);tint=mix(vec3f(.22,.23,.24),vec3f(.55,.48,.28),hash(cell+41.)*.7);
 }
 return vec4f(tint,clamp(cover*fade,0.,1.));
}
