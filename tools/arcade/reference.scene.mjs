// Camera and architecture are reusable SceneSpec data. This shot authors
// physical lighting and surface state; every pixel comes from the engine.
import base,{authoredEntityCount as buildingEntityCount} from './scene.mjs';
export {camera,quality} from './scene.mjs';
const materialMap=(name,sizeM,blend=.45)=>({url:`/tools/arcade/assets/${name}.png`,normalUrl:`/tools/arcade/assets/${name}-normal.png`,ormUrl:`/tools/arcade/assets/${name}-orm.png`,sizeM,bumpStrength:.20,normalStrength:.8,albedoStrength:blend,ormStrength:.7});
const canvas={kind:'default',color:[.46,.385,.31,1],roughness:.96,ageYears:50,texture:materialMap('plaster',1.4,.62)};
const snow={kind:'snow',color:[.80,.81,.80,1],roughness:.94,texture:materialMap('snow',.42,.35)};
const additions=[];
const start=-2.5,bay=3.55,count=9,r=bay/2+.025,rise=1.12;
for(let i=0;i<count;i++){
 const x=-(start+bay*(i+.5));
 const points=Array.from({length:65},(_,j)=>{const a=j/64*Math.PI;return[r*Math.cos(a),rise*Math.sin(a)];});
 additions.push({id:`awning-fascia-${i}`,position:[x,3.19,-2.89],mesh:{kind:'polygon-prism',axis:2,points,thickness:.035},material:canvas});
}
const entities=base.entities.map(e=>{
 const light=e.id.match(/^shop-(\d+)-canopy-light$/);
 if(!light)return e;
 const lit=Number(light[1])<2?.08:1;
 const color=[1,.80,.66];
 return {...e,position:[e.position[0],3.06,-3.50],mesh:{kind:'sphere',radius:.045,segments:16},
   material:{kind:'default',color:[1,.84,.72,1],roughness:.5,emissive:color.map(v=>v*3.5*lit)},
   light:{...e.light,color,intensity:10.5*lit,range:4.8}};
});
// One physical snowpack, one engine-owned surface projection. The previous
// independent microrelief sheet could overlap the snow and disagree with it.
additions.push({
 id:'snow-covered-street',position:[-8,-.065,-12],mesh:{kind:'box',size:[70,.10,20]},
 material:{kind:'concrete',color:[.18,.175,.16,1],roughness:.9,texture:materialMap('stone',1.5,.45)},
 environmental:{surfaceUse:'generic',snowDepthM:.075,waterDepthM:.00015,iceDepthM:.0002,snowMaterial:snow},
});
export const authoredEntityCount=buildingEntityCount+additions.length;
export default {...base,rendering:{...base.rendering,skyColor:[.027,.028,.030],fogDensity:.030,sunIntensity:.32,exposure:1.16},entities:[...entities,...additions]};
