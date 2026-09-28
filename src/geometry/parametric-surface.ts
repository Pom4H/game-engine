export type V3=readonly[number,number,number];

export interface ParametricSurface {
  readonly id:string;
  point(u:number,v:number):V3;
}

/** Adaptive render tessellation. The surface stays authoritative; triangles are a projection. */
export function tessellateSurface(surface:ParametricSurface,opts:{errorM:number;maxDepth?:number}){
  const error=opts.errorM,maxDepth=opts.maxDepth??8;
  if(!(error>0)||maxDepth<0||maxDepth>12)throw new RangeError('Invalid tessellation budget');
  const positions:number[]=[],normals:number[]=[],indices:number[]=[];
  const p=(u:number,v:number)=>surface.point(u,v);
  const dist=(a:V3,b:V3)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
  const mix=(a:V3,b:V3,t=.5):V3=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];
  const deviation=(u0:number,v0:number,u1:number,v1:number)=>{
    const a=p(u0,v0),b=p(u1,v0),c=p(u1,v1),d=p(u0,v1),m=p((u0+u1)/2,(v0+v1)/2);
    return dist(m,mix(mix(a,c),mix(b,d)));
  };
  const leaves:{u0:number;v0:number;u1:number;v1:number}[]=[];
  const split=(u0:number,v0:number,u1:number,v1:number,depth:number)=>{
    if(depth>=maxDepth||deviation(u0,v0,u1,v1)<=error){leaves.push({u0,v0,u1,v1});return;}
    const um=(u0+u1)/2,vm=(v0+v1)/2;
    split(u0,v0,um,vm,depth+1);split(um,v0,u1,vm,depth+1);split(u0,vm,um,v1,depth+1);split(um,vm,u1,v1,depth+1);
  };
  split(0,0,1,1,0);
  const key=(u:number,v:number)=>u.toFixed(12)+':'+v.toFixed(12),verts=new Map<string,number>();
  const add=(u:number,v:number)=>{
    const k=key(u,v),old=verts.get(k);if(old!==undefined)return old;
    const q=p(u,v),e=1e-4,pu=p(Math.min(1,u+e),v),pv=p(u,Math.min(1,v+e));
    const au=[pu[0]-q[0],pu[1]-q[1],pu[2]-q[2]],av=[pv[0]-q[0],pv[1]-q[1],pv[2]-q[2]];
    let n:[number,number,number]=[au[1]*av[2]-au[2]*av[1],au[2]*av[0]-au[0]*av[2],au[0]*av[1]-au[1]*av[0]],l=Math.hypot(...n)||1;n=[n[0]/l,n[1]/l,n[2]/l];
    const i=positions.length/3;positions.push(...q);normals.push(...n);verts.set(k,i);return i;
  };
  for(const q of leaves){const a=add(q.u0,q.v0),b=add(q.u1,q.v0),c=add(q.u1,q.v1),d=add(q.u0,q.v1);indices.push(a,b,c,a,c,d);}
  return{kind:'triangle-mesh' as const,positions,normals,indices,patches:leaves.length};
}

/** Reflection-continuity oracle: variation of normals along equal-v samples. Lower is smoother. */
export function normalVariation(surface:ParametricSurface,samples=128){
  const normals:V3[]=[],v=.5,e=1e-4;
  for(let i=0;i<samples;i++){const u=i/(samples-1),q=surface.point(u,v),a=surface.point(Math.min(1,u+e),v),b=surface.point(u,Math.min(1,v+e));const x=[a[0]-q[0],a[1]-q[1],a[2]-q[2]],y=[b[0]-q[0],b[1]-q[1],b[2]-q[2]],n:[number,number,number]=[x[1]*y[2]-x[2]*y[1],x[2]*y[0]-x[0]*y[2],x[0]*y[1]-x[1]*y[0]],l=Math.hypot(...n)||1;normals.push([n[0]/l,n[1]/l,n[2]/l]);}
  let sum=0,max=0;for(let i=1;i<normals.length;i++){const a=normals[i-1]!,b=normals[i]!,d=Math.acos(Math.max(-1,Math.min(1,a[0]*b[0]+a[1]*b[1]+a[2]*b[2])));sum+=d*d;max=Math.max(max,d);}
  return{rmsRad:Math.sqrt(sum/(normals.length-1)),maxRad:max};
}
