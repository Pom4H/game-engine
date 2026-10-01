// Camera and architecture are reusable SceneSpec data. This shot authors
// physical lighting and surface state; every pixel comes from the engine.
import base,{authoredEntities} from './scene.mjs';
import {batchStaticScenery} from '../../dist/procedural/static-batch.js';
import {canopySnow} from './snow-canopy.mjs';
import {cobbledRoad,streetLantern} from './street.mjs';
export {quality} from './scene.mjs';
export const camera={position:[9.8,2.55,-11.7],target:[-6.4,4.05,1.75],fov:44.5,aperture:0};
export const cameraRail={durationSeconds:90,keyframes:[
 {position:camera.position,target:camera.target},
 {position:[-1,2.45,-11.2],target:[-15,4,1.3]},
 {position:[-11,2.7,-10.5],target:[-26,4.2,1]},
 {position:[-1,2.6,-12.4],target:[-15,4.1,1.5]},
]};
const materialMap=(name,sizeM,blend=.45)=>({url:`/tools/arcade/assets/${name}.png`,normalUrl:`/tools/arcade/assets/${name}-normal.png`,ormUrl:`/tools/arcade/assets/${name}-orm.png`,sizeM,bumpStrength:.20,normalStrength:.8,albedoStrength:blend,ormStrength:.7});
const canvas={kind:'default',color:[.19,.17,.15,1],roughness:.94,ageYears:105,texture:materialMap('plaster',.36,.92)};
const snow={kind:'snow',color:[.90,.91,.90,1],roughness:.96,texture:materialMap('snow',.34,.42)};
const additions=[];
const warmGlass={kind:'default',color:[.16,.145,.125,.20],metalness:.02,roughness:.10,emissive:[.30,.25,.20]};
const darkWood={kind:'default',color:[.075,.045,.03,1],roughness:.72,ageYears:80,texture:materialMap('wood',.55,.58)};
const agedWall={kind:'default',color:[.245,.235,.215,1],roughness:.985,ageYears:135,texture:materialMap('plaster',.34,1.0)};

const start=-2.5,bay=3.55,count=9,r=bay/2+.025,rise=1.12;
for(let i=0;i<count;i++){
 const x=-(start+bay*(i+.5));
 const points=Array.from({length:65},(_,j)=>{const a=j/64*Math.PI;return[r*Math.cos(a),rise*Math.sin(a)];});
 additions.push({id:`awning-fascia-${i}`,position:[x,3.19,-2.89],mesh:{kind:'polygon-prism',axis:2,points,thickness:.035},material:canvas});
}
const entities=authoredEntities.filter(e=>
 !/^sett-|^wet-patch-|^lamp-/.test(e.id)&&
 !/^shop-\d+-(canopy-snow|icicle)/.test(e.id)&&
 !/^street-snow-/.test(e.id)&&
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
 if(/^shop-\d+-upper-glass/.test(e.id)){
   const m=e.id.match(/^shop-(\d+)-/),i=Number(m?.[1]??0),on=[.06,.18,.04,.12,.05,.16,.03,.09,.02][i]??.04;
   return {...e,material:{...warmGlass,emissive:[on,on*.78,on*.55]}};
 }
 if(/^shop-\d+-glass/.test(e.id))return {...e,material:{...e.material,color:[.075,.085,.08,.13],roughness:.045}};
 if(/^shop-\d+-curtain/.test(e.id))return {...e,material:{...e.material,color:[.60,.59,.56,.42],emissive:[.012,.011,.010],roughness:.995}};
 if(/^shop-\d+-room-back/.test(e.id)){
   const m=e.id.match(/^shop-(\d+)-/),i=Number(m?.[1]??0),on=[.08,.16,.28,.12,.24,.10,.18,.08,.05][i]??.08;
   return {...e,material:{...e.material,color:[.11,.105,.095,1],emissive:[on,on*.84,on*.68]}};
 }
 if(/^shop-\d+-inside-light/.test(e.id)){
   const m=e.id.match(/^shop-(\d+)-/),i=Number(m?.[1]??0),level=[.5,.9,1.6,.7,1.3,.6,1.0,.45,.25][i]??.5;
   return {...e,light:{...e.light,color:[1,.86,.76],intensity:level,range:3.4}};
 }
 if(/^sign-|^side-sign-/.test(e.id))return {...e,material:{...e.material,color:[.30,.29,.265,1],roughness:.98,emissive:[.004,.004,.003]}};
 if(e.id==='street-base')return {...e,material:{...e.material,color:[.06,.063,.066,1],roughness:.78}};
 if(e.id==='distant-building')return {...e,material:{...e.material,color:[.09,.085,.078,1]}};
 const light=e.id.match(/^shop-(\d+)-canopy-light$/);
 if(!light)return e;
 const lit=[.08,.18,.55,.32,.48,.22,.36,.15,.08][Number(light[1])]??.18;
 const color=[1,.80,.66];
 return {...e,position:[e.position[0],3.06,-3.50],mesh:{kind:'sphere',radius:.045,segments:16},
   material:{kind:'default',color:[1,.90,.82,1],roughness:.55,emissive:color.map(v=>v*2.2*lit)},
   light:{...e.light,color,intensity:4.4*lit,range:4.2}};
});
// The housing profile supplies the fog pattern; no second halo light.
additions.push(...streetLantern('hero-lantern',6.7116,-.4714));
for(const [i,x,z] of [[0,-4,-3.95],[1,-15,-3.95],[2,-27,-3.95],[3,10.6,-17.5]])additions.push(...streetLantern('street-lantern-'+i,x,z));
const cobble={kind:'default',color:[.21,.225,.235,1],roughness:.43,clearcoat:.18,clearcoatRoughness:.18,texture:materialMap('stone',.65,.24)};
additions.push({id:'cobbled-main-road',position:[0,0,0],mesh:cobbledRoad(-33,13,-13,-3.8),material:cobble});
additions.push({id:'cobbled-cross-road',position:[0,0,0],mesh:cobbledRoad(4.8,12,-24,1.5,710,(x,z)=>z>-13.15&&z<-3.65),material:cobble});

