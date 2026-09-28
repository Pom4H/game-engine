import type {MutableVec3,Vec3} from '../math.js';
export type Quaternion=readonly[number,number,number,number];
/** Rx*Ry*Rz, the exact convention shared by compose(), ForceFrame and PhysicsWorld. */
export function quaternionFromEuler(r:Vec3,out:Float64Array=new Float64Array(4)):Float64Array {
 const x=r[0]/2,y=r[1]/2,z=r[2]/2,sx=Math.sin(x),cx=Math.cos(x),sy=Math.sin(y),cy=Math.cos(y),sz=Math.sin(z),cz=Math.cos(z);
 out[0]=sx*cy*cz+cx*sy*sz;out[1]=cx*sy*cz-sx*cy*sz;out[2]=cx*cy*sz+sx*sy*cz;out[3]=cx*cy*cz-sx*sy*sz;return out;
}
export function eulerFromQuaternion(q:ArrayLike<number>,out:MutableVec3):void {
 const x=q[0]!,y=q[1]!,z=q[2]!,w=q[3]!,s=Math.max(-1,Math.min(1,2*(x*z+y*w)));
 out[1]=Math.asin(s);
 if(Math.abs(s)<1-1e-12){out[0]=Math.atan2(2*(x*w-y*z),1-2*(x*x+y*y));out[2]=Math.atan2(2*(z*w-x*y),1-2*(y*y+z*z));}
 else{out[0]=Math.sign(s)*Math.atan2(2*(x*y+z*w),1-2*(x*x+z*z));out[2]=0;}
}
/** Exp(world angular velocity * dt) pre-multiplies the orientation; world omega is NOT Euler rate.
 * Scratch belongs to the integrator, not to a second authoritative orientation state. */
export function advanceRotation(r:MutableVec3,omega:Vec3,dt:number,q:Float64Array):void {
 const speed=Math.hypot(...omega);if(speed<1e-14)return;
 quaternionFromEuler(r,q);const a=speed*dt/2,s=Math.sin(a)/speed,x=omega[0]*s,y=omega[1]*s,z=omega[2]*s,w=Math.cos(a);
 const qx=q[0]!,qy=q[1]!,qz=q[2]!,qw=q[3]!;
 q[0]=w*qx+x*qw+y*qz-z*qy;q[1]=w*qy-x*qz+y*qw+z*qx;q[2]=w*qz+x*qy-y*qx+z*qw;q[3]=w*qw-x*qx-y*qy-z*qz;
 const ox=r[0],oy=r[1],oz=r[2];eulerFromQuaternion(q,r);
 // Equivalent Euler charts are chosen nearest the prior chart; a wheel keeps unwrapped spin.
 const tau=2*Math.PI,rx=r[0],ry=r[1],rz=r[2];
 const dx=rx+Math.round((ox-rx)/tau)*tau,dy=ry+Math.round((oy-ry)/tau)*tau,dz=rz+Math.round((oz-rz)/tau)*tau;
 const ax=rx+Math.PI+Math.round((ox-rx-Math.PI)/tau)*tau,ay=Math.PI-ry+Math.round((oy+ry-Math.PI)/tau)*tau,az=rz+Math.PI+Math.round((oz-rz-Math.PI)/tau)*tau;
 const alternate=(ax-ox)**2+(ay-oy)**2+(az-oz)**2<(dx-ox)**2+(dy-oy)**2+(dz-oz)**2;
 r[0]=alternate?ax:dx;r[1]=alternate?ay:dy;r[2]=alternate?az:dz;
}
/** Shortest spherical orientation interpolation, including antipodal quaternion representations. */
export function sampleQuaternion(a:ArrayLike<number>,b:ArrayLike<number>,offset:number,t:number,out:Float64Array):void {
 let dot=0;for(let k=0;k<4;k++)dot+=a[offset+k]!*b[offset+k]!;
 const sign=dot<0?-1:1;dot=Math.min(1,Math.abs(dot));const angle=Math.acos(dot),sn=Math.sin(angle);
 const x=sn>1e-6?Math.sin((1-t)*angle)/sn:1-t,y=(sn>1e-6?Math.sin(t*angle)/sn:t)*sign;
 let norm=0;for(let k=0;k<4;k++){const v=a[offset+k]!*x+b[offset+k]!*y;out[offset+k]=v;norm+=v*v;}
 norm=Math.sqrt(norm);for(let k=0;k<4;k++)out[offset+k]!/=norm;
}

/** Convert the shared column-major f64 body basis into the renderer's Euler chart.
 * Pure numeric boundary; output is caller-owned and may be reused. */
export function eulerFromBasis(b:ArrayLike<number>,out:MutableVec3):void {
 out[1]=Math.asin(Math.max(-1,Math.min(1,b[6]!)));
 if(Math.abs(Math.cos(out[1]))>1e-7){out[0]=Math.atan2(-b[7]!,b[8]!);out[2]=Math.atan2(-b[3]!,b[0]!);}else{out[0]=Math.sign(b[6]!)*Math.atan2(b[1]!,b[4]!);out[2]=0;}
}
