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
