/**
 * Tiny deterministic fallback for offline CI, NOT a generative model.
 * Only a smoke test of the prose -> guarded draft -> WebGPU plumbing.
 */
export function interpretOffline(source,world={entities:[]}){
  const lines=source.split('\n').map(line=>line.trim()).filter(Boolean);
  const claims=lines.map((quote,i)=>({
    id:'passage-'+i,quote,
    reading:/рассыпал[аи]? серебро|вздохнул|плакал|шептал|ожил/u.test(quote.toLowerCase())
      ?'figurative':'literal',
    ...(source.indexOf(quote)!==source.lastIndexOf(quote)?{offset:source.indexOf(quote)}:{}),
  }));
  const facts=[],visuals=[];
  const find=re=>claims.find(claim=>re.test(claim.quote.toLowerCase()));
  const fact=(claim,kind,value,entityId)=>{
    if(claim)facts.push({claimId:claim.id,kind,value,...(entityId?{entityId}:{})});
  };
  const temperature=find(/температура.*[−+\-]?\d+\s*°?\s*[cс]/u);
  if(temperature){
    const raw=temperature.quote.match(/([−+\-]?\d+(?:[.,]\d+)?)\s*°?\s*[cс]/iu)?.[1];
    if(raw!==undefined)fact(temperature,'temperatureC',Number(raw.replace('−','-').replace(',','.')));
  }
  const snow=find(/(?:умерен|сильн|обильн|слаб|лёгк|легк).{0,60}снег/u);
  if(snow){
    const quote=snow.quote.toLowerCase();
    fact(snow,'snowfall',/сильн|обильн/u.test(quote)?'heavy':/слаб|лёгк|легк/u.test(quote)?'light':'moderate');
  }
  const vehicle=find(/внедорожник|автомобиль|машин/u);
  if(vehicle&&world.entities?.some(entity=>entity.id==='car')){
    const mass=vehicle.quote.match(/(\d+(?:[.,]\d+)?)\s*(?:кг|kg)/iu)?.[1];
    if(mass)fact(vehicle,'massKg',Number(mass.replace(',','.')),'car');
    const speed=vehicle.quote.match(/(\d+(?:[.,]\d+)?)\s*(км\/ч|km\/h|м\/с|m\/s)/iu);
    if(speed&&/на восток|к востоку|на запад|к западу/iu.test(vehicle.quote)){
      const magnitude=Number(speed[1].replace(',','.'))*(/км\/ч|km\/h/iu.test(speed[2])?1/3.6:1);
      fact(vehicle,'velocityX',magnitude*(/на запад|к западу/iu.test(vehicle.quote)?-1:1),'car');
    }
  }
  const used=new Set(world.entities?.map(entity=>entity.id)??[]);
  const add=(claim,id,position,mesh,material,extra={})=>{
    if(!claim||used.has(id))return;
    used.add(id);
    visuals.push({claimId:claim.id,entity:{id,position,mesh,material,renderOnly:true,...extra}});
  };
  const river=find(/рек|вод/u);
  add(river,'visual-river',[0,0.055,0],{kind:'plane',size:[70,14]},
    {kind:'mirror',color:[.10,.16,.24,1],roughness:.10,metalness:.15});
  const moon=find(/лун/u);
  add(moon,'visual-moon',[-26,42,-100],{kind:'sphere',radius:5,segments:24},
    {kind:'default',color:[.72,.80,.93,1],emissive:[1.5,1.6,1.9]},
    {light:{kind:'point',color:[.5,.65,.95],intensity:2.2,range:120}});
  const bridge=find(/мост|перил/u);
  add(bridge,'visual-road-snow',[0,4.28,0],{kind:'box',size:[27.7,.055,3.6]},
    {kind:'snow',color:[.58,.64,.69,1],roughness:.96});
  add(bridge,'visual-rail-frost-a',[0,5.88,-1.9],{kind:'box',size:[27.5,.11,.14]},
    {kind:'snow',color:[.7,.75,.78,1]});
  add(bridge,'visual-rail-frost-b',[0,5.88,1.9],{kind:'box',size:[27.5,.11,.14]},
    {kind:'snow',color:[.7,.75,.78,1]});
  const helicopter=find(/вертолёт|вертолет/u);
  add(helicopter,'visual-helicopter-fuselage',[18,23,-13],{kind:'sphere',radius:1,segments:24},
    {kind:'steel',color:[.15,.22,.27,1],metalness:.65,roughness:.4},{scale:[3.6,1.1,1.25]});
  add(helicopter,'visual-helicopter-tail',[22,23,-13],{kind:'box',size:[6,.22,.27]},
    {kind:'steel',color:[.15,.2,.24,1],metalness:.7});
  add(helicopter,'visual-helicopter-rotor',[18,24.25,-13],{kind:'box',size:[12,.075,.26]},
    {kind:'steel',color:[.08,.09,.11,1]});
  add(helicopter,'visual-helicopter-searchlight',[16,22,-12],{kind:'sphere',radius:.18,segments:12},
    {kind:'default',color:[1,.9,.7,1],emissive:[3,2.6,1.9]},
    {light:{kind:'point',color:[1,.85,.65],intensity:9,range:45}});
  const firs=find(/сосн|ел[ьяи]|ёл/u);
  for(let i=0;i<7;i++){
    const x=-24+i*8,z=(i%2?15:-15),id='visual-fir-'+i;
    add(firs,id,[x,5,z],{kind:'cylinder',radius:1.45,height:10,topRadius:.05,segments:12},
      {kind:'wood',color:[.05,.13,.11,1],roughness:.96});
  }
  const relevant=claims.filter(claim=>claims.some(item=>item.id===claim.id));
  const camera={position:[24,18,28],target:[0,4,0],fov:52};
  return {
    version:1,source,claims:relevant,facts,visuals,
    shots:[
      {id:'overview',camera},
      {id:'across-bridge',camera:{position:[-19,8,8],target:[6,4,0],fov:60}},
    ],
    rendering:{
      sunDirection:[-.3,.32,.65],sunColor:[.45,.50,.7],sunIntensity:.34,
      skyColor:[.09,.12,.19],ambientIrradiance:[.14,.17,.23],
      backgroundColor:[.035,.049,.073],fogColor:[.10,.15,.21],fogDensity:.012,
      exposure:1.45,shadowExtent:80,
    },
  };
}
