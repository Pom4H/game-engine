// Camera and architecture are reusable SceneSpec data. This shot authors
// physical lighting and surface state; every pixel comes from the engine.
import base,{authoredEntityCount as buildingEntityCount,authoredEntities} from './scene.mjs';
import {batchStaticScenery} from '../../dist/procedural/static-batch.js';
export {camera,quality} from './scene.mjs';
const materialMap=(name,sizeM,blend=.45)=>({url:`/tools/arcade/assets/${name}.png`,normalUrl:`/tools/arcade/assets/${name}-normal.png`,ormUrl:`/tools/arcade/assets/${name}-orm.png`,sizeM,bumpStrength:.20,normalStrength:.8,albedoStrength:blend,ormStrength:.7});
const canvas={kind:'default',color:[.30,.205,.135,1],roughness:.88,ageYears:88,texture:materialMap('plaster',.42,1.0)};
const snow={kind:'snow',color:[.90,.91,.90,1],roughness:.96,texture:materialMap('snow',.34,.42)};
const additions=[];
const warmGlass={kind:'default',color:[.22,.15,.09,.22],metalness:.02,roughness:.12,emissive:[.52,.29,.12]};
const darkWood={kind:'default',color:[.075,.045,.03,1],roughness:.72,ageYears:80,texture:materialMap('wood',.55,.58)};
const agedWall={kind:'default',color:[.39,.34,.275,1],roughness:.97,ageYears:110,texture:materialMap('plaster',.46,.98)};

const start=-2.5,bay=3.55,count=9,r=bay/2+.025,rise=1.12;
for(let i=0;i<count;i++){
 const x=-(start+bay*(i+.5));
 const points=Array.from({length:65},(_,j)=>{const a=j/64*Math.PI;return[r*Math.cos(a),rise*Math.sin(a)];});
 additions.push({id:`awning-fascia-${i}`,position:[x,3.19,-2.89],mesh:{kind:'polygon-prism',axis:2,points,thickness:.035},material:canvas});
}
const entities=authoredEntities.filter(e=>
 !/^chimney-/.test(e.id)&&
 e.id!=='distant-building'&&
 e.id!=='roof-top'&&e.id!=='front-mansard'&&
 !/^roof-(seam|snow-seam)/.test(e.id)&&e.id!=='eaves-snow'&&
 !/^dormer-/.test(e.id)&&
 !/^shop-\d+-arch-face$/.test(e.id)&&
 !/^side-(canopy|column|arch-trim|window)/.test(e.id)
).map(e=>{
 if(e.id==='upper-building')return {...e,material:agedWall};
 if(/^shop-\d+-(pier|jamb|plinth|crossbar|mullion|raised-panel)/.test(e.id))return {...e,material:darkWood};
 if(/^shop-\d+-upper-glass/.test(e.id))return {...e,material:{...warmGlass,emissive:[.10,.055,.022]}};
 if(/^shop-\d+-glass/.test(e.id))return {...e,material:{...e.material,color:[.075,.085,.08,.13],roughness:.045}};
 if(/^shop-\d+-curtain/.test(e.id))return {...e,material:{...e.material,color:[.40,.35,.29,.30],emissive:[.014,.007,.0025],roughness:.99}};
 if(/^shop-\d+-room-back/.test(e.id))return {...e,material:{...e.material,color:[.115,.073,.045,1],emissive:[.055,.025,.008]}};
 if(/^shop-\d+-inside-light/.test(e.id))return {...e,light:{...e.light,color:[1,.64,.36],intensity:6.2,range:4.5}};
 if(/^sign-|^side-sign-/.test(e.id))return {...e,material:{...e.material,color:[.26,.22,.17,1],roughness:.96,emissive:[.012,.009,.006]}};
 if(e.id==='lamp-light')return {...e,light:{...e.light,color:[1,.58,.28],intensity:36,range:9.8}};
 if(e.id==='lamp-flame')return {...e,material:{...e.material,color:[1,.82,.54,1],emissive:[18,9,3.8]}};
 if(e.id==='street-base')return {...e,material:{...e.material,color:[.032,.035,.038,1],roughness:.10},environmental:{surfaceUse:'road',waterDepthM:.020,snowDepthM:.010,iceDepthM:.0005}};
 if(e.id==='distant-building')return {...e,material:{...e.material,color:[.09,.085,.078,1]}};
 const light=e.id.match(/^shop-(\d+)-canopy-light$/);
 if(!light)return e;
 const lit=Number(light[1])<2?.08:1;
 const color=[1,.72,.46];
 return {...e,position:[e.position[0],3.06,-3.50],mesh:{kind:'sphere',radius:.045,segments:16},
   material:{kind:'default',color:[1,.84,.72,1],roughness:.5,emissive:color.map(v=>v*3.5*lit)},
   light:{...e.light,color,intensity:10.5*lit,range:5.1}};
});
// The practical has two causal scales: a compact photometric lamp and a
// low-intensity wide source that only supplies the broad snow/fog bounce seen
// around real street lamps. Both remain ordinary point lights.
additions.push({id:'lamp-aureole',position:[6.7116,3.63,-.4714],light:{kind:'point',color:[1,.60,.30],intensity:10.5,range:12.5}});

