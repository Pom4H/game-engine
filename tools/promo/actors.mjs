// Winter pedestrian: two-bone IK, planted feet, deterministic contact events.
export const WALK={startX:-20,z:5.02,speed:.86,period:1.30,ground:.163};
const add=(a,b)=>a.map((v,i)=>v+b[i]),sub=(a,b)=>a.map((v,i)=>v-b[i]),mul=(a,s)=>a.map(v=>v*s),unit=a=>mul(a,1/(Math.hypot(...a)||1));
function limb(root,end,a,b,pole){const d=sub(end,root),distance=Math.min(a+b-.0001,Math.max(Math.abs(a-b)+.0001,Math.hypot(...d))),dir=unit(d),bend=unit(sub(pole,mul(dir,pole.reduce((s,v,i)=>s+v*dir[i],0)))),along=(a*a-b*b+distance*distance)/(2*distance);return add(root,add(mul(dir,along),mul(bend,Math.sqrt(Math.max(0,a*a-along*along)))));}
export function pedestrianPose(time){
 const {startX,z,speed,period,ground}=WALK,x=startX+speed*time,phase=time/period,bodyBob=.012*Math.cos(phase*4*Math.PI),hipY=ground+.87+bodyBob,parts={},feet=[];
 parts.coat={position:[x+.018,hipY+.21,z],scale:[.36,.72,.48],rotation:[0,0,-.035]};

 parts.head={position:[x+.034,hipY+.686,z],scale:[.198,.245,.181]};parts.hat={position:[x+.01,hipY+.786,z],scale:[.227,.13,.211]};parts.hatBand={position:[x+.014,hipY+.746,z],scale:[.230,.058,.214]};
 parts.nose={position:[x+.137,hipY+.679,z],scale:[.042,.044,.035]};parts.scarf={position:[x+.022,hipY+.556,z],scale:[.26,.115,.274]};parts.scarfTail={position:[x+.18,hipY+.38,z-.095],scale:[.027,.30,.082]};
 parts.pack={position:[x-.179,hipY+.26,z],scale:[.18,.41,.32]};
 const segment=(name,a,b,r,top)=>{const d=sub(b,a),l=Math.hypot(...d);parts[name]={position:mul(add(a,b),.5),scale:[r,l,top??r],rotation:[Math.atan2(d[2],d[1]),0,Math.asin(-d[0]/l)]};};
 for(const side of [-1,1]){
  const offset=side===1?0:.5,cycle=phase+offset,k=Math.floor(cycle),u=cycle-k,stance=.62,anchor=startX+(k-offset+stance*.5)*period*speed;
  const swing=Math.max(0,(u-stance)/(1-stance)),smooth=swing*swing*(3-2*swing),fx=anchor+smooth*period*speed,fy=ground+Math.sin(swing*Math.PI)*.12;
  const foot=[fx,fy,z+side*.13],ankle=[fx,fy+.105,z+side*.13],hip=[x,hipY,z+side*.125],knee=limb(hip,ankle,.425,.42,[1,0,0]);
  feet.push({id:'pedestrian:'+side,position:foot,grounded:u<stance,yaw:side*.035});
  segment('thigh'+side,hip,knee,.135,.148);segment('shin'+side,knee,ankle,.105,.125);parts['knee'+side]={position:knee,scale:[.122,.135,.133]};
  parts['boot'+side]={position:[fx+.034,fy+.07,z+side*.13],scale:[.32,.14,.139],rotation:[0,side*.035,Math.sin(swing*Math.PI)*-.10]};
  parts['sole'+side]={position:[fx+.034,fy+.013,z+side*.13],scale:[.322,.026,.141],rotation:[0,side*.035,Math.sin(swing*Math.PI)*-.10]};
  parts['cuff'+side]={position:[fx-.021,fy+.146,z+side*.13],scale:[.155,.13,.151]};
  const shoulder=[x+.006,hipY+.45,z+side*.207],hand=[x-.02-side*Math.sin(phase*2*Math.PI)*.13,hipY-.07,z+side*.285],elbow=limb(shoulder,hand,.295,.27,[-1,0,0]);
  segment('upperArm'+side,shoulder,elbow,.122,.13);segment('forearm'+side,elbow,hand,.108,.117);parts['glove'+side]={position:hand,scale:[.105,.137,.098]};
  parts['strap'+side]={position:[x+.174,hipY+.29,z+side*.148],scale:[.026,.36,.042]};
 }
 return{parts,feet,position:[x,ground,z]};
}
export function makePedestrian(){
 return Object.entries(pedestrianPose(0).parts).map(([key,pose])=>{
  const segment=/thigh|shin|Arm|forearm/.test(key),coat=/coat|hem|Arm|forearm/.test(key),pants=/thigh|shin|knee/.test(key),skin=/head|nose/.test(key),scarf=key.startsWith('scarf'),hat=key.startsWith('hat');
  const color=coat?[.40,.43,.32,1]:pants?[.22,.24,.27,1]:skin?[.51,.34,.25,1]:scarf?[.31,.12,.075,1]:hat?[.25,.24,.22,1]:key==='pack'?[.27,.20,.13,1]:/boot|cuff/.test(key)?[.29,.23,.18,1]:[.14,.145,.135,1];
  return{id:'walker-'+key,...pose,mesh:clothingMesh(key,segment),material:{kind:'default',color,roughness:skin?.68:.95,...(!skin?{pattern:'fabric'}:{})}};
 });
}
export function updatePedestrian(scene,time){const pose=pedestrianPose(time);for(const [key,p] of Object.entries(pose.parts)){const e=scene.entities.get('walker-'+key);e.position=[...p.position];e.scale=[...p.scale];e.rotation=[...(p.rotation??[0,0,0])];}return pose;}
export const CAR={startX:-40,z:-1.40,speed:2.65,radius:.346};
export function puddleAt(x,z){return Math.max(0,...[[-11,-1.4,1.1,.85],[9,-1.35,1.6,.7]].map(([px,pz,rx,rz])=>Math.exp(-(((x-px)/rx)**2)-((z-pz)/rz)**2)));}
export function makeM3(asset,id,x,z,color,speed=0){
 const entities=[],motions=[];
 for(const part of asset.parts){
  const type=part.material,paint=type==='CarPaint',glass=type==='Window'||type==='Transparent',rim=type==='Rims',light=type==='DayLights',tail=type==='RearLight';
  const c=paint?color:type==='Transparent'?[.45,.53,.57,.18]:glass?[.115,.17,.21,1]:rim?[.26,.29,.31,1]:type==='Tires'?[.027,.03,.032,1]:light?[.80,.89,1,1]:tail?[.34,.012,.008,1]:type==='Mirror'?[.4,.45,.5,1]:type==='Exhaust'?[.23,.25,.26,1]:type==='RedPart'?[.27,.015,.011,1]:[.024,.028,.031,1];
  const position=[x+part.center[0],.006+part.center[1],z+part.center[2]],e={id:id+'-'+part.name,position,mesh:part.mesh,material:{kind:type==='Transparent'?'glass':'default',color:c,roughness:paint?.23:glass?.09:rim?.30:type==='Tires'?.91:.50,metalness:paint?.24:rim?.87:type==='Exhaust'?.9:glass?.18:0,...(type==='Tires'?{pattern:'rubber'}:{}),...(light?{emissive:speed?[2.8,3.1,3.5]:[.12,.14,.17]}:tail?{emissive:speed?[.7,.015,.006]:[0,0,0]}:{})}};
  entities.push(e);if(speed)motions.push({id:e.id,origin:position,speed,wheel:part.wheel,radius:CAR.radius});
 }
 return{entities,motions};
}

