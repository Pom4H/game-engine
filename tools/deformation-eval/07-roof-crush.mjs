import {makeM3Crash} from './m3-crash.mjs';
export default makeM3Crash({
  seed:2107,start:[0,0],velocity:[0,0,0],
  camera:{position:[4.5,2.85,5.0],target:[0,.85,0],fov:40},
  extra:[{
    id:'roof-press',position:[0,3.2,0],mesh:{kind:'box',size:[1.6,.42,1.35]},
    material:{kind:'default',color:[.29,.30,.32,1],metalness:.25,roughness:.55},
    body:{mass:850,velocity:[0,-8,0],restitution:0,friction:.8},
  }],
});
