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
  sunIntensity:3.02,
  skyColor:[.29,.45,.70],
  fogDensity:.00020,
  exposure:1.10,
  shadowExtent:30,
};
spec.camera={
  position:[-15.62,.96,-3.78],
  target:[-20.38,.64,-1.38],
  fov:32,
  focusDistance:5.55,
  aperture:.025,
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
  {id:'hero-road-skin',position:[10,.006,0],mesh:{kind:'box',size:[180,.008,7.10]},material:{kind:'asphalt',color:[.225,.232,.242,1],roughness:.70},environmental:{surfaceUse:'road',snowDepthM:.0015,iceDepthM:.00060,waterDepthM:.00072}},
);
const heroSnowMaterial={kind:'snow',color:[.962,.973,.985,1],roughness:.85,texture:{url:'/assets/snow-granular.png',sizeM:.26,bumpStrength:.26,albedoStrength:.22}};
for(const bank of [
  {id:'near',z:-4.18,y:.115,height:.34,width:1.04,seed:4617},
  {id:'far',z:4.12,y:.13,height:.40,width:1.16,seed:9121},
]){
  const tile=5.2,start=-44,end=18;
  for(let x=start+tile/2,index=0;x<end;x+=tile,index++)spec.entities.push({
    id:`hero-bank-${bank.id}-${index}`,
    position:[x,bank.y,bank.z],
    mesh:{kind:'snowdrift',size:[tile,bank.height,bank.width],seed:bank.seed,segments:40,continuous:true,offset:x},
    material:heroSnowMaterial,
  });
}
for(const entity of spec.entities){
  if(entity.id.startsWith('passing-contact')&&entity.body)entity.body={...entity.body,velocity:[0,0,0]};
  if(entity.id.startsWith('passing-')&&entity.material?.treatment==='painted'){
    entity.material={...entity.material,color:[.265,.272,.282,1],roughness:.185,metalness:.02};
  }
  if(entity.id==='road'&&entity.environmental){
    entity.environmental={...entity.environmental,snowDepthM:.0015,iceDepthM:.00060,waterDepthM:.00072};
    entity.material={...entity.material,color:[.225,.232,.242,1],roughness:.71};
  }
  if(entity.id.includes('lamp')&&entity.id.endsWith('-glow')){
    if(entity.light)entity.light={...entity.light,intensity:.15,range:8};
    entity.material={...entity.material,emissive:[.08,.055,.025]};
  }
  if(entity.material?.pattern==='plaster'){
    entity.material={...entity.material,pattern:'brick',color:[.74,.67,.61,1],roughness:.88,texture:{url:'/assets/brick-weathered.png',sizeM:1.42,bumpStrength:.34,albedoStrength:.92}};
  }
}

export default spec;
