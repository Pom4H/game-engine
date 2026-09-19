import {makeLaboratory} from './laboratory.mjs';
import {makeM3,makePedestrian,CAR} from './actors.mjs';
import {batchStaticScenery} from '../../dist/index.js';
// Original street geometry in metres; user supplied M3 imported offline.
const C={snow:[.93,.955,.975,1],stone:[.59,.57,.52,1],dark:[.07,.075,.078,1],metal:[.16,.18,.19,1],glass:[.16,.23,.28,1]};
const rng=seed=>()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
export function makeCity(kind='street',m3){if(kind==='laboratory')return makeLaboratory();

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
   const lit=random()<(kind==='courtyard'?.72:.20),glass=lit?[.50,.38,.23,1]:[.13,.17,.21,1];
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
  const data=makeM3(m3,id,x,z,color,speed);entities.push(...data.entities);motions.push(...data.motions);
  if(!speed){bank(id+'-roof-snow',[x-.35,1.46,z],[1.36,.07,1.28],79);bank(id+'-hood-snow',[x+1.38,1.01,z],[1.05,.055,1.38],98);}
  if(speed)for(const side of [-1,1])for(const xx of [-1.301,1.536])add(id+'-contact'+side+xx,[x+xx,.346,z+side*.80],{kind:'sphere',radius:.346},[0,0,0,0],{body:{motion:'kinematic',mass:390,velocity:[speed,0,0],friction:.7}});
 }
 // Street dimensions remain continuous through the camera path.
 box('ground',[0,-.20,0],[210,.3,150],C.snow,{material:{kind:'snow',roughness:.94}});
 box('road',[10,-.075,0],[180,.15,7.35],[.16,.17,.18,1],{material:{kind:'asphalt',roughness:.76},environmental:{surfaceUse:'road',snowDepthM:.008,iceDepthM:.00025}});
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
 // Settled fragments at the ploughed bank foot. Footprints are contact-driven.
 // Authored initial surface dressing, separate from the simulated vehicle tracks.
 for(const side of [-1,1]){
  for(let i=0;i<70;i++){const xx=-48+i*1.7+random()*.6;bank('plough-'+side+'-'+i,[xx,.004,side*(3.24+random()*.20)],[.15+random()*.5,.025+random()*.09,.13+random()*.27],1500+i);}
 }
 // Markings worn and partially buried in the wet carriageway.
 for(let i=0;i<28;i++)box('lane-mark'+i,[-72+i*6,.004,0],[2,.008,.10],[.60,.60,.53,1]);
 for(let i=0;i<8;i++)box('crosswalk'+i,[17+(i-3.5)*.7,.006,0],[.38,.012,6.5],[.61,.62,.59,1]);
 bench('bench',-15,6.5,1);bench('bench-west',28,-6.2,-1);
 for(const [x,z,c] of [[32,2.75,[.23,.25,.27,1]]])car('parked-'+x,x,z,c);
 car('passing',CAR.startX,CAR.z,[.37,.49,.52,1],CAR.speed);
 entities.push(...makePedestrian());
 for(const [i,x] of [-11,9].entries()){
  const points=Array.from({length:40},(_,j)=>{const a=j/40*Math.PI*2,r=1+.06*Math.sin(a*5+.8)+.04*Math.sin(a*9);return[Math.cos(a)*1.6*r,Math.sin(a)*1.05*r];});
  add('puddle'+i,[x,.002,-1.4],{kind:'polygon-prism',axis:1,points,thickness:.001},[.105,.12,.13,1],{material:{kind:'asphalt',roughness:.17},environmental:{surfaceUse:'road',waterDepthM:.004}});
 }
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
 const spec={version:1,seed:20260920,ground:-100,environment:{temperatureC:-6,humidity:.76,groundMoisture:.36,precipitation:'rare',snowfall:'moderate',sunlight:.64,wind:[.7,0,.2],clock:{startHour:8.3,hoursPerSecond:0}},rendering:{sunDirection:[-.65,.32,-.5],sunColor:[1,.83,.65],sunIntensity:4.8,skyColor:[.18,.24,.32],fogDensity:.0025,exposure:1.0,shadowExtent:65},camera:{position:[-29,1.45,5.8],target:[-2,2.6,-2.5],fov:47},entities};
 if(kind==='courtyard'){spec.environment.sunlight=.12;spec.environment.snowfall='moderate';spec.rendering={sunDirection:[-.4,.5,-.3],sunColor:[.48,.63,1],sunIntensity:.38,skyColor:[.10,.16,.28],fogDensity:.008,exposure:1.45,shadowExtent:45};}
 const sourceCount=entities.length;spec.entities=batchStaticScenery(entities,e=>!e.id.startsWith('passing')&&!e.id.startsWith('walker-')&&e.material?.pattern!=='window');
 return{spec,motions,sourceCount};
}