// One physical snowpack, one engine-owned surface projection. The previous
// independent microrelief sheet could overlap the snow and disagree with it.
additions.push({
 id:'snow-covered-street',position:[-8,-.065,-12],mesh:{kind:'box',size:[70,.10,20]},
 material:{kind:'concrete',color:[.18,.175,.16,1],roughness:.9,texture:materialMap('stone',1.5,.45)},
 environmental:{surfaceUse:'generic',snowDepthM:.045,waterDepthM:.00015,iceDepthM:.0002,snowMaterial:snow},
});

const box=(id,position,size,material,extra={})=>additions.push({id,position,mesh:{kind:'box',size},material,...extra});
const sphere=(id,position,r,material,scale=[1,1,1])=>additions.push({id,position,mesh:{kind:'sphere',radius:r,segments:18},material,scale});
// Rebuild the facade read at human scale: deep frames, illuminated upper rooms,
// carved pilasters and a richer cornice. These are geometry, not image cards.
for(let i=0;i<count;i++){
 const x=-(start+bay*(i+.5));
 const lit=i<6?1:.45;
 box(`hero-upper-glass-${i}`,[x,5.43,-.205],[1.02,1.42,.025],{...warmGlass,emissive:[.17*lit,.075*lit,.025*lit]});
 for(const sx of [-.57,.57])box(`hero-upper-jamb-${i}-${sx}`,[x+sx,5.42,-.27],[.10,1.72,.18],darkWood);
 box(`hero-upper-head-${i}`,[x,6.32,-.28],[1.34,.10,.20],darkWood);
 box(`hero-upper-sill-${i}`,[x,4.54,-.29],[1.40,.12,.24],darkWood);
 for(const y of [4.08,6.62])box(`hero-belt-${i}-${y}`,[x,y,-.23],[bay-.14,.11,.22],agedWall);
 for(const sx of [-1,1])box(`hero-pilaster-${i}-${sx}`,[x+sx*(bay*.47),5.34,-.24],[.15,2.55,.20],agedWall);
 // subtle wall relief catches grazing moonlight
 for(let k=0;k<3;k++)box(`hero-relief-${i}-${k}`,[x+(k-1)*.48,6.95,-.29],[.16,.46,.05],{...agedWall,color:[.26,.21,.16,1]});
}
// Canopy snow comes from the continuous engine-owned snow surface. Spherical
// bead detail was removed because it read as decoration rather than accumulated snow.
// Warm display objects near the glass give the shop windows depth and specular breakup.
for(let i=0;i<Math.min(count,7);i++){
 const x=-(start+bay*(i+.5));
 box(`window-display-base-${i}`,[x,.72,-.36],[2.2,.08,.44],darkWood);
 for(let k=0;k<7;k++){
   const xx=x+(k-3)*.27;
   sphere(`window-display-${i}-${k}`,[xx,.86+(k%2)*.10,-.40],.085+(k%3)*.012,{kind:'default',color:[.52,.42,.30,1],roughness:.38,emissive:[.06,.028,.01]});
 }
}
// Continuous snow lip on the awning edge: a narrow triangle strip, not beads.
for(let i=0;i<count;i++){
 const x=-(start+bay*(i+.5)),positions=[],normals=[],indices=[],steps=56;
 for(let k=0;k<=steps;k++){
   const a=k/steps*Math.PI,cs=Math.cos(a),sn=Math.sin(a);
   for(const d of [0,.11]){
     const rr=r+.055-d*.22,yy=3.19+(rise+.075-d*.18)*sn;
     positions.push(x+rr*cs,yy,-2.945-d);
     normals.push(cs*.45,sn,.08);
   }
   if(k<steps){const q=k*2;indices.push(q,q+2,q+1,q+1,q+2,q+3);}
 }
 additions.push({id:`awning-snow-rim-${i}`,position:[0,0,0],mesh:{kind:'triangle-mesh',positions,normals,indices},material:snow});
}
// Irregular roadside accumulation keeps the wet centre visible while breaking
// the perfectly clean curb silhouette.
for(let i=0;i<24;i++){
 const x=-17+i*1.25,seed=9100+i*97;
 additions.push({id:`road-snowbank-${i}`,position:[x,.015,-4.4-(i%3)*.12],mesh:{kind:'snowdrift',size:[1.05,.14,.62],seed,segments:20},material:snow});
}

