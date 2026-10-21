import {experimentViews} from './experiments.mjs';

export default [
  ...experimentViews,
  {name:'proving-ground-overview',output:'artifacts/proving-ground-overview.png',time:0,camera:{position:[128,96,-150],target:[0,6,20],fov:47,aperture:0}},
  {name:'proving-ground-loop-hill',output:'artifacts/proving-ground-loop-hill.png',time:0,camera:{position:[96,58,8],target:[18,12,70],fov:50,aperture:0}},
  {name:'proving-ground-surfaces-water',output:'artifacts/proving-ground-surfaces-water.png',time:0,camera:{position:[72,42,-112],target:[5,0,-48],fov:48,aperture:0}},
  {name:'proving-ground-split-mu',output:'artifacts/proving-ground-split-mu.png',time:0,camera:{position:[-118,18,-88],target:[-94,0,-54],fov:44,aperture:0}},
  {name:'proving-ground-washboard-articulation',output:'artifacts/proving-ground-washboard-articulation.png',time:0,camera:{position:[-122,28,-4],target:[-83,0,-16],fov:47,aperture:0}},
  {name:'proving-ground-crosswind-tunnel',output:'artifacts/proving-ground-crosswind-tunnel.png',time:0,camera:{position:[124,28,-18],target:[84,4,-18],fov:45,aperture:0}},
  {name:'proving-ground-soft-ground',output:'artifacts/proving-ground-soft-ground.png',time:0,camera:{position:[126,18,-142],target:[97,0,-112],fov:43,aperture:0}},
  {name:'proving-ground-brake-endurance',output:'artifacts/proving-ground-brake-endurance.png',time:0,camera:{position:[-118,42,-120],target:[-150,0,40],fov:52,aperture:0}},
];