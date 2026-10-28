type V=readonly number[];
type Vec=[number,number,number];
const sub=(a:V,b:V):Vec=>[a[0]!-b[0]!,a[1]!-b[1]!,a[2]!-b[2]!];
const cross=(a:V,b:V):Vec=>[a[1]!*b[2]!-a[2]!*b[1]!,a[2]!*b[0]!-a[0]!*b[2]!,a[0]!*b[1]!-a[1]!*b[0]!];
const dot=(a:V,b:V)=>a[0]!*b[0]!+a[1]!*b[1]!+a[2]!*b[2]!;
/** The same signed material angle as the articulated flange, with all spatial
 * derivatives. The axis endpoints belong to the parent; omitting their term
 * creates a spurious net torque when a deformed flange has axial skew. */
export function materialAngle(axisPositive:V,axisNegative:V,referencePositive:V,referenceNegative:V,positive:V,negative:V){
 const axis=sub(axisPositive,axisNegative),length=Math.hypot(...axis);if(length<1e-8)return;
 const n=axis.map(v=>v/length),u=sub(referencePositive,referenceNegative),v=sub(positive,negative),uv=cross(u,v),S=dot(n,uv),D=dot(u,v),denominator=D*D+S*S;if(denominator<1e-20)return;
 const vn=cross(v,n),nu=cross(n,u),reference=vn.map((x,k)=>(D*x-S*v[k]!)/denominator) as Vec,child=nu.map((x,k)=>(D*x-S*u[k]!)/denominator) as Vec,normal=uv.map(x=>D*x/denominator),parallel=dot(normal,n),hinge=normal.map((x,k)=>(x-parallel*n[k]!)/length) as Vec;
 return{angle:Math.atan2(S,D),reference,child,hinge};
}
