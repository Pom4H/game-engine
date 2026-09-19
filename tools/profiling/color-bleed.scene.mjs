const box=(id,position,size,color,extra={})=>({id,position,mesh:{kind:'box',size},material:{kind:'concrete',color,roughness:.78,...(extra.material??{})},...extra});
export default {
  version:1,
  seed:20260920,
  gravity:[0,-9.81,0],
  ground:-100,
  environment:{temperatureC:20,snowfall:'none',sunlight:0,humidity:.3,precipitation:'arid',wind:[0,0,0]},
  rendering:{sunDirection:[-.4,.7,-.3],sunColor:[1,1,1],sunIntensity:0,skyColor:[.018,.022,.028],fogDensity:0,exposure:1.08,shadowExtent:12},
  camera:{position:[0,2.65,5.4],target:[0,.72,0],fov:43},
  entities:[
    box('floor',[0,-.08,0],[7,.16,6],[.68,.68,.68,1]),
    box('receiver',[0,.55,0],[1.05,1.1,1.05],[.76,.76,.76,1]),
    box('red-emitter',[-1.25,.78,0],[.12,1.55,2.2],[.55,.025,.018,1],{material:{emissive:[5.8,.035,.018],roughness:.72}}),
    box('blue-emitter',[1.25,.78,0],[.12,1.55,2.2],[.018,.045,.58,1],{material:{emissive:[.018,.055,5.8],roughness:.72}}),
    box('back',[0,1,-1.6],[4.2,2,.12],[.55,.55,.55,1]),
  ],
};
