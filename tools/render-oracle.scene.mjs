import {defineScene} from '@rom4/game-engine';

const quad=(cx,cy,w=.46,h=.46,z=0)=>({
  kind:'triangle-mesh',
  positions:[
    cx-w/2,cy-h/2,z, cx+w/2,cy-h/2,z,
    cx+w/2,cy+h/2,z, cx-w/2,cy+h/2,z,
  ],
  normals:[0,0,1, 0,0,1, 0,0,1, 0,0,1],
  indices:[0,1,2,0,2,3],
});

const camera={position:[0,0,20],target:[0,0,0],fov:8};
const point=(id,x,y)=>({id,world:[x,y,0]});

export const oracle=Object.freeze({
  width:256,
  height:144,
  camera,
  points:Object.freeze([
    point('diffuse-black',-.82,.52),
    point('diffuse-gray',0,.52),
    point('diffuse-white',.82,.52),
    point('specular-rough',-1.15,-.18),
    point('emission-off',-.35,-.18),
    point('emission-on',.35,-.18),
    point('specular-smooth',1.15,-.18),
    point('coat-off',-.35,-.92),
    point('coat-on',.35,-.92),
  ]),
  contracts:Object.freeze([
    {kind:'delta',id:'emission-delta',a:'emission-off',b:'emission-on',expected:[.25,.50,1.0],tolerance:.025},
    {kind:'ratio',id:'diffuse-linear-response',black:'diffuse-black',mid:'diffuse-gray',white:'diffuse-white',expected:Math.pow(.5,2.2),tolerance:.045},
    {kind:'gain',id:'roughness-specular-gain',low:'specular-rough',high:'specular-smooth',minimum:40},
    {kind:'difference',id:'clearcoat-highlight-gain',low:'coat-off',high:'coat-on',minimum:.015},
  ]),
});

const matte=color=>({kind:'default',color,roughness:1,metalness:0,clearcoat:0});
const black=[0,0,0,1];

export default defineScene({
  version:1,
  seed:1,
  gravity:[0,0,0],
  ground:-100,
  environment:{humidity:0,temperatureC:20,precipitation:'rare',sunlight:1,wind:[0,0,0],groundMoisture:0},
  camera,
  rendering:{
    sunDirection:[0,0,1],
    sunColor:[1,1,1],
    sunIntensity:1,
    skyColor:[0,0,0],
    fogDensity:0,
    exposure:1,
    shadowExtent:8,
  },
  entities:[
    {id:'diffuse-black',position:[0,0,0],mesh:quad(-.82,.52),material:matte([0,0,0,1])},
    {id:'diffuse-gray',position:[0,0,0],mesh:quad(0,.52),material:matte([.5,.5,.5,1])},
    {id:'diffuse-white',position:[0,0,0],mesh:quad(.82,.52),material:matte([1,1,1,1])},
    {id:'specular-rough',position:[0,0,0],mesh:quad(-1.15,-.18),material:{kind:'default',color:black,roughness:1,metalness:0,clearcoat:0}},
    {id:'emission-off',position:[0,0,0],mesh:quad(-.35,-.18),material:{kind:'default',color:black,roughness:1,metalness:0,clearcoat:0}},
    {id:'emission-on',position:[0,0,0],mesh:quad(.35,-.18),material:{kind:'default',color:black,roughness:1,metalness:0,clearcoat:0,emissive:[.25,.50,1]}},
    {id:'specular-smooth',position:[0,0,0],mesh:quad(1.15,-.18),material:{kind:'default',color:black,roughness:.1,metalness:0,clearcoat:0}},
    {id:'coat-off',position:[0,0,0],mesh:quad(-.35,-.92),material:{kind:'default',color:[.05,.05,.05,1],roughness:.42,metalness:0,clearcoat:0}},
    {id:'coat-on',position:[0,0,0],mesh:quad(.35,-.92),material:{kind:'default',color:[.05,.05,.05,1],roughness:.42,metalness:0,clearcoat:1,clearcoatRoughness:.05}},
  ],
});
