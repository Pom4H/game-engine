/** Proper mass-weighted rotation from a frozen tangent frame to its current
 * material pose. Horn's symmetric quaternion eigenproblem also supports flat
 * sheets without inverting their small through-thickness covariance. */
export class MaterialFrameRotation{
 readonly matrix=Float64Array.of(1,0,0,0,1,0,0,0,1);
 private readonly a=new Float64Array(16);private readonly v=new Float64Array(16);
 fit(from:Float64Array,to:Float64Array,mass:Float64Array){
  let M=0,fx=0,fy=0,fz=0,tx=0,ty=0,tz=0;for(let i=0;i<mass.length;i++){const m=mass[i]!;if(m<=0)continue;const j=i*3;M+=m;fx+=m*from[j]!;fy+=m*from[j+1]!;fz+=m*from[j+2]!;tx+=m*to[j]!;ty+=m*to[j+1]!;tz+=m*to[j+2]!;}if(!(M>0))return this.matrix;fx/=M;fy/=M;fz/=M;tx/=M;ty/=M;tz/=M;
  let xx=0,xy=0,xz=0,yx=0,yy=0,yz=0,zx=0,zy=0,zz=0;for(let i=0;i<mass.length;i++){const m=mass[i]!;if(m<=0)continue;const j=i*3,x=from[j]!-fx,y=from[j+1]!-fy,z=from[j+2]!-fz,u=to[j]!-tx,v=to[j+1]!-ty,w=to[j+2]!-tz;xx+=m*x*u;xy+=m*x*v;xz+=m*x*w;yx+=m*y*u;yy+=m*y*v;yz+=m*y*w;zx+=m*z*u;zy+=m*z*v;zz+=m*z*w;}
  const a=this.a,v=this.v;a[0]=xx+yy+zz;a[1]=a[4]=yz-zy;a[2]=a[8]=zx-xz;a[3]=a[12]=xy-yx;a[5]=xx-yy-zz;a[6]=a[9]=xy+yx;a[7]=a[13]=xz+zx;a[10]=-xx+yy-zz;a[11]=a[14]=yz+zy;a[15]=-xx-yy+zz;v.fill(0);v[0]=v[5]=v[10]=v[15]=1;const norm=Math.max(...a.map(Math.abs));
  for(let iteration=0;iteration<64;iteration++){let p=0,q=1,largest=0;for(let i=0;i<4;i++)for(let j=i+1;j<4;j++)if(Math.abs(a[i*4+j]!)>largest){largest=Math.abs(a[i*4+j]!);p=i;q=j;}if(largest<=Number.EPSILON*norm)break;const angle=.5*Math.atan2(2*a[p*4+q]!,a[q*4+q]!-a[p*4+p]!),c=Math.cos(angle),s=Math.sin(angle);for(let k=0;k<4;k++){const ap=a[k*4+p]!,aq=a[k*4+q]!;a[k*4+p]=c*ap-s*aq;a[k*4+q]=s*ap+c*aq;const vp=v[k*4+p]!,vq=v[k*4+q]!;v[k*4+p]=c*vp-s*vq;v[k*4+q]=s*vp+c*vq;}for(let k=0;k<4;k++){const ap=a[p*4+k]!,aq=a[q*4+k]!;a[p*4+k]=c*ap-s*aq;a[q*4+k]=s*ap+c*aq;}}
  let best=0;for(let k=1;k<4;k++)if(a[k*4+k]!>a[best*4+best]!)best=k;const w=v[best]!,x=v[4+best]!,y=v[8+best]!,z=v[12+best]!,r=this.matrix;r[0]=1-2*(y*y+z*z);r[1]=2*(x*y-z*w);r[2]=2*(x*z+y*w);r[3]=2*(x*y+z*w);r[4]=1-2*(x*x+z*z);r[5]=2*(y*z-x*w);r[6]=2*(x*z-y*w);r[7]=2*(y*z+x*w);r[8]=1-2*(x*x+y*y);return r;
 }
}
