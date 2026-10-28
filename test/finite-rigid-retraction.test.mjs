import test from 'node:test';
import assert from 'node:assert/strict';
import {finiteRigidDisplacement} from '../dist/physics/finite-rigid-retraction.js';
import {MaterialFrameRotation} from '../dist/physics/material-frame-rotation.js';

const mass=Float64Array.of(1,2,3,4),p=Float64Array.of(-.8,-.3,-.5,.7,-.2,-.1,-.2,.8,-.4,.1,.1,.9);
const close=(a,b,tol=1e-11)=>{assert.equal(a.length,b.length);for(let i=0;i<a.length;i++)assert.ok(Math.abs(a[i]-b[i])<=tol,`index${i}: ${a[i]} vs ${b[i]}`);};
function center(x,m=mass){const c=[0,0,0],M=m.reduce((s,v)=>s+v,0);for(let i=0;i<m.length;i++)for(let k=0;k<3;k++)c[k]+=x[i*3+k]*m[i]/M;return c;}
function rotate(x,w){const a=Math.hypot(...w),s=a?Math.sin(a)/a:1,t=a?(1-Math.cos(a))/(a*a):.5,cross=[w[1]*x[2]-w[2]*x[1],w[2]*x[0]-w[0]*x[2],w[0]*x[1]-w[1]*x[0]],double=[w[1]*cross[2]-w[2]*cross[1],w[2]*cross[0]-w[0]*cross[2],w[0]*cross[1]-w[1]*cross[0]];return x.map((v,k)=>v+s*cross[k]+t*double[k]);}

test('finite contact rigid modes preserve translation, lengths, centroid and rotating inertia',()=>{
 const c=center(p),w=[.4,-.7,.8],translation=[.3,-.4,.2],tangent=new Float64Array(p.length),out=new Float64Array(p.length),expected=new Float64Array(p.length);
 for(let i=0;i<mass.length;i++){const j=i*3,r=[p[j]-c[0],p[j+1]-c[1],p[j+2]-c[2]],R=rotate(r,w),cross=[w[1]*r[2]-w[2]*r[1],w[2]*r[0]-w[0]*r[2],w[0]*r[1]-w[1]*r[0]];for(let k=0;k<3;k++){tangent[j+k]=translation[k]+cross[k];expected[j+k]=c[k]+translation[k]+R[k];}}
 finiteRigidDisplacement(p,mass,tangent,1,out);const actual=p.map((v,i)=>v+out[i]);close(actual,expected);close(center(actual),c.map((v,k)=>v+translation[k]));
 for(let i=0;i<mass.length;i++)for(let j=i+1;j<mass.length;j++)assert.ok(Math.abs(Math.hypot(...[0,1,2].map(k=>actual[i*3+k]-actual[j*3+k]))-Math.hypot(...[0,1,2].map(k=>p[i*3+k]-p[j*3+k])))<1e-12);
 // The complete second moment rotates with the same finite material frame.
 const a=center(actual);for(const axis of [[1,0,0],[0,1,0],[0,0,1]]){const rotated=rotate(axis,w);let before=0,after=0;for(let i=0;i<mass.length;i++){const r=[0,1,2].map(k=>p[i*3+k]-c[k]),s=[0,1,2].map(k=>actual[i*3+k]-a[k]);before+=mass[i]*(r.reduce((sum,v,k)=>sum+v*axis[k],0))**2;after+=mass[i]*(s.reduce((sum,v,k)=>sum+v*rotated[k],0))**2;}assert.ok(Math.abs(before-after)<1e-11);}
 tangent.set(p.map((_,j)=>translation[j%3]));finiteRigidDisplacement(p,mass,tangent,.8,out);close(out,tangent.map(v=>v*.8));
});

test('the finite contact map has the original zero-step Jacobian and leaves internal zero-moment rows unchanged',()=>{
 const tangent=Float64Array.from(p,(_,j)=>Math.sin(j*.63)),out=new Float64Array(p.length),h=1e-7;finiteRigidDisplacement(p,mass,tangent,h,out);close(out.map(v=>v/h),tangent,2e-7);
 const c=center(p),internal=p.map((v,j)=>(v-c[j%3])*.2);for(const scale of [-.7,.3,1]){finiteRigidDisplacement(p,mass,internal,scale,out);close(out,internal.map(v=>v*scale));}
});

test('finite contact retraction is rotation covariant and retains observable rod rotation',()=>{
 const w=[.8,.4,-.6],translation=[2,-3,1],tangent=p.map((_,j)=>Math.cos(j*.7)),q=new Float64Array(p.length),d=new Float64Array(p.length),out=new Float64Array(p.length),rotated=new Float64Array(p.length);for(let i=0;i<mass.length;i++){const j=i*3,x=rotate(Array.from(p.slice(j,j+3)),w),v=rotate(Array.from(tangent.slice(j,j+3)),w);for(let k=0;k<3;k++){q[j+k]=x[k]+translation[k];d[j+k]=v[k];}}
 finiteRigidDisplacement(p,mass,tangent,.7,out);finiteRigidDisplacement(q,mass,d,.7,rotated);for(let i=0;i<mass.length;i++)close(rotate(Array.from(out.slice(i*3,i*3+3)),w),rotated.slice(i*3,i*3+3));
 const rod=Float64Array.of(-1,0,0,1,0,0),rodMass=Float64Array.of(1,1),delta=Float64Array.of(0,-.7,0,0,.7,0),r=new Float64Array(6);finiteRigidDisplacement(rod,rodMass,delta,1,r);const final=rod.map((v,i)=>v+r[i]);assert.ok(Math.abs(Math.hypot(...[0,1,2].map(k=>final[k]-final[k+3]))-2)<1e-12);
});

test('cached material tangent frame follows proper rotations, including flat sheets',()=>{
 for(const from of [p,Float64Array.of(-1,0,-1,1,0,-1,-1,0,1,1,0,1)]){const w=[.8,1.4,-.4],to=from.map((_,j)=>rotate(Array.from(from.slice(Math.floor(j/3)*3,Math.floor(j/3)*3+3)),w)[j%3]+[2,-1,3][j%3]),fit=new MaterialFrameRotation().fit(from,to,mass);for(let i=0;i<from.length;i+=3){const x=Array.from(from.slice(i,i+3)),actual=[0,1,2].map(k=>fit[k*3]*x[0]+fit[k*3+1]*x[1]+fit[k*3+2]*x[2]);close(actual,rotate(x,w));}}
});
