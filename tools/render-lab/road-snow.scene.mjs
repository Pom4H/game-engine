import production from '../promo/clear-day.scene.mjs';

const scene=structuredClone(production);
for(const entity of scene.entities){
  if(entity.id==='road'||entity.id==='hero-road-skin'){
    entity.environmental={...entity.environmental,snowDepthM:.012};
  }
}
export default scene;
