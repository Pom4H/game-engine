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
  sunDirection:[.36,.84,-.40],
  sunColor:[1,.98,.94],
  sunIntensity:2.78,
  skyColor:[.29,.45,.70],
  fogDensity:.00022,
  exposure:1.06,
  shadowExtent:30,
};
spec.camera={
  position:[-14.55,1.02,-4.08],
  target:[-20.48,.66,-1.38],
  fov:32,
  focusDistance:6.35,
  aperture:.032,
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
  if(id.startsWith('batch:plough-grit-')||id.startsWith('batch:walk-grain-')||id.startsWith('batch:centre-slush-')||id.startsWith('puddle'))return false;
  // Replace near-road batched snow dressing with two coherent high-resolution
  // banks; the distant roof/window snow stays untouched.
  if(id.startsWith('batch:')&&entity.material?.kind==='snow'&&Math.abs(entity.position?.[2]??99)<8.6)return false;
  return true;
});
spec.entities.push(
  {id:'hero-road-skin',position:[10,.006,0],mesh:{kind:'box',size:[180,.008,7.10]},material:{kind:'asphalt',color:[.145,.150,.158,1],roughness:.71},environmental:{surfaceUse:'road',snowDepthM:.0012,iceDepthM:.00055,waterDepthM:.00052}},
  {id:'hero-bank-near',position:[-13,.13,-4.18],mesh:{kind:'snowdrift',size:[62,.34,1.04],seed:4617,segments:64,continuous:true},material:{kind:'snow',color:[.955,.968,.98,1],roughness:.86,texture:{url:'/assets/snow-granular.png',sizeM:.30,bumpStrength:.24,albedoStrength:.24}}},
  {id:'hero-bank-far',position:[-13,.145,4.12],mesh:{kind:'snowdrift',size:[62,.40,1.16],seed:9121,segments:64,continuous:true},material:{kind:'snow',color:[.955,.968,.98,1],roughness:.86,texture:{url:'/assets/snow-granular.png',sizeM:.30,bumpStrength:.24,albedoStrength:.24}}},
);
for(const entity of spec.entities){
  if(entity.id.startsWith('passing-contact')&&entity.body)entity.body={...entity.body,velocity:[0,0,0]};
  if(entity.id.startsWith('passing-')&&entity.material?.treatment==='painted'){
    entity.material={...entity.material,color:[.265,.272,.282,1],roughness:.185,metalness:.02};
  }
  if(entity.id==='road'&&entity.environmental){
    entity.environmental={...entity.environmental,snowDepthM:.0012,iceDepthM:.00055,waterDepthM:.00052};
    entity.material={...entity.material,color:[.145,.150,.158,1],roughness:.71};
  }
  if(entity.id.includes('lamp')&&entity.id.endsWith('-glow')){
    if(entity.light)entity.light={...entity.light,intensity:.15,range:8};
    entity.material={...entity.material,emissive:[.08,.055,.025]};
  }
  if(entity.material?.pattern==='plaster'){
    const [r,g,b,a]=entity.material.color,l=r*.299+g*.587+b*.114;
    entity.material={...entity.material,color:[l+(r-l)*.48,l+(g-l)*.48,l+(b-l)*.48,a],roughness:Math.max(.86,entity.material.roughness??.9)};
  }
}

export default spec;
