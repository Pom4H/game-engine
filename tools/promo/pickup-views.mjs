const target=[-20.55,.82,-1.38];
const optics={fov:31,focusDistance:6.4,aperture:.055};
export default [
  {name:'pickup-front-left',output:'artifacts/pickup-front-left.png',camera:{...optics,position:[-15.70,1.22,-6.23],target}},
  {name:'pickup-rear-right',output:'artifacts/pickup-rear-right.png',camera:{...optics,position:[-25.40,1.22,3.47],target}},
];
