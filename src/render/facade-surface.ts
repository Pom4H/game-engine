/** Metre-based architectural surface; never creates geometry or collision. */
export interface FacadeSpec {readonly kind:'masonry'|'glazed';readonly night?:number}
export function validateFacadeNight(value:unknown):asserts value is number{
 if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1)throw new TypeError('facadeNight must be finite within 0..1');
}
export function validateFacade(value:unknown):asserts value is FacadeSpec{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError('facade must be an object');
 const v=value as Record<string,unknown>;
 if(v.kind!=='masonry'&&v.kind!=='glazed'||Object.keys(v).some(k=>k!=='kind'&&k!=='night')||v.night!==undefined&&(typeof v.night!=='number'||!Number.isFinite(v.night)||v.night<0||v.night>1))throw new TypeError('facade requires masonry/glazed and optional night within 0..1');
}
/** Original Game architectural kernel and material response. UVs in metres;
 * explicit derivatives keep the same kernel available to native compute QA. */
export const FACADE_SURFACE_WGSL=/* wgsl */`
// Presence is separate so the presented night retains its full float32 precision.
fn resolveFacadeNight(materialNight:f32,night:f32,enabled:f32)->f32{return select(materialNight,night,enabled>.5);}
fn facadeHash(p:vec2f)->f32 {return fract(sin(dot(p,vec2f(127.1,311.7)))*43758.5453);}
fn facadeNoise(p:vec2f)->f32 {let i=floor(p);let f=fract(p);let u=f*f*(3.-2.*f);return mix(mix(facadeHash(i),facadeHash(i+vec2f(1,0)),u.x),mix(facadeHash(i+vec2f(0,1)),facadeHash(i+vec2f(1,1)),u.x),u.y);}
fn facadeSafeNormal(v:vec3f,fallback:vec3f)->vec3f {return select(fallback,v*inverseSqrt(max(dot(v,v),1e-12)),dot(v,v)>1e-12);}
struct FacadeUV {uv:vec2f}
struct FacadeWeather {weather:vec4f}
struct FacadeSurface {color:vec3f,roughness:f32,normal:vec3f,emission:f32,windows:f32}
fn facadeSurface(uv:vec2f,uvWidth:vec2f,seed:f32,glazed:bool,night:f32,sourceColor:vec3f,macroNoise:f32,sourceNormal:vec3f,geometricNormal:vec3f)->FacadeSurface{
 let id=select(2u,3u,glazed);let v=FacadeUV(uv);let frame=FacadeWeather(vec4f(0,0,0,night));
 var col=sourceColor;var rough=.88;var metal=0.;var emission=0.;var n=sourceNormal;

 let construction=facadeHash(vec2f(seed*65535.,43.));
 if(id==2u){
  if(construction<.27){col=mix(col,vec3f(.49,.255,.16),.78);}
  else if(construction<.55){col=mix(col,vec3f(.70,.69,.63),.58);}
  else if(construction<.78){col=mix(col,vec3f(.34,.40,.39),.60);}
  else{col=mix(col,vec3f(.61,.52,.38),.53);}
 }
 // Architectural dimensions are metres. Filter coverage at the actual feature
 // scale, independently of the millimetre-scale material grain.
 let cell=select(vec2f(2.85,3.2),vec2f(2.1,3.4),id==3u);let q=fract(v.uv/cell);let pane=q*cell;
 let windowId=facadeHash(floor(v.uv/cell)+seed*179.);
 let border=select(vec2f(.23,.19),vec2f(.055,.035),id==3u);
 let low=border*cell;let high=vec2f(1.-border.x,.84)*cell;
 let sides=min(pane-low,high-pane);let edge=min(sides.x,sides.y);
 let aa=max(.003,max(uvWidth.x,uvWidth.y)*.7);
 let windows=smoothstep(-aa,aa,edge);
 let architecture=1.-smoothstep(.35,1.4,max(uvWidth.x,uvWidth.y));
 // Mortar uses the brick footprint, not the micrograin footprint. Periodic
 // distance is symmetric at the cell boundary, avoiding a sawtooth seam.
 if(id==2u){
  if(construction<.27){
   let row=floor(v.uv.y/.23);let brickUV=fract(vec2f((v.uv.x+row*.26)/.52,v.uv.y/.23));
   let joint=min(brickUV,1.-brickUV)*vec2f(.52,.23);
   let mortar=(1.-smoothstep(.008-aa,.014+aa,min(joint.x,joint.y)))*(1.-smoothstep(.04,.18,max(uvWidth.x,uvWidth.y)));
   col*=.90+macroNoise*.20;col=mix(col,vec3f(.48,.43,.34),mortar*.62);
  }else if(construction<.55){
   let seamDistance=min(q,1.-q)*cell;
   let seam=(1.-smoothstep(.012-aa,.022+aa,min(seamDistance.x,seamDistance.y)))*architecture;
   col*=1.-seam*.22;
  }
  // Pale floor courses and a dark underside give repeated storeys a readable
  // hierarchy without creating thousands of small trim meshes.
  let course=(1.-smoothstep(.09-aa,.12+aa,pane.y))*architecture;
  let underside=(1.-smoothstep(.018-aa,.04+aa,abs(pane.y-.145)))*architecture;
  col=mix(col,mix(col,vec3f(.69,.64,.53),.55),course*.8);col*=1.-underside*.17;
 }
 let wallColor=col;
 let trim=(smoothstep(-.13-aa,-.13+aa,edge)-windows)*architecture;
 let trimColor=select(mix(wallColor,vec3f(.66,.60,.47),.72),vec3f(.23,.28,.29),id==3u);
 col=mix(col,trimColor,clamp(trim,0.,1.));
 let sill=(1.-smoothstep(.045-aa,.075+aa,abs(pane.y-low.y+.085)))*smoothstep(low.x-.14-aa,low.x-.14+aa,pane.x)*(1.-smoothstep(high.x+.14-aa,high.x+.14+aa,pane.x))*architecture;
 col=mix(col,trimColor*1.13,sill*.75);
 rough=.88;
 if(windows>0.){
 var glassColor=vec3f(.14,.20,.24)*(.78+windowId*.30);
 let lit=step(.68,windowId)*frame.weather.w;
 let roomSeed=facadeHash(floor(v.uv/cell)+seed*913.);let roomColor=mix(vec3f(.80,.48,.22),vec3f(.68,.77,.83),smoothstep(.64,.92,roomSeed));
 let blind=(1.-smoothstep((.25+roomSeed*.45)*cell.y-aa,(.25+roomSeed*.45)*cell.y+aa,pane.y))*step(.57,roomSeed);
 let roomShade=.68+.32*smoothstep(.15,.65,q.y);
 glassColor=mix(glassColor,vec3f(.35,.34,.29),blind*.55);glassColor=mix(glassColor,roomColor*roomShade,min(lit,1.));
 // Recess shading is attached to the pane; no screen-space noise or LOD switch.
 let recess=.57+.43*smoothstep(0.,.16,max(0.,edge));
 let mullion=(1.-smoothstep(.018-aa,.034+aa,abs(pane.x-cell.x*.5)))*architecture;
 glassColor*=recess;glassColor=mix(glassColor,trimColor*.56,mullion*.8);
 col=mix(col,glassColor,windows);rough=mix(.88,.15,windows);metal=0.;n=facadeSafeNormal(mix(n,geometricNormal,windows),geometricNormal);
 emission=lit*(.6+roomSeed*1.3)*(1.-blind*.52)*windows*(1.-mullion*.8);
 }
 
 return FacadeSurface(col,rough,n,emission,windows);
}
fn facadeMaterial(uv:vec2f,dpX:vec3f,dpY:vec3f,uvX:vec2f,uvY:vec2f,geometricNormal:vec3f,absoluteY:f32,seed:f32,glazed:bool,night:f32,worldWetness:f32,rain:f32,sourceColor:vec3f)->FacadeSurface{
 let microScale=select(.012,.006,glazed);let macroScale=select(.52,2.1,glazed);
 let age=select(.36,.2,glazed);let normalScale=select(.44,.08,glazed);let dirtAmount=select(.12,.08,glazed);
 let horizontal=smoothstep(.65,.96,geometricNormal.y);let footprint=max(length(uvX),length(uvY));let uvWidth=max(abs(uvX),abs(uvY));
 let microWeight=1.-smoothstep(.25,.8,footprint/microScale);let macroNoise=facadeNoise(uv/macroScale+seed);var grain=.5;var n=geometricNormal;
 if(microWeight>0.){
  grain=facadeNoise(uv/microScale+seed*31.);let grainX=facadeNoise(uv/microScale+vec2f(.25,0)+seed*31.);let grainY=facadeNoise(uv/microScale+vec2f(0,.25)+seed*31.);
  let fallbackT=facadeSafeNormal(cross(n,select(vec3f(0,1,0),vec3f(1,0,0),abs(n.y)>.95)),vec3f(1,0,0));
  let tangent=facadeSafeNormal(cross(dpY,n)*uvX.x+cross(n,dpX)*uvY.x,fallbackT);let bitangent=facadeSafeNormal(cross(dpY,n)*uvX.y+cross(n,dpX)*uvY.y,cross(n,tangent));
  n=facadeSafeNormal(n-((grainX-grain)*tangent+(grainY-grain)*bitangent)*normalScale*microWeight*.55,n);
 }
 let col=sourceColor*(.96+(macroNoise-.5)*(.06+age*.12)+(grain-.5)*.08*microWeight);
 var result=facadeSurface(uv,uvWidth,seed,glazed,night,col,macroNoise,n,geometricNormal);
 let wet=max(worldWetness*mix(.18,1.,horizontal),rain*horizontal*.75);
 result.roughness=mix(result.roughness,select(.46,.09,glazed),wet);result.color*=1.-wet*select(.27,.07,glazed);
 // Source water response normalizes even when this facade has zero puddle coverage.
 result.normal=facadeSafeNormal(result.normal,geometricNormal);
 let drip=facadeNoise(vec2f(uv.x*2.3,uv.y*.12)+seed);let contact=1.-smoothstep(.1,1.1,max(absoluteY,0.));
 let dirt=dirtAmount*(.35+contact*.65)*(macroNoise*.6+drip*.4);result.color*=1.-dirt*.32;result.roughness=mix(result.roughness,.94,dirt*.35);
 result.roughness=clamp(result.roughness,.055,1.);return result;
}
`;
