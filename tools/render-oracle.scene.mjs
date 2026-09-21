import {defineScene} from '@rom4/game-engine';

const norm=v=>{const l=Math.hypot(...v)||1;return v.map(x=>x/l);};
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const quad=(cx,cy,w=.46,h=.46,z=0)=>({
  kind:'triangle-mesh',
  positions:[
    cx-w/2,cy-h/2,z, cx+w/2,cy-h/2,z,
    cx+w/2,cy+h/2,z, cx-w/2,cy+h/2,z,
  ],
  normals:[0,0,1, 0,0,1, 0,0,1, 0,0,1],
  indices:[0,1,2,0,2,3],
});
const orientedQuad=(center,normal,w=.32,h=.32)=>{
  const n=norm(normal),t=norm(cross([0,1,0],n)),b=norm(cross(n,t));
  const corner=(sx,sy)=>[
    center[0]+t[0]*sx*w/2+b[0]*sy*h/2,
    center[1]+t[1]*sx*w/2+b[1]*sy*h/2,
    center[2]+t[2]*sx*w/2+b[2]*sy*h/2,
  ];
  const p=[corner(-1,-1),corner(1,-1),corner(1,1),corner(-1,1)];
  return{kind:'triangle-mesh',positions:p.flat(),normals:[...n,...n,...n,...n],indices:[0,1,2,0,2,3]};
};

const camera={position:[0,0,20],target:[0,0,0],fov:8};
const point=(id,x,y,z=0,stage='hdr')=>({id,world:[x,y,z],stage});
const black=[0,0,0,1];
const matte=color=>({kind:'default',color,roughness:1,metalness:0,clearcoat:0});

export const oracle=Object.freeze({
  width:256,
  height:144,
  camera,
  points:Object.freeze([
    point('bounce-receiver',-1.70,1.05,0,'effects'),
    point('bounce-control',-.55,1.05,0,'effects'),
    point('mirror-target',1.05,1.02),
    point('mirror-control',1.65,1.02),

    point('reflection-black',-.82,.52,0,'reflection'),
    point('reflection-gray',0,.52,0,'reflection'),
    point('reflection-white',.82,.52,0,'reflection'),
    point('reflection-emission-off',-1.70,1.05,0,'reflection'),
    point('reflection-emission-on',-1.28,1.05,.22,'reflection'),

    point('diffuse-black',-.82,.52),
    point('diffuse-gray',0,.52),
    point('diffuse-white',.82,.52),

    point('specular-rough',-1.15,-.18),
    point('emission-off',-.35,-.18),
    point('emission-on',.35,-.18),
    point('specular-smooth',1.15,-.18),

    point('glass-front',-1.95,-.92),
    point('coat-off',-.35,-.92),
    point('coat-on',.35,-.92),
    point('glass-grazing',1.95,-.92),

    point('shadow-lit',-.70,-1.22),
    point('shadowed',.70,-1.22),
    point('shadow-edge',.742,-1.22),
    point('shadow-outside',.760,-1.22),
  ]),
  contracts:Object.freeze([
    {kind:'delta',id:'emission-delta',a:'emission-off',b:'emission-on',expected:[.25,.50,1.0],tolerance:.025},
    {kind:'ratio',id:'diffuse-linear-response',black:'diffuse-black',mid:'diffuse-gray',white:'diffuse-white',expected:Math.pow(.5,2.2),tolerance:.045},
    {kind:'ratio',id:'reflection-diffuse-linear-response',black:'reflection-black',mid:'reflection-gray',white:'reflection-white',expected:Math.pow(.5,2.2),tolerance:.045},
    {kind:'delta',id:'reflection-emission-delta',a:'reflection-emission-off',b:'reflection-emission-on',expected:[4,.08,.02],tolerance:.06},
    {kind:'gain',id:'roughness-specular-gain',low:'specular-rough',high:'specular-smooth',minimum:40},
    {kind:'difference',id:'clearcoat-highlight-gain',low:'coat-off',high:'coat-on',minimum:.015},
    {kind:'rangeRatio',id:'glass-fresnel-transmission',low:'glass-grazing',high:'glass-front',minimum:.45,maximum:.98},
    {kind:'rangeRatio',id:'directional-shadow-visibility',low:'shadowed',high:'shadow-lit',minimum:0,maximum:.30},
    {kind:'rangeRatio',id:'directional-shadow-penumbra',low:'shadow-edge',high:'shadow-lit',minimum:.12,maximum:.88},
    {kind:'rangeRatio',id:'directional-shadow-outside',low:'shadow-outside',high:'shadow-lit',minimum:.82,maximum:1.12},
    {kind:'channelDominance',id:'mirror-probe-red',sample:'mirror-target',channel:0,minimum:3},
    {kind:'channelGain',id:'mirror-directed-reflection',low:'mirror-control',high:'mirror-target',channel:0,minimum:2},
    {kind:'channelDifference',id:'indirect-red-bounce',low:'bounce-control',high:'bounce-receiver',channel:0,minimum:.035},
  ]),
});

