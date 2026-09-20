import {makeM3Crash,wall} from './m3-crash.mjs';
export default makeM3Crash({
  seed:2101,start:[-5.0,0],velocity:[5,0,0],obstacles:[wall(0)],
  camera:{position:[-1.8,2.15,5.9],target:[-.55,.74,0],fov:42},
});
