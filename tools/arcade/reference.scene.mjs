// Camera and architecture are reusable SceneSpec data. This shot authors
// physical lighting and surface state; every pixel comes from the engine.
import base,{authoredEntityCount as buildingEntityCount} from './scene.mjs';
export {camera,quality} from './scene.mjs';
const materialMap=(name,sizeM,blend=.45)=>({url:`/tools/arcade/assets/${name}.png`,normalUrl:`/tools/arcade/assets/${name}-normal.png`,ormUrl:`/tools/arcade/assets/${name}-orm.png`,sizeM,bumpStrength:.20,normalStrength:.8,albedoStrength:blend,ormStrength:.7});
const canvas={kind:'default',color:[.31,.235,.17,1],roughness:.91,ageYears:65,emissive:[.065,.036,.018],texture:materialMap('plaster',.85,.72)};
const snow={kind:'snow',color:[.80,.81,.80,1],roughness:.94,texture:materialMap('snow',.42,.35)};
const additions=[];
const start=-2.5,bay=3.55,count=9,r=bay/2+.025,rise=1.12;
for(let i=0;i<count;i++){
 const x=-(start+bay*(i+.5));
 const points=Array.from({length:65},(_,j)=>{const a=j/64*Math.PI;return[r*Math.cos(a),rise*Math.sin(a)];});
 additions.push({id:`awning-fascia-${i}`,position:[x,3.19,-2.89],mesh:{kind:'polygon-prism',axis:2,points,thickness:.035},material:canvas});
}
const entities=base.entities.filter(e=>!/^chimney-0(?:$|-)/.test(e.id)&&e.id!=='distant-building').map(e=>{
 if(e.id==='lamp-light')return {...e,light:{...e.light,color:[1,.72,.43],intensity:58,range:18}};
 if(e.id==='lamp-flame')return {...e,material:{...e.material,color:[1,.78,.48,1],emissive:[24,13,5]}};
 if(e.id==='street-base')return {...e,material:{...e.material,color:[.055,.058,.06,1],roughness:.24},environmental:{surfaceUse:'road',waterDepthM:.0035,snowDepthM:.014,iceDepthM:.0004}};
 if(e.id==='distant-building')return {...e,material:{...e.material,color:[.09,.085,.078,1]}};
 const light=e.id.match(/^shop-(\d+)-canopy-light$/);
 if(!light)return e;
 const lit=Number(light[1])<2?.08:1;
 const color=[1,.72,.46];
 return {...e,position:[e.position[0],3.06,-3.50],mesh:{kind:'sphere',radius:.045,segments:16},
   material:{kind:'default',color:[1,.84,.72,1],roughness:.5,emissive:color.map(v=>v*3.5*lit)},
   light:{...e.light,color,intensity:13.5*lit,range:5.6}};
});
// One physical snowpack, one engine-owned surface projection. The previous
// independent microrelief sheet could overlap the snow and disagree with it.
additions.push({
 id:'snow-covered-street',position:[-8,-.065,-12],mesh:{kind:'box',size:[70,.10,20]},
 material:{kind:'concrete',color:[.18,.175,.16,1],roughness:.9,texture:materialMap('stone',1.5,.45)},
 environmental:{surfaceUse:'generic',snowDepthM:.035,waterDepthM:.00015,iceDepthM:.0002,snowMaterial:snow},
});
export const authoredEntityCount=buildingEntityCount+additions.length;
export default {...base,rendering:{...base.rendering,skyColor:[.010,.012,.016],fogDensity:.020,sunIntensity:.12,exposure:1.28},entities:[...entities,...additions]};
