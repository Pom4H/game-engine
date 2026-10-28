// Frozen static-plane branch from SolidWorld.ray before scalar allocation removal.
// Keep vector temporaries and evaluation order independent of the production code.
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const scale=(a,k)=>[a[0]*k,a[1]*k,a[2]*k];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export function planeRayBefore(candidates,origin,dir,maxDistance,counts){
 let best=null;
 for(let i=0;i<candidates.length;i++){
  const item=candidates[i];if(counts)counts.candidates++;
  const dn=dot(dir,item.n);if(dn>=-1e-8)continue;
  if(counts){counts.facing++;counts.temporaryArrays++;}
  const t=dot(sub(item.p,origin),item.n)/dn;
  if(t<0||t>maxDistance||best&&t>=best.t)continue;
  if(counts){counts.inRange++;counts.temporaryArrays+=3;}
  const p=add(origin,scale(dir,t)),d=sub(p,item.p);
  if(Math.abs(dot(d,item.u))>item.hu+.001||Math.abs(dot(d,item.v))>item.hv+.001)continue;
  if(counts)counts.insideBounds++;
  if(item.filter&&!item.filter(p))continue;
  best={t,p,n:item.n,body:null,tag:item.tag,plane:item};
 }
 return best;
}
export function planeRayBeforeWorld(world,origin,dir,maxDistance,counts){
 const mx=origin[0]+dir[0]*maxDistance*.5,my=origin[1]+dir[1]*maxDistance*.5,mz=origin[2]+dir[2]*maxDistance*.5;
 const enclosingRadius=maxDistance*.5+1,horizontalRadius=Math.min(enclosingRadius,Math.hypot(dir[0],dir[2])*maxDistance*.5+1);
 return planeRayBefore(world.candidates([mx,my,mz],horizontalRadius,enclosingRadius),origin,dir,maxDistance,counts);
}
