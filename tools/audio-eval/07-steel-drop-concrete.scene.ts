import {defineScene} from '@rom4/game-engine';

export default defineScene({
  version:1,seed:1407,gravity:[0,-9.81,0],ground:-10,
  environment:{temperatureC:18,humidity:.45,sunlight:.65},
  camera:{position:[2.4,1.8,3.2],target:[0,.35,0],fov:38},
  entities:[
    {id:'slab',position:[0,0,0],mesh:{kind:'box',size:[4,.24,3]},material:{kind:'concrete',finish:'rough'},body:{mass:0,shape:'box'}},
    // 12 kg / 7850 kg/m³ => ~0.00153 m³ => ~0.115 m solid cube.
    {id:'steel-block',position:[0,1.8,0],mesh:{kind:'box',size:[.115,.115,.115]},material:{kind:'steel'},body:{mass:12,restitution:.05,friction:.45}},
  ],
});
