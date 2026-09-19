import type {SceneSpec} from '@rom4/game-engine';

export default {
  version:1,
  camera:{position:[7,5,9],target:[0,1,0]},
  entities:[
    {id:'floor',position:[0,-.05,0],mesh:{kind:'box',size:[12,.1,12]},material:{color:[.12,.14,.17,1]}},
    {id:'ball',position:[0,6,0],mesh:{kind:'sphere',radius:.65},body:{mass:1,restitution:.82},material:{color:[1,.35,.15,1]}},
  ],
} satisfies SceneSpec;