// Wind-blown foreground clumps break the pavement into wet and packed-snow
// regions without hiding the reflections.
for(let i=0;i<104;i++){
 const t=(i*37%101)/101,z=-5.2-(i*53%89)/89*8.6,x=-18+t*43;
 additions.push({id:`road-scatter-${i}`,position:[x,-.002,z],mesh:{kind:'snowdrift',size:[.52+(i%5)*.14,.05+(i%3)*.022,.40+(i%4)*.12],seed:14000+i*83,segments:14},material:snow});
}



// Warm bounce from the shopfronts onto wet cobbles. These are low-energy point
// lights placed at the actual windows, not screen-space glow cards.
for(let i=0;i<7;i++){
 const x=-(start+bay*(i+.5));
 additions.push({id:`window-bounce-${i}`,position:[x,.42,-1.35],light:{kind:'point',color:[1,.53,.28],intensity:3.1,range:5.0}});
}
// Architectural depth around the upper windows: lintels, pilaster caps and
// recessed panels catch the cold directional light and stop the facade reading
// like one flat wall.
for(let i=0;i<count;i++){
 const x=-(start+bay*(i+.5));
 for(const sx of [-1,1]){
   box(`hero-cap-${i}-${sx}`,[x+sx*(bay*.47),6.55,-.31],[.30,.16,.30],{...agedWall,color:[.36,.30,.24,1]});
   box(`hero-base-${i}-${sx}`,[x+sx*(bay*.47),4.02,-.30],[.28,.14,.28],{...agedWall,color:[.30,.25,.20,1]});
 }
 box(`hero-panel-top-${i}`,[x,7.18,-.28],[bay-.34,.11,.18],{...agedWall,color:[.29,.24,.19,1]});
 box(`hero-panel-inset-${i}`,[x,6.92,-.315],[bay-.62,.36,.045],{kind:'default',color:[.18,.145,.11,1],roughness:.96,texture:materialMap('plaster',.34,.90)});
}
// Fine icicles hang only from the front edge where melt/refreeze is plausible.
for(let i=0;i<7;i++){
 const x=-(start+bay*(i+.5));
 for(let k=0;k<7;k++){
   const a=(k+.5)/7*Math.PI,px=x+Math.cos(a)*(r+.05),py=3.19+Math.sin(a)*(rise+.075),h=.05+((i*11+k*7)%6)*.018;
   additions.push({id:`hero-icicle-${i}-${k}`,position:[px,py-h*.5,-3.01],mesh:{kind:'cylinder',radius:.006,topRadius:.0015,height:h,segments:8},material:{kind:'default',color:[.62,.69,.72,.75],roughness:.18,metalness:.02}});
 }
}


