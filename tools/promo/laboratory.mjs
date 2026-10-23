// Original material study, rendered by the same engine as the city.
export function makeLaboratory(){
 const entities=[],box=(id,p,size,color,material={},body)=>entities.push({id,position:p,mesh:{kind:'box',size},material:{kind:'default',color,...material},...(body?{body}:{})});
 box('lab-floor',[0,-.18,0],[25,.30,24],[.22,.24,.26,1],{kind:'concrete',roughness:.62},{mass:0,friction:.8});
 box('backdrop',[0,5,-5],[25,10,.3],[.11,.14,.19,1],{roughness:.85});
 box('base',[0,.13,0],[5.4,.28,4.3],[.07,.09,.12,1],{kind:'steel',roughness:.28,metalness:.55},{mass:0,friction:.8});
 for(const x of [-2.12,2.12])for(const z of [-1.42,1.42]){
  entities.push({id:`leg${x}${z}`,position:[x,1.35,z],mesh:{kind:'cylinder',radius:.045,height:2.3},material:{kind:'steel',color:[.3,.34,.38,1],metalness:.9,roughness:.23}});
 }
 for(const z of [-1.42,1.42])box('rail'+z,[0,2.48,z],[4.36,.055,.055],[.30,.36,.40,1],{kind:'steel',metalness:.8,roughness:.22});
 box('glass',[0,2.5,0],[4.12,.016,2.76],[.46,.62,.64,.45],{kind:'glass',roughness:.09});
 entities.push({id:'impactor',position:[.3,5.55,.1],mesh:{kind:'sphere',radius:.25,segments:64},material:{kind:'steel',color:[.63,.31,.13,1],roughness:.25,metalness:.75},body:{mass:8,velocity:[0,-7,0],restitution:.12}});
 for(const x of [-4.5,4.5])entities.push({id:'soft-light'+x,position:[x,4.5,1],mesh:{kind:'box',size:[.04,5,.05]},material:{kind:'default',color:[.5,.7,.9,1],emissive:x<0?[.7,1.1,1.6]:[1.7,.7,.25]},light:{kind:'point',color:x<0?[.4,.65,1]:[1,.64,.33],intensity:8,range:12}});
 for(let i=0;i<10;i++)box('back-rib'+i,[-10+i*2,5,-4.79],[.025,10,.05],[.22,.28,.34,1]);
 return{motions:[],spec:{version:1,seed:912607,ground:-100,environment:{temperatureC:18,snowfall:'none',sunlight:.18,humidity:.2,precipitation:'arid'},rendering:{sunDirection:[-.3,.8,.25],sunColor:[.75,.86,1],sunIntensity:1.8,skyColor:[.065,.09,.15],exposure:1.10,shadowExtent:16,fogDensity:.001},camera:{position:[6,4.7,8],target:[0,1.9,0],fov:40},entities}};
}
