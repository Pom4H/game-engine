const target=[-20.55,.72,-1.38];
const optics={fov:30,focusDistance:6.2,aperture:.06};

export default [
  {name:'front',output:'artifacts/render2.png',camera:{...optics,position:[-14.2,1.05,-1.38],target}},
  {name:'rear',output:'artifacts/render3.png',camera:{...optics,position:[-26.9,1.05,-1.38],target}},
  {name:'left',output:'artifacts/render4.png',camera:{...optics,position:[-20.55,1.05,-8.35],target}},
  {name:'right',output:'artifacts/render5.png',camera:{...optics,position:[-20.55,1.05,5.55],target}},
];
