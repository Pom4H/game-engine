import production from '../promo/clear-day.scene.mjs';

// Optical experiment: a continuous, shallow film over the existing road.
// Geometry, car, camera and physical surface system stay identical.
const scene=structuredClone(production);
for(const entity of scene.entities){
  if(entity.id==='road'||entity.id==='hero-road-skin'){
    entity.environmental={...entity.environmental,waterDepthM:.0014};
  }
}
export default scene;
