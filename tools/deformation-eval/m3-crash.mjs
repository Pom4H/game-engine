import {readFileSync} from 'node:fs';
import {makeM3} from '../promo/actors.mjs';

const asset=JSON.parse(readFileSync(new URL('../promo/assets/m3.json',import.meta.url),'utf8'));
const noPlasticMesh=new Set(['Tires','Rims','Window','Transparent','DayLights','RearLight','Mirror','Exhaust']);

export function makeM3Crash({
  seed,
  start=[-5,0],
  velocity=[15,0,0],
  camera={position:[-1.8,2.25,5.8],target:[-.4,.72,0],fov:42},
  obstacles=[],
  extra=[],
  color=[.105,.17,.28,1],
}){
  const car=makeM3(asset,'m3',start[0],start[1],color,0);
  const visualIds=[],deformVisualIds=[];
  for(let i=0;i<car.entities.length;i++){
    const entity=car.entities[i],part=asset.parts[i];
    if(entity?.mesh?.kind!=='triangle-mesh')continue;
    visualIds.push(entity.id);
    if(!part?.wheel&&!noPlasticMesh.has(part?.material))deformVisualIds.push(entity.id);
  }
  if(!visualIds.length||!deformVisualIds.length)throw new Error('M3 asset exposes no deformable triangle meshes');

  return{
    version:1,
    seed,
    gravity:[0,-9.81,0],
    ground:-100,
    clearColor:[.025,.03,.038,1],
    environment:{temperatureC:16,humidity:.48,precipitation:'rare',sunlight:.62,wind:[.3,0,.1],groundMoisture:.18},
    rendering:{sunDirection:[-.45,.78,-.28],sunColor:[1,.91,.79],skyColor:[.32,.40,.53],sunIntensity:2.4,exposure:1.0,shadowExtent:28},
    camera,
    entities:[
      {id:'floor',position:[0,-.12,0],mesh:{kind:'box',size:[30,.24,18]},material:{kind:'default',color:[.24,.25,.27,1],roughness:.88},body:{mass:0,friction:.9,restitution:0}},
      {id:'m3:crash-body',position:[start[0],.72,start[1]],material:{kind:'steel'},body:{mass:1700,velocity,collisionSize:[4.55,1.42,1.86],restitution:.025,friction:.78}},
      ...car.entities,
      ...obstacles,
      ...extra,
    ],
    deformation:{bodies:[{
      bodyId:'m3:crash-body',
      visualIds,
      deformVisualIds,
      skinThicknessM:.0009,
      radiusM:.58,
      maxDentM:.78,
      minEnergyJ:45,
    }]},
  };
}

export const wall=(x=0)=>({id:'wall',position:[x,1.05,0],mesh:{kind:'box',size:[.42,2.1,6]},material:{kind:'default',color:[.39,.40,.42,1],roughness:.92},body:{mass:0,restitution:0,friction:.9}});
export const narrowBlock=(x=0,z=.62)=>({id:'offset-block',position:[x,.80,z],mesh:{kind:'box',size:[.45,1.6,.66]},material:{kind:'default',color:[.38,.39,.41,1],roughness:.94},body:{mass:0,restitution:0,friction:.9}});
export const pole=(x=0,z=0)=>({id:'pole',position:[x,.95,z],mesh:{kind:'box',size:[.34,1.9,.34]},material:{kind:'default',color:[.31,.32,.34,1],metalness:.15,roughness:.72},body:{mass:0,restitution:0,friction:.9}});
