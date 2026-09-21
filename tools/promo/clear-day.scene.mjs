import {makeCity} from './city.mjs';

const {spec}=makeCity('street');

// Canonical visual target: clear winter daylight, low front three-quarter M3 shot.
// This is an authored camera/weather setup only; the car, materials, snow, wet road,
// lighting, reflections and post-processing are production engine systems.
spec.environment={
  temperatureC:-1.5,
  humidity:.46,
  groundMoisture:.42,
  precipitation:'rare',
  snowfall:'none',
  sunlight:1,
  wind:[.35,0,.08],
  clock:{startHour:11.8,hoursPerSecond:0},
};
spec.rendering={
  sunDirection:[.42,.80,-.42],
  sunColor:[1,.975,.93],
  sunIntensity:3.05,
  skyColor:[.30,.45,.66],
  fogDensity:.00028,
  exposure:1.03,
  shadowExtent:30,
};
spec.camera={
  position:[-15.15,1.17,-4.10],
  target:[-20.55,.72,-1.38],
  fov:28,
  focusDistance:6.10,
  aperture:.050,
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
  facesPerFrame:1,
};
// Hero daylight shot keeps the physically meaningful snow banks but drops the
// thousands of sub-pixel dressing grains generated for the moving winter demo.
// This is visual LOD, not a different material/lighting path.
spec.entities=spec.entities.filter(entity=>{
  const id=entity.id;
  if(id.startsWith('batch:plough-grit-')||id.startsWith('batch:walk-grain-')||id.startsWith('batch:centre-slush-'))return false;
  // Replace near-road batched snow dressing with two coherent high-resolution
  // banks; the distant roof/window snow stays untouched.
  if(id.startsWith('batch:')&&entity.material?.kind==='snow'&&Math.abs(entity.position?.[2]??99)<8.6)return false;
  return true;
});
spec.entities.push(
  {id:'hero-road-skin',position:[10,.006,0],mesh:{kind:'box',size:[180,.008,7.10]},material:{kind:'asphalt',color:[.028,.031,.036,1],roughness:.68},environmental:{surfaceUse:'road',snowDepthM:0,iceDepthM:0,waterDepthM:.00065}},
  {id:'hero-bank-near',position:[-13,.16,-4.18],mesh:{kind:'snowdrift',size:[62,.42,1.08],seed:4617,segments:96,continuous:true},material:{kind:'snow',color:[.92,.945,.97,1],roughness:.93,texture:{url:'/assets/snow-granular.png',sizeM:1.2,bumpStrength:.4,albedoStrength:.45}}},
  {id:'hero-bank-far',position:[-13,.17,4.12],mesh:{kind:'snowdrift',size:[62,.50,1.22],seed:9121,segments:96,continuous:true},material:{kind:'snow',color:[.92,.945,.97,1],roughness:.93,texture:{url:'/assets/snow-granular.png',sizeM:1.2,bumpStrength:.4,albedoStrength:.45}}},
);
for(const entity of spec.entities){
  if(entity.id.startsWith('passing-contact')&&entity.body)entity.body={...entity.body,velocity:[0,0,0]};
  if(entity.id.startsWith('passing-')&&entity.material?.treatment==='painted'){
    entity.material={...entity.material,color:[.255,.262,.272,1],roughness:.17,metalness:.025};
  }
  if(entity.id==='road'&&entity.environmental){
    entity.environmental={...entity.environmental,snowDepthM:0,iceDepthM:0,waterDepthM:.00055};
    entity.material={...entity.material,color:[.025,.028,.032,1],roughness:.68};
  }
}

export default spec;
