// Camera and architecture are reusable SceneSpec data. This shot authors
// physical lighting and surface state; every pixel comes from the engine.
import base,{authoredEntityCount as buildingEntityCount} from './scene.mjs';
export {camera,quality} from './scene.mjs';
const materialMap=(name,sizeM,blend=.45)=>({url:`/tools/arcade/assets/${name}.png`,normalUrl:`/tools/arcade/assets/${name}-normal.png`,ormUrl:`/tools/arcade/assets/${name}-orm.png`,sizeM,bumpStrength:.20,normalStrength:.8,albedoStrength:blend,ormStrength:.7});
const canvas={kind:'default',color:[.22,.16,.115,1],roughness:.94,ageYears:75,texture:materialMap('plaster',.62,.88)};
const snow={kind:'snow',color:[.90,.91,.90,1],roughness:.96,texture:materialMap('snow',.34,.42)};
const additions=[];
const warmGlass={kind:'default',color:[.22,.15,.09,.22],metalness:.02,roughness:.12,emissive:[.52,.29,.12]};
const darkWood={kind:'default',color:[.075,.045,.03,1],roughness:.72,ageYears:80,texture:materialMap('wood',.55,.58)};
const agedWall={kind:'default',color:[.19,.15,.12,1],roughness:.97,ageYears:95,texture:materialMap('plaster',.7,.76)};

const start=-2.5,bay=3.55,count=9,r=bay/2+.025,rise=1.12;
for(let i=0;i<count;i++){
 const x=-(start+bay*(i+.5));
 const points=Array.from({length:65},(_,j)=>{const a=j/64*Math.PI;return[r*Math.cos(a),rise*Math.sin(a)];});
 additions.push({id:`awning-fascia-${i}`,position:[x,3.19,-2.89],mesh:{kind:'polygon-prism',axis:2,points,thickness:.035},material:canvas});
}
const entities=base.entities.filter(e=>!/^chimney-/.test(e.id)&&e.id!=='distant-building').map(e=>{
 if(e.id==='upper-building')return {...e,material:agedWall};
 if(/^shop-\d+-(pier|jamb|plinth|crossbar|mullion|raised-panel)/.test(e.id))return {...e,material:darkWood};
 if(/^shop-\d+-upper-glass/.test(e.id))return {...e,material:{...warmGlass,emissive:[.10,.055,.022]}};
 if(/^shop-\d+-glass/.test(e.id))return {...e,material:{...e.material,color:[.075,.085,.08,.13],roughness:.045}};
 if(/^shop-\d+-curtain/.test(e.id))return {...e,material:{...e.material,color:[.57,.52,.45,1],emissive:[.085,.045,.018],roughness:.98}};
 if(/^shop-\d+-room-back/.test(e.id))return {...e,material:{...e.material,color:[.16,.105,.07,1],emissive:[.035,.016,.006]}};
 if(/^shop-\d+-inside-light/.test(e.id))return {...e,light:{...e.light,color:[1,.67,.40],intensity:3.2,range:3.5}};
 if(/^sign-|^side-sign-/.test(e.id))return {...e,material:{...e.material,color:[.26,.22,.17,1],roughness:.96,emissive:[.012,.009,.006]}};
 if(e.id==='lamp-light')return {...e,light:{...e.light,color:[1,.61,.32],intensity:42,range:8.5}};
 if(e.id==='lamp-flame')return {...e,material:{...e.material,color:[1,.82,.54,1],emissive:[18,9,3.8]}};
 if(e.id==='street-base')return {...e,material:{...e.material,color:[.038,.041,.044,1],roughness:.18},environmental:{surfaceUse:'road',waterDepthM:.0045,snowDepthM:.008,iceDepthM:.0005}};
 if(e.id==='distant-building')return {...e,material:{...e.material,color:[.09,.085,.078,1]}};
 const light=e.id.match(/^shop-(\d+)-canopy-light$/);
 if(!light)return e;
 const lit=Number(light[1])<2?.08:1;
 const color=[1,.72,.46];
 return {...e,position:[e.position[0],3.06,-3.50],mesh:{kind:'sphere',radius:.045,segments:16},
   material:{kind:'default',color:[1,.84,.72,1],roughness:.5,emissive:color.map(v=>v*3.5*lit)},
   light:{...e.light,color,intensity:8.5*lit,range:4.6}};
});
// The practical has two causal scales: a compact photometric lamp and a
// low-intensity wide source that only supplies the broad snow/fog bounce seen
// around real street lamps. Both remain ordinary point lights.
additions.push({id:'lamp-aureole',position:[6.7116,3.63,-.4714],light:{kind:'point',color:[1,.60,.30],intensity:5.8,range:15.5}});

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

// Wetness/reflections remain properties of the actual road surface, not rectangular cards.

export const authoredEntityCount=buildingEntityCount+additions.length;
export default {...base,
 environment:{...base.environment,snowfall:'moderate',humidity:.93,wind:[.38,0,.12]},
 rendering:{...base.rendering,skyColor:[.024,.029,.038],fogDensity:.0115,sunDirection:[-.34,.72,-.49],sunColor:[.48,.58,.72],sunIntensity:.36,exposure:1.10},
 entities:[...entities,...additions]};
