import type {SceneSpec} from './scene/types.js';

export const demoScene:SceneSpec={
  version:1,
  gravity:[0,-9.81,0],
  ground:0,
  clearColor:[0.025,0.035,0.055,1],
  camera:{position:[8,5.5,10],target:[0,1.4,0],fov:52},
  entities:[
    {id:'ground',position:[0,-.03,0],mesh:{kind:'box',size:[16,.06,16]},material:{color:[.14,.16,.18,1]}},
    {id:'box-a',position:[-1.2,4,0],rotation:[0,.25,0],mesh:{kind:'box',size:[1.3,1.3,1.3]},material:{color:[.95,.32,.18,1]},body:{mass:2,restitution:.35}},
    {id:'box-b',position:[.2,2.2,0],rotation:[0,-.2,0],mesh:{kind:'box',size:[1.6,.8,1.1]},material:{color:[.2,.65,.95,1]},body:{mass:3,restitution:.2}},
    {id:'sphere',position:[2.1,5.5,.2],mesh:{kind:'sphere',radius:.7,segments:24},material:{color:[.92,.82,.2,1]},body:{mass:1,velocity:[-1.2,0,0],restitution:.7,shape:'sphere'}},
  ],
};
