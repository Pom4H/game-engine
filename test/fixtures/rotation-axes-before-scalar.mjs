/** Independent pre-change arithmetic from src/physics/compound.ts on2026-10-18.
 * Original full source SHA256:
 * 773b9887c7940d631e82558b8ac716cb0121f82100e5efbfb6b2fdcec7ba1304.
 * Frozen expressions deliberately delegate to no production math.
 * boxesBefore is the numeric composition oracle; overrides are tested separately. */
const Vadd=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const Vscale=(a,k)=>[a[0]*k,a[1]*k,a[2]*k];
const Vcross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const QrotateBefore=(q,v)=>{const u=[q[0],q[1],q[2]],t=Vscale(Vcross(u,v),2);return Vadd(v,Vadd(Vscale(t,q[3]),Vcross(u,t)));};
const QmulBefore=(a,b)=>[a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];
export function rotationAxesBefore(q){return [QrotateBefore(q,[1,0,0]),QrotateBefore(q,[0,1,0]),QrotateBefore(q,[0,0,1])];}
function withBoundsBefore(box){
 let x=0,y=0,z=0;for(let i=0;i<3;i++){const axis=box.axes[i],half=box.half[i];x+=Math.abs(axis[0])*half;y+=Math.abs(axis[1])*half;z+=Math.abs(axis[2])*half;}
 return Object.assign(box,{bounds:[box.p[0]-x,box.p[1]-y,box.p[2]-z,box.p[0]+x,box.p[1]+y,box.p[2]+z]});
}
export function boxesBefore(body){
 const axes=rotationAxesBefore(body.q);
 return body.shapes.map(s=>{
  const shapeAxes=s.q?rotationAxesBefore(QmulBefore(body.q,s.q)):axes;
  return withBoundsBefore({body,p:Vadd(body.p,QrotateBefore(body.q,s.offset||[0,0,0])),axes:shapeAxes,half:s.half,tag:s.tag||body.tag,structureNode:s.structureNode,structureBeam:s.structureBeam});
 });
}
