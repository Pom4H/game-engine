import {makeLaboratory} from './laboratory.mjs';
import {bodyMesh,cabinMesh,quad} from './vehicle.mjs';
// Original procedural sets. Metres throughout; no downloaded assets.
const C={snow:[.93,.955,.975,1],stone:[.59,.57,.52,1],dark:[.07,.075,.078,1],metal:[.16,.18,.19,1],glass:[.16,.23,.28,1]};
const rng=seed=>()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
export function makeCity(kind='street'){if(kind==='laboratory')return makeLaboratory();
 const bodyGeometry=bodyMesh(),cabinGeometry=cabinMesh();
 const entities=[],random=rng(20260920),motions=[];let sequence=0;
 const add=(id,p,mesh,color=C.stone,extra={})=>{const e={id,position:p,mesh,material:{kind:'default',color,roughness:.8,...extra.material},...extra};if(extra.material)e.material={kind:'default',color,roughness:.8,...extra.material};entities.push(e);return e;};
 const box=(id,p,s,c=C.stone,extra={})=>add(id,p,{kind:'box',size:s},c,extra);
 const cylinder=(id,p,r,h,c=C.metal,extra={})=>add(id,p,{kind:'cylinder',radius:r,height:h,segments:24},c,extra);
 const bank=(id,p,s,seed)=>add(id,p,{kind:'snowdrift',size:s,seed,segments:48},C.snow,{material:{kind:'snow',roughness:.9}});
 function rod(id,a,b,r,c=C.metal){const d=b.map((v,i)=>v-a[i]),length=Math.hypot(...d);return cylinder(id,a.map((v,i)=>(v+b[i])/2),r,length,c,{rotation:[Math.atan2(d[2],d[1]),0,Math.asin(-d[0]/length)]});}
 function tree(id,x,z,height=7){
  let serial=0;const color=[.20,.17,.135,1];
  function branch(a,dir,length,radius,depth){
    const end=a.map((v,k)=>v+dir[k]*length),d=end.map((v,k)=>v-a[k]),l=Math.hypot(...d);
    add(id+'-limb'+serial++,a.map((v,k)=>(v+end[k])/2),{kind:'cylinder',radius,height:l,topRadius:radius*.55,segments:9},color,{rotation:[Math.atan2(d[2],d[1]),0,Math.asin(-d[0]/l)],material:{roughness:.97}});
    if(!depth)return;
    for(let j=0;j<2;j++){
      let v=[dir[0]*.75+(random()-.5)*1.05,dir[1]*.75+.12+random()*.18,dir[2]*.75+(random()-.5)*1.05];const n=Math.hypot(...v);v=v.map(x=>x/n);
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
  const lightColor=[1,.63,.29],brightness=night?6:2;
  cylinder(id+'-glow',[x,5.08,z],.145,.38,[1,.75,.4,1],{light:{kind:'point',color:lightColor,intensity:brightness*1.1,range:10},material:{emissive:lightColor.map(v=>v*brightness),roughness:.35}});
  for(let a=0;a<4;a++){const angle=a*Math.PI/2;cylinder(id+'-bar'+a,[x+Math.cos(angle)*.16,5.07,z+Math.sin(angle)*.16],.017,.45,C.metal);}
  add(id+'-cap',[x,5.36,z],{kind:'cylinder',radius:.29,topRadius:.035,height:.18,segments:24},C.metal);
  bank(id+'-cap-snow',[x,5.45,z],[.55,.07,.55],32);
 }
 function bench(id,x,z,sign=1){
  const wood=[.26,.16,.09,1];
  for(let i=0;i<5;i++)box(id+'-seat'+i,[x,.59,z+(i-2)*.10],[1.9,.065,.082],wood,{material:{roughness:.72}});
  for(let i=0;i<3;i++)box(id+'-back'+i,[x,.84+i*.13,z+sign*.27],[1.9,.075,.08],wood);
  for(const side of [-1,1]){rod(id+'-leg'+side,[x+side*.72,.16,z-.21],[x+side*.72,.65,z+.15],.035);rod(id+'-backpole'+side,[x+side*.78,.50,z+sign*.27],[x+side*.78,1.17,z+sign*.3],.027);}
  bank(id+'-snow-seat',[x,.63,z],[1.88,.11,.48],47);
  bank(id+'-snow-back',[x,1.145,z+sign*.27],[1.89,.055,.16],55);
 }
 function building(id,x,z,width,height,depth,sign,color,pattern='brick'){
  const front=z-sign*depth/2,face=front-sign*.03,trim=[.70,.68,.61,1];
  box(id+'-mass',[x,height/2+.1,z],[width,height,depth],color,{material:{pattern,roughness:.92}});
  box(id+'-foundation',[x,.48,front],[width,.8,.34],[.32,.34,.34,1]);
  box(id+'-cornice',[x,height-.04,z],[width+.48,.3,depth+.48],trim);
  box(id+'-frieze',[x,height-.44,front-sign*.08],[width+.28,.18,.42],trim);
  box(id+'-roof',[x,height+.2,z],[width+.3,.18,depth+.3],[.2,.24,.25,1]);
  bank(id+'-roof-snow',[x,height+.3,z],[width+.55,.20,depth+.55],Math.floor(random()*10000));
  for(let c=0;c<2;c++){
   box(id+'-chimney'+c,[x+(c-.5)*width*.5,height+.7,z+1],[.65,1,.6],[.31,.23,.19,1],{material:{pattern:'brick'}});
   box(id+'-chimneycap'+c,[x+(c-.5)*width*.5,height+1.23,z+1],[.78,.14,.73],C.snow);
  }
  const cols=Math.max(3,Math.floor(width/2.4)),floors=Math.floor((height-1)/2.9);
  for(let floor=0;floor<floors;floor++)for(let col=0;col<cols;col++){
   const wx=x+(col-(cols-1)/2)*(width/(cols+.4)),wy=2+floor*2.82,w=1.2,h=1.65,wid=id+'-w'+floor+'-'+col;
   const lit=random()<(kind==='courtyard'?.72:.20),glass=lit?[.50,.38,.23,1]:[.11+random()*.04,.17,.21,1];
   box(wid+'-recess',[wx,wy,face-sign*.055],[w+.16,h+.16,.08],[.09,.10,.10,1]);
   box(wid+'-glass',[wx,wy,face-sign*.1],[w,h,.04],glass,{material:{pattern:'window',metalness:.05,roughness:.23,emissive:lit?[.44,.27,.12]:[0,0,0]}});
   // Deep reveals, sash and sill provide actual silhouette and shadow geometry.
   for(const side of [-1,1])box(wid+'-jamb'+side,[wx+side*(w/2+.055),wy,face-sign*.16],[.095,h+.22,.16],trim);
   box(wid+'-top',[wx,wy+h/2+.075,face-sign*.14],[w+.3,.12,.13],trim);
   box(wid+'-sill',[wx,wy-h/2-.04,face-sign*.24],[w+.4,.11,.36],trim);
   box(wid+'-snow',[wx,wy-h/2+.035,face-sign*.25],[w+.42,.055,.38],C.snow);
   box(wid+'-sash',[wx,wy,face-sign*.145],[.045,h,.075],trim);
   box(wid+'-cross',[wx,wy+.16,face-sign*.15],[w,.038,.075],trim);
   if(lit)box(wid+'-curtain',[wx-w*.30,wy,face-sign*.122],[w*.24,h,.015],[.68,.61,.46,1],{material:{emissive:[.10,.055,.018]}});
  }
  // Ground-floor storefront with mullions, painted fascia and entrance.
  if(height>11){
   const sx=x-width*.24;box(id+'-store-border',[sx,1.5,face-sign*.13],[width*.43,2.6,.16],[.16,.22,.20,1]);
   box(id+'-store-glass',[sx,1.40,face-sign*.25],[width*.37,2.1,.05],[.15,.20,.19,1],{material:{pattern:'window',metalness:.10,roughness:.23,emissive:[.012,.006,.002]}});
   for(let j=-1;j<=1;j++)box(id+'-shop-mullion'+j,[sx+j*width*.125,1.4,face-sign*.29],[.075,2.1,.05],[.13,.18,.16,1]);
   box(id+'-fascia',[sx,2.76,face-sign*.24],[width*.45,.36,.26],[.11,.19,.17,1],{material:{label:['ПЕКАРНЯ','КОФЕ И КНИГИ','АПТЕКА','МАСТЕРСКАЯ'][Math.floor(random()*4)],roughness:.64}});
   box(id+'-awning-snow',[sx,2.98,face-sign*.29],[width*.47,.12,.45],C.snow);
  }
  if(id.endsWith('-3')||id.endsWith('-5')){box(id+'-canopy',[x+width*.31,2.63,face-sign*.61],[2.1,.13,1.34],[.14,.20,.19,1]);bank(id+'-canopy-snow',[x+width*.31,2.70,face-sign*.61],[2.15,.16,1.37],62);}
  const doorx=x+width*.31;box(id+'-doorframe',[doorx,1.28,face-sign*.11],[1.38,2.5,.21],trim);box(id+'-door',[doorx,1.22,face-sign*.23],[1.11,2.3,.06],[.20,.13,.083,1]);box(id+'-doorwindow',[doorx,1.65,face-sign*.265],[.81,.98,.025],C.glass,{material:{metalness:.3,roughness:.2}});
  cylinder(id+'-drainpipe',[x-width/2+.20,height/2,face-sign*.20],.047,height,[.29,.31,.29,1]);
  for(let floor=1;floor<floors;floor++)box(id+'-band'+floor,[x,floor*2.82+.48,front-sign*.04],[width,.11,.18],trim);
 }
 function car(id,x,z,color,speed=0){
  const start=entities.length,steel={roughness:.40,metalness:.30};
  add(id+'-body',[x,0,z],bodyGeometry,color,{material:steel});
  add(id+'-cabin',[x,0,z],cabinGeometry,color,{material:steel});
  add(id+'-windshield',[x,0,z],quad([[1.28,1.111,-.790],[1.28,1.111,.790],[.61,1.629,.712],[.61,1.629,-.712]],[1,1,0]),[.095,.17,.21,1],{material:{metalness:.5,roughness:.15}});
  add(id+'-backlight',[x,0,z],quad([[-1.12,1.110,.792],[-1.12,1.110,-.792],[-.62,1.66,-.712],[-.62,1.66,.712]],[-1,1,0]),[.095,.17,.21,1],{material:{metalness:.5,roughness:.15}});
  for(const [window,points] of [['front',[[1.28,1.111,-.790],[1.28,1.111,.790],[.61,1.629,.712],[.61,1.629,-.712]]],['rear',[[-1.12,1.110,.792],[-1.12,1.110,-.792],[-.62,1.66,-.712],[-.62,1.66,.712]]]])for(let i=0;i<4;i++)rod(id+'-window-frame-'+window+i,points[i].map((v,k)=>v+[x,0,z][k]),points[(i+1)%4].map((v,k)=>v+[x,0,z][k]),.027,color);
  for(const side of [-1,1]){
   for(const [name,points] of [['rear',[[-.98,1.12],[-.58,1.56],[-.12,1.56],[-.12,1.12]]],['front',[[.0,1.12],[.0,1.56],[.57,1.54],[1.09,1.12]]]]){
    let vertices=points.map(([xx,yy])=>[xx,yy,side*(.798-(yy-1.045)*.16)]);if(side<0)vertices=vertices.reverse();
    add(id+'-glass-'+side+name,[x,0,z],quad(vertices,[0,.2,side]),[.10,.17,.20,1],{material:{roughness:.18,metalness:.4}});
   }
   box(id+'-chrome'+side,[x,.64,z+side*.88],[4.1,.055,.035],[.52,.56,.56,1],{material:{metalness:.9,roughness:.18}});
   for(const xx of [-1.35,1.37]){
    add(id+'-tyre'+side+xx,[x+xx,.33,z+side*.84],{kind:'torus',radius:.247,tube:.083,segments:48},[.04,.041,.042,1],{rotation:[Math.PI/2,0,0],material:{roughness:.97,pattern:'rubber'}});
    cylinder(id+'-rim'+side+xx,[x+xx,.33,z+side*.924],.205,.025,[.52,.55,.54,1],{rotation:[Math.PI/2,0,0],material:{metalness:.84,roughness:.24}});
    for(let spoke=0;spoke<7;spoke++){const angle=spoke/7*Math.PI*2;rod(id+'-spoke'+side+xx+spoke,[x+xx,.33,z+side*.944],[x+xx+Math.cos(angle)*.17,.33+Math.sin(angle)*.17,z+side*.944],.017,[.72,.74,.72,1]);}
    cylinder(id+'-hub'+side+xx,[x+xx,.33,z+side*.942],.07,.027,[.27,.29,.29,1],{rotation:[Math.PI/2,0,0],material:{metalness:.9,roughness:.2}});
   }
   box(id+'-mirror'+side,[x+.63,1.14,z+side*1.02],[.20,.13,.25],color,{material:steel});
   box(id+'-handle'+side,[x+.12,1.03,z+side*.9],[.23,.035,.04],[.62,.64,.64,1],{material:{metalness:.9}});
   box(id+'-tail'+side,[x-2.10,.79,z+side*.49],[.045,.12,.24],[.46,.03,.02,1],{material:{emissive:speed?[1,.025,.008]:[.08,.003,.001],roughness:.2}});
   box(id+'-headlight'+side,[x+2.09,.77,z+side*.46],[.035,.14,.26],[.9,.85,.68,1],{material:{emissive:speed?[2.8,2.15,1.35]:[.25,.20,.12],roughness:.15}});
  }
  box(id+'-bumper',[x+2.19,.52,z],[.09,.14,1.56],[.15,.16,.16,1],{material:{metalness:.3,roughness:.4}});
  box(id+'-grille',[x+2.19,.76,z],[.025,.20,.63],C.dark);box(id+'-plate',[x+2.247,.57,z],[.014,.09,.34],[.77,.79,.72,1]);
  bank(id+'-roof-snow',[x-.02,1.615,z],[1.28,speed?.035:.12,1.44],79);
  if(speed){for(const e of entities.slice(start)){const origin=[...e.position];motions.push({id:e.id,origin,speed,rotation:[...(e.rotation??[0,0,0])],wheel:e.id.includes('-spoke'),center:[x+(e.position[0]<x?-1.35:1.37),.33,e.position[2]]});}for(const side of [-1,1])for(const xx of [-1.35,1.37]){
   add(id+'-contact'+side+xx,[x+xx,.32,z+side*.84],{kind:'sphere',radius:.32},[0,0,0,0],{body:{motion:'kinematic',mass:360,velocity:[speed,0,0],friction:.7}});
  }}
 }
 // Street dimensions remain continuous through the camera path.
 box('ground',[0,-.20,0],[210,.3,150],C.snow,{material:{kind:'snow',roughness:.94}});
 box('road',[10,-.075,0],[180,.15,7.35],[.16,.17,.18,1],{material:{kind:'asphalt',roughness:.58},environmental:{surfaceUse:'road',snowDepthM:.008,iceDepthM:.0015}});
 for(const sign of [-1,1]){
  box('curb-'+sign,[10,.13,sign*3.85],[180,.26,.23],[.54,.55,.53,1],{material:{kind:'concrete'},environmental:{surfaceUse:'curb',snowDepthM:.21}});
  box('walk-'+sign,[10,.065,sign*5.25],[180,.13,2.6],[.61,.61,.58,1],{material:{kind:'concrete'},environmental:{surfaceUse:'generic',snowDepthM:.052}});
  box('snow-verge-'+sign,[10,.04,sign*7.25],[180,.12,1.6],C.snow,{material:{kind:'snow'}});
  for(let i=0;i<8;i++){
   const x=-57+i*17+(sign>0?3:0),height=11.6+(i%3)*2.8,width=14+(i%2)*1.2;
   const palettes=[[.48,.34,.27,1],[.64,.61,.52,1],[.50,.55,.56,1],[.50,.31,.24,1],[.60,.55,.44,1]];
   building(`b${sign}-${i}`,x,sign*13.2,width,height,9.8,sign,palettes[(i+(sign>0?2:0))%5],i%3===1?'plaster':'brick');
  }
  for(let i=0;i<8;i++)lamp(`lamp${sign}-${i}`,-51+i*20,sign*5.95,kind==='courtyard');
  for(let i=0;i<4;i++)tree(`tree${sign}-${i}`,-38+i*35,sign*7.1,5.8+random()*1.4);
 }
 // Settled fragments at the ploughed bank's foot and old compressed shoe prints.
 // Authored initial surface dressing, separate from the simulated vehicle tracks.
 for(const side of [-1,1]){
  for(let i=0;i<70;i++){const xx=-48+i*1.7+random()*.6;bank('plough-'+side+'-'+i,[xx,.004,side*(3.24+random()*.20)],[.15+random()*.5,.025+random()*.09,.13+random()*.27],1500+i);}
  for(let i=0;i<95;i++){const xx=-40+i*.64,zz=side*5.02+Math.sin(xx*.08)*.16+(i%2?.09:-.09);add('old-footprint-'+side+'-'+i,[xx,.133,zz],{kind:'polygon-prism',axis:1,points:[[-.13,-.04],[-.09,-.052],[.095,-.05],[.15,-.02],[.14,.04],[.03,.055],[-.10,.04]],thickness:.0015},[.57,.61,.64,1],{rotation:[0,(i%2?.11:-.11),0],material:{roughness:.99}});}
 }
 // Markings worn and partially buried in the wet carriageway.
 for(let i=0;i<28;i++)box('lane-mark'+i,[-72+i*6,.004,0],[2,.008,.10],[.60,.60,.53,1]);
 for(let i=0;i<8;i++)box('crosswalk'+i,[17+(i-3.5)*.7,.006,0],[.38,.012,6.5],[.61,.62,.59,1]);
 bench('bench',-15,6.5,1);bench('bench-west',28,-6.2,-1);
 for(const [x,z,c] of [[-17,2.8,[.23,.31,.32,1]],[12,-2.8,[.35,.22,.15,1]],[39,2.8,[.34,.35,.32,1]],[-42,-2.8,[.17,.24,.30,1]]])car('parked-'+x,x,z,c);
 car('passing',-32,-1.6,[.19,.23,.26,1],4.8);
 // Low fencing and street furniture give nearby snow a human scale.
 for(let i=0;i<11;i++){const x=-20+i*1.6;cylinder('fence-post'+i,[x,.60,7.6],.028,1.2,C.metal);if(i<10){rod('fence-top'+i,[x,1.02,7.6],[x+1.6,1.02,7.6],.023);rod('fence-low'+i,[x,.30,7.6],[x+1.6,.30,7.6],.018);}}
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
 if(kind==='square'){
  for(let i=entities.length-1;i>=0;i--)if(['b1-3','b1-4','b1-5'].some(prefix=>entities[i].id.startsWith(prefix)))entities.splice(i,1);
  for(let i=0;i<7;i++)building('square-back-'+i,-9+i*16,42,14,10.5+(i%3)*2.8,8,1,[[.54,.39,.30,1],[.61,.60,.54,1],[.46,.49,.48,1]][i%3],i%2?'plaster':'brick');
  for(let i=0;i<6;i++)tree('square-back-tree'+i,-5+i*8,35+(i%2)*2,7+random());
  for(let i=0;i<25;i++){const xx=-9+i*2;cylinder('square-fence'+i,[xx,.70,33],.026,1.2);if(i<24){rod('square-rail'+i,[xx,1.15,33],[xx+2,1.15,33],.025);rod('square-rail-low'+i,[xx,.4,33],[xx+2,.4,33],.018);}}
  box('square-base',[14,.025,20],[46,.15,26],C.snow,{material:{kind:'snow'}});
  box('square-walk',[14,.108,19],[40,.015,2.2],[.61,.62,.59,1],{material:{kind:'concrete',roughness:.82}});
  cylinder('fountain-base',[13,.37,23],3.8,.6,[.42,.44,.43,1]);
  add('fountain-rim',[13,.70,23],{kind:'torus',radius:3.65,tube:.24,segments:80},C.snow,{material:{kind:'snow'}});
  cylinder('fountain-ice',[13,.64,23],3.43,.06,[.36,.48,.52,1],{material:{roughness:.12,metalness:.23}});
  cylinder('fountain-core',[13,.95,23],.48,.7,[.45,.46,.43,1]);bank('fountain-cap',[13,1.30,23],[1.12,.16,1.12],56);
  for(const [xx,zz] of [[-2,16],[27,17],[1,29],[26,29],[35,20]]){tree('square-tree'+xx,xx,zz,6.4);lamp('square-lamp'+xx,xx+2,zz-2,true);}
  bench('square-bench',5,19.8,1);bench('square-bench2',23,19.8,1);
  for(let i=0;i<7;i++)bank('square-bank'+i,[-6+i*6,.09,32],[7,.45+random()*.24,2.4],770+i);
 }
 const spec={version:1,seed:20260920,ground:-100,environment:{temperatureC:-6,humidity:.76,groundMoisture:.6,precipitation:'rare',snowfall:'light',sunlight:.64,wind:[.7,0,.2],clock:{startHour:8.3,hoursPerSecond:0}},rendering:{sunDirection:[-.8,.46,-.13],sunColor:[1,.76,.49],sunIntensity:5.5,skyColor:[.14,.21,.33],fogDensity:.0025,exposure:1.0,shadowExtent:65},camera:{position:[-29,1.45,5.8],target:[-2,2.6,-2.5],fov:47},entities};
 if(kind==='courtyard'){spec.environment.sunlight=.12;spec.environment.snowfall='moderate';spec.rendering={sunDirection:[-.4,.5,-.3],sunColor:[.48,.63,1],sunIntensity:.38,skyColor:[.10,.16,.28],fogDensity:.008,exposure:1.45,shadowExtent:45};}
 return{spec,motions};
}
