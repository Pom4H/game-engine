/** Retract a tangent displacement on the mass-orthogonal rigid modes.
 * The internal field stays linear; only the angular rigid mode uses SO(3).
 * Thus the derivative at zero is exactly the supplied displacement, without
 * the fictitious O(angle²) stretch of an infinitesimal rigid rotation. */
export function finiteRigidDisplacement(position:Float64Array,mass:Float64Array,tangent:Float64Array,scale:number,out:Float64Array,ids?:readonly number[],gradient?:Float64Array,target?:number,minScale=-Infinity){
 let M=0,cx=0,cy=0,cz=0;for(let i=0;i<mass.length;i++){const m=mass[i]!;if(m<=0)continue;const j=i*3;M+=m;cx+=m*position[j]!;cy+=m*position[j+1]!;cz+=m*position[j+2]!;}if(!(M>0)){out.fill(0);return 0;}cx/=M;cy/=M;cz/=M;
 let xx=0,yy=0,zz=0,xy=0,xz=0,yz=0,lx=0,ly=0,lz=0;
 for(let i=0;i<mass.length;i++){const m=mass[i]!;if(m<=0)continue;const j=i*3,x=position[j]!-cx,y=position[j+1]!-cy,z=position[j+2]!-cz,a=tangent[j]!,b=tangent[j+1]!,c=tangent[j+2]!;xx+=m*(y*y+z*z);yy+=m*(x*x+z*z);zz+=m*(x*x+y*y);xy-=m*x*y;xz-=m*x*z;yz-=m*y*z;lx+=m*(y*c-z*b);ly+=m*(z*a-x*c);lz+=m*(x*b-y*a);}
 const determinant=xx*(yy*zz-yz*yz)-xy*(xy*zz-xz*yz)+xz*(xy*yz-xz*yy),trace=xx+yy+zz;let wx=0,wy=0,wz=0;
 if(Math.abs(determinant)>1e-18*trace**3){wx=((yy*zz-yz*yz)*lx+(xz*yz-xy*zz)*ly+(xy*yz-xz*yy)*lz)/determinant;wy=((xz*yz-xy*zz)*lx+(xx*zz-xz*xz)*ly+(xy*xz-xx*yz)*lz)/determinant;wz=((xy*yz-xz*yy)*lx+(xy*xz-xx*yz)*ly+(xx*yy-xy*xy)*lz)/determinant;}
 else if(trace>0){
  // A rod has a physical null spin about its axis. Use the Moore--Penrose
  // inverse rather than deleting its two observable angular modes.
  const a=[xx,xy,xz,xy,yy,yz,xz,yz,zz],v=[1,0,0,0,1,0,0,0,1];
  for(let sweep=0;sweep<12;sweep++){let p=0,q=1;if(Math.abs(a[2]!)>Math.abs(a[1]!)){p=0;q=2;}if(Math.abs(a[5]!)>Math.abs(a[p*3+q]!)){p=1;q=2;}const off=a[p*3+q]!;if(Math.abs(off)<=Number.EPSILON*trace)break;const angle=.5*Math.atan2(2*off,a[q*3+q]!-a[p*3+p]!),c=Math.cos(angle),s=Math.sin(angle);for(let k=0;k<3;k++){const ap=a[k*3+p]!,aq=a[k*3+q]!;a[k*3+p]=c*ap-s*aq;a[k*3+q]=s*ap+c*aq;const vp=v[k*3+p]!,vq=v[k*3+q]!;v[k*3+p]=c*vp-s*vq;v[k*3+q]=s*vp+c*vq;}for(let k=0;k<3;k++){const ap=a[p*3+k]!,aq=a[q*3+k]!;a[p*3+k]=c*ap-s*aq;a[q*3+k]=s*ap+c*aq;}}
  for(let k=0;k<3;k++){const eigen=a[k*3+k]!;if(eigen<=Number.EPSILON*trace)continue;const amount=(v[k]!*lx+v[3+k]!*ly+v[6+k]!*lz)/eigen;wx+=v[k]!*amount;wy+=v[3+k]!*amount;wz+=v[6+k]!*amount;}
 }
 const angular=Math.hypot(wx,wy,wz);
 if(ids&&gradient&&target!==undefined&&scale!==0&&angular>0){
  let linear=0,cross=0,doubleCross=0;for(let a=0;a<ids.length;a++){const j=ids[a]!*3,x=position[j]!-cx,y=position[j+1]!-cy,z=position[j+2]!-cz,ux=wy*z-wz*y,uy=wz*x-wx*z,uz=wx*y-wy*x,gx=gradient[a*3]!,gy=gradient[a*3+1]!,gz=gradient[a*3+2]!;linear+=gx*tangent[j]!+gy*tangent[j+1]!+gz*tangent[j+2]!;cross+=gx*ux+gy*uy+gz*uz;doubleCross+=gx*(wy*uz-wz*uy)+gy*(wz*ux-wx*uz)+gz*(wx*uy-wy*ux);}
  const sign=Math.sign(scale),goal=sign*target,limit=sign<0?-minScale:Infinity;
  const value=(u:number)=>{const a=angular*u,q=a*a,sinc=a<1e-4?-q/6+q*q/120:Math.sin(a)/a-1,cosc=a<1e-4?.5-q/24+q*q/720:(1-Math.cos(a))/q;return u*(linear+sinc*cross)+sign*u*u*cosc*doubleCross;};
  const derivative=(u:number)=>{const a=angular*u;return linear+(Math.cos(a)-1)*cross+sign*Math.sin(a)/angular*doubleCross;};
  let lo=0,hi=Math.min(Math.abs(scale),limit),v=value(hi);for(let bracket=0;v<goal&&hi<limit&&bracket<32;bracket++){hi=Math.min(hi*2,limit);v=value(hi);}if(v>=goal){let u=Math.min(Math.abs(scale),hi);for(let iteration=0;iteration<32;iteration++){const error=value(u)-goal;if(Math.abs(error)<=1e-13*Math.max(1,Math.abs(goal)))break;if(error<0)lo=u;else hi=u;const next=u-error/derivative(u);u=Number.isFinite(next)&&next>lo&&next<hi?next:(lo+hi)*.5;}scale=sign*u;}else scale=sign*hi;
 }
 const angle=angular*Math.abs(scale),s=angle<1e-4?-angle*angle/6+angle**4/120:Math.sin(angle)/angle-1,t=angle<1e-4?.5-angle*angle/24+angle**4/720:(1-Math.cos(angle))/(angle*angle),ax=wx*scale,ay=wy*scale,az=wz*scale;
 for(let i=0;i<mass.length;i++){const j=i*3;if(mass[i]!<=0){out[j]=out[j+1]=out[j+2]=0;continue;}const x=position[j]!-cx,y=position[j+1]!-cy,z=position[j+2]!-cz,ux=ay*z-az*y,uy=az*x-ax*z,uz=ax*y-ay*x;out[j]=scale*tangent[j]!+s*ux+t*(ay*uz-az*uy);out[j+1]=scale*tangent[j+1]!+s*uy+t*(az*ux-ax*uz);out[j+2]=scale*tangent[j+2]!+s*uz+t*(ax*uy-ay*ux);}return scale;
}
