import {makeM3Crash,narrowBlock} from './m3-crash.mjs';
export default makeM3Crash({
  seed:2104,start:[-5.2,0],velocity:[16,0,0],obstacles:[narrowBlock(0,.63)],
  camera:{position:[-1.7,2.25,5.6],target:[-.25,.72,.35],fov:40},
});
