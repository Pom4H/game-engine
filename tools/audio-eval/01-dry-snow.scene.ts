import {defineScene} from '@rom4/game-engine';

export default defineScene({
  version:1,
  seed:1101,
  ground:-10,
  environment:{temperatureC:-14,humidity:.42,precipitation:'rare',snowfall:'none',sunlight:.08,wind:[0,0,0],groundMoisture:.25},
  rendering:{sunDirection:[-.5,.7,-.2],sunIntensity:.7,exposure:1.1},
  camera:{position:[0,1.65,5.2],target:[0,.48,0],fov:42},
  entities:[
    {id:'path',position:[0,.02,0],mesh:{kind:'box',size:[10,.12,4]},material:{kind:'concrete',finish:'rough'},environmental:{surfaceUse:'generic',snowDepthM:.10}},
    {id:'torso',mesh:{kind:'box',size:[.38,.7,.28]},material:{kind:'default',color:[.18,.22,.28,1]}},
    {id:'head',mesh:{kind:'sphere',radius:.14,segments:16},material:{kind:'default',color:[.72,.58,.48,1]}},
    {id:'left-boot',mesh:{kind:'box',size:[.28,.12,.15]},material:{kind:'default',color:[.035,.04,.045,1]}},
    {id:'right-boot',mesh:{kind:'box',size:[.28,.12,.15]},material:{kind:'default',color:[.035,.04,.045,1]}},
  ],
  animation:{walkers:[{id:'walker',root:[-3,.08,0],speed:1.0,period:1.15,bindings:[
    {entity:'torso',joint:'chest'},{entity:'head',joint:'head'},
    {entity:'left-boot',joint:'leftFoot',foot:'left',offset:[.08,.055,0]},
    {entity:'right-boot',joint:'rightFoot',foot:'right',offset:[.08,.055,0]},
  ]}]},
  surfaceContacts:{snow:[{surfaceId:'path',maxTiles:24,maxDetailedTiles:8}]},
});
