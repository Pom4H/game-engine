import production from '../promo/clear-day.scene.mjs';

const scene=structuredClone(production);
for(const entity of scene.entities){
  if(entity.id==='road'||entity.id==='hero-road-skin'){
    entity.environmental={...entity.environmental,snowDepthM:.055};
  }
}
console.log('ROAD_SNOW_AUTHORED',JSON.stringify(scene.entities.filter(entity=>entity.id==='road'||entity.id==='hero-road-skin').map(entity=>({id:entity.id,snowDepthM:entity.environmental?.snowDepthM,waterDepthM:entity.environmental?.waterDepthM}))));
export default scene;
