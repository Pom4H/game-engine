// Frozen pre-staging implementation: keep independent of render/visibility and
// math helpers so the differential check cannot share an optimized predicate.
export function originalClipProduct(a,b){
 const out=new Float32Array(16);
 for(let column=0;column<4;column++)for(let row=0;row<4;row++){
  out[column*4+row]=a[row]*b[column*4]+a[4+row]*b[column*4+1]+a[8+row]*b[column*4+2]+a[12+row]*b[column*4+3];
 }
 return out;
}
export function originalClipTrace(bounds,m){
 for(let plane=0;plane<6;plane++){
  const row=plane>>1,sign=(plane&1)?-1:1,near=plane===4;
  const a=near?m[2]:m[3]+sign*m[row],b=near?m[6]:m[7]+sign*m[4+row],c=near?m[10]:m[11]+sign*m[8+row],d=near?m[14]:m[15]+sign*m[12+row];
  const distance=a*bounds.center[0]+b*bounds.center[1]+c*bounds.center[2]+d;
  const radius=Math.abs(a)*bounds.half[0]+Math.abs(b)*bounds.half[1]+Math.abs(c)*bounds.half[2];
  if(distance+radius < -1e-5)return{visible:false,plane};
 }
 return{visible:true,plane:6};
}
