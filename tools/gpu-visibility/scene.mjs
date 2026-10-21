/** Shared deterministic source for every mode. No per-renderer scene tuning. */
export function visibilityScene(count=5000){
 if(!Number.isSafeInteger(count)||count<4||count>100000)throw new RangeError('Invalid scene size');
 const entities=Array.from({length:count},(_,n)=>({
  id:'cube:'+n,position:[(n%100-49.5)*2.1,.65+Math.floor(n/10000)*1.6,(Math.floor(n/100)%100-49.5)*2.1],
  rotation:[0,(n%13)*.09,0],scale:[1,1+(n%7)*.04,1],mesh:{kind:'box',size:[1,1,1]},
  material:{kind:'steel',color:[.22+(n%7)*.07,.24+(n%5)*.08,.3+(n%3)*.1,1],roughness:.46},
 }));
 entities.push({id:'ground',position:[0,-.2,0],mesh:{kind:'box',size:[260,.4,260]},material:{kind:'concrete',color:[.24,.25,.26,1],roughness:.85}});
 for(let n=0;n<4;n++)entities.push({id:'lamp:'+n,position:[(n%2?1:-1)*15,6,(n>1?1:-1)*15],light:{kind:'point',intensity:35,range:30,color:[1,.75,.5]}});
 for(let n=0;n<8;n++)entities.push({id:'replay:'+n,position:[n*1.3-5,8,0],mesh:{kind:'sphere',radius:.4},body:{motion:'dynamic',mass:2,velocity:[.2,0,.1]},material:{kind:'rubber',color:[.25,.15,.1,1]}});
 return{version:1,seed:731,gravity:[0,-9.81,0],camera:visibilityCamera(0),entities,
  environment:{temperatureC:15,humidity:.3,sunlight:.8,snowfall:'none',precipitation:'rare',clock:{startHour:12,hoursPerSecond:0}},
  rendering:{sunDirection:[-.55,.48,-.35],sunIntensity:2.4,skyColor:[.26,.34,.47],exposure:1.1,fogDensity:.001,shadowExtent:145},
 };
}
export function visibilityCamera(frame,scenario='static'){
 const angle=scenario==='camera-motion'?frame*.003:0;
 return{position:[Math.sin(angle)*35+22,22,Math.cos(angle)*35+16],target:[0,1,0],fov:65,near:.1,far:145};
}
