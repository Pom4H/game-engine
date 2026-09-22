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
  sunColor:[1,.955,.88],
  sunIntensity:3.35,
  skyColor:[.33,.50,.72],
  fogDensity:.00038,
  exposure:1.02,
  shadowExtent:30,
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
  {id:'hero-road-skin',position:[10,.006,0],mesh:{kind:'box',size:[180,.008,7.10]},material:{kind:'asphalt',color:[.034,.037,.041,1],roughness:.74},environmental:{surfaceUse:'road',snowDepthM:0,iceDepthM:0,waterDepthM:.00030}},
  {id:'hero-bank-near',position:[-13,.18,-4.18],mesh:{kind:'snowdrift',size:[62,.48,1.08],seed:4617,segments:72,continuous:true},material:{kind:'snow',color:[.92,.945,.97,1],roughness:.93}},
  {id:'hero-bank-far',position:[-13,.18,4.12],mesh:{kind:'snowdrift',size:[62,.56,1.22],seed:9121,segments:72,continuous:true},material:{kind:'snow',color:[.92,.945,.97,1],roughness:.93}},
);
for(const entity of spec.entities){
  if(entity.id.startsWith('passing-contact')&&entity.body)entity.body={...entity.body,velocity:[0,0,0]};
  if(entity.id.startsWith('passing-')&&entity.material?.treatment==='painted'){
    entity.material={...entity.material,color:[.245,.248,.255,1],roughness:.125,metalness:.035};
  }
  if(entity.id==='road'&&entity.environmental){
    entity.environmental={...entity.environmental,snowDepthM:0,iceDepthM:0,waterDepthM:.00026};
    entity.material={...entity.material,color:[.031,.034,.038,1],roughness:.76};
  }
}

export default spec;
