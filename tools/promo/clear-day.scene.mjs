import {makeCity} from './city.mjs';

const {spec}=makeCity('street');

// Canonical visual target: clear winter daylight, low front three-quarter M3 shot.
// This is an authored camera/weather setup only; the car, materials, snow, wet road,
// lighting, reflections and post-processing are production engine systems.
spec.environment={
  temperatureC:-.35,
  humidity:.46,
  groundMoisture:.42,
  precipitation:'rare',
  snowfall:'none',
  sunlight:1,
  wind:[.35,0,.08],
  clock:{startHour:11.8,hoursPerSecond:0},
  // The visible snowpack is a consequence of three days of weather rather than
  // a hand-picked "snow type": snowfall -> partial thaw -> refreeze -> fresh cap.
  history:[
    {hoursAgo:72,temperatureC:-11,snowfall:'moderate',sunlight:.08,humidity:.84,wind:[3.2,0,.6]},
    {hoursAgo:69.5,temperatureC:-9,snowfall:'none',sunlight:.12,humidity:.72,wind:[1.4,0,.2]},
    {hoursAgo:24,temperatureC:.8,sunlight:.48,humidity:.61,wind:[.7,0,.1]},
    {hoursAgo:17,temperatureC:-5.5,sunlight:.04,humidity:.70,wind:[.9,0,.1]},
    {hoursAgo:4,temperatureC:-6.5,snowfall:'light',sunlight:.03,humidity:.82,wind:[1.8,0,.3]},
    {hoursAgo:2.5,temperatureC:-5.2,snowfall:'none',sunlight:.06,humidity:.74,wind:[.8,0,.1]},
  ],
};
spec.rendering={
  // Raking winter sun: enough lateral component for window reveals/cornices to
  // cast readable shadows instead of flattening the facade into a texture sheet.
  sunDirection:[-.58,.63,.36],
  sunColor:[1,.95,.86],
  sunIntensity:2.75,
  skyColor:[.27,.39,.55],
  fogDensity:.00042,
  exposure:.97,
  shadowExtent:28,
};
spec.camera={
  position:[-15.15,1.06,-4.10],
  target:[-20.55,.70,-1.38],
  fov:28,
  focusDistance:6.10,
  aperture:.075,
};

// Keep the reference car exactly at its authored start pose. Headlights remain on
// because that is material state, not a movie-only animation side effect.
spec.animation={...spec.animation,vehicles:[]};
const heroReflectionExclude=spec.entities.filter(entity=>entity.id.startsWith('passing-')).map(entity=>entity.id);
spec.rendering.reflectionProbe={
  entity:'passing-body',
  offset:[0,.92,0],
  radius:46,
  exclude:heroReflectionExclude,
  facesPerFrame:6,
  // Tight local volume for parallax-correct reflections on the car body.
  boxHalfExtents:[8,3,5],
};
// Hero daylight shot keeps the physically meaningful snow banks but drops the
// thousands of sub-pixel dressing grains generated for the moving winter demo.
// This is visual LOD, not a different material/lighting path.
// In a history-driven scene, authored phase depths are the state at the start of
// that history. Keep only a thin old base layer; the rest is derived by prewarm.
for(const entity of spec.entities){
  if(!entity.environmental?.surfaceUse)continue;
  const use=entity.environmental.surfaceUse;
  entity.environmental={
    ...entity.environmental,
    snowDepthM:use==='curb'?.022:use==='road'?0:.008,
    waterDepthM:0,
    iceDepthM:0,
  };
}
spec.entities=spec.entities.filter(entity=>{
  const id=entity.id;
  if(id.startsWith('batch:plough-grit-')||id.startsWith('batch:walk-grain-'))return false;
  // Replace near-road batched snow dressing with two coherent high-resolution
  // banks; the distant roof/window snow stays untouched.
  if(id.startsWith('batch:')&&entity.material?.kind==='snow'&&Math.abs(entity.position?.[2]??99)<8.6)return false;
  return true;
});
spec.entities.push(
  {id:'hero-road-skin',position:[10,.006,0],mesh:{kind:'box',size:[180,.008,7.10]},material:{kind:'asphalt',color:[.043,.045,.048,1],roughness:.78},environmental:{surfaceUse:'road',snowDepthM:0,iceDepthM:0,waterDepthM:0}},
);
// No authored hero snowbanks: the curb/sidewalk snow geometry now comes only
// from the prewarmed weather history and the general surface visual system.
for(const entity of spec.entities){
  if(entity.id.startsWith('passing-contact')&&entity.body){
    entity.position=[entity.position[0]-4.2,entity.position[1],entity.position[2]];
    entity.body={...entity.body,velocity:[2.65,0,0]};
  }
  if(entity.id.startsWith('passing-')&&entity.material?.treatment==='painted'){
    // The scene chooses only the hero colour. Automotive layer response belongs to
    // the vehicle material + renderer so stills, gameplay and offline renders agree.
    entity.material={...entity.material,color:[.16,.175,.205,1]};
  }
  if(entity.id==='road'&&entity.environmental){
    entity.material={...entity.material,color:[.040,.042,.045,1],roughness:.80};
  }
}

export default spec;
