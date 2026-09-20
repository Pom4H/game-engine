import {defineScene} from '@rom4/game-engine';

export default defineScene({
  version:1,seed:1409,gravity:[0,-9.81,0],ground:-10,
  environment:{temperatureC:18,humidity:.45,sunlight:.65},
  camera:{position:[3.0,2.3,3.8],target:[0,.5,0],fov:40},
  entities:[
    {id:'slab',position:[0,0,0],mesh:{kind:'box',size:[5,.24,4]},material:{kind:'concrete',finish:'rough'},body:{mass:0,shape:'box'}},
    // 0.52 × 0.52 × 0.006 m × 7850 kg/m³ ≈ 12.7 kg.
    {id:'steel-plate',position:[0,2.1,0],mesh:{kind:'box',size:[.52,.006,.52]},material:{kind:'steel',finish:'smooth'},body:{mass:12.7,restitution:.04,friction:.45}},
  ],
});
