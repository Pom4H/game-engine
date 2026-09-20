import {defineScene} from '@rom4/game-engine';

export default defineScene({
  version:1,seed:1408,gravity:[0,-9.81,0],ground:-10,
  environment:{temperatureC:18,humidity:.45,sunlight:.65},
  camera:{position:[3.2,2.4,4.0],target:[0,.55,0],fov:40},
  entities:[
    {id:'slab',position:[0,0,0],mesh:{kind:'box',size:[5,.24,4]},material:{kind:'concrete',finish:'rough'},body:{mass:0,shape:'box'}},
    // 0.72 × 0.62 × 0.021 m × ~650 kg/m³ ≈ 6.1 kg.
    {id:'wood-board',position:[0,2.1,0],mesh:{kind:'box',size:[.72,.021,.62]},material:{kind:'wood',finish:'rough'},body:{mass:6.1,restitution:.035,friction:.55}},
  ],
});
