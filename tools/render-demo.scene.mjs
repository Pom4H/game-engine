import {generateM3Vehicle,m3PartMaterial} from '/dist/index.js';

const m3=generateM3Vehicle();
const entities=[];

const add=(id,position,mesh,material,extra={})=>{
  entities.push({id,position,mesh,material,...extra});
};

add('ground',[0,-0.08,0],{kind:'plane',size:[34,28]},
  {kind:'asphalt',color:[.035,.042,.050,1],roughness:.58,metalness:.04},
  {environmental:{surfaceUse:'road',waterDepthM:.0018,snowDepthM:0,iceDepthM:0}});

add('display-plinth',[0,0.025,0],{kind:'box',size:[8.8,.14,5.6]},
  {color:[.095,.105,.115,1],roughness:.32,metalness:.28,clearcoat:.55,clearcoatRoughness:.12});

add('back-wall',[-1.8,2.8,-5.8],{kind:'box',size:[15,6,.18]},
  {color:[.055,.062,.072,1],roughness:.72,metalness:.04});

add('back-floor',[-1.8,.01,-2.6],{kind:'box',size:[15,.025,7]},
  {kind:'asphalt',color:[.022,.028,.035,1],roughness:.28,metalness:.12});

for(const [side,z] of [['left',-3.8],['right',3.8]]){
  add('snow-bank-'+side,[0,.20,z],{kind:'snowdrift',size:[18,.48,1.05],seed:side==='left'?4617:9121,segments:72,continuous:true},
    {kind:'snow',color:[.86,.89,.94,1],roughness:.91});
}

const lightBar=(id,p,color,intensity)=>{
  add(id,p,{kind:'box',size:[4.8,.07,.30]},
    {color:[.72,.76,.82,1],roughness:.18,metalness:.12,emissive:color},
    {light:{kind:'point',color,intensity,range:10}});
};
lightBar('key-light',[-.8,4.9,1.9],[.52,.66,.95],42);
lightBar('fill-light',[-.5,3.7,-2.4],[.24,.34,.55],26);

const heroPosition=[0,.18,0];
for(const part of m3.parts){
  const material=m3PartMaterial(part,[.46,.012,.008,1],true);
  add('hero-'+part.id,
    [heroPosition[0]+part.position[0],heroPosition[1]+part.position[1],heroPosition[2]+part.position[2]],
    part.mesh,
    material,
    {
      rotation:part.rotation??[0,0,0],
      scale:part.scale??[1,1,1],
      wheel:part.wheel,
    });
}

add('headlight-L',[2.34,.82,.54],{kind:'box',size:[.035,.18,.32]},
  {color:[.72,.82,.95,1],roughness:.08,metalness:.45,emissive:[1.2,.82,.45]},
  {light:{kind:'point',color:[1,.72,.42],intensity:18,range:6}});
add('headlight-R',[2.34,.82,-.54],{kind:'box',size:[.035,.18,.32]},
  {color:[.72,.82,.95,1],roughness:.08,metalness:.45,emissive:[1.2,.82,.45]},
  {light:{kind:'point',color:[1,.72,.42],intensity:18,range:6}});

export const scene={
  version:1,
  seed:20260927,
  gravity:[0,-9.81,0],
  ground:0,
  clearColor:[.012,.018,.028,1],
  camera:{position:[6.5,2.15,5.7],target:[0,.88,0],fov:31,focusDistance:7.2,aperture:.045},
  rendering:{
    sunDirection:[-.42,-.78,-.34],
    sunColor:[1,.91,.78],
    sunIntensity:3.6,
    skyColor:[.12,.18,.28],
    exposure:1.0,
    shadowExtent:30,
    fogDensity:.0018,
    reflectionProbe:{entity:'hero-body',offset:[0,.88,0],radius:28,exclude:[],facesPerFrame:1},
  },
  entities,
};

if(typeof window!=='undefined'){
  try{
    const {BrowserRuntime}=await import('/dist/browser.js');
    const canvas=document.getElementById('c');
    canvas.width=innerWidth;canvas.height=innerHeight;
    const runtime=await BrowserRuntime.create(canvas,scene,{autoplay:false,audio:false,exposeBridge:true});
    globalThis.__CAPTURE__=()=>runtime.capture('image/png');
    document.documentElement.dataset.engineReady='1';
  }catch(error){window.__ENGINE_ERROR__=error?.stack??String(error);throw error}
}
