import {makeCity} from '../promo/city.mjs';
import {makePedestrian,pedestrianAnimation} from '../promo/actors.mjs';
import {expressiveFaceEntities,WINTER_FACE_IDENTITIES} from '../../dist/animation/expressive-face.js';

export const CENTER=[-19.95,0,5.25],GROUND=.166,TABLE=1.06;
export const at=(x,y,z)=>[CENTER[0]+x,y,CENTER[2]+z];
// Door of b1-2: building centre -20, width 14, doorx=x+width*.345,
// facade z=8.30. Stop just outside the threshold instead of walking into glazing.
export const SHOP_DOOR=[-15.17,GROUND,7.82];

const SNOW_SHELL_TARGETS=['coat','hood','hat','pack','upperArm-1','upperArm1'];
const fract=x=>x-Math.floor(x);
function snowShellMesh(mesh,seed){
 if(mesh?.kind!=='triangle-mesh'||!mesh.positions?.length||!mesh.normals?.length)return null;
 const triangles=mesh.indices??Array.from({length:mesh.positions.length/3},(_,i)=>i),candidates=[];let total=0,state=seed>>>0||1;
 const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
 const norm=v=>{const l=Math.hypot(...v)||1;return v.map(x=>x/l);},cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
 for(let i=0;i<triangles.length;i+=3){
  const ids=[triangles[i],triangles[i+1],triangles[i+2]],p=ids.map(id=>mesh.positions.slice(id*3,id*3+3)),e1=p[1].map((x,k)=>x-p[0][k]),e2=p[2].map((x,k)=>x-p[0][k]),cr=cross(e1,e2),twiceArea=Math.hypot(...cr),n=norm(cr);
  const exposure=Math.max(0,Math.min(1,(n[1]-.14)/.86)),weight=twiceArea*.5*exposure*exposure;
  if(weight<1e-7)continue;total+=weight;candidates.push({ids,p,n,e1,cumulative:total});
 }
 if(!candidates.length)return null;
 const positions=[],normals=[],indices=[],count=Math.min(180,Math.max(48,Math.round(candidates.length*.62)));
 for(let grain=0;grain<count;grain++){
  const needle=random()*total;let tri=candidates[candidates.length-1];for(const q of candidates)if(q.cumulative>=needle){tri=q;break;}
  const su=Math.sqrt(random()),v=random(),weights=[1-su,su*(1-v),su*v],center=[0,1,2].map(k=>tri.p.reduce((sum,p,j)=>sum+p[k]*weights[j],0));
  const n=tri.n,tangent=norm(tri.e1),bitangent=norm(cross(n,tangent)),radius=.007+random()*.013,height=.0018+random()*.0035,offset=.0012+random()*.0014,rays=6,start=positions.length/3;
  positions.push(center[0]+n[0]*(offset+height),center[1]+n[1]*(offset+height),center[2]+n[2]*(offset+height));normals.push(...n);
  for(let k=0;k<rays;k++){
   const a=k/rays*Math.PI*2,rr=radius*(.72+random()*.34),edge=center.map((x,j)=>x+(tangent[j]*Math.cos(a)+bitangent[j]*Math.sin(a))*rr+n[j]*offset);
   positions.push(...edge);const side=norm([n[0]*.85+tangent[0]*Math.cos(a)*.22+bitangent[0]*Math.sin(a)*.22,n[1]*.85+tangent[1]*Math.cos(a)*.22+bitangent[1]*Math.sin(a)*.22,n[2]*.85+tangent[2]*Math.cos(a)*.22+bitangent[2]*Math.sin(a)*.22]);normals.push(...side);
  }
  for(let k=0;k<rays;k++)indices.push(start,start+1+k,start+1+(k+1)%rays);
 }
 return{kind:'triangle-mesh',positions,normals,indices};
}
function snowShells(actor,entities){
 const byId=new Map(entities.map(e=>[e.id,e])),material={kind:'snow',color:[.91,.94,.96,1],roughness:.96,texture:{url:'/assets/snow-granular.png',sizeM:.22,bumpStrength:.55,albedoStrength:.5}};
 return SNOW_SHELL_TARGETS.flatMap((key,index)=>{
  const source=byId.get(actor.id+'-'+key),mesh=snowShellMesh(source?.mesh,actor.id.length*97+index*31);
  return source&&mesh?[{...source,id:actor.id+'-snow-shell-'+key,mesh,material,renderOnly:true}]:[];
 });
}
export const cast=[
 {id:'mike',root:at(-.59,GROUND,0),heading:.27,heightScale:1,palette:{skin:WINTER_FACE_IDENTITIES.mike.skin}},
 {id:'anna',root:at(.59,GROUND,.015),heading:Math.PI-.27,heightScale:.97,palette:{skin:WINTER_FACE_IDENTITIES.anna.skin,coat:[.37,.18,.14,1],scarf:[.49,.37,.22,1],hat:[.21,.17,.14,1],pants:[.15,.18,.205,1]}},
];
export function performanceBindings(actor){
 const adjusted=pedestrianAnimation({...actor,speed:0}).bindings.map(binding=>{
  const key=binding.entity.slice(actor.id.length+1),b={...binding,offset:[...(binding.offset??[0,0,0])],scale:[...(binding.scale??[1,1,1])]};
  if(key==='hat'){b.offset[1]=.145;b.scale[1]=.15;}
  if(key==='hatBand'){b.offset[1]=.086;b.scale[1]=.037;}
  if(key==='hatPom')b.offset[1]=.230;
  if(key==='collar'){b.offset[1]=-.019;b.scale[1]=.086;}
  if(key==='scarf'){b.offset[1]=-.018;b.scale[1]=.087;}
  if(key==='hood'){b.offset[0]-=.025;b.offset[1]-=.030;}
  return b;
 }).filter(b=>!b.entity.endsWith('-nose')&&!b.entity.endsWith('-head')&&!b.entity.includes('-snow'));
 const byKey=new Map(adjusted.map(binding=>[binding.entity.slice(actor.id.length+1),binding]));
 const shells=SNOW_SHELL_TARGETS.flatMap(key=>{
  const source=byKey.get(key);return source?[{...source,entity:actor.id+'-snow-shell-'+key}]:[];
 });
 return [...adjusted,...shells];
}
function lathe(profile,segments=48){
 const positions=[],normals=[],indices=[];
 for(let j=0;j<profile.length;j++){
  const [r,y]=profile[j],a=profile[Math.max(0,j-1)],b=profile[Math.min(profile.length-1,j+1)],dr=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dr,dy)||1;
  for(let k=0;k<=segments;k++){const angle=k/segments*Math.PI*2,c=Math.cos(angle),s=Math.sin(angle);positions.push(r*c,y,r*s);normals.push(dy/len*c,-dr/len,dy/len*s);}
 }
 for(let j=0;j<profile.length-1;j++)for(let k=0;k<segments;k++){const a=j*(segments+1)+k,b=a+segments+1;indices.push(a,b,a+1,a+1,b,b+1);}
 return{kind:'triangle-mesh',positions,normals,indices};
}
function handle(cx,rx,ry,radius){
 const positions=[],normals=[],indices=[],steps=40,radial=12;
 for(let i=0;i<=steps;i++)for(let j=0;j<=radial;j++){
  const a=i/steps*Math.PI*2,b=j/radial*Math.PI*2,c=Math.cos(a),s=Math.sin(a),n=[c*Math.cos(b),s*Math.cos(b),Math.sin(b)];
  positions.push(cx+rx*c+radius*n[0],ry*s+radius*n[1],radius*n[2]);normals.push(...n);
  if(i<steps&&j<radial){const q=i*(radial+1)+j;indices.push(q,q+1,q+radial+1,q+1,q+radial+2,q+radial+1);}
 }
 return{kind:'triangle-mesh',positions,normals,indices};
}
export function createPerformanceStage(){
 const select=e=>['ground','road','walk-1','curb-1','snow-verge-1'].includes(e.id)||e.id.startsWith('b1-2-')||((e.position?.[0]??0)>-27&&(e.position?.[0]??0)<-12&&(e.position?.[2]??0)>3.2&&(e.position?.[2]??0)<8&&/^(fence|walk-edge|walk-grain|plough-|bench)/.test(e.id));
 const {spec,sourceCount}=makeCity('street',{select});
 spec.animation={walkers:[],vehicles:[]};delete spec.surfaceContacts;
 spec.environment={...spec.environment,temperatureC:-4,snowfall:'light',sunlight:.58,clock:{startHour:15.8,hoursPerSecond:0},wind:[.35,0,.08]};
 spec.rendering={...spec.rendering,sunColor:[.91,.92,1],sunIntensity:1.6,skyColor:[.30,.38,.47],fogDensity:.0015,exposure:1.04,shadowExtent:18};
 const added=[];
 const add=(id,mesh,material,position=[0,0,0],extra={})=>added.push({id,mesh,material,position,renderOnly:true,...extra});
 const wood={kind:'default',color:[.24,.125,.060,1],roughness:.66},iron={kind:'default',color:[.085,.10,.095,1],roughness:.55,metalness:.45};
 const ceramic={kind:'default',color:[.76,.73,.63,1],roughness:.24,clearcoat:.45},pot={kind:'default',color:[.12,.24,.21,1],roughness:.28,clearcoat:.4};
 add('tea-table-top',{kind:'cylinder',radius:.39,height:.052,segments:64},wood,at(0,TABLE-.026,0));
 add('tea-table-stem',{kind:'cylinder',radius:.043,height:TABLE-GROUND-.05,segments:24},iron,at(0,(TABLE+GROUND)/2,0));
 for(const s of [-1,1])add('tea-table-foot'+s,{kind:'box',size:[.58,.05,.045]},iron,at(0,GROUND+.025,0),{rotation:[0,s*Math.PI/4,0]});
 add('tea-cup-body',lathe([[.001,-.043],[.027,-.043],[.032,-.038],[.039,.034],[.038,.044],[.0335,.044],[.032,.034],[.025,-.036],[.001,-.036]]),ceramic);
 add('tea-cup-handle',handle(-.040,.027,.030,.004),ceramic);
 add('tea-cup-band',lathe([[.037,.018],[.038,.025]]),{kind:'default',color:[.35,.14,.065,1],roughness:.36});
 add('tea-cup-liquid',{kind:'cylinder',radius:.029,height:.0015,segments:48},{kind:'default',color:[.21,.076,.018,1],roughness:.12,clearcoat:.9});
 add('tea-pot-body',lathe([[.001,-.080],[.045,-.080],[.068,-.064],[.079,-.021],[.067,.047],[.047,.062],[.001,.062]]),pot);
 add('tea-pot-lid',lathe([[.001,.065],[.049,.065],[.046,.076],[.020,.084],[.001,.084]]),pot);
 add('tea-pot-knob',{kind:'sphere',radius:.014,segments:16},iron);
 add('tea-pot-handle',handle(-.084,.044,.052,.008),pot);
 add('tea-pot-spout',{kind:'cylinder',radius:.018,topRadius:.010,height:.135,segments:20},pot);
 add('tea-stream',{kind:'cylinder',radius:.0026,height:1,segments:10},{kind:'default',color:[.36,.17,.050,1],roughness:.1,clearcoat:1},[0,0,0],{scale:[.0001,.0001,.0001]});
 for(let i=0;i<12;i++)add('tea-steam-'+i,{kind:'sphere',radius:.5,segments:8},{kind:'default',color:[.66,.70,.72,.07],roughness:1},[0,0,0],{scale:[.0001,.0001,.0001]});
 for(let i=0;i<72;i++)add('tea-mist-'+i,{kind:'sphere',radius:.5,segments:8},{kind:'default',color:[.70,.78,.80,.085],roughness:.22},[0,0,0],{scale:[.0001,.0001,.0001]});
 for(let i=0;i<36;i++)add('tea-droplet-'+i,{kind:'sphere',radius:.5,segments:8},{kind:'default',color:[.31,.075,.012,.68],roughness:.08,clearcoat:.95},[0,0,0],{scale:[.0001,.0001,.0001]});
 const actors=cast.flatMap(actor=>{
  const base=makePedestrian({...actor,speed:0}).filter(e=>!e.id.endsWith('-nose')&&!e.id.endsWith('-head')&&!e.id.includes('-snow'));
  return [...base,...snowShells(actor,base)];
 });
 const faces=cast.flatMap(actor=>expressiveFaceEntities(actor.id,WINTER_FACE_IDENTITIES[actor.id]));
 spec.entities.push(...actors,...faces,...added,
  {id:'tea-sky-fill',position:at(-1.2,3.1,-1.7),light:{kind:'point',color:[.80,.87,1],intensity:2.2,range:7}},
  {id:'tea-key-light',position:at(1.4,3.4,-1.4),light:{kind:'point',color:[1,.90,.78],intensity:3.6,range:8}},
  {id:'tea-shop-light',position:at(0,2.6,2.7),light:{kind:'point',color:[1,.67,.37],intensity:1.9,range:5}},
 );
 for(const e of spec.entities)if(e.light?.intensity===0)delete e.light;
 return{spec,sourceCount,movers:[...actors,...faces,...added.filter(e=>!e.id.startsWith('tea-table'))].map(e=>e.id)};
}
