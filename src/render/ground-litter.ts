/** Procedural ground litter. No prop simulation or mesh allocation. */
export interface GroundLitterSpec {readonly kind:'asphalt'|'paving'|'tile';readonly baseRoughness?:number}
export function validateVariationSeed(seed:unknown):asserts seed is number{if(typeof seed!=='number'||!Number.isFinite(Math.fround(seed)))throw new TypeError('variationSeed must be a finite float32');}
export function validateGroundLitter(value:unknown):asserts value is GroundLitterSpec{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError('groundLitter must be an object');const v=value as Record<string,unknown>;
 if(!['asphalt','paving','tile'].includes(String(v.kind))||Object.keys(v).some(k=>k!=='kind'&&k!=='baseRoughness')||v.baseRoughness!==undefined&&(typeof v.baseRoughness!=='number'||!Number.isFinite(v.baseRoughness)||v.baseRoughness<0||v.baseRoughness>1))throw new TypeError('groundLitter requires a surface kind and optional baseRoughness within 0..1');
}

export function rareWindGust(wind:readonly[number,number],gust:number,time:number):[number,number]{
 const wx=Number.isFinite(wind[0])?wind[0]:0,wz=Number.isFinite(wind[1])?wind[1]:0;
 const g=Math.max(0,Math.min(1,Number.isFinite(gust)?gust:0));
 if(g<.02)return[wx,wz];
 // ~9 s candidate windows; only a gust-scaled fraction fire, peak phase/width from hash.
 const t=(Number.isFinite(time)?Math.max(0,time):0)*.11;
 const epoch=Math.floor(t);
 let h=Math.imul(epoch^0x9e3779b9,0x85ebca6b)>>>0;
 h=Math.imul(h^(h>>>13),0xc2b2ae35)>>>0;
 const roll=(h>>>0)/4294967295;
 if(roll>g*.22)return[wx,wz];
 const peak=.12+((h>>>8)&255)/255*.6;
 const width=.02+((h>>>16)&255)/255*.07;
 const phase=t-epoch;
 const x=(phase-peak)/Math.max(width,1e-3);
 const envelope=Math.exp(-x*x*2);
 const boost=1+envelope*(1.2+g*2.4);
 return[wx*boost,wz*boost];
}

export const GROUND_LITTER_WGSL=/* wgsl */`
fn litterHash(p:vec2f)->f32 {return fract(sin(dot(p,vec2f(127.1,311.7)))*43758.5453);}
fn litterNoise(p:vec2f)->f32 {let i=floor(p);var f=fract(p);f=f*f*(3.-2.*f);return mix(mix(litterHash(i),litterHash(i+vec2f(1,0)),f.x),mix(litterHash(i+vec2f(0,1)),litterHash(i+vec2f(1,1)),f.x),f.y);}

fn groundLitter(p:vec2f,cellSize:f32,chance:f32,footprint:f32,seed:f32,wind:vec2f,time:f32)->vec4f{
 // One candidate per metre cell. Subpixel footprints fade before the shape aliases.
 let cell=floor(p/cellSize);let roll=litterHash(cell+seed*11.);
 let fade=(1.-smoothstep(.035,.2,footprint))*step(roll,chance);if(fade<=0.){return vec4f(0);}
 let kind=litterHash(cell+seed*3.17);
 // Leaves and scrap dominate; newspapers stay sparse so roads are not tiled with flyers.
 let mobility=select(select(1.15,.95,kind>=.18),.42,kind>=.78);
 let speed=length(wind);let dir=wind/max(speed,.001);
 // Continuous advection along free wind XZ (along / across / diagonal — whatever airAt blows).
 // fract wrap keeps travel endless inside the placement cell ("recursive").
 let rate=mobility*(.65+.7*litterHash(cell+9.));
 let slide=wind*(time*rate*.09);
 // Surge only while a rare gust spike elevates instantaneous speed (CPU rareWindGust).
 let surge=smoothstep(7.,18.,speed);
 let kick=dir*surge*mobility*(.8+litterHash(cell+11.)*1.4);
 let local=(fract((p-slide-kick)/cellSize)-.5)*cellSize;
 // Tumble with travel distance; brief extra twist only during surge — no timed sine flutter.
 let ang=litterHash(cell+seed*5.91)*6.2831853+dot(slide,vec2f(.031,.029))+surge*litterHash(cell+13.)*.9;
 let cs=cos(ang);let sn=sin(ang);
 let q=vec2f(local.x*cs-local.y*sn,local.x*sn+local.y*cs);let aa=max(.004,footprint*.85);
 var cover=0.;var tint=vec3f(.55);
 if(kind<.18){
  // Folded newspaper / flyer: thin rectangle with print grain.
  let half=vec2f(.10+.04*litterHash(cell+17.),.14+.05*litterHash(cell+19.));
  let box=max(abs(q.x)-half.x,abs(q.y)-half.y);cover=1.-smoothstep(-aa,aa,box);
  let print=smoothstep(.35,.75,litterNoise(q*48.+cell));tint=mix(vec3f(.78,.76,.70),vec3f(.42,.40,.36),print*.55);
 }else if(kind<.78){
  // Leaf / dry leaf cluster: soft ellipse, olive→brown.
  let half=vec2f(.045+.035*litterHash(cell+23.),.07+.04*litterHash(cell+29.));
  let d=length(q/max(half,vec2f(.02)));cover=1.-smoothstep(1.-aa*8.,1.+aa*8.,d);
  tint=mix(vec3f(.34,.42,.18),vec3f(.42,.28,.12),litterHash(cell+31.));
 }else{
  // Crumpled scrap / wrapper: small irregular blob.
  let r=.028+.022*litterHash(cell+37.);let d=length(q)*(1.+.35*litterNoise(q*36.+cell));
  cover=1.-smoothstep(r-aa,r+aa,d);tint=mix(vec3f(.22,.23,.24),vec3f(.55,.48,.28),litterHash(cell+41.)*.7);
 }
 return vec4f(tint,clamp(cover*fade,0.,1.));
}
`;