// A weak front-facing practical per bay reveals the aged canvas texture without
// flattening the facade. It approximates light spilling from the pendant below.
for(let i=0;i<8;i++){
 const x=-(start+bay*(i+.5));
 additions.push({id:`awning-face-fill-${i}`,position:[x,3.55,-3.45],light:{kind:'point',color:[1,.58,.32],intensity:.72,range:2.7}});
}

// Continuous snow shells over the arched canopies. Unlike the old beads these
// preserve the canopy silhouette and add low-frequency accumulation depth.
for(let i=0;i<count;i++){
 const cx=-(start+bay*(i+.5)),positions=[],normals=[],indices=[],nu=52,nv=12;
 for(let v=0;v<=nv;v++)for(let u=0;u<=nu;u++){
   const fu=u/nu,fv=v/nv,a=(.035+fu*.93)*Math.PI;
   const lump=.018*Math.sin(fu*10.5+i*.7)+.010*Math.sin(fu*27.0+fv*5.0+i);
   const front=.018*Math.exp(-fv*7.0)*(1+.5*Math.sin(fu*19.0+i));
   const h=.125+lump*1.65+front*1.75;
   const cs=Math.cos(a),sn=Math.sin(a);
   positions.push(cx+cs*(r+h),3.19+sn*(rise+h*.72),-2.92+fv*2.78);
   const l=Math.hypot(cs,sn)||1;normals.push(cs/l,sn/l,.05);
   if(u<nu&&v<nv){const q=v*(nu+1)+u,b=q+nu+1;indices.push(q,b,q+1,q+1,b,b+1);}
 }
 additions.push({id:`awning-snow-shell-${i}`,position:[0,0,0],mesh:{kind:'triangle-mesh',positions,normals,indices},material:snow});
}
// Interior practicals create small pools of warm light and depth behind glass.
for(let i=0;i<6;i++){
 const x=-(start+bay*(i+.5));
 for(let k=0;k<2;k++){
   const px=x+(k?-.52:.52),py=1.45+k*.34,pz=.48;
   sphere(`interior-lamp-bulb-${i}-${k}`,[px,py,pz],.045,{kind:'default',color:[1,.72,.42,1],roughness:.4,emissive:[4.5,2.2,.7]});
   additions.push({id:`interior-lamp-light-${i}-${k}`,position:[px,py,pz],light:{kind:'point',color:[1,.60,.32],intensity:1.35,range:2.4}});
 }
}

// Wetness/reflections remain properties of the actual road surface, not rectangular cards.


