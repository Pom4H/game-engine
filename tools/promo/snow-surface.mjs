// High-resolution snow skin over the original sidewalk. Only contacted 2 m tiles
// are rebuilt; the surrounding pavement and its environmental field remain intact.
const base=.183,centerZ=5.25,width=2.6;
export class SnowSkin {
 constructor(){this.stamps=[];this.tiles=new Map();}
 initialize(scene){for(let k=-40;k<50;k++)this.rebuild(scene,k,false);}
 stamp(scene,stamp){const k=Math.floor(stamp.position[0]/2);if(k< -40||k>=50)return;this.stamps.push(stamp);if(this.stamps.length>256)this.stamps.shift();for(const tile of [k-1,k,k+1])if(tile>=-40&&tile<50&&this.stamps.some(s=>Math.abs(s.position[0]-(tile*2+1))<1.3))this.rebuild(scene,tile,true);}
 height(x,z,stamps){
  let h=base+.0018*Math.sin(x*11+z*8)*Math.sin(x*3-z*7);
  for(const s of stamps){const dx=x-s.position[0]-.034,dz=z-s.position[2],c=Math.cos(s.yaw),si=Math.sin(s.yaw),u=c*dx-si*dz,v=si*dx+c*dz;
   const toe=Math.max(0,Math.min(1,(u+.04)/.1)),heel=Math.max(0,Math.min(1,(-u-.03)/.07)),w=.047+.017*toe+.008*heel;
   const shape=(u/.154)**4+(v/w)**4,r=Math.sqrt(Math.sqrt(shape));
   if(r<1.5){const dip=.022*(1-smooth(.68,1.0,r)),rim=.0055*Math.exp(-(((r-1.08)/.15)**2));h+=rim-dip;}
  }
  return h;
 }
 rebuild(scene,k,detailed){
  const stamps=this.stamps.filter(s=>Math.abs(s.position[0]-(k*2+1))<1.3),nx=detailed?96:16,nz=detailed?112:20,positions=[],normals=[],indices=[],eps=.008;
  for(let j=0;j<=nz;j++)for(let i=0;i<=nx;i++){
   const x=k*2+i/nx*2,z=centerZ-width/2+j/nz*width,h=this.height(x,z,stamps),dx=(this.height(x+eps,z,stamps)-this.height(x-eps,z,stamps))/(eps*2),dz=(this.height(x,z+eps,stamps)-this.height(x,z-eps,stamps))/(eps*2),l=Math.hypot(dx,1,dz);
   positions.push(x-(k*2+1),h,z-centerZ);normals.push(-dx/l,1/l,-dz/l);
   if(i<nx&&j<nz){const a=j*(nx+1)+i,b=a+nx+1;indices.push(a,b,a+1,b,b+1,a+1);}
  }
  const id='snow-skin-'+k;scene.remove(id);scene.add({id,position:[k*2+1,0,centerZ],mesh:{kind:'triangle-mesh',positions,normals,indices},material:{kind:'default',color:[.89,.925,.953,1],roughness:.94}});this.tiles.set(k,detailed);
 }
}
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
