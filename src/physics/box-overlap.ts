/** Boolean SAT for navigation/motor occupancy. It deliberately does not construct a contact manifold. */
export type OrientedBox={p:readonly number[];half:readonly number[];axes:readonly (readonly number[])[]};
export type BoxBounds=readonly [number,number,number,number,number,number];
/** World-axis envelope computed once when a physical box's pose is constructed. */
export function boxBounds(box:OrientedBox):BoxBounds{
 let x=0,y=0,z=0;for(let i=0;i<3;i++){const axis=box.axes[i]!,half=box.half[i]!;x+=Math.abs(axis[0]!)*half;y+=Math.abs(axis[1]!)*half;z+=Math.abs(axis[2]!)*half;}
 return [box.p[0]!-x,box.p[1]!-y,box.p[2]!-z,box.p[0]!+x,box.p[1]!+y,box.p[2]!+z];
}
export function withBoxBounds<T extends OrientedBox>(box:T):T&{bounds:BoxBounds}{return Object.assign(box,{bounds:boxBounds(box)});}
/** Conservative prefilter only; the oriented SAT still determines every contact. */
export function boxBoundsOverlap(a:OrientedBox&{bounds?:BoxBounds},b:OrientedBox&{bounds?:BoxBounds},margin=.006){
 const A=a.bounds??boxBounds(a),B=b.bounds??boxBounds(b),padding=Math.max(0,margin)*2;
 return A[0]<=B[3]+padding&&B[0]<=A[3]+padding&&A[1]<=B[4]+padding&&B[1]<=A[4]+padding&&A[2]<=B[5]+padding&&B[2]<=A[5]+padding;
}
// Keep each query's arithmetic and public geometry reads in their original
// order without constructing a capturing function for every occupancy test.
function passesAxis(a:OrientedBox,b:OrientedBox,dx:number,dy:number,dz:number,depth:number,x:number,y:number,z:number){
 let radius=0;for(let i=0;i<3;i++){const u=a.axes[i]!,v=b.axes[i]!;radius+=Math.abs(u[0]!*x+u[1]!*y+u[2]!*z)*a.half[i]!+Math.abs(v[0]!*x+v[1]!*y+v[2]!*z)*b.half[i]!;}
 return radius-Math.abs(dx*x+dy*y+dz*z)>depth;
}
export function boxesPenetrate(a:OrientedBox,b:OrientedBox,depth=.012):boolean{
 const dx=a.p[0]!-b.p[0]!,dy=a.p[1]!-b.p[1]!,dz=a.p[2]!-b.p[2]!;
 for(const axes of [a.axes,b.axes])for(const axis of axes)if(!passesAxis(a,b,dx,dy,dz,depth,axis[0]!,axis[1]!,axis[2]!))return false;
 for(const u of a.axes)for(const v of b.axes){const x=u[1]!*v[2]!-u[2]!*v[1]!,y=u[2]!*v[0]!-u[0]!*v[2]!,z=u[0]!*v[1]!-u[1]!*v[0]!,squared=x*x+y*y+z*z;if(squared<=1e-9)continue;const length=Math.sqrt(squared);if(!passesAxis(a,b,dx,dy,dz,depth,x/length,y/length,z/length))return false;}
 return true;
}

export const STATIC_COLLISION_CELL_SIZE=8;
/** Conservative XZ radius for spatial indexing; a tall upright facade is not 100 m wide. */
export function staticQueryRadius(origin:readonly number[],boxes:readonly OrientedBox[]):number{
 let radius=0;for(const box of boxes){let x=Math.abs(box.p[0]!-origin[0]!),z=Math.abs(box.p[2]!-origin[2]!);for(let i=0;i<3;i++){x+=Math.abs(box.axes[i]![0]!)*box.half[i]!;z+=Math.abs(box.axes[i]![2]!)*box.half[i]!;}radius=Math.max(radius,Math.hypot(x,z));}return radius;
}
