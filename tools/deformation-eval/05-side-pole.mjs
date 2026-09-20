import {makeM3Crash,pole} from './m3-crash.mjs';
export default makeM3Crash({
  seed:2105,start:[0,4.2],velocity:[0,0,-13],obstacles:[pole(0,0)],
  camera:{position:[5.0,2.35,4.6],target:[0,.72,.25],fov:40},
});
