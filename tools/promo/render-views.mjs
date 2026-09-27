const target=[-20.55,.72,-1.38];
const optics={fov:30,focusDistance:6.2,aperture:.06};

// Four true 45° three-quarter views: the reflection is visible across both
// the front/rear fascia and the side panels instead of being edge-on.
export default [
  {name:'front-left',output:'artifacts/render10.png',camera:{...optics,position:[-16.06,1.05,-5.87],target}},
  {name:'rear-left',output:'artifacts/render11.png',camera:{...optics,position:[-25.04,1.05,-5.87],target}},
  {name:'rear-right',output:'artifacts/render12.png',camera:{...optics,position:[-25.04,1.05,3.11],target}},
  {name:'front-right',output:'artifacts/render13.png',camera:{...optics,position:[-16.06,1.05,3.11],target}},
];
