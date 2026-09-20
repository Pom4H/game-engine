import {defineScene} from '@rom4/game-engine';

export default defineScene({
  version:1,seed:1408,gravity:[0,-9.81,0],ground:-10,
  environment:{temperatureC:18,humidity:.45,sunlight:.65},
  camera:{position:[4.0,2.6,4.5],target:[0,.7,0],fov:40},
  entities:[
    {id:'slab',position:[0,0,0],mesh:{kind:'box',size:[5,.24,4]},material:{kind:'concrete',finish:'rough'},body:{mass:0,shape:'box'}},
    {id:'wood-block',position:[0,2.25,0],mesh:{kind:'box',size:[.72,.48,.62]},material:{kind:'wood',finish:'rough'},body:{mass:6,restitution:.06,friction:.55}},
  ],
});