const glass={kind:'glass',color:[0,0,0,.4],roughness:.4,metalness:0};
const mirror={kind:'mirror',color:black,roughness:.02,metalness:.94};

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
    reflectionProbe:{position:[0,0,0],radius:8,facesPerFrame:6,exclude:['mirror-target','mirror-control']},
  },
  entities:[
    // Screen-space indirect transport: only the left black receiver has a red
    // emitter exactly one 0.42 m GI sample ring away and slightly toward camera.
    {id:'bounce-receiver',position:[0,0,0],mesh:quad(-1.70,1.05,.22,.22),material:matte(black)},
    {id:'bounce-emitter',position:[0,0,0],mesh:quad(-1.28,1.05,.18,.18,.22),material:{kind:'default',color:black,roughness:1,metalness:0,emissive:[4,.08,.02]}},
    {id:'bounce-control',position:[0,0,0],mesh:quad(-.55,1.05,.22,.22),material:matte(black)},

    // The target mirror normal is the bisector that reflects the camera ray into
    // the +Z/+X probe texel containing mirror-source. The control faces +Z.
    {id:'mirror-target',position:[1.05,1.02,0],mesh:orientedQuad([0,0,0],[.21924,.08770,.97170],.28,.28),material:mirror},
    {id:'mirror-control',position:[1.65,1.02,0],mesh:orientedQuad([0,0,0],[0,0,1],.28,.28),material:mirror},
    {id:'mirror-source',position:[2.20,1.02,4],mesh:orientedQuad([0,0,0],[0,0,-1],.8,.8),material:{kind:'default',color:black,roughness:1,metalness:0,emissive:[4,.05,.02]}},

    {id:'diffuse-black',position:[0,0,0],mesh:quad(-.82,.52),material:matte([0,0,0,1])},
    {id:'diffuse-gray',position:[0,0,0],mesh:quad(0,.52),material:matte([.5,.5,.5,1])},
    {id:'diffuse-white',position:[0,0,0],mesh:quad(.82,.52),material:matte([1,1,1,1])},

    {id:'specular-rough',position:[0,0,0],mesh:quad(-1.15,-.18),material:{kind:'default',color:black,roughness:1,metalness:0,clearcoat:0}},
    {id:'emission-off',position:[0,0,0],mesh:quad(-.35,-.18),material:{kind:'default',color:black,roughness:1,metalness:0,clearcoat:0}},
    {id:'emission-on',position:[0,0,0],mesh:quad(.35,-.18),material:{kind:'default',color:black,roughness:1,metalness:0,clearcoat:0,emissive:[.25,.50,1]}},
    {id:'specular-smooth',position:[0,0,0],mesh:quad(1.15,-.18),material:{kind:'default',color:black,roughness:.1,metalness:0,clearcoat:0}},

    // White emissive cards isolate transmitted radiance. The grazing pane has a
    // 75° optical normal so Fresnel must reduce the visible background.
    {id:'glass-front-bg',position:[0,0,0],mesh:quad(-1.95,-.92,.52,.52,-.30),material:{kind:'default',color:black,roughness:1,metalness:0,emissive:[1,1,1]}},
    {id:'glass-front',position:[0,0,0],mesh:orientedQuad([-1.95,-.92,0],[0,0,1],.34,.34),material:glass},
    {id:'coat-off',position:[0,0,0],mesh:quad(-.35,-.92),material:{kind:'default',color:[.05,.05,.05,1],roughness:.42,metalness:0,clearcoat:0}},
    {id:'coat-on',position:[0,0,0],mesh:quad(.35,-.92),material:{kind:'default',color:[.05,.05,.05,1],roughness:.42,metalness:0,clearcoat:1,clearcoatRoughness:.05}},
    {id:'glass-grazing-bg',position:[0,0,0],mesh:quad(1.95,-.92,.52,.52,-.30),material:{kind:'default',color:black,roughness:1,metalness:0,emissive:[1,1,1]}},
    {id:'glass-grazing',position:[0,0,0],mesh:orientedQuad([1.95,-.92,0],[.965925826,0,.258819045],.34,.34),material:glass},

    // Sun and camera are both +Z. Perspective lets this tiny blocker sit on the
    // sun ray to the receiver while the camera ray passes beside it.
    {id:'shadow-lit',position:[0,0,0],mesh:quad(-.70,-1.22,.20,.18),material:matte([1,1,1,1])},
    {id:'shadowed',position:[0,0,0],mesh:quad(.70,-1.22,.20,.18),material:matte([1,1,1,1])},
    {id:'shadow-blocker',position:[.70,-1.22,3],mesh:{kind:'box',size:[.07,.07,.07]},material:matte(black),body:{motion:'kinematic'}},
  ],
});