// Rebuild the whole mansard as two coherent planes. The original procedural
// front/rear surfaces could cross the hero camera near-plane and create the
// giant black wedge visible in previous captures.
{
 const x0=-29.55,x1=2.55,zEave=-.18,zRidge=2.15,yEave=7.82,yRidge=10.35;
 const positions=[x0,yEave,zEave,x1,yEave,zEave,x1,yRidge,zRidge,x0,yRidge,zRidge];
 const dx=x1-x0,dy=yRidge-yEave,dz=zRidge-zEave;
 const nx=0,ny=-dz,nz=dy,l=Math.hypot(ny,nz),n=[nx,ny/l,nz/l];
 const normals=[...n,...n,...n,...n],indices=[0,1,2,0,2,3];
 additions.push({id:'hero-front-roof',position:[0,0,0],mesh:{kind:'triangle-mesh',positions,normals,indices},material:{kind:'default',color:[.050,.055,.060,1],metalness:.22,roughness:.78,texture:materialMap('stone',1.0,.34)}});
 for(let i=0;i<14;i++){
   const x=-28+i*2.25;
   additions.push({id:`front-roof-snow-${i}`,position:[x,8.03+(i%3)*.05,.02+(i%3)*.12],mesh:{kind:'snowdrift',size:[2.15,.045,.62],seed:31000+i*137,segments:18},material:snow});
 }
}
// Hero dormers are rebuilt on top of the coherent mansard instead of keeping
// the old roof-relative geometry.
for(let i=0;i<5;i++){
 const x=-25.5+i*6.0,z=.88;
 box(`hero-dormer-body-${i}`,[x,9.65,z],[1.34,1.58,1.20],{kind:'default',color:[.060,.052,.047,1],roughness:.86,texture:materialMap('wood',.7,.42)});
 box(`hero-dormer-glass-${i}`,[x,9.63,.255],[.72,.90,.025],{...warmGlass,emissive:[.12,.055,.022]});
 box(`hero-dormer-frame-v-${i}`,[x,9.63,.20],[.055,.98,.09],darkWood);
 box(`hero-dormer-frame-h-${i}`,[x,9.68,.19],[.80,.055,.09],darkWood);
 const pts=[[-.84,0],[.84,0],[0,.66]];
 additions.push({id:`hero-dormer-gable-${i}`,position:[x,10.45,.31],mesh:{kind:'polygon-prism',axis:2,points:pts,thickness:1.34},material:{kind:'default',color:[.050,.055,.060,1],metalness:.18,roughness:.80}});
 additions.push({id:`hero-dormer-snow-${i}`,position:[x,10.53,.12],mesh:{kind:'snowdrift',size:[1.76,.055,.66],seed:41000+i*131,segments:18},material:snow});
}
for(const [i,x] of [-22,-10].entries()){
 box(`hero-chimney-${i}`,[x,11.25,3.7],[.72,1.86,.76],{kind:'default',color:[.085,.072,.062,1],roughness:.95,texture:materialMap('stone',.62,.50)});
 box(`hero-chimney-cap-${i}`,[x,12.20,3.7],[.94,.14,.98],{kind:'concrete',color:[.14,.13,.12,1],roughness:.94});
 additions.push({id:`hero-chimney-snow-${i}`,position:[x,12.30,3.7],mesh:{kind:'snowdrift',size:[1.0,.06,1.04],seed:43000+i*173,segments:16},material:snow});
}

// Replace the malformed original rear roof with a single coherent mansard back
// plane. It shares the building axis and cannot cross the camera near plane.
{
 const x0=-29.55,x1=2.55,z0=2.12,z1=6.45,y0=10.34,y1=8.16;
 const positions=[x0,y0,z0,x1,y0,z0,x1,y1,z1,x0,y1,z1];
 const n=[0,.88,.47],normals=[...n,...n,...n,...n],indices=[0,2,1,0,3,2];
 additions.push({id:'hero-rear-roof',position:[0,0,0],mesh:{kind:'triangle-mesh',positions,normals,indices},material:{kind:'default',color:[.055,.060,.065,1],metalness:.25,roughness:.72,texture:materialMap('stone',1.2,.36)}});
 // broken snow bands catch cold moonlight without making a white roof sheet
 for(let i=0;i<11;i++){
   const x=-27+i*2.8;
   additions.push({id:`roof-snow-patch-${i}`,position:[x,9.95-(i%3)*.10,2.55+(i%3)*.30],mesh:{kind:'snowdrift',size:[2.6,.055,.72],seed:22000+i*111,segments:18},material:snow});
 }
}

export const authoredEntityCount=buildingEntityCount+additions.length;
export default {...base,
 environment:{...base.environment,snowfall:'moderate',humidity:.97,wind:[.28,0,.10]},
 rendering:{...base.rendering,skyColor:[.018,.022,.030],fogDensity:.0155,sunDirection:[-.28,.76,-.46],sunColor:[.44,.54,.70],sunIntensity:.72,exposure:1.08},
 entities:batchStaticScenery([...entities,...additions],()=>true,9)};
