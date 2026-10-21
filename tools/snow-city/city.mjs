import {batchStaticScenery} from '../../dist/procedural/static-batch.js';
import {hash} from './math.mjs';
export const BLOCK=96;
const snow={kind:'snow',color:[.96,.98,.995,1],roughness:.95};
const tileCache=new Map();
export function cityTile(x,z,lod=0){
 const tileKey=x+':'+z+':'+lod,cached=tileCache.get(tileKey);if(cached){tileCache.delete(tileKey);tileCache.set(tileKey,cached);return cached;}
 const ox=x*BLOCK,oz=z*BLOCK,entities=[],seed=hash(x,z,92617);
 const box=(id,p,size,material)=>entities.push({id:`city:${x}:${z}:${id}`,position:[ox+p[0],p[1],oz+p[2]],mesh:{kind:'box',size},material});
 // Two roads form a real four-way junction at every unbounded grid coordinate.
 box('ground',[0,-.22,0],[96,.3,96],snow);
 const asphalt={kind:'concrete',color:[.10,.12,.15,1],roughness:.87};
 box('road-x',[0,-.025,0],[96,.04,21],asphalt);box('road-z',[0,-.024,0],[21,.04,96],asphalt);
 if(lod>0){
  // The distant skyline has the same footprints/heights, with no subpixel trims.
  for(const sx of [-1,1])for(const sz of [-1,1])if(sx!==1||sz!==1){
   const h=hash(x*2+sx,z*2+sz,seed),height=8+(h%5)*3,px=sx*31,pz=sz*31;
   const colors=[[.48,.43,.38,1],[.59,.52,.45,1],[.47,.53,.53,1],[.57,.55,.49,1]];
   box(`building${sx}${sz}`,[px,height/2,pz],[27,height,27],{kind:'default',color:colors[h%4],roughness:.9});
   box(`roof${sx}${sz}`,[px,height+.18,pz],[28,.35,28],snow);
   for(let side=0;side<4;side++)for(let floor=0;floor<Math.floor(height/3);floor++)for(let n=-2;n<=2;n++){
    const axis=side%2,sign=side<2?-1:1,lit=hash(h+side,n,floor)%7<2;
    box(`distant-window:${sx}${sz}:${side}:${floor}:${n}`,axis?[px+n*4.6,2.1+floor*3,pz+sign*13.72]:[px+sign*13.72,2.1+floor*3,pz+n*4.6],axis?[1.6,1.8,.07]:[.07,1.8,1.6],{kind:'default',color:[.14,.20,.25,1],roughness:.7,emissive:lit?[.44,.27,.12]:[0,0,0]});
   }
  }
  const result=batchStaticScenery(entities,()=>true,48);tileCache.set(tileKey,result);if(tileCache.size>64)tileCache.delete(tileCache.keys().next().value);return result;
 }
 for(const axis of [0,1])for(const sign of [-1,1]){
  box(`walk${axis}${sign}`,axis?[sign*12,.31,0]:[0,.31,sign*12],axis?[3,.62,96]:[96,.62,3],snow);
  for(let n=-3;n<=3;n++)if(n){const p=axis?[sign*12,0,n*13]:[n*13,0,sign*12];box(`lamp-${axis}-${sign}-${n}`,[p[0],3.2,p[2]],[.07,6.4,.07],{kind:'steel',color:[.08,.13,.2,1],metalness:.65});box(`glow-${axis}-${sign}-${n}`,[p[0],6.35,p[2]],[.45,.13,.7],{kind:'default',color:[1,.87,.55,1],emissive:[2.4,1.65,.8]});}
 }
 for(const sx of [-1,1])for(const sz of [-1,1]){
  const h=hash(x*2+sx,z*2+sz,seed),height=8+(h%5)*3,px=sx*31,pz=sz*31;
  // Keep one corner open for a snow-covered neighbourhood park.
  if(sx===1&&sz===1){for(let t=0;t<4;t++){
   const tx=19+(t%2)*22,tz=19+Math.floor(t/2)*18,trunk={kind:'wood',color:[.25,.20,.16,1],roughness:.95};
   const limb=(id,a,b,r)=>{const v=b.map((n,k)=>n-a[k]),length=Math.hypot(...v);entities.push({id:`city:${x}:${z}:tree:${t}:${id}`,position:[ox+(a[0]+b[0])*.5,(a[1]+b[1])*.5,oz+(a[2]+b[2])*.5],rotation:[Math.atan2(v[2],v[1]),0,-Math.atan2(v[0],Math.hypot(v[1],v[2]))],mesh:{kind:'cylinder',radius:r,height:length,segments:7},material:trunk});};
   limb('trunk',[tx,.2,tz],[tx,5.8,tz],.12);
   for(let branch=0;branch<5;branch++){const angle=branch*2.399,height=2.4+branch*.53,tip=[tx+Math.cos(angle)*1.7,height+1.35,tz+Math.sin(angle)*1.7];limb(branch,[tx,height,tz],tip,.045);limb(branch+'twig',tip,[tip[0]+Math.cos(angle+.7)*.7,tip[1]+.7,tip[2]+Math.sin(angle+.7)*.7],.022);}
  }for(let n=0;n<3;n++){box('park-bench'+n,[20+n*7,.7,40],[3,.2,.9],{kind:'wood',color:[.2,.14,.10,1]});box('park-back'+n,[20+n*7,1.15,40.35],[3,.7,.15],{kind:'wood',color:[.2,.14,.10,1]});}continue;}
  // The continuous SnowMatter surface owns snow on the ground. Decorative
  // box banks would mask excavations and put square plateaus above that surface.
  const colors=[[.48,.43,.38,1],[.59,.52,.45,1],[.47,.53,.53,1],[.57,.55,.49,1]],trim={kind:'default',color:[.65,.64,.60,1],roughness:.86},frame={kind:'steel',color:[.18,.20,.22,1],metalness:.3,roughness:.58};
  box(`building${sx}${sz}`,[px,height/2,pz],[27,height,27],{kind:'default',pattern:h%3===0?'plaster':'brick',color:colors[h%4],roughness:.89});
  box(`plinth${sx}${sz}`,[px,.63,pz],[27.15,1.26,27.15],{kind:'concrete',color:[.33,.34,.34,1],roughness:.9});
  box(`roof-edge${sx}${sz}`,[px,height-.12,pz],[27.65,.3,27.65],trim);
  box(`roof${sx}${sz}`,[px,height+.18,pz],[28,.35,28],snow);
  box(`chimney${sx}${sz}`,[px+6,height+1.1,pz-4],[1.2,2,1.4],{kind:'default',pattern:'brick',color:[.37,.34,.31,1],roughness:.86});
  box(`chimney-cap${sx}${sz}`,[px+6,height+2.17,pz-4],[1.5,.16,1.7],snow);
  // All four facades have real frames, sills and recessed-looking dark panes.
  // Material/spatial batches retain this detail without one draw per window.
  for(let side=0;side<4;side++){
   const axis=side%2,sign=side<2?-1:1;
   const onFace=(u,y,offset)=>axis?[px+u,y,pz+sign*(13.5+offset)]:[px+sign*(13.5+offset),y,pz+u];
   const dims=(u,y,d)=>axis?[u,y,d]:[d,y,u];
   for(let floor=0;floor<Math.floor(height/3);floor++)for(let n=-2;n<=2;n++){
    if(floor===0&&n===0)continue;
    const key=`${sx}${sz}:${side}:${floor}:${n}`,u=n*4.6,y=2.10+floor*3,lit=hash(h+side,n,floor)%7<2;
    box('window-reveal:'+key,onFace(u,y,.035),dims(1.68,1.94,.08),frame);
    box('window-pane:'+key,onFace(u,y,.16),dims(1.42,1.64,.025),{kind:'default',color:lit?[.47,.34,.20,1]:[.14,.20,.25,1],metalness:0,roughness:.58,emissive:lit?[.44,.27,.12]:[0,0,0]});
    box('window-mullion:'+key,onFace(u,y,.22),dims(.055,1.67,.045),trim);
    box('window-sill:'+key,onFace(u,y-.97,.20),dims(1.9,.15,.44),trim);
    box('sill-snow:'+key,onFace(u,y-.87,.20),dims(1.86,.09,.42),snow);
    if(floor===1&&(hash(h,n,side)%5===0)){
     box('balcony:'+key,onFace(u,y-.91,.66),dims(2.5,.16,1.3),trim);
     box('balcony-rail:'+key,onFace(u,y-.37,1.26),dims(2.5,.07,.07),frame);
     for(const edge of [-1,1])box('balcony-post:'+key+edge,onFace(u+edge*1.15,y-.65,1.26),dims(.06,.58,.06),frame);
    }
   }
   // A doorway and projecting canopy give the ground floor a human scale.
   box(`door:${sx}${sz}:${side}`,onFace(0,1.5,.09),dims(1.65,2.45,.13),{kind:'default',color:[.19,.23,.25,1],metalness:.12,roughness:.36});
   box(`canopy:${sx}${sz}:${side}`,onFace(0,2.94,.78),dims(3,.16,1.5),frame);
   box(`canopy-snow:${sx}${sz}:${side}`,onFace(0,3.08,.78),dims(3,.14,1.5),snow);
  }

 }
 for(const sx of [-1,1])for(const sz of [-1,1]){
  box(`signal-pole${sx}${sz}`,[sx*11.5,2.2,sz*11.5],[.13,4.4,.13],{kind:'steel',color:[.1,.13,.17,1]});
  box(`signal${sx}${sz}`,[sx*11.5,4.1,sz*11.5],[.25,.65,.3],{kind:'default',color:[.1,.1,.12,1]});
  box(`signal-red${sx}${sz}`,[sx*11.5,4.25,sz*11.3],[.17,.17,.05],{kind:'default',color:[.9,.04,.01,1],emissive:[2.8,.02,.01]});
  for(let n=0;n<6;n++)box(`crossing${sx}${sz}${n}`,[sx*(6+n*.9),.06,sz*8.8],[.4,.018,2.1],{kind:'default',color:[.73,.77,.75,1],roughness:.8});
 }
 const result=batchStaticScenery(entities,()=>true,24);tileCache.set(tileKey,result);if(tileCache.size>64)tileCache.delete(tileCache.keys().next().value);return result;
}
