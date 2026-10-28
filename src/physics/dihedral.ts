/** Signed shell hinge and its exact position gradient. Edge a->b is shared by
 * triangles (a,b,c) and (b,a,d). Formula follows discrete-shell hinge geometry;
 * see Tamstorf, Disney TR201307 (2013), rather than a stretch-distance proxy. */
export function dihedralGeometry(p:Float64Array,a:number,b:number,c:number,d:number,g?:Float64Array):number|undefined{
 const A=a*3,B=b*3,C=c*3,D=d*3,ex=p[B]!-p[A]!,ey=p[B+1]!-p[A+1]!,ez=p[B+2]!-p[A+2]!,cx=p[C]!-p[A]!,cy=p[C+1]!-p[A+1]!,cz=p[C+2]!-p[A+2]!,dx=p[D]!-p[A]!,dy=p[D+1]!-p[A+1]!,dz=p[D+2]!-p[A+2]!;
 const l2=ex*ex+ey*ey+ez*ez,nx=ey*cz-ez*cy,ny=ez*cx-ex*cz,nz=ex*cy-ey*cx,mx=dy*ez-dz*ey,my=dz*ex-dx*ez,mz=dx*ey-dy*ex,N=nx*nx+ny*ny+nz*nz,M=mx*mx+my*my+mz*mz;
 if(l2<=1e-24||N<=1e-24*l2||M<=1e-24*l2){g?.fill(0);return;}
 const l=Math.sqrt(l2);if(g){const s=(cx*ex+cy*ey+cz*ez)/l2,t=(dx*ex+dy*ey+dz*ez)/l2;
  g[6]=-l*nx/N;g[7]=-l*ny/N;g[8]=-l*nz/N;g[9]=-l*mx/M;g[10]=-l*my/M;g[11]=-l*mz/M;
  for(let k=0;k<3;k++){g[3+k]=-s*g[6+k]!-t*g[9+k]!;g[k]=-g[3+k]!-g[6+k]!-g[9+k]!;}
 }
 return Math.atan2((ex*(ny*mz-nz*my)+ey*(nz*mx-nx*mz)+ez*(nx*my-ny*mx))/l,nx*mx+ny*my+nz*mz);
}
