fn hash(p:vec2f)->f32 {return fract(sin(dot(p,vec2f(127.1,311.7)))*43758.5453);}
fn noise(p:vec2f)->f32 {let i=floor(p);let f=fract(p);let u=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2f(1,0)),u.x),mix(hash(i+vec2f(0,1)),hash(i+vec2f(1,1)),u.x),u.y);}
fn safeNormal(v:vec3f,fallback:vec3f)->vec3f {return select(fallback,v*inverseSqrt(max(dot(v,v),1e-12)),dot(v,v)>1e-12);}
struct OracleV {uv:vec2f}
struct OracleFrame {weather:vec4f,flags:vec4f}
struct OracleFamily {base:vec4f,surface:vec4f,aging:vec4f,detail:vec4f}
fn originalFacade(uv:vec2f,dpX:vec3f,dpY:vec3f,uvX:vec2f,uvY:vec2f,geometricNormal:vec3f,absoluteY:f32,seed:f32,glazed:bool,night:f32,worldWetness:f32,sourceRain:f32,sourceColor:vec3f)->FacadeSurface{
 let v=OracleV(uv);let frame=OracleFrame(vec4f(worldWetness,0,0,night),vec4f(0,sourceRain,0,0));let absolute=vec3f(0,absoluteY,0);let id=select(2u,3u,glazed);
 let family=OracleFamily(vec4f(0,0,0,select(.83,.26,glazed)),vec4f(0,select(.44,.08,glazed),select(.36,.2,glazed),select(.12,.08,glazed)),vec4f(0,0,0,select(.52,2.1,glazed)),vec4f(select(.012,.006,glazed),select(.27,.07,glazed),select(.46,.09,glazed),0));
 var n=geometricNormal;var col=sourceColor;var rough=family.base.w;var metal=0.;var emission=0.;let horizontal=smoothstep(.65,.96,n.y);let age=family.surface.z;let dirtAmount=family.surface.w;
 let worldMapped=id==1u||id==8u||id==9u||id==11u||id==12u;
 let surfaceUV=select(v.uv,absolute.xz+absolute.yy*.37,worldMapped);
 let microScale=max(family.detail.x,.001);let macroNoiseScale=max(family.aging.w,.05);
 // Derivatives are evaluated before every material-dependent branch (WGSL uniformity).
 
 let uvWidth=max(abs(uvX),abs(uvY));
 // Floor paint footprint by projected pixel size so TAA jitter cannot shrink thin stripe filters
 // frame-to-frame (that made dashed centre lines shimmer / "dance").
 let pixelMetres=length(dpX)+length(dpY);
 let paintFoot=max(abs(uvX)+abs(uvY),vec2f(pixelMetres*.9));

 let footprint=max(length(uvX),length(uvY));let microWeight=1.-smoothstep(.25,.8,footprint/microScale);
 let macroNoise=noise(surfaceUV/macroNoiseScale+seed);var grain=.5;
 // The derivative filter already makes subpixel detail contribute exactly zero.
 // Do not evaluate its three noise fields and tangent basis after it has faded.
 if(microWeight>0.){
  grain=noise(surfaceUV/microScale+seed*31.);
  let grainX=noise(surfaceUV/microScale+vec2f(.25,0)+seed*31.);
  let grainY=noise(surfaceUV/microScale+vec2f(0,.25)+seed*31.);
  let fallbackT=safeNormal(cross(n,select(vec3f(0,1,0),vec3f(1,0,0),abs(n.y)>.95)),vec3f(1,0,0));
  let tangent=safeNormal(cross(dpY,n)*uvX.x+cross(n,dpX)*uvY.x,fallbackT);
  let bitangent=safeNormal(cross(dpY,n)*uvX.y+cross(n,dpX)*uvY.y,cross(n,tangent));
  n=safeNormal(n-((grainX-grain)*tangent+(grainY-grain)*bitangent)*family.surface.y*microWeight*.55,n);
 }
 col*=.96+(macroNoise-.5)*(.06+age*.12)+(grain-.5)*.08*microWeight;

 if(id==2u||id==3u){
 let construction=hash(vec2f(seed*65535.,43.));
 if(id==2u){
  if(construction<.27){col=mix(col,vec3f(.49,.255,.16),.78);}
  else if(construction<.55){col=mix(col,vec3f(.70,.69,.63),.58);}
  else if(construction<.78){col=mix(col,vec3f(.34,.40,.39),.60);}
  else{col=mix(col,vec3f(.61,.52,.38),.53);}
 }
 // Architectural dimensions are metres. Filter coverage at the actual feature
 // scale, independently of the millimetre-scale material grain.
 let cell=select(vec2f(2.85,3.2),vec2f(2.1,3.4),id==3u);let q=fract(v.uv/cell);let pane=q*cell;
 let windowId=hash(floor(v.uv/cell)+seed*179.);
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
 let roomSeed=hash(floor(v.uv/cell)+seed*913.);let roomColor=mix(vec3f(.80,.48,.22),vec3f(.68,.77,.83),smoothstep(.64,.92,roomSeed));
 let blind=(1.-smoothstep((.25+roomSeed*.45)*cell.y-aa,(.25+roomSeed*.45)*cell.y+aa,pane.y))*step(.57,roomSeed);
 let roomShade=.68+.32*smoothstep(.15,.65,q.y);
 glassColor=mix(glassColor,vec3f(.35,.34,.29),blind*.55);glassColor=mix(glassColor,roomColor*roomShade,min(lit,1.));
 // Recess shading is attached to the pane; no screen-space noise or LOD switch.
 let recess=.57+.43*smoothstep(0.,.16,max(0.,edge));
 let mullion=(1.-smoothstep(.018-aa,.034+aa,abs(pane.x-cell.x*.5)))*architecture;
 glassColor*=recess;glassColor=mix(glassColor,trimColor*.56,mullion*.8);
 col=mix(col,glassColor,windows);rough=mix(.88,.15,windows);metal=0.;n=safeNormal(mix(n,geometricNormal,windows),geometricNormal);
 emission=lit*(.6+roomSeed*1.3)*(1.-blind*.52)*windows*(1.-mullion*.8);
 }
 }

 let exposed=select(1.,0.,id==13u||id==14u||id==19u||id==20u);
 var wet=max(family.aging.x,frame.weather.x*exposed*mix(.18,1.,horizontal));
 // Falling rain keeps outdoor paving film-wet even before weather wetness saturates.
 let rain=frame.flags.y;
 wet=max(wet,rain*exposed*horizontal*.75);
 let puddle=wet*smoothstep(.55,.75,macroNoise)*smoothstep(.97,.998,geometricNormal.y)*select(0.,1.,id==1u||id==11u);
 // Weather supplies water; existing stable macro detail breaks up the film.
 // Dry roads retain their roughness. No extra noise sample or reflection pass.
 let filmRoughness=select(family.detail.z,mix(.17,.36,macroNoise),id==11u);
 rough=mix(rough,filmRoughness,wet);rough=mix(rough,.065,puddle);
 col*=1.-wet*family.detail.y;
 n=safeNormal(mix(n,geometricNormal,puddle*.88),geometricNormal);

 let drip=noise(vec2f(surfaceUV.x*2.3,surfaceUV.y*.12)+seed);
 let contact=1.-smoothstep(.1,1.1,max(absolute.y,0.));
 let dirt=dirtAmount*(.35+contact*.65)*(macroNoise*.6+drip*.4);col*=1.-dirt*.32;rough=mix(rough,.94,dirt*.35);
 if(family.aging.y>0.){
 let crackWidth=clamp(footprint*2.,.014,.15);
 let crack=(1.-smoothstep(crackWidth,crackWidth+.035,abs(noise(surfaceUV*2.+seed)-.5)))*(1.-smoothstep(.08,.3,footprint));
 let damage=family.aging.y*crack;col*=1.-damage*.32;rough=mix(rough,.95,damage*.4);
 }

 return FacadeSurface(col,clamp(rough,.055,1.),n,emission,0);
}
