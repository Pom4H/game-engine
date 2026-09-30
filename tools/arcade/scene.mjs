// A fully geometric scene: no reference-image cards, sky photographs or overlays.
// All materials, lighting, snowfall and depth fog are rendered by game-engine.
import {batchStaticScenery} from '../../dist/procedural/static-batch.js';

export const camera={position:[7.2707,2.35,-8.8992],target:[-5.7446,2.35,6.2854],intrinsics:{fx:638.8486,fy:638.8486,cx:640,cy:526.8103,width:1280,height:720},aperture:0};
export const quality={output:[1920,1080],internal:[3840,2160],warmupFrames:24};
const P={
 wall:{kind:'default',color:[.36,.315,.265,1],pattern:'plaster',roughness:.96,ageYears:45},
 side:{kind:'default',color:[.16,.145,.12,1],pattern:'brick',roughness:.96,ageYears:95},
 wood:{kind:'default',color:[.18,.112,.072,1],pattern:'plaster',roughness:.78,ageYears:35},
 trim:{kind:'default',color:[.25,.22,.175,1],roughness:.83,ageYears:70},
 iron:{kind:'default',color:[.06,.066,.065,1],metalness:.72,roughness:.52,ageYears:55},
 roof:{kind:'default',color:[.16,.164,.158,1],metalness:.45,roughness:.73,ageYears:60},
 snow:{kind:'snow',color:[.76,.79,.78,1],roughness:.92},
 stone:{kind:'concrete',color:[.22,.215,.20,1],roughness:.86,ageYears:100},
 brass:{kind:'default',color:[.48,.31,.12,1],metalness:.75,roughness:.4},
};
const detail=(name,sizeM,albedoStrength=.42)=>({url:'/tools/arcade/assets/'+name+'.png',normalUrl:'/tools/arcade/assets/'+name+'-normal.png',ormUrl:'/tools/arcade/assets/'+name+'-orm.png',sizeM,albedoStrength,normalStrength:.65,ormStrength:.55,bumpStrength:.22});
P.wall.texture=detail('plaster',2.9);P.side.texture=detail('plaster',2.9);P.wood.texture=detail('wood',1.9,.38);P.trim.texture=detail('plaster',2.9,.25);P.roof.texture=detail('stone',1.8,.32);P.snow.texture=detail('snow',1.2,.30);P.stone.texture=detail('stone',1.35,.44);
const warm=[1,.85,.71];
let seed=93281;
const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const entities=[];
const add=(id,position,mesh,material,extra={})=>{const e={id,position,mesh,material,...extra};entities.push(e);return e;};
const box=(id,p,s,m=P.wood,extra={})=>add(id,p,{kind:'box',size:s},m,extra);
const cyl=(id,p,r,h,m=P.iron,topRadius=r,segments=20)=>add(id,p,{kind:'cylinder',radius:r,topRadius,height:h,segments},m);
const sphere=(id,p,r,m,scale=[1,1,1])=>add(id,p,{kind:'sphere',radius:r,segments:12},m,{scale});
const light=(id,p,intensity,range,color=warm)=>entities.push({id,position:p,light:{kind:'point',color,intensity,range}});
const snow=(id,p,size,s=20)=>add(id,p,{kind:'snowdrift',size,seed:Math.floor(random()*1e6),segments:s},P.snow);
function rod(id,a,b,r,m=P.iron){
 const d=b.map((v,k)=>v-a[k]),length=Math.hypot(...d);
 const e=cyl(id,a.map((v,k)=>(v+b[k])/2),r,length,m,r,10);
 e.rotation=[Math.atan2(d[2],d[1]),0,Math.asin(-d[0]/length)];return e;
}
function surface(id,position,nu,nv,point,material,reverse=false){
 const positions=[],normals=[],indices=[];
 const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
 for(let v=0;v<=nv;v++)for(let u=0;u<=nu;u++){
  const x=u/nu,y=v/nv,p=point(x,y),h=.0001;
  const a=point(x+h,y).map((q,k)=>q-point(x-h,y)[k]);
  const b=point(x,y+h).map((q,k)=>q-point(x,y-h)[k]);
  const n=cross(a,b),l=Math.hypot(...n)||1;
  positions.push(...p);normals.push(...n.map(q=>q/l*(reverse?-1:1)));
 }
 for(let v=0;v<nv;v++)for(let u=0;u<nu;u++){
  const a=v*(nu+1)+u,b=a+1,c=a+nu+1,d=c+1;
  indices.push(...(reverse?[a,c,b,b,c,d]:[a,b,c,b,d,c]));
 }
 return add(id,position,{kind:'triangle-mesh',positions,normals,indices},material);
}
function archRib(id,cx,z,r,ry,y){
 const segments=56;
 for(let i=0;i<segments;i++){
  const a=i/segments*Math.PI,b=(i+1)/segments*Math.PI;
  rod(id+'-'+i,[cx+Math.cos(a)*r,y+Math.sin(a)*ry,z],[cx+Math.cos(b)*r,y+Math.sin(b)*ry,z],.018);
 }
}
function capital(id,x,z){
 box(id+'-foot',[x,.09,z],[.28,.18,.28],P.stone);
 cyl(id+'-pedestal',[x,.3,z],.09,.26,P.iron,.067);
 cyl(id+'-shaft',[x,1.73,z],.041,2.62,P.iron,.036);
 for(const [i,y,r,h]of [[0,.47,.071,.07],[1,2.96,.070,.09],[2,3.055,.095,.1],[3,3.13,.12,.05]])cyl(id+'-ring'+i,[x,y,z],r,h);
 for(const s of [-1,1]){
  for(let i=0;i<10;i++){
   const a=i/10*Math.PI*.70,b=(i+1)/10*Math.PI*.70;
   rod(id+'-scroll'+s+'-'+i,[x+s*(.04+.24*Math.sin(a)),3.01-.22*Math.cos(a),z],[x+s*(.04+.24*Math.sin(b)),3.01-.22*Math.cos(b),z],.013);
  }
 }
}
const start=-2.5,bay=3.55,count=9,length=bay*count,end=start+length;
const center=(start+end)/2;
box('upper-building',[center,5.43,4.35],[length,4.52,8.7],P.wall);
box('rear-building',[center,1.53,5.2],[length,3.06,6.9],P.side);
box('left-wall',[start-.08,3.90,4.3],[.35,7.8,8.6],P.side);
for(const [y,h,w,z]of [[.22,.44,.28,-.09],[3.20,.16,.34,-.14],[6.37,.11,.30,-.13],[7.55,.18,.42,-.17],[7.75,.20,.56,-.18]])box('continuous-cornice-'+y,[center,y,z],[length+w,h,w],y<1?P.stone:P.trim);
for(let b=0;b<count;b++){
 const x=start+bay*(b+.5),id='shop-'+b,w=bay-.42,glow=1;
 for(const side of [-1,1]){
  const xx=x+side*bay/2;
  box(id+'-pier'+side,[xx,1.68,.28],[.23,3.04,.75],P.wood);
  box(id+'-jamb'+side,[xx+side*.09,1.68,-.15],[.07,3.06,.15],P.trim);
 }
 box(id+'-room-back',[x,1.70,1.67],[w,2.86,.1],{...P.wall,color:[.34,.28,.215,1],emissive:[.075,.046,.025].map(v=>v*glow)});
 box(id+'-room-floor',[x,.26,.82],[w,.1,1.8],P.wood);
 box(id+'-ceiling',[x,3.02,.83],[w,.1,1.8],{...P.wall,color:[.50,.43,.31,1]});
 for(const s of [-1,1])box(id+'-room-side'+s,[x+s*w/2,1.64,.86],[.10,2.9,1.8],P.wood);
 const curt={kind:'default',texture:detail('lace',.75,.38),pattern:'fabric',color:[.71,.66,.55,1],roughness:.98,emissive:[.31,.245,.175].map(v=>v*glow)};
 for(const side of [-1,1])surface(id+'-curtain'+side,[x,0,0],44,32,(u,v)=>{
  const xx=side*(.27+u*(w*.5-.25));
  return[xx,.64+v*2.15+.025*Math.cos(u*30),.37+.07*Math.cos(u*Math.PI*14)*(1-.25*v)+.09*(1-v)**2];
 },curt,side>0);
 for(let row=0;row<2;row++){
  const y=.66+row*.62;
  box(id+'-shelf'+row,[x,y,.74],[w-.18,.05,.38],P.wood);
  for(let j=0;j<8;j++){
   const xx=x+(j-3.5)*(w-.38)/8,yy=y+.08;
   const ceramic={kind:'default',color:[.49,.44,.32,1],roughness:.33,emissive:[.045,.026,.013]};
   if((j+b+row)%3===0){cyl(id+'-bottle'+row+'-'+j,[xx,yy+.105,.72],.062,.25,{...ceramic,color:[.13,.16,.10,1]},.045,12);cyl(id+'-bottle-neck'+row+'-'+j,[xx,yy+.27,.72],.022,.08,P.brass,.022,10);}
   else{sphere(id+'-vase'+row+'-'+j,[xx,yy+.08,.68],.11,ceramic,[.8,1.05,.75]);cyl(id+'-vase-neck'+row+'-'+j,[xx,yy+.2,.68],.045,.11,ceramic,.065,12);}
  }
 }
 box(id+'-glass',[x,1.72,-.09],[w,2.48,.017],{kind:'default',color:[.22,.26,.25,.10],metalness:.06,roughness:.09});
 for(const off of [-w/2,-w/6,w/6,w/2])box(id+'-mullion'+off,[x+off,1.69,-.16],[.067,2.77,.13]);
 for(const y of [.31,.47,2.66,2.98])box(id+'-crossbar'+y,[x,y,-.18],[w+.18,.072,.17]);
 box(id+'-plinth',[x,.23,-.08],[w+.19,.43,.2]);
 for(const off of [-w/3,0,w/3])box(id+'-raised-panel'+off,[x+off,.25,-.198],[w/3-.12,.22,.027],P.trim);
 for(const off of [-1,1])rod(id+'-handle'+off,[x+off*.14,1.13,-.25],[x+off*.14,1.29,-.25],.014,P.brass);
 light(id+'-inside-light',[x,2.38,.68],5.2*glow,4.2);
 sphere(id+'-bulb',[x,2.98,-1.60],.08,{kind:'default',color:[1,.9,.70,1],emissive:[4.0,3.0,1.85].map(v=>v*glow),roughness:.5},[.65,1,.65]);
 cyl(id+'-pendant',[x,3.17,-1.60],.016,.26);
 light(id+'-canopy-light',[x,2.91,-1.58],3.3*glow,4.8);
 const r=bay/2+.025,ry=1.12;
 surface(id+'-canopy',[x,3.19,0],72,14,(u,v)=>[r*Math.cos(u*Math.PI),ry*Math.sin(u*Math.PI),-2.85+v*2.88],P.roof);
 surface(id+'-canopy-lining',[x,3.19,0],72,10,(u,v)=>[(r-.055)*Math.cos(u*Math.PI),(ry-.055)*Math.sin(u*Math.PI),-2.83+v*2.85],{...P.wood,color:[.18,.13,.09,1]},true);
 surface(id+'-canopy-snow',[x,3.19,0],96,24,(u,v)=>{
  const a=(.035+u*.93)*Math.PI;
  const broad=.016*Math.sin(u*11.7+v*2.8)+.010*Math.sin(u*27.3-v*7.1)+.006*Math.cos(v*15.6+u*5.2);
  const lip=Math.exp(-v*10.0)*(.020+.018*(.5+.5*Math.sin(u*23.0+1.7)));
  const h=.058+broad+lip;
  return[(r+h)*Math.cos(a),(ry+h)*Math.sin(a),-2.86+v*2.87];
 },P.snow);
 const archFace=Array.from({length:65},(_,i)=>{const a=i/64*Math.PI;return[r*Math.cos(a),ry*Math.sin(a)];});
 add(id+'-arch-face',[x,3.19,-2.875],{kind:'polygon-prism',points:archFace,axis:2,thickness:.045},{...P.wall,color:[.29,.22,.175,1]});
 archRib(id+'-front-rib',x,-2.91,r,ry,3.19);
 capital(id+'-column',x-bay/2,-2.86);
 for(let j=0;j<15;j++){
  const a=(j+.4)/15*Math.PI,xx=x+r*Math.cos(a),yy=3.19+ry*Math.sin(a),h=.04+random()*.14;
  cyl(id+'-icicle'+j,[xx,yy-h/2,-2.89],.002,h,{kind:'default',color:[.54,.60,.61,1],roughness:.25},.015,7);
 }
 const wy=5.36;
 box(id+'-upper-reveal',[x,wy,-.035],[1.30,1.69,.095],{kind:'default',color:[.035,.036,.032,1],roughness:1});
 box(id+'-upper-glass',[x,wy,-.092],[1.04,1.46,.016],{kind:'default',pattern:'window',color:[.08,.078,.055,1],roughness:.27,metalness:.08,emissive:b%4===0?[.055,.032,.012]:[0,0,0]});
 for(const s of [-1,1])box(id+'-upper-frame'+s,[x+s*.6,wy,-.14],[.11,1.79,.17],P.trim);
 for(const y of [wy-.84,wy+.84])box(id+'-upper-horizontal'+y,[x,y,-.17],[1.41,.12,.25],P.trim);
 box(id+'-upper-cross-v',[x,wy,-.15],[.052,1.65,.13]);
 box(id+'-upper-cross-h',[x,wy+.20,-.15],[1.20,.055,.13]);
 snow(id+'-upper-sill-snow',[x,wy-.755,-.23],[1.45,.046,.29],16);
 for(const s of [-1,1])box(id+'-upper-pilaster'+s,[x+s*bay*.46,5.15,-.12],[.16,1.93,.15],P.trim);
}
capital('end-column',end,-2.86);
const signs=[[2.7,7.00,8.6,'МАГАЗИНЪ ПОЗНЯКОВА.'],[14.0,6.98,9.0,'ШЕЛКОВЫЯ И ШЕРСТЯНЫЯ ТОВАРЫ'],[25.4,7.0,7.9,'МАНУФАКТУРА']];
for(const [i,[x,y,w,text]]of signs.entries()){
 box('sign-'+i,[x,y,-.13],[w,.92,.055],{...P.wall,color:[.35,.31,.24,1],label:text});
 for(const s of [-1,1])box('sign-frame-'+i+'-'+s,[x,y+s*.49,-.17],[w+.12,.047,.09],P.trim);
}
for(const [i,text]of ['ЗОНТЫ','ПЕРЧАТКИ','ТКАНИ','ГАЛАНТЕРЕЯ'].entries())box('side-sign-'+i,[start-.27,6.75-i*.53,1.9],[3.1,.42,.035],{...P.wall,color:[.26,.225,.17,1],label:text},{rotation:[0,-Math.PI/2,0]});
surface('front-mansard',[center,7.83,0],4,2,(u,v)=>[(u-.5)*(length+.3),v*2.52,-.1+v*2.25],P.roof,true);
surface('roof-top',[center,10.35,0],4,2,(u,v)=>[(u-.5)*(length+.3),.15*Math.sin(v*Math.PI),2.15+v*4.4],P.roof,true);
for(let x=start-.05;x<=end;x+=.34){
 rod('roof-seam-'+x,[x,7.85,-.1],[x,10.38,2.25],.012,P.iron);
 if(Math.floor((x-start)/.34)%4===0)rod('roof-snow-seam-'+x,[x,8.35,.32],[x,10.40,2.25],.012,P.snow);
}
snow('eaves-snow',[center,7.9,-.15],[length+.45,.095,.48],72);
for(let d=0;d<6;d++){
 const x=start+2.0+d*5.6,z=1.35,id='dormer-'+d;
 box(id+'-body',[x,10.12,z],[1.24,1.7,1.25],P.roof);
 box(id+'-window',[x,10.17,z-.646],[.70,1.02,.017],{kind:'default',pattern:'window',color:[.10,.087,.061,1],roughness:.27,emissive:d%3===1?[.032,.021,.01]:[0,0,0]});
 for(const s of [-1,1])box(id+'-jamb'+s,[x+s*.43,10.17,z-.70],[.105,1.2,.12],P.wood);
 box(id+'-cross',[x,10.17,z-.69],[.042,1.04,.09],P.wood);
 add(id+'-gable',[x,10.97,z-.02],{kind:'polygon-prism',axis:2,points:[[-.79,0],[.79,0],[0,.59]],thickness:1.59},P.roof);
 for(const side of [-1,1])rod(id+'-gable-edge'+side,[x+side*.82,10.99,z-.83],[x,11.60,z-.83],.047,P.roof);
 snow(id+'-sill-snow',[x,9.66,z-.71],[1.05,.05,.30],12);
}
for(const [i,x]of [-6.1,6.5,20.9].entries()){
 box('chimney-'+i,[x,11.37,4.65],[.71,2.2,.77],P.side);
 box('chimney-cap-'+i,[x,12.49,4.65],[.93,.16,.99],P.stone);
 snow('chimney-snow-'+i,[x,12.59,4.65],[.99,.065,1.03],12);
}
cyl('downpipe',[start+.13,3.87,-.23],.054,7.75,P.iron);
for(let y=.7;y<7.8;y+=1.6)cyl('pipe-collar-'+y,[start+.13,y,-.23],.075,.065);
const lamp=[-6.7116,0,-.4714],lx=lamp[0],lz=lamp[2];
box('lamp-base',[lx,.09,lz],[.44,.18,.44],P.iron);
cyl('lamp-plinth',[lx,.34,lz],.16,.5,P.iron,.115);
cyl('lamp-post',[lx,1.86,lz],.072,2.77,P.iron,.044,28);
for(const [y,r,h]of [[.57,.11,.07],[3.16,.1,.10],[3.24,.14,.10]])cyl('lamp-ring-'+y,[lx,y,lz],r,h);
add('lamp-glass',[lx,3.60,lz],{kind:'cylinder',radius:.21,topRadius:.29,height:.66,segments:4},{kind:'default',color:[1,.92,.75,.20],emissive:[2.1,1.9,1.55],roughness:.25},{rotation:[0,Math.PI/4,0]});
sphere('lamp-flame',[lx,3.59,lz],.095,{kind:'default',color:[1,.9,.72,1],emissive:[16,13,9],roughness:.5},[.65,1.6,.65]);
for(let a=0;a<4;a++){
 const t=Math.PI/4+a*Math.PI/2;
 rod('lamp-cage-'+a,[lx+Math.cos(t)*.218,3.27,lz+Math.sin(t)*.218],[lx+Math.cos(t)*.31,3.95,lz+Math.sin(t)*.31],.022);
}
add('lamp-top',[lx,4.07,lz],{kind:'cylinder',radius:.385,topRadius:.06,height:.25,segments:4},P.iron,{rotation:[0,Math.PI/4,0]});
sphere('lamp-finial',[lx,4.25,lz],.059,P.iron,[.7,1.5,.7]);
snow('lamp-cap-snow',[lx,4.18,lz],[.49,.025,.49],12);
light('lamp-light',[lx,3.65,lz],38,19,[1,.92,.80]);
box('street-base',[8,-.19,-11],[110,.28,54],{kind:'asphalt',color:[.12,.12,.115,1],roughness:.78});
box('walk',[center,.035,-1.55],[length+2,.07,3.6],P.stone,{environmental:{surfaceUse:'sidewalk',snowDepthM:.007,waterDepthM:.00012}});
box('curb',[center,.08,-3.5],[length+2,.16,.29],P.stone,{environmental:{surfaceUse:'curb',snowDepthM:.029}});
const settMaterials=Array.from({length:7},(_,i)=>({kind:'default',color:[.18+i*.014,.175+i*.013,.165+i*.012,1],roughness:.67+i*.018}));
for(let iz=0;iz<36;iz++)for(let ix=0;ix<158;ix++){
 const x=-22+ix*.37+(iz%2)*.185,z=-3.8-iz*.29;
 box('sett-'+ix+'-'+iz,[x,-.065+(random()-.5)*.016,z],[.345,.095,.258],settMaterials[(ix*7+iz*11+Math.floor(random()*7))%7],{rotation:[0,(random()-.5)*.055,0]});
}
for(let i=0;i<360;i++){
 const x=-18+random()*58,z=-4-random()*14;
 snow('street-snow-'+i,[x,-.023,z],[.55+random()*2.2,.014+random()*.052,.30+random()*1.3],16);
}
for(let i=0;i<75;i++){
 const x=start-1+i*.52;
 snow('curb-slush-'+i,[x,.075,-3.39+(random()-.5)*.19],[.52+random()*.40,.08+random()*.09,.38+random()*.32],16);
}
for(let i=0;i<18;i++){
 const x=-18+random()*58,z=-4.4-random()*10;
 const points=Array.from({length:32},(_,j)=>{const a=j/32*Math.PI*2,r=1+.08*Math.sin(a*5+i);return[Math.cos(a)*(.6+(i%3)*.23)*r,Math.sin(a)*.45*r];});
 add('wet-patch-'+i,[x,-.011,z],{kind:'polygon-prism',points,thickness:.002,axis:1},{kind:'asphalt',color:[.08,.087,.09,1],roughness:.16},{environmental:{surfaceUse:'road',waterDepthM:.003}});
}
box('distant-building',[38,5.6,4.8],[18,11.2,10],P.side);
// A side porch wraps around the building corner ahead of the main facade.
const sideZ=3.30,sideRadius=2.24,sideRise=1.23;
surface('side-canopy',[start,3.19,sideZ],72,20,(u,v)=>[-2.88+v*2.9,sideRise*Math.sin(u*Math.PI),-sideRadius*Math.cos(u*Math.PI)],P.roof);
surface('side-canopy-snow',[start,3.19,sideZ],96,32,(u,v)=>{
 const a=(.025+.95*u)*Math.PI,h=.046+.022*Math.sin(u*49+v*17)*Math.sin(v*46);
 return[-2.9+v*2.91,(sideRise+h)*Math.sin(a),-(sideRadius+h)*Math.cos(a)];
},P.snow);
const sideProfile=Array.from({length:65},(_,i)=>{const a=i/64*Math.PI;return[sideRise*Math.sin(a),-sideRadius*Math.cos(a)];});
add('side-canopy-face',[start-2.89,3.19,sideZ],{kind:'polygon-prism',axis:0,points:sideProfile,thickness:.05},{...P.wall,color:[.22,.20,.17,1]});
for(const z of [sideZ-sideRadius,sideZ+sideRadius])capital('side-column-'+z,start-2.89,z);
for(let i=0;i<64;i++){
 const a=i/64*Math.PI,b=(i+1)/64*Math.PI;
 rod('side-arch-trim-'+i,[start-2.94,3.19+sideRise*Math.sin(a),sideZ-sideRadius*Math.cos(a)],[start-2.94,3.19+sideRise*Math.sin(b),sideZ-sideRadius*Math.cos(b)],.027);
}
box('side-window-dark',[start-.275,1.73,sideZ],[.03,2.70,3.61],{kind:'default',pattern:'window',color:[.072,.068,.057,1],roughness:.35,emissive:[.006,.005,.003]});
for(const z of [sideZ-1.88,sideZ-.64,sideZ+.64,sideZ+1.88])box('side-window-jamb-'+z,[start-.33,1.70,z],[.17,3.0,.09]);
for(const y of [.26,.49,2.68,3.0])box('side-window-crossbar-'+y,[start-.34,y,sideZ],[.18,.085,3.86]);
box('side-walk',[start-1.55,.035,4.35],[3.6,.07,10.6],P.stone,{environmental:{surfaceUse:'sidewalk',snowDepthM:.012}});
box('side-curb',[start-3.46,.07,4.35],[.22,.14,10.6],P.stone);
for(let i=0;i<20;i++)snow('side-curb-snow-'+i,[start-3.38,.06,-.8+i*.53],[.47,.09+random()*.05,.67],14);