// One physical snowpack, one engine-owned surface projection. The previous
// independent microrelief sheet could overlap the snow and disagree with it.
additions.push({
 id:'snow-covered-street',position:[-8,-.065,-12],mesh:{kind:'box',size:[70,.10,20]},
 material:{kind:'concrete',color:[.18,.175,.16,1],roughness:.9,texture:materialMap('stone',1.5,.45)},
 environmental:{surfaceUse:'generic',snowDepthM:.009,waterDepthM:.00015,iceDepthM:.0002,snowMaterial:snow},
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
// Irregular roadside accumulation keeps the wet centre visible while breaking
// the perfectly clean curb silhouette.
for(let i=0;i<24;i++){
 const x=-17+i*1.25,seed=9100+i*97;
 additions.push({id:`road-snowbank-${i}`,position:[x,.015,-4.4-(i%3)*.12],mesh:{kind:'snowdrift',size:[1.05,.14,.62],seed,segments:20},material:snow});
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

// A single shell replaces the overlapping base coating and separate snow rim.
// Deposition thins on steep sides and collects on the crown and exposed lip.
for(let i=0;i<count;i++){
 const cx=-(start+bay*(i+.5));
 additions.push({id:`awning-snow-shell-${i}`,position:[0,0,0],mesh:canopySnow(cx,r,rise,i),material:snow});
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

// Long-lived winter grime and accumulated ledges break the CG-clean facade.
for(let i=0;i<count;i++){
 const x=-(start+bay*(i+.5));
 box(`facade-sill-snow-${i}`,[x,4.48,-.35],[1.48,.045,.28],snow);
 for(const sx of [-.75,.15,.92]){
   box(`facade-streak-${i}-${sx}`,[x+sx,5.72,-.338],[.025,2.50,.018],
     {kind:'default',color:[.085,.082,.078,.72],roughness:1});
 }
}
const finalEntities=[...entities,...additions].filter(e=>!/^(window-bounce|awning-face-fill|interior-lamp-light)/.test(e.id));
export const referenceEntities=finalEntities;
export const authoredEntityCount=finalEntities.length;
export default {...base,
 camera,cameraRail,
 environment:{...base.environment,snowfall:'light',humidity:.985,wind:[.18,0,.06]},
 rendering:{...base.rendering,skyColor:[.020,.022,.025],fogDensity:.32,fogColor:[.095,.112,.13],fogHeightFalloff:.25,fogBaseHeight:0,fogStartDistance:2,fogRampDistance:16,sunDirection:[-.28,.76,-.46],sunColor:[.46,.49,.53],sunIntensity:.18,exposure:.96,reflectionProbe:{...base.rendering.reflectionProbe,facesPerFrame:1}},
 entities:batchStaticScenery(finalEntities,()=>true,9)};
