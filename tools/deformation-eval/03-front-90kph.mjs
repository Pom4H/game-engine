import {makeM3Crash,wall} from './m3-crash.mjs';
export default makeM3Crash({
  seed:2103,start:[-5.4,0],velocity:[25,0,0],obstacles:[wall(0)],
  camera:{position:[-1.45,2.25,5.7],target:[-.35,.74,0],fov:42},
});
