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
  position:[-15.65,.92,-4.18],
  target:[-20.15,.79,-1.42],
  fov:34,
  focusDistance:5.25,
  aperture:.012,
};

// Keep the reference car exactly at its authored start pose. Headlights remain on
// because that is material state, not a movie-only animation side effect.
spec.animation={...spec.animation,vehicles:[]};
for(const entity of spec.entities){
  if(entity.id.startsWith('passing-contact')&&entity.body)entity.body={...entity.body,velocity:[0,0,0]};
  if(entity.id.startsWith('passing-')&&entity.material?.treatment==='painted'){
    entity.material={...entity.material,color:[.28,.315,.36,1]};
  }
}

export default spec;