// Ring lofts give garments, soles and rucksacks a shaped silhouette instead of
// intersecting ellipsoids. Gentle irregularities break perfect plastic surfaces.
function clothingMesh(key,segment){
 if(/head|nose|hat|scarf|glove|knee/.test(key))return{kind:'sphere',radius:.5,segments:24};
 if(/strap/.test(key))return{kind:'box',size:[1,1,1]};
 if(segment)return loft([[ -.5,.41,.44],[-.43,.49,.49],[-.1,.50,.48],[.27,.49,.48],[.46,.46,.47],[.5,.39,.40]],1.0,1);
 if(key.startsWith('boot'))return bootMesh();
 if(key.startsWith('sole'))return loft([[-.5,.43,.44],[0,.5,.5],[.5,.47,.47]],.68,0);
 if(key.startsWith('cuff'))return loft([[-.5,.45,.46],[-.35,.5,.5],[.4,.45,.46],[.5,.43,.43]],.8,0);
 if(key==='pack')return loft([[-.5,.32,.36],[-.4,.46,.49],[.3,.49,.48],[.46,.38,.40],[.5,.2,.25]],.48,0);
 if(key==='coat')return loft([[-.5,.40,.40],[-.42,.49,.47],[-.06,.46,.45],[.23,.48,.49],[.37,.46,.49],[.46,.30,.40],[.5,.20,.22]],.8,1);
 return loft([[-.5,.44,.43],[0,.49,.49],[.5,.45,.45]],.75,1);
}
function loft(rings,power,wrinkle){
 const positions=[],normals=[],indices=[],steps=32;
 for(let r=0;r<rings.length;r++)for(let j=0;j<steps;j++){
  const [y,rx,rz]=rings[r],a=j/steps*Math.PI*2,c=Math.cos(a),s=Math.sin(a),w=1+wrinkle*(.011*Math.sin(j*2.2+r*4)+.008*Math.cos(j*3.1-r));
  positions.push(Math.sign(c)*Math.abs(c)**power*rx*w,y,Math.sign(s)*Math.abs(s)**power*rz*w);normals.push(0,0,0);
 }
 for(let r=0;r<rings.length-1;r++)for(let j=0;j<steps;j++){const a=r*steps+j,b=r*steps+(j+1)%steps;indices.push(a,a+steps,b,b,a+steps,b+steps);}
 // End caps; smooth surface normals are area-weighted from actual geometry.
 for(const r of [0,rings.length-1])for(let j=1;j<steps-1;j++)indices.push(r*steps,r*steps+j+(r===0?0:1),r*steps+j+(r===0?1:0));
 for(let k=0;k<indices.length;k+=3){const ids=indices.slice(k,k+3),v=ids.map(i=>positions.slice(i*3,i*3+3)),a=sub(v[1],v[0]),b=sub(v[2],v[0]),n=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];for(const id of ids)for(let d=0;d<3;d++)normals[id*3+d]+=n[d];}
 for(let j=0;j<normals.length;j+=3){const n=unit(normals.slice(j,j+3));normals.splice(j,3,...n);}
 return{kind:'triangle-mesh',positions,normals,indices};
}
function bootMesh(){return loft([[-.5,.39,.40],[-.41,.49,.48],[-.23,.5,.50],[.12,.46,.48],[.38,.31,.40],[.5,.25,.36]],.66,0);}
