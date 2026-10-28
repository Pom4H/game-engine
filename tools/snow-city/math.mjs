export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const mix=(a,b,t)=>a+(b-a)*t;
export const smooth=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};
export const yawPoint=(p,root,yaw)=>{const c=Math.cos(yaw),s=Math.sin(yaw);return[root[0]+c*p[0]+s*p[2],root[1]+p[1],root[2]-s*p[0]+c*p[2]];};
export const hash=(x,z,seed=0)=>{let h=Math.imul(x|0,374761393)^Math.imul(z|0,668265263)^seed;h=Math.imul(h^(h>>>13),1274126177);return(h^(h>>>16))>>>0;};
export const wrapAngle=a=>Math.atan2(Math.sin(a),Math.cos(a));
export function closestApproach(a,b,horizon=2.5){const px=b.position[0]-a.position[0],pz=b.position[2]-a.position[2],vx=b.velocity[0]-a.velocity[0],vz=b.velocity[2]-a.velocity[2],v2=vx*vx+vz*vz,t=v2>1e-6?clamp(-(px*vx+pz*vz)/v2,0,horizon):0;return{time:t,distance:Math.hypot(px+vx*t,pz+vz*t),point:[(a.position[0]+a.velocity[0]*t+b.position[0]+b.velocity[0]*t)/2,1,(a.position[2]+a.velocity[2]*t+b.position[2]+b.velocity[2]*t)/2]};}
