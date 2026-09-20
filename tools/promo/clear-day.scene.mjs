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
  sunDirection:[-.36,.79,-.49],
  sunColor:[1,.955,.88],
  sunIntensity:4.45,
  skyColor:[.31,.53,.82],
  fogDensity:.00038,
  exposure:.94,
  shadowExtent:30,
};
spec.camera={
  position:[-15.76,1.33,-3.82],
  target:[-20.16,.77,-1.42],
  fov:29.5,
  focusDistance:5.05,
  aperture:.006,
};

// Keep the reference car exactly at its authored start pose. Headlights remain on
// because that is material state, not a movie-only animation side effect.
spec.animation={...spec.animation,vehicles:[]};
for(const entity of spec.entities){
  if(entity.id.startsWith('passing-contact')&&entity.body)entity.body={...entity.body,velocity:[0,0,0]};
  if(entity.id.startsWith('passing-')&&entity.material?.treatment==='painted'){
    entity.material={...entity.material,color:[.36,.37,.39,1],roughness:.115,metalness:.06};
  }
  if(entity.id==='road'&&entity.environmental){
    entity.environmental={...entity.environmental,snowDepthM:.00018,iceDepthM:.00016,waterDepthM:.0034};
    entity.material={...entity.material,color:[.060,.064,.070,1],roughness:.69};
  }
}

export default spec;
