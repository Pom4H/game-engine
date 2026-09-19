import {defineScene} from '@rom4/game-engine';

const thickness=[.01,.015,.02,.03,.04,.06,.08,.11,.15,.20];

export default defineScene({
  version:1,
  seed:19,
  gravity:[0,-9.81,0],
  ground:0,
  clearColor:[.018,.024,.035,1],
  camera:{position:[-4.5,4.2,9],target:[8,1.2,0],fov:38},
  entities:[
    ...thickness.map((value,index)=>({
      id:`window-${index+1}`,
      position:[index*1.8,1.2,0] as const,
      mesh:{kind:'box' as const,size:[value,2,1.5] as const},
      material:{kind:'glass' as const},
    })),
    {
      id:'ball',
      position:[-4,1.2,0],
      mesh:{kind:'sphere',radius:.11,segments:28},
      material:{kind:'steel'},
      body:{mass:3.8,velocity:[55,0,0]},
    },
  ],
});
