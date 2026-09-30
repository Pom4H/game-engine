// Reference shot assembled from ordinary public SceneSpec entities and materials.
// The building remains reusable; this module authors the winter street dressing.
import base,{authoredEntityCount as buildingEntityCount} from './scene.mjs';
export {camera,quality} from './scene.mjs';
const materialMap=(name,sizeM,blend=.45)=>({url:`/tools/arcade/assets/${name}.png`,normalUrl:`/tools/arcade/assets/${name}-normal.png`,ormUrl:`/tools/arcade/assets/${name}-orm.png`,sizeM,bumpStrength:.20,normalStrength:.8,albedoStrength:blend,ormStrength:.7});
const canvas={kind:'default',color:[.46,.385,.31,1],roughness:.96,ageYears:50,texture:materialMap('plaster',1.4,.62)};
const snow={kind:'snow',color:[.74,.765,.77,1],roughness:.94,texture:materialMap('snow',.63,.35)};
const additions=[];
const start=-2.5,bay=3.55,count=9,r=bay/2+.025,rise=1.12;
for(let i=0;i<count;i++){
 const x=-(start+bay*(i+.5));
 // Awnings in the reference have closed, weathered arched fascias, not open
 // black tunnels. These thin panels catch light from the actual pendant bulbs.
 const points=Array.from({length:65},(_,j)=>{const a=j/64*Math.PI;return[r*Math.cos(a),rise*Math.sin(a)];}).reverse();
 additions.push({id:`awning-fascia-${i}`,position:[x,3.19,-2.89],mesh:{kind:'polygon-prism',axis:2,points,thickness:.035},material:canvas});
}
const entities=base.entities.map(e=>{
 if(/^shop-\d+-canopy-light$/.test(e.id))return{...e,position:[e.position[0],3.0,-3.12],light:{...e.light,intensity:4.6,range:4.4}};
 if(/^shop-\d+-bulb$/.test(e.id))return{...e,position:[e.position[0],2.98,-3.04]};
 return e;
});
// A continuous 2.4 cm snowpack belongs to a physical street surface. The engine
// creates and shades its snow projection; there is no image card or screen mask.
additions.push({
 id:'snow-covered-street',position:[-8,-.065,-12],mesh:{kind:'box',size:[70,.10,20]},
 material:{kind:'concrete',color:[.18,.175,.16,1],roughness:.9,texture:materialMap('stone',1.5,.45)},
 environmental:{surfaceUse:'generic',snowDepthM:.024,waterDepthM:.00015,iceDepthM:.0002,snowMaterial:snow},
});
// Small sub-metre clumps break up the silhouette of compacted snow between the
// native snow surface and the kerb. Stable seeds make the shot reproducible.
let state=174132;
const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
const positions=[],normals=[],indices=[],colors=[];
const nx=220,nz=72,dx=.16,dz=.16,x0=-22,z0=-15.6;
const h=(x,z)=>.006+.010*Math.sin(x*29.7+Math.sin(z*13.4))*Math.sin(z*23.1)+.014*Math.sin(x*9.3+z*12.7)**4+.004*Math.cos(x*52.1-z*47.3);
for(let z=0;z<=nz;z++)for(let x=0;x<=nx;x++){
 const xx=x0+x*dx,zz=z0+z*dz,y=h(xx,zz);
 const gx=(h(xx+.007,zz)-h(xx-.007,zz))/.014,gz=(h(xx,zz+.007)-h(xx,zz-.007))/.014,l=Math.hypot(gx,1,gz);
 positions.push(xx,y,zz);normals.push(-gx/l,1/l,-gz/l);
 const tone=.72+.21*random();colors.push(tone,tone,tone*.98,1);
 if(x<nx&&z<nz){const a=z*(nx+1)+x,b=a+1,c=a+nx+1,d=c+1;indices.push(a,c,b,b,c,d);}
}
additions.push({id:'compacted-snow-microrelief',position:[0,0,0],mesh:{kind:'triangle-mesh',positions,normals,indices,colors},material:snow});
export const authoredEntityCount=buildingEntityCount+additions.length;
export default {...base,rendering:{...base.rendering,skyColor:[.020,.022,.025],fogDensity:.023,sunIntensity:.16,exposure:1.16},entities:[...entities,...additions]};
