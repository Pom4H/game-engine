import production from '../promo/clear-day.scene.mjs';

// Measure small residual snow on the ploughed road with the real GPU path.
const captures=[.006,.012,.020].map(depth=>{
  const scene=structuredClone(production);
  for(const entity of scene.entities){
    if(entity.id==='road'||entity.id==='hero-road-skin'){
      entity.environmental={...entity.environmental,snowDepthM:depth};
    }
  }
  return{id:`snow-${String(depth).replace('.','_')}`,scene,time:0,frames:8,meta:{snowDepthM:depth}};
});
export default{assetRoot:'../promo',captures};
