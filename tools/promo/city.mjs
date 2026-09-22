import {makeLaboratory} from './laboratory.mjs';
import {makeM3,makePedestrian,pedestrianAnimation,CAR} from './actors.mjs';
import {batchStaticScenery} from '../../dist/index.js';
// Original street geometry in metres; M3 is reconstructed from a compact parametric profile.
const C={snow:[.93,.955,.975,1],stone:[.59,.57,.52,1],dark:[.07,.075,.078,1],metal:[.16,.18,.19,1],glass:[.16,.23,.28,1]};
const rng=seed=>()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
export function makeCity(kind='street'){if(kind==='laboratory')return makeLaboratory();
 const hero=kind==='hero';

 const entities=[],random=rng(20260920),motions=[];let sequence=0;
 const add=(id,p,mesh,color=C.stone,extra={})=>{const e={id,position:p,mesh,material:{kind:'default',color,roughness:.8,...extra.material},...extra};if(extra.material)e.material={kind:'default',color,roughness:.8,...extra.material};entities.push(e);return e;};
 const box=(id,p,s,c=C.stone,extra={})=>add(id,p,{kind:'box',size:s},c,extra);
 const cylinder=(id,p,r,h,c=C.metal,extra={})=>add(id,p,{kind:'cylinder',radius:r,height:h,segments:24},c,extra);
 const bank=(id,p,s,seed,segments=16)=>add(id,p,{kind:'snowdrift',size:s,seed,segments},C.snow,{material:{kind:'snow',roughness:.94}});
 // Initial set dressing is authored here; snow dynamics and contact deformation live in the engine.
 const lump=(id,p,size,color=C.snow)=>add(id,p,{kind:'sphere',radius:.5,segments:6},color,{scale:size,material:{kind:'snow',roughness:.97}});
 function snowcap(id,p,length,width,height=.09){
  bank(id+'-blanket',p,[length,height,width],Math.floor(random()*100000),12);
  const count=Math.max(2,Math.ceil(length/.30));
  for(let i=0;i<count;i++){const xx=((i+random()*.65)/(count-.35)-.5)*length*.95;const size=.034+random()*.045;lump(id+'-clump'+i,[p[0]+xx,p[1]+height*.24,p[2]-width*(.12+random()*.18)],[size*(2.0+random()*1.4),size,width*(.40+random()*.25)]);}
 }

 function rod(id,a,b,r,c=C.metal){const d=b.map((v,i)=>v-a[i]),length=Math.hypot(...d);return cylinder(id,a.map((v,i)=>(v+b[i])/2),r,length,c,{rotation:[Math.atan2(d[2],d[1]),0,Math.asin(-d[0]/length)]});}
 function tree(id,x,z,height=7){
  let serial=0;const color=[.20,.17,.135,1];
  function branch(a,dir,length,radius,depth){
    const end=a.map((v,k)=>v+dir[k]*length),d=end.map((v,k)=>v-a[k]),l=Math.hypot(...d);
    add(id+'-limb'+serial++,a.map((v,k)=>(v+end[k])/2),{kind:'cylinder',radius,height:l,topRadius:radius*.55,segments:9},color,{rotation:[Math.atan2(d[2],d[1]),0,Math.asin(-d[0]/l)],material:{roughness:.97}});
    // Sheltered snow rests along horizontal branch sections, never as an upright white tube.
    if(depth>=2&&Math.abs(dir[1])<.72&&random()<.72){const mix=.28+random()*.38,mid=a.map((v,k)=>v+d[k]*mix);const snow=bank(id+'-branch-snow'+serial,[mid[0],mid[1]+radius*.80,mid[2]],[l*(.27+random()*.23),.016+radius*.22,radius*(2.1+random())],serial,8);snow.rotation=[0,-Math.atan2(d[2],d[0]),Math.asin(d[1]/l)];}
    if(!depth)return;
    for(let j=0;j<(depth===2?3:2);j++){
      let v=[dir[0]*.75+(random()-.5)*1.05,dir[1]*.58+(random()-.10)*.49,dir[2]*.75+(random()-.5)*1.05];const n=Math.hypot(...v);v=v.map(x=>x/n);
      branch(end,v,length*(.61+random()*.12),radius*.55,depth-1);
    }
  }
  rod(id+'-trunk',[x,.12,z],[x+.10,height*.54,z],.12,color);
  for(let i=0;i<6;i++){const angle=i*2.4+random()*.5;branch([x+.08,height*(.32+i*.037),z],[Math.cos(angle)*.73,.60,Math.sin(angle)*.73],height*.28,.042,4);}
  bank(id+'-base',[x,.10,z],[2.8,.27,2.2],Math.floor(random()*100000));
 }
 function lamp(id,x,z,night=false){
  cylinder(id+'-foot',[x,.32,z],.16,.6,C.metal);cylinder(id+'-pole',[x,2.65,z],.052,5.1,C.metal);
  cylinder(id+'-collar',[x,4.88,z],.085,.10,C.metal);
  const lightColor=[1,.61,.265],brightness=night?8:6;
  cylinder(id+'-glow',[x,5.08,z],.145,.38,[1,.75,.4,1],{light:{kind:'point',color:lightColor,intensity:brightness*3.2,range:13},material:{emissive:lightColor.map(v=>v*brightness),roughness:.35}});
  for(let a=0;a<4;a++){const angle=a*Math.PI/2;cylinder(id+'-bar'+a,[x+Math.cos(angle)*.16,5.07,z+Math.sin(angle)*.16],.017,.45,C.metal);}
  add(id+'-cap',[x,5.36,z],{kind:'cylinder',radius:.29,topRadius:.035,height:.18,segments:24},C.metal);
  bank(id+'-cap-snow',[x,5.45,z],[.55,.07,.55],32);
 }
 function bench(id,x,z,sign=1){
  const wood=[.26,.16,.09,1];
  for(let i=0;i<5;i++)box(id+'-seat'+i,[x,.59,z+(i-2)*.10],[1.9,.065,.082],wood,{material:{roughness:.72}});
  for(let i=0;i<3;i++)box(id+'-back'+i,[x,.84+i*.13,z+sign*.27],[1.9,.075,.08],wood);
  for(const side of [-1,1]){rod(id+'-leg'+side,[x+side*.72,.16,z-.21],[x+side*.72,.65,z+.15],.035);rod(id+'-backpole'+side,[x+side*.78,.50,z+sign*.27],[x+side*.78,1.17,z+sign*.3],.027);}
  snowcap(id+'-snow-seat',[x,.63,z],1.88,.48,.13);
  snowcap(id+'-snow-back',[x,1.145,z+sign*.27],1.89,.18,.09);
 }
 function building(id,x,z,width,height,depth,sign,color,pattern='brick'){
  const front=z-sign*depth/2,face=front-sign*.035,trim=[.62,.61,.56,1];
  // The ground floor is a genuine recessed volume. Window dressing has real parallax.
  box(id+'-upper-mass',[x,(height+3.12)/2,z],[width,height-3.12,depth],color,{material:{pattern,roughness:.94,ageYears:35}});
  box(id+'-rear-mass',[x,1.57,z+sign*.86],[width,3.14,depth-1.72],color,{material:{pattern,roughness:.95}});
  box(id+'-cornice',[x,height-.04,z],[width+.42,.25,depth+.42],trim);
  box(id+'-cornice-shadow',[x,height-.22,front-sign*.07],[width+.20,.12,.29],[.39,.38,.34,1]);
  box(id+'-frieze',[x,height-.43,front-sign*.07],[width+.24,.18,.35],trim);
  box(id+'-roof',[x,height+.14,z],[width+.26,.15,depth+.26],[.16,.19,.19,1]);
  bank(id+'-roof-snow',[x,height+.22,z],[width+.45,.26,depth+.45],Math.floor(random()*10000),24);
  snowcap(id+'-cornice-snow',[x,height+.075,front-sign*.16],width+.46,.43,.13);
  for(let c=0;c<2;c++){
   box(id+'-chimney'+c,[x+(c-.5)*width*.5,height+.7,z+1],[.65,1,.6],[.31,.23,.19,1],{material:{pattern:'brick'}});
   snowcap(id+'-chimneycap'+c,[x+(c-.5)*width*.5,height+1.23,z+1],.78,.73,.13);
  }
  const cols=Math.max(3,Math.floor(width/2.4)),floors=Math.floor((height-3.2)/2.82);
  for(let floor=0;floor<floors;floor++)for(let col=0;col<cols;col++){
   const wx=x+(col-(cols-1)/2)*(width/(cols+.4)),wy=4.59+floor*2.82,w=1.12,h=1.69,wid=id+'-w'+floor+'-'+col;
   const lit=random()<.48,glass=lit?[.53,.40,.24,1]:[.12,.16,.20,1];
   box(wid+'-recess',[wx,wy,face-sign*.045],[w+.19,h+.19,.065],[.07,.08,.08,1]);
   box(wid+'-glass',[wx,wy,face-sign*.09],[w,h,.025],glass,{material:{pattern:'window',metalness:.12,roughness:.20,emissive:lit?[.32,.16,.048]:[0,0,0]}});
   for(const side of [-1,1])box(wid+'-jamb'+side,[wx+side*(w/2+.055),wy,face-sign*.15],[.095,h+.20,.17],trim);
   box(wid+'-lintel',[wx,wy+h/2+.075,face-sign*.13],[w+.32,.13,.16],trim);
   box(wid+'-sill',[wx,wy-h/2-.055,face-sign*.24],[w+.38,.115,.39],trim);
   snowcap(wid+'-snow',[wx,wy-h/2+.005,face-sign*.25],w+.43,.43,.12);
   if(floor===floors-1)snowcap(wid+'-lintel-snow',[wx,wy+h/2+.142,face-sign*.16],w+.34,.25,.065);
   box(wid+'-sash',[wx,wy,face-sign*.13],[.042,h,.06],trim);
   box(wid+'-cross',[wx,wy+.24,face-sign*.14],[w,.04,.065],trim);
   if(lit&&random()<.45)box(wid+'-curtain',[wx-w*.34,wy,face-sign*.115],[w*.25,h,.012],[.57,.52,.39,1],{material:{pattern:'fabric',roughness:.97,emissive:[.08,.043,.012]}});
  }
  const sx=x-width*.19,sw=width*.54,doorx=x+width*.345,doorw=1.15,shopKind=[...id].reduce((sum,ch)=>sum+ch.charCodeAt(0),0)%4;
  const pillars=[[-width/2,-width*.19-sw/2],[-width*.19+sw/2,width*.345-doorw/2],[width*.345+doorw/2,width/2]];
  for(const [i,[l,r]]of pillars.entries())if(r-l>.02){
   box(id+'-ground-pier'+i,[x+(l+r)/2,1.55,front+sign*.65],[r-l,3.1,1.3],color,{material:{pattern,roughness:.95}});
   box(id+'-plinth'+i,[x+(l+r)/2,.40,face-sign*.06],[r-l,.55,.15],[.29,.30,.28,1]);
   for(let row=0;row<5;row++)box(id+'-rustication'+i+'-'+row,[x+(l+r)/2,.92+row*.41,face-sign*.044],[r-l,.022,.020],[.32,.31,.28,1]);
  }
  // Warm retail room: plaster walls, wooden floor, display counter, shelves and pendant lamps.
  const shop=[.075,.125,.105,1],wood=[.25,.155,.078,1],warm=[1,.53,.19],roomPalette=[[.35,.29,.22,1],[.24,.29,.235,1],[.35,.235,.15,1],[.25,.265,.26,1]],room=roomPalette[Math.floor(random()*roomPalette.length)];
  box(id+'-store-back',[sx,1.57,front+sign*1.65],[sw,2.95,.12],room,{material:{pattern:'plaster',emissive:[.075,.031,.008],roughness:.95}});
  box(id+'-store-floor',[sx,.23,front+sign*.85],[sw,.11,1.62],[.23,.16,.10,1],{material:{roughness:.53,emissive:[.035,.017,.006]}});
  box(id+'-store-ceiling',[sx,2.94,front+sign*.84],[sw,.1,1.64],[.47,.38,.23,1],{material:{emissive:[.042,.017,.005]}});
  for(const side of [-1,1])box(id+'-store-wall'+side,[sx+side*(sw/2-.025),1.55,front+sign*.85],[.07,2.8,1.6],[.39,.31,.23,1],{material:{emissive:[.035,.014,.004],roughness:.9}});
  for(let j=0;j<3;j++){
   const dx=sx+(j-1)*sw*.27;
   box(id+'-shelf'+j,[dx,1.14,front+sign*1.39],[sw*.225,.065,.38],wood,{material:{emissive:[.08,.036,.01]}});
   box(id+'-shelf-top'+j,[dx,1.93,front+sign*1.39],[sw*.225,.058,.38],wood,{material:{emissive:[.08,.036,.01]}});
   for(let k=0;k<5;k++){
    const xx=dx+(k-2)*sw*.040,hh=.15+random()*.22,book=[[.34,.21,.12,1],[.20,.25,.19,1],[.46,.34,.16,1],[.21,.25,.29,1]][k%4];
    box(id+'-goods'+j+'-'+k,[xx,1.95+hh/2,front+sign*1.34],[.14,hh,.22],book,{material:{roughness:.86,emissive:[.06,.027,.006]}});
   }
   const pendantY=2.36;
   rod(id+'-pendant-wire'+j,[dx,2.90,front+sign*.75],[dx,pendantY+.11,front+sign*.75],.011,[.13,.12,.09,1]);
   add(id+'-pendant-shade'+j,[dx,pendantY,front+sign*.75],{kind:'cylinder',radius:.19,topRadius:.075,height:.17,segments:16},[.54,.37,.18,1],{material:{metalness:.5,roughness:.38,emissive:[.20,.07,.012]}});
   cylinder(id+'-pendant-bulb'+j,[dx,pendantY-.09,front+sign*.75],.14,.025,[1,.73,.35,1],{material:{emissive:[2.8,1.45,.43]}});
  }
  box(id+'-counter',[sx, .78,front+sign*.83],[sw*.62,1.04,.42],[.25,.16,.075,1],{material:{emissive:[.09,.044,.012]}});
  box(id+'-countertop',[sx,1.315,front+sign*.83],[sw*.65,.055,.48],[.57,.43,.27,1],{material:{roughness:.36,emissive:[.13,.06,.014]}});
  for(let j=0;j<4;j++){const xx=sx+(j-1.5)*sw*.11;add(id+'-display'+j,[xx,1.395,front+sign*.80],{kind:'sphere',radius:.12,segments:12},[.63,.39,.17,1],{scale:[1.45,.48,.70],material:{roughness:.8,emissive:[.12,.057,.013]}});}
  // Joinery and a small display bay give the shop front a human scale. The
  // visible products vary by store, while the simulation remains scene-agnostic.
  for(let board=0;board<9;board++)box(id+'-counter-joint'+board,[sx+(board-4)*sw*.061,.79,front+sign*.607],[.011,.95,.014],[.15,.097,.049,1],{material:{roughness:.79}});
  box(id+'-display-plinth',[sx-sw*.31,.65,front+sign*.38],[.63,.89,.39],[.20,.14,.075,1],{material:{roughness:.63,emissive:[.025,.009,.002]}});
  if(shopKind===0){
   for(let row=0;row<2;row++)for(let item=0;item<3;item++)add(id+'-bread-tray'+row+'-'+item,[sx-sw*.31+(item-1)*.15,1.13+row*.13,front+sign*(.35+row*.035)],{kind:'sphere',radius:.085,segments:12},[.56,.32,.12,1],{scale:[1.5,.68,.70],material:{roughness:.88,emissive:[.036,.012,.002]}});
  }else if(shopKind===1){
   box(id+'-coffee-machine',[sx-sw*.31,1.30,front+sign*.40],[.43,.34,.31],[.35,.37,.35,1],{material:{metalness:.78,roughness:.26}});
   box(id+'-coffee-front',[sx-sw*.31,1.29,front+sign*.231],[.35,.21,.035],[.065,.071,.068,1],{material:{metalness:.35,roughness:.3}});
   for(const offset of [-.105,.105]){cylinder(id+'-coffee-cup'+offset,[sx-sw*.31+offset,1.135,front+sign*.21],.038,.063,[.83,.80,.71,1],{material:{roughness:.25}});}
  }else if(shopKind===2){
   for(let item=0;item<5;item++){const xx=sx-sw*.31+(item-2)*.102;cylinder(id+'-pharmacy-bottle'+item,[xx,1.20,front+sign*.36],.034,.20,[.30,.19,.08,1],{material:{metalness:.08,roughness:.18}});cylinder(id+'-pharmacy-cap'+item,[xx,1.31,front+sign*.36],.035,.026,[.63,.60,.50,1]);}
   box(id+'-pharmacy-cross-horizontal',[sx+sw*.33,2.35,face-sign*.16],[.36,.085,.035],[.33,.72,.34,1],{material:{emissive:[.12,.5,.09]}});
   box(id+'-pharmacy-cross-vertical',[sx+sw*.33,2.35,face-sign*.16],[.085,.36,.035],[.33,.72,.34,1],{material:{emissive:[.12,.5,.09]}});
  }else{
   for(let item=0;item<3;item++)box(id+'-workshop-display'+item,[sx-sw*.31+(item-1)*.15,1.15+item*.04,front+sign*.37],[.12,.10+item*.08,.23],[.30,.18,.078,1],{material:{roughness:.62}});
  }
  box(id+'-warm-display-strip',[sx,1.25,front+sign*.59],[sw*.57,.016,.024],[1,.58,.23,1],{material:{emissive:[.48,.19,.035],roughness:.4}});
  // Glazing is optical rather than a breakable physics body; physical glass is a separate material choice.
  box(id+'-store-glazing',[sx,1.64,face-sign*.105],[sw-.15,2.56,.022],[.24,.30,.32,.13],{material:{metalness:.25,roughness:.12}});
  for(let j=-2;j<=2;j++)box(id+'-shop-mullion'+j,[sx+j*sw*.245,1.62,face-sign*.14],[.075,2.76,.14],shop);
  box(id+'-store-plinth',[sx,.30,face-sign*.125],[sw+.10,.30,.23],shop);
  box(id+'-store-head',[sx,2.97,face-sign*.13],[sw+.10,.12,.23],shop);
  box(id+'-fascia',[sx,3.20,face-sign*.24],[sw+.28,.43,.31],shop,{material:{label:['ПЕКАРНЯ','КОФЕ И КНИГИ','АПТЕКА','МАСТЕРСКАЯ'][shopKind],roughness:.61}});
  box(id+'-fascia-cap',[sx,3.45,face-sign*.27],[sw+.40,.075,.45],shop);
  snowcap(id+'-awning-snow',[sx,3.495,face-sign*.30],sw+.47,.55,.17);
  add(id+'-store-light',[sx,2.25,front+sign*.72],{kind:'sphere',radius:.012,segments:8},[0,0,0,0],{light:{kind:'point',color:warm,intensity:kind==='courtyard'?5.8:5.2,range:6.8}});
  // Door recessed between masonry piers, with brass furniture and a warm transom.
  box(id+'-doorframe',[doorx,1.36,face-sign*.08],[doorw+.17,2.7,.19],trim);
  box(id+'-door',[doorx,1.29,face-sign*.20],[doorw,2.48,.08],[.15,.102,.065,1],{material:{roughness:.54}});
  box(id+'-doorwindow',[doorx,1.81,face-sign*.245],[doorw-.25,.92,.024],[.29,.23,.16,1],{material:{pattern:'window',metalness:.18,roughness:.20,emissive:[.15,.08,.025]}});
  for(const offset of [-.30,.30])box(id+'-doorpanel'+offset,[doorx+offset,.69,face-sign*.253],[.30,.62,.026],[.11,.072,.043,1]);
  rod(id+'-handle',[doorx+.39,1.02,face-sign*.30],[doorx+.39,1.23,face-sign*.30],.016,[.57,.39,.17,1]);
  box(id+'-threshold',[doorx,.185,face-sign*.25],[doorw+.2,.06,.55],[.34,.34,.31,1]);
  cylinder(id+'-drainpipe',[x-width/2+.20,height/2,face-sign*.20],.043,height,[.24,.26,.25,1]);
  for(let y=1.5;y<height;y+=2.4)cylinder(id+'-draincollar'+y,[x-width/2+.20,y,face-sign*.20],.065,.08,[.17,.19,.18,1]);
  for(let floor=0;floor<floors;floor++){const yy=3.55+floor*2.82;box(id+'-band'+floor,[x,yy,front-sign*.045],[width,.10,.19],trim);snowcap(id+'-band-snow'+floor,[x,yy+.054,front-sign*.08],width,.23,.055);}
  // Shop plants add a recognizable indoor scale behind the glass.
  for(const side of [-1,1]){
   const px=sx+side*sw*.40,pz=front+sign*.39;
   add(id+'-planter'+side,[px,.49,pz],{kind:'cylinder',radius:.18,topRadius:.22,height:.43,segments:14},[.26,.23,.18,1],{material:{roughness:.76,emissive:[.035,.015,.005]}});
   rod(id+'-plant-stem'+side,[px,.69,pz],[px,1.31,pz],.018,[.20,.18,.08,1]);
   for(let leaf=0;leaf<9;leaf++){const a=leaf*2.399,y=.80+leaf*.052;add(id+'-plant-leaf'+side+'-'+leaf,[px+Math.cos(a)*.13,y,pz+Math.sin(a)*.12],{kind:'sphere',radius:.5,segments:8},[.115,.22,.092,1],{scale:[.24,.095,.12],rotation:[0,a,.2],material:{roughness:.77,emissive:[.021,.022,.005]}});}
  }
 }
 function car(id,x,z,color,speed=0){
  const data=makeM3(id,x,z,color,speed);entities.push(...data.entities);motions.push(...data.motions);
  if(!speed){bank(id+'-roof-snow',[x-.35,1.46,z],[1.36,.07,1.28],79);bank(id+'-hood-snow',[x+1.38,1.01,z],[1.05,.055,1.38],98);}
  if(speed)for(const side of [-1,1])for(const xx of [-1.301,1.536])add(id+'-contact'+side+xx,[x+xx,.346,z+side*.80],{kind:'sphere',radius:.346},[0,0,0,0],{body:{motion:'kinematic',mass:390,velocity:[speed,0,0],friction:.7}});
 }
 // Street dimensions remain continuous through the camera path.
 box('ground',[0,-.20,0],[210,.3,150],C.snow,{material:{kind:'snow',roughness:.94}});
 box('road',[10,-.075,0],[180,.15,7.35],[.16,.153,.14,1],{material:{kind:'asphalt',roughness:.83},environmental:{surfaceUse:'road',snowDepthM:.003,iceDepthM:.00012,waterDepthM:.00085}});
 for(const sign of [-1,1]){
  box('curb-'+sign,[10,.13,sign*3.85],[180,.26,.23],[.54,.55,.53,1],{material:{kind:'concrete'},environmental:{surfaceUse:'curb',snowDepthM:.14}});
  box('walk-'+sign,[10,.065,sign*5.25],[180,.13,2.6],[.61,.61,.58,1],{material:{kind:'concrete'},environmental:{surfaceUse:'generic',snowDepthM:.052}});
  box('snow-verge-'+sign,[10,.04,sign*7.25],[180,.12,1.6],C.snow,{material:{kind:'snow'}});
  for(let i=0;i<8;i++){
   const x=-57+i*17+(sign>0?3:0),height=11.6+(i%3)*2.8,width=14+(i%2)*1.2;
   const palettes=[[.46,.265,.17,1],[.53,.49,.40,1],[.40,.45,.45,1],[.44,.25,.17,1],[.54,.46,.34,1]];
   building(`b${sign}-${i}`,x,sign*13.2,width,height,9.8,sign,palettes[(i+(sign>0?2:0))%5],i%3===1?'plaster':'brick');
  }
  for(let i=0;i<8;i++)lamp(`lamp${sign}-${i}`,-51+i*20,sign*5.95,kind==='courtyard');
  for(let i=0;i<4;i++)tree(`tree${sign}-${i}`,-38+i*35,sign*7.1,5.8+random()*1.4);
 }
 // Initial plough dressing: connected low shoulders, partly dirty compacted
 // chunks and sparse pushed-up crests. Weather/contacts still own later change.
 const dressing=rng(617309);
 for(const side of [-1,1]){
  for(let i=0;i<120;i++){
   const xx=-50+dressing()*134,zz=side*(2.98+dressing()*.57),size=.025+dressing()*.115;
   lump('plough-grit-'+side+'-'+i,[xx,.007+size*.13,zz],[size*(1.2+dressing()),size*.48,size],i%3===0?[.40,.385,.34,1]:[.66,.66,.61,1]);
  }
  let station=-50,index=0;
  while(station<86){
   const stretch=1.65+dressing()*2.2,center=station+stretch*.42,shoulder=bank('plough-shoulder-'+side+'-'+index,[center,.027,side*(3.46+(dressing()-.5)*.32)],[stretch,.09+dressing()*.16,.72+dressing()*.40],74000+index*19+side,20);
   shoulder.rotation=[0,(dressing()-.5)*.20,0];
   shoulder.material.color=index%4===0?[.64,.64,.60,1]:[.83,.85,.83,1];
   // Occasional thrown blocks overlap the existing ridge instead of a row of isolated peaks.
   if(index%3===1){const crest=bank('plough-crest-'+side+'-'+index,[center+.25,.12+dressing()*.035,side*(3.86+(dressing()-.5)*.20)],[1.0+dressing()*1.2,.20+dressing()*.18,.54+dressing()*.24],75000+index*31+side,16);crest.rotation=[0,(dressing()-.5)*.26,0];}
   station+=stretch*(.63+dressing()*.16);index++;
  }
  // Low irregular shoulders soften the abrupt sidewalk/verge seam. The walking
  // strip z=4.62..5.42 is deliberately free of authored piles or imitation prints.
  for(let i=0;i<86;i++){
   const xx=-49+i*1.55+(dressing()-.5)*.6;
   bank('walk-edge-'+side+'-'+i,[xx,.152,side*(6.49+(dressing()-.5)*.17)],[.65+dressing()*.75,.028+dressing()*.06,.48+dressing()*.50],78000+i*11+side,12);
  }
  for(let i=0;i<300;i++){
   const xx=-48+dressing()*132,edge=i%3===0?4.18+dressing()*.35:5.72+dressing()*.68,r=.009+dressing()*.035;
   lump('walk-grain-'+side+'-'+i,[xx,.181+r*.09,side*edge],[r*(1.1+dressing()),r*.40,r],i%11===0?[.64,.635,.595,1]:[.90,.92,.90,1]);
  }
  // Small compacted slush fragments remain between the cleared wheel tracks.
  for(let i=0;i<60;i++){const xx=-48+dressing()*132,zz=side*(.12+dressing()*.29),size=.023+dressing()*.075;lump('centre-slush-'+side+'-'+i,[xx,.004,zz],[size*1.9,size*.25,size],[.44,.44,.405,1]);}
 }
 // Markings worn and partially buried in the wet carriageway.
 // The old lane line is mostly covered by ploughed wet snow.
 for(let i=0;i<28;i++)box('lane-mark'+i,[-72+i*6,.003,0],[.55+random()*.65,.006,.08],[.38,.38,.33,1]);
 for(let i=0;i<8;i++)box('crosswalk'+i,[48+(i-3.5)*.7,.004,0],[.31,.008,6.5],[.40,.41,.38,1]);
 bench('bench',-15,6.5,1);bench('bench-west',28,-6.2,-1);
 for(const [x,z,c] of [[32,2.75,[.23,.25,.27,1]]])car('parked-'+x,x,z,c);
 car('passing',CAR.startX,CAR.z,[.37,.49,.52,1],CAR.speed);
 entities.push(...makePedestrian());
 for(const [i,x] of [-11,9].entries()){
  const points=Array.from({length:40},(_,j)=>{const a=j/40*Math.PI*2,r=1+.06*Math.sin(a*5+.8)+.04*Math.sin(a*9);return[Math.cos(a)*1.6*r,Math.sin(a)*1.05*r];});
  add('puddle'+i,[x,.002,-1.4],{kind:'polygon-prism',axis:1,points,thickness:.001},[.105,.12,.13,1],{material:{kind:'asphalt',roughness:.17},environmental:{surfaceUse:'road',waterDepthM:.004}});
 }
 // Low fencing and street furniture give nearby snow a human scale.
 for(let i=0;i<30;i++){
  const x=-30+i*1.6;cylinder('fence-post'+i,[x,.70,7.25],.042,1.4,C.metal);lump('fence-cap'+i,[x,1.43,7.25],[.18,.12,.16]);
  if(i<29){for(const yy of [.38,1.15]){rod('fence-rail'+i+'-'+yy,[x,yy,7.25],[x+1.6,yy,7.25],.032);snowcap('fence-snow'+i+'-'+yy,[x+.8,yy+.025,7.25],1.58,.14,.095);}for(let bar=1;bar<=3;bar++)cylinder('fence-bar'+i+'-'+bar,[x+bar*.4,.79,7.25],.020,.84,C.metal);}
 }

 cylinder('bin',[-7,.54,6.4],.28,.8,[.20,.26,.24,1]);bank('bin-snow',[-7,.96,6.4],[.57,.10,.57],12);
 // A distant civic building closes the street vista at a believable city block.
 const backStart=entities.length;building('back-vista',-87,0,31,13,10,1,[.48,.41,.33,1],'brick');
 for(const e of entities.slice(backStart)){const [xx,yy,zz]=e.position;e.position=[-87-zz,yy,xx+87];e.rotation=[0,-Math.PI/2,0];}
 const vistaStart=entities.length;building('vista',105,0,24,20,12,1,[.54,.53,.48,1],'plaster');
 for(const e of entities.slice(vistaStart)){const [xx,yy,zz]=e.position;e.position=[105+zz,yy,-(xx-105)];e.rotation=[0,Math.PI/2,0];}
 cylinder('vista-clock',[98.92,16.9,0],1.03,.08,[.86,.84,.74,1],{rotation:[0,0,Math.PI/2]});
 for(let i=0;i<12;i++){const a=i/12*Math.PI*2;rod('clock-index'+i,[98.86,16.9+Math.cos(a)*.83,Math.sin(a)*.83],[98.86,16.9+Math.cos(a)*.92,Math.sin(a)*.92],.025);}
 rod('clock-minute',[98.85,16.9,0],[98.85,16.9,.74],.037);rod('clock-hour',[98.84,16.9,0],[98.84,16.56,-.42],.05);
 box('cross-street',[91,-.075,0],[9,.15,50],[.16,.17,.18,1],{material:{kind:'asphalt',roughness:.68},environmental:{surfaceUse:'road',snowDepthM:.015,iceDepthM:.0008}});
 if(hero){
  // Recover the photographic hero state without special-casing renderer behavior:
  // remove sub-pixel road dressing, keep continuous snow masses, and author the
  // wet road as physically dark asphalt instead of a bright brown diffuse slab.
  for(let i=entities.length-1;i>=0;i--){
   const id=entities[i].id;
   if(id.startsWith('plough-grit-')||id.startsWith('walk-grain-')||id.startsWith('centre-slush-')||id.startsWith('plough-shoulder-')||id.startsWith('plough-crest-'))entities.splice(i,1);
  }
  bank('hero-bank-near',[-13,.18,-4.12],[118,.48,1.08],4617,72);
  bank('hero-bank-far',[-13,.18,4.08],[118,.56,1.22],9121,72);
  for(const entity of entities){
   if(entity.id==='road'){
    entity.material={...entity.material,color:[.014,.016,.020,1],roughness:.72};
    entity.environmental={...entity.environmental,snowDepthM:.001,iceDepthM:.00003,waterDepthM:.0010};
   }
   if(entity.id.startsWith('puddle')){
    entity.material={...entity.material,color:[.025,.032,.040,1],roughness:.10};
   }
  }
 }
 const snowTexture={url:'/assets/snow-granular.png',sizeM:1.2,bumpStrength:.4,albedoStrength:.45};for(const e of entities){if(e.material?.kind==='snow')e.material.texture=snowTexture;if(e.environmental?.snowDepthM)e.environmental.snowMaterial={texture:snowTexture};}
 for(const e of entities)if(e.material?.pattern==='brick'){e.material.texture={url:'/assets/brick-weathered.png',sizeM:1.55,bumpStrength:.40,albedoStrength:1};e.material.color=[.88,.82,.76,1];}
 const spec={version:1,seed:20260920,ground:-100,
  environment:hero
   ?{temperatureC:-3,humidity:.58,groundMoisture:.42,precipitation:'rare',snowfall:'moderate',sunlight:.88,wind:[.35,0,.08],clock:{startHour:14.7,hoursPerSecond:0}}
   :{temperatureC:-6,humidity:.76,groundMoisture:.36,precipitation:'rare',snowfall:'moderate',sunlight:.24,wind:[.7,0,.2],clock:{startHour:17.3,hoursPerSecond:0}},
  rendering:hero
   ?{sunDirection:[.42,.80,-.42],sunColor:[1,.955,.88],sunIntensity:3.35,skyColor:[.33,.50,.72],fogDensity:.00055,exposure:1.02,shadowExtent:35}
   :{sunDirection:[-.65,.32,-.5],sunColor:[.70,.79,1],sunIntensity:1.8,skyColor:[.19,.24,.32],fogDensity:.0045,exposure:1.12,shadowExtent:35},
  camera:{position:[-29,1.45,5.8],target:[-2,2.6,-2.5],fov:47},entities};
 if(hero){
  const exclude=entities.filter(entity=>entity.id.startsWith('passing-')).map(entity=>entity.id);
  spec.rendering.reflectionProbe={entity:'passing-body',offset:[0,.92,0],radius:42,exclude,facesPerFrame:1};
 }
 if(kind==='courtyard'){spec.environment.sunlight=.12;spec.environment.snowfall='moderate';spec.rendering={sunDirection:[-.4,.5,-.3],sunColor:[.48,.63,1],sunIntensity:.70,skyColor:[.14,.20,.29],fogDensity:.006,exposure:1.10,shadowExtent:35};}
 spec.animation={walkers:[pedestrianAnimation()],vehicles:[{id:'passing',velocity:[CAR.speed,0,0],parts:motions.map(({id,origin,wheel,radius})=>({id,origin,wheel,radius}))}]};
 spec.surfaceContacts={snow:[{surfaceId:'walk-1',seed:701}],wheels:entities.filter(e=>e.id.startsWith('passing-contact')).map(e=>({entityId:e.id,radius:CAR.radius,lateral:[0,0,e.position[2]>CAR.z?1:-1]}))};
 const sourceCount=entities.length;spec.entities=batchStaticScenery(entities,e=>!e.id.startsWith('passing')&&!e.id.startsWith('walker-')&&e.material?.pattern!=='window');
 return{spec,motions,sourceCount};
}
