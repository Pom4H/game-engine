import {defineScene} from '@rom4/game-engine';

const roadLength=190;

function car(id:string,x:number,z:number,speed:number,color:readonly[number,number,number,number]){
  const velocity=[speed,0,0] as const;
  return[
    {
      id,
      position:[x,.68,z] as const,
      mesh:{kind:'box' as const,size:[4.6,1.25,1.86] as const},
      material:{kind:'steel' as const,treatment:'painted' as const,color},
      body:{motion:'kinematic' as const,mass:1450,velocity},
    },
    {
      id:`${id}:cabin`,
      position:[x-.25,1.52,z] as const,
      mesh:{kind:'box' as const,size:[2.65,.72,1.68] as const},
      material:{kind:'steel' as const,treatment:'painted' as const,color},
      body:{motion:'kinematic' as const,mass:85,velocity},
    },
    {
      id:`${id}:rear-wing`,
      position:[x-2.05,1.35,z] as const,
      mesh:{kind:'box' as const,size:[.18,.18,1.72] as const},
      material:{kind:'steel' as const,treatment:'painted' as const,color},
      body:{motion:'kinematic' as const,mass:14,velocity},
    },
  ];
}

const lamps=Array.from({length:9},(_,i)=>({
  id:`lamp-${i}`,
  position:[-22+i*16,2.7,7.15] as const,
  mesh:{kind:'box' as const,size:[.12,5.4,.12] as const},
  material:{kind:'steel' as const,color:[.08,.09,.11,1] as const},
}));

const buildings=[
  ...Array.from({length:9},(_,i)=>({
    id:`building-r-${i}`,
    position:[-12+i*16,5.2,18.2] as const,
    mesh:{kind:'box' as const,size:[13,10,7] as const},
    material:{kind:'concrete' as const,finish:'rough' as const,ageYears:25},
  })),
  ...Array.from({length:9},(_,i)=>({
    id:`building-l-${i}`,
    position:[-12+i*16,5.0,-18.4] as const,
    mesh:{kind:'box' as const,size:[13,9.6,7] as const},
    material:{kind:'concrete' as const,finish:'rough' as const,ageYears:28},
  })),
];

export default defineScene({
  version:1,
  seed:20260919,
  gravity:[0,-9.81,0],
  ground:-100,
  environment:{
    humidity:.86,
    groundMoisture:.72,
    precipitation:'frequent',
    clock:{startHour:2,hoursPerSecond:.30},
    weather:[
      {hour:2,temperatureC:-10,snowfall:'heavy',sunlight:0,humidity:.9,wind:[2.8,0,.8]},
      {hour:6,temperatureC:-7,snowfall:'heavy',sunlight:.02,humidity:.92,wind:[2.2,0,.5]},
      {hour:7.4,temperatureC:0,snowfall:'moderate',sunlight:.18,humidity:.91,wind:[1.6,0,.3]},
      {hour:8.3,temperatureC:.8,snowfall:'none',sunlight:.48,humidity:.82,wind:[1.4,0,.2]},
      {hour:13,temperatureC:4,snowfall:'none',sunlight:.88,humidity:.64,wind:[1.8,0,.1]},
    ],
  },
  camera:{position:[-27,3.35,10.2],target:[16,.75,0],fov:48},
  entities:[
    {
      id:'road',
      position:[20,-.12,0],
      mesh:{kind:'box',size:[roadLength,.24,8]},
      material:{kind:'asphalt',finish:'rough',ageYears:9},
      environmental:{surfaceUse:'road'},
    },
    {
      id:'curb-right',
      position:[20,.16,4.18],
      mesh:{kind:'box',size:[roadLength,.32,.36]},
      material:{kind:'concrete',finish:'rough',ageYears:14},
      environmental:{surfaceUse:'curb'},
    },
    {
      id:'sidewalk-right',
      position:[20,.20,5.95],
      mesh:{kind:'box',size:[roadLength,.18,3.2]},
      material:{kind:'concrete',finish:'rough',ageYears:14},
      environmental:{surfaceUse:'sidewalk'},
    },
    {
      id:'curb-left',
      position:[20,.16,-4.18],
      mesh:{kind:'box',size:[roadLength,.32,.36]},
      material:{kind:'concrete',finish:'rough',ageYears:14},
      environmental:{surfaceUse:'curb'},
    },
    {
      id:'sidewalk-left',
      position:[20,.20,-5.95],
      mesh:{kind:'box',size:[roadLength,.18,3.2]},
      material:{kind:'concrete',finish:'rough',ageYears:14},
      environmental:{surfaceUse:'sidewalk'},
    },

    ...car('car-a',-18,-1.85,8.5,[.07,.08,.1,1]),
    ...car('car-b',-58,1.8,9.2,[.24,.26,.29,1]),
    ...car('car-c',-112,-1.7,7.8,[.12,.16,.2,1]),
    ...car('car-d',-166,1.65,9.8,[.34,.33,.31,1]),
    ...car('car-e',-224,-1.75,8.2,[.16,.18,.22,1]),
    ...car('car-f',-286,1.72,8.7,[.08,.11,.13,1]),
    ...car('car-g',-340,-1.7,8.9,[.28,.29,.31,1]),

    ...lamps,
    ...buildings,
  ],
});
