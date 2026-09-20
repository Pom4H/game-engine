import {makeM3Crash,wall} from './m3-crash.mjs';
export default makeM3Crash({
  seed:2106,start:[5.1,0],velocity:[-12,0,0],obstacles:[wall(0)],
  camera:{position:[1.8,2.20,5.7],target:[.45,.72,0],fov:42},
});
