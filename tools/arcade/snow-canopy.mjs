/** One slope-aware snow shell per canopy, including its irregular front lip. */
export function canopySnow(cx,r,rise,seed,nu=52,nv=12){
 const point=(u,v)=>{
  const a=u*Math.PI,cs=Math.cos(a),sn=Math.max(0,Math.sin(a));
  const support=sn**1.7,variation=.016*Math.sin(u*10.5+seed*.7)+.009*Math.sin(u*27+v*5+seed);
  const lip=.018*Math.exp(-v*9)*(.75+.25*Math.sin(u*23+seed));
  const h=.008+support*(.095+variation+lip),l=Math.hypot(cs/r,sn/rise);
  return[cx+r*cs+h*cs/r/l,3.19+rise*sn+h*sn/rise/l,-2.94+v*2.81+.012*Math.sin(u*19+seed)*(1-v)**5];
 };
 const positions=[],normals=[],indices=[],eps=.0001;
 for(let v=0;v<=nv;v++)for(let u=0;u<=nu;u++){
  const fu=u/nu,fv=v/nv,p=point(fu,fv);
  const a=point(fu+eps,fv).map((n,k)=>n-point(fu-eps,fv)[k]);
  const b=point(fu,fv+eps).map((n,k)=>n-point(fu,fv-eps)[k]);
  const n=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],l=Math.hypot(...n);
  positions.push(...p);normals.push(...n.map(x=>x/l));
  if(u<nu&&v<nv){const q=v*(nu+1)+u,b=q+nu+1;indices.push(q,q+1,b,q+1,b+1,b);}
 }
 return{kind:'triangle-mesh',positions,normals,indices};
}
