import {defineScene} from '@rom4/game-engine';

export default defineScene({
  version:1,seed:1204,gravity:[0,0,0],ground:-10,
  environment:{temperatureC:20,humidity:.45,sunlight:.65},
  camera:{position:[3.2,2.2,4.8],target:[0,1,0],fov:38},
  entities:[
    {id:'floor',position:[0,-.08,0],mesh:{kind:'box',size:[7,.16,6]},material:{kind:'concrete',finish:'rough'}},
    {id:'panel',position:[0,1,0],mesh:{kind:'box',size:[2.2,1.5,.018]},material:{kind:'steel',finish:'smooth'},body:{mass:0,shape:'box'}},
    {id:'hammer',position:[0,1,2.5],mesh:{kind:'sphere',radius:.14,segments:24},material:{kind:'steel'},body:{mass:5,velocity:[0,0,-7.0],restitution:.02}},
  ],
});
