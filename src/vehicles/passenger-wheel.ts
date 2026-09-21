import type {Primitive} from '../scene/types.js';
type Mesh=Extract<Primitive,{kind:'triangle-mesh'}>;
type V3=readonly[number,number,number];

export interface RoadWheelGeometrySpec { readonly radius:number; readonly width:number; readonly rimRatio:number; readonly spokes:number; readonly split?:number; readonly dish:number; }

class Builder{
  positions:number[]=[];normals:number[]=[];indices:number[]=[];
  tri(a:V3,b:V3,c:V3){const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2],nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,L=Math.hypot(nx,ny,nz)||1,base=this.positions.length/3;for(const p of [a,b,c]){this.positions.push(...p);this.normals.push(nx/L,ny/L,nz/L);}this.indices.push(base,base+1,base+2);}
  quad(a:V3,b:V3,c:V3,d:V3){this.tri(a,b,c);this.tri(a,c,d);}
  cylinderZ(z0:number,z1:number,r:number,segments=20){for(let i=0;i<segments;i++){const a=i/segments*Math.PI*2,b=(i+1)/segments*Math.PI*2,A:[number,number,number]=[Math.cos(a)*r,Math.sin(a)*r,z0],B:[number,number,number]=[Math.cos(b)*r,Math.sin(b)*r,z0],C:[number,number,number]=[Math.cos(b)*r,Math.sin(b)*r,z1],D:[number,number,number]=[Math.cos(a)*r,Math.sin(a)*r,z1];this.quad(A,B,C,D);}}
  mesh():Mesh{return{kind:'triangle-mesh',positions:this.positions,normals:this.normals,indices:this.indices};}
}

/** Mature TheGame road-wheel topology, expressed as engine-native indexed-source geometry.
 * The wheel axis is Z in game-engine vehicle space; render compilation may reindex later. */
export function detailedRoadWheelMeshes(p:RoadWheelGeometrySpec,side:-1|1):{tire:Mesh;rim:Mesh}{
  const radius=p.radius,half=p.width/2,segments=24,ratio=p.rimRatio,rr=(r:number)=>r*ratio/.70,tire=new Builder(),rim=new Builder();
  const ring=(out:Builder,points:readonly (readonly [axial:number,radial:number])[])=>{
    for(let j=0;j<points.length-1;j++)for(let i=0;i<segments;i++){
      const a=i/segments*Math.PI*2,b=(i+1)/segments*Math.PI*2,map=(q:readonly[number,number],angle:number):V3=>[Math.sin(angle)*q[1],Math.cos(angle)*q[1],q[0]];
      out.quad(map(points[j]!,a),map(points[j]!,b),map(points[j+1]!,b),map(points[j+1]!,a));
    }
  };
  ring(tire,[[-half*.78,rr(radius*.69)],[-half,radius*.79],[-half*.98,radius*.90],[-half*.77,radius*.985],[-half*.53,radius],[half*.53,radius],[half*.77,radius*.985],[half*.98,radius*.90],[half,radius*.79],[half*.78,rr(radius*.69)]]);
  ring(rim,[[-half*.81,rr(radius*.69)],[-half*.81,rr(radius*.63)],[half*.81,rr(radius*.63)],[half*.81,rr(radius*.69)]]);
  const z=side*half*.82;
  ring(rim,[[z-side*radius*.025,rr(radius*.61)],[z+side*radius*.008,rr(radius*.645)],[z+side*radius*.008,rr(radius*.70)],[z-side*radius*.025,rr(radius*.71)]]);
  // Recessed rotor + hub/nuts share the same causal wheel package instead of separate FBX hardware.
  rim.cylinderZ(z-side*radius*.12,z-side*radius*.09,radius*.51,24);
  const spokes=p.spokes,split='split' in p&&typeof (p as any).split==='number'?(p as any).split:0,branches=split>0?2:1,dish=p.dish;
  for(let i=0;i<spokes*branches;i++){
    const a=Math.floor(i/branches)*Math.PI*2/spokes+(branches===2?(i%2?1:-1)*split/radius:0),radial:[number,number]=[Math.cos(a),Math.sin(a)],tangent:[number,number]=[-Math.sin(a),Math.cos(a)];
    const pt=(r:number,w:number,depth:number):V3=>{const stem=branches===2?(i%2?1:-1)*split*(1-clamp((r-radius*.30)/(radius*.44))):0,axial=z+side*depth;return[radial[1]*r+tangent[1]*(w-stem),radial[0]*r+tangent[0]*(w-stem),axial];};
    const w0=radius*(split?.025:.066),w1=radius*(split?.020:.041),a0=pt(radius*.16,-w0,-dish),b0=pt(rr(radius*.64),-w1,0),c0=pt(rr(radius*.64),w1,0),d0=pt(radius*.16,w0,-dish),a1=pt(radius*.16,-w0,-radius*.07),b1=pt(rr(radius*.64),-w1,-radius*.05),c1=pt(rr(radius*.64),w1,-radius*.05),d1=pt(radius*.16,w0,-radius*.07);
    const faces:[V3,V3,V3,V3][]=[[a0,b0,c0,d0],[a1,d1,c1,b1],[a0,a1,b1,b0],[b0,b1,c1,c0],[c0,c1,d1,d0],[d0,d1,a1,a0]];
    for(const q of faces){if(side<0)rim.quad(q[3],q[2],q[1],q[0]);else rim.quad(...q);}
    if(i<5){const aa=i*Math.PI*2/5,x=Math.sin(aa)*radius*.135,y=Math.cos(aa)*radius*.135,rrr=radius*.022;for(let k=0;k<6;k++){const u=k/6*Math.PI*2,v=(k+1)/6*Math.PI*2,A:[number,number,number]=[x+Math.sin(u)*rrr,y+Math.cos(u)*rrr,z],B:[number,number,number]=[x+Math.sin(v)*rrr,y+Math.cos(v)*rrr,z],C:[number,number,number]=[x+Math.sin(v)*rrr,y+Math.cos(v)*rrr,z+side*radius*.024],D:[number,number,number]=[x+Math.sin(u)*rrr,y+Math.cos(u)*rrr,z+side*radius*.024];rim.quad(A,B,C,D);}}
  }
  rim.cylinderZ(z-side*radius*.035,z+side*radius*.014,radius*.195,20);
  rim.cylinderZ(z+side*radius*.016,z+side*radius*.020,radius*.082,16);
  return{tire:tire.mesh(),rim:rim.mesh()};
}
export function detailedPassengerWheelMeshes(profile:{readonly dimensions:{readonly wheelRadius:number};readonly wheel:Omit<RoadWheelGeometrySpec,'radius'>},side:-1|1){return detailedRoadWheelMeshes({radius:profile.dimensions.wheelRadius,...profile.wheel},side);}
const clamp=(v:number,a=0,b=1)=>Math.max(a,Math.min(b,v));
