const clamp=(value:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,value));
const lerp=(a:number,b:number,t:number)=>a+(b-a)*t;
export function tyreResponse(slip:number,stiffness:number):number{
  if(!Number.isFinite(slip)||!Number.isFinite(stiffness)||stiffness<0)throw new RangeError('Invalid tyre response input');
  const x=slip*stiffness,a=Math.abs(x),peak=x/Math.sqrt(1+x*x);return peak*lerp(1,.88,clamp((a-2)/8,0,1));
}
export function combinedTyreResponse(longSlip:number,sideSlip:number,longStiffness:number,sideStiffness:number):readonly[number,number]{
  if(![longSlip,sideSlip,longStiffness,sideStiffness].every(Number.isFinite)||longStiffness<0||sideStiffness<0)throw new RangeError('Invalid combined tyre input');
  const x=longSlip*longStiffness,y=sideSlip*sideStiffness,magnitude=Math.hypot(x,y),response=lerp(1,.88,clamp((magnitude-2)/8,0,1))/Math.sqrt(1+magnitude*magnitude);return[x*response,y*response];
}
export function loadSensitiveGrip(normalForce:number,mu:number,nominalLoad:number):number{
  if(![normalForce,mu,nominalLoad].every(Number.isFinite)||mu<0)return 0;if(!(normalForce>0&&nominalLoad>0))return 0;
  const sensitivity=clamp(1-.11*(normalForce/nominalLoad-1),.82,1.08);return normalForce*mu*sensitivity;
}
export function limitCombinedForce(fx:number,fy:number,limit:number):readonly[number,number]{
  if(![fx,fy,limit].every(Number.isFinite)||limit<0)throw new RangeError('Invalid combined force');
  const magnitude=Math.hypot(fx,fy);return magnitude>limit&&magnitude>0?[fx*limit/magnitude,fy*limit/magnitude]:[fx,fy];
}
export interface TyreContactInput{readonly normalForce:number;readonly friction:number;readonly nominalLoad:number;readonly longitudinalSlip:number;readonly lateralSlip:number;readonly longitudinalStiffness:number;readonly lateralStiffness:number}
export function tyreContactForce(input:TyreContactInput):readonly[number,number]{
  const response=combinedTyreResponse(input.longitudinalSlip,input.lateralSlip,input.longitudinalStiffness,input.lateralStiffness),limit=loadSensitiveGrip(input.normalForce,input.friction,input.nominalLoad);return limitCombinedForce(response[0]*limit,response[1]*limit,limit);
}
