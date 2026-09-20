import {defineScene} from '@rom4/game-engine';

export default defineScene({
  version:1,seed:1305,gravity:[0,0,0],ground:-10,
  environment:{temperatureC:20,humidity:.45,sunlight:.7},
  camera:{position:[3.0,2.0,4.6],target:[0,1,0],fov:38},
  entities:[
    {id:'floor',position:[0,-.08,0],mesh:{kind:'box',size:[7,.16,6]},material:{kind:'concrete'}},
    {id:'glass',position:[0,1,0],mesh:{kind:'box',size:[2.0,1.55,.012]},material:{kind:'glass'},body:{mass:0,shape:'box'}},
    {id:'tap',position:[0,1,2.0],mesh:{kind:'sphere',radius:.055,segments:20},material:{kind:'wood'},body:{mass:.10,velocity:[0,0,-2.0],restitution:.08}},
  ],
});
