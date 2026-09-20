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
  sunDirection:[-.42,.74,-.52],
  sunColor:[1,.93,.82],
  sunIntensity:4.9,
  skyColor:[.24,.46,.78],
  fogDensity:.00055,
  exposure:1.03,
  shadowExtent:30,
};
spec.camera={
  position:[-15.72,.80,-3.38],
  target:[-20.05,.76,-1.42],
  fov:30,
  focusDistance:4.8,
  aperture:.010,
};

// Keep the reference car exactly at its authored start pose. Headlights remain on
// because that is material state, not a movie-only animation side effect.
spec.animation={...spec.animation,vehicles:[]};
for(const entity of spec.entities){
  if(entity.id.startsWith('passing-contact')&&entity.body)entity.body={...entity.body,velocity:[0,0,0]};
  if(entity.id.startsWith('passing-')&&entity.material?.treatment==='painted'){
    entity.material={...entity.material,color:[.30,.31,.33,1]};
  }
  if(entity.id==='road'&&entity.environmental){
    entity.environmental={...entity.environmental,snowDepthM:.00035,iceDepthM:.00008,waterDepthM:.0028};
    entity.material={...entity.material,color:[.075,.078,.082,1],roughness:.74};
  }
}

export default spec;