// Facade authoring coordinates run from the nearest bay toward the distant bay.
// Convert them to engine -X so the arcade recedes to screen-right. Reflected
// triangle meshes get corrected winding/normals rather than negative scales.
for(const e of entities){
 e.position=[-e.position[0],e.position[1],e.position[2]];
 if(e.rotation)e.rotation=[e.rotation[0],-e.rotation[1],-e.rotation[2]];
 if(e.mesh?.kind==='triangle-mesh'){
  e.mesh.positions=e.mesh.positions.map((v,i)=>i%3===0?-v:v);
  e.mesh.normals=e.mesh.normals.map((v,i)=>i%3===0?-v:v);
  for(let i=0;i<e.mesh.indices.length;i+=3){const t=e.mesh.indices[i+1];e.mesh.indices[i+1]=e.mesh.indices[i+2];e.mesh.indices[i+2]=t;}
 }
}
export const authoredEntities=entities;
export const authoredEntityCount=entities.length;
export default {
 version:1,seed:20260930,ground:-.3,gravity:[0,-9.81,0],camera,
 clearColor:[.018,.021,.025,1],
 environment:{temperatureC:-3.8,humidity:.91,groundMoisture:.38,precipitation:'rare',snowfall:'light',sunlight:0,wind:[.26,0,.08],clock:{startHour:23,hoursPerSecond:0}},
 rendering:{sunDirection:[-.48,.68,-.31],sunColor:[.64,.70,.80],sunIntensity:.22,skyColor:[.047,.049,.051],fogDensity:.038,exposure:1.08,shadowExtent:48,reflectionProbe:{position:[1,1.1,-3.8],radius:55,facesPerFrame:6,boxHalfExtents:[28,8,18]}},
 entities:batchStaticScenery(entities,()=>true,9),
};
