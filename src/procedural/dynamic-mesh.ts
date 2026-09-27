/** Runtime-owned fixed-topology mesh. commit() updates normals/one interleaved buffer.
 * No geometry cache keyed by all vertex bytes; topology changes require a new mesh. */
let serial=0;
export class DynamicMesh {
 readonly kind='triangle-mesh' as const;readonly key=`dynamic:${++serial}`;
 readonly positions:number[];readonly normals:number[];readonly indices:readonly number[];
 readonly vertices:Float32Array;revision=0;
 constructor(positions:readonly number[],indices:readonly number[]){
  if(!positions.length||positions.length%3||positions.some(n=>!Number.isFinite(n))||indices.length%3||indices.some(i=>!Number.isInteger(i)||i<0||i>=positions.length/3))throw new RangeError('Invalid dynamic mesh');
  this.positions=[...positions];this.normals=Array(positions.length).fill(0);this.indices=Object.freeze([...indices]);this.vertices=new Float32Array(positions.length*2);this.commit();
 }
 commit():void {
  const p=this.positions,n=this.normals;
  if(p.length*2!==this.vertices.length||p.some(v=>!Number.isFinite(v)))throw new RangeError('Dynamic vertex buffer changed shape or contains nonfinite values');
  n.fill(0);
  for(let i=0;i<this.indices.length;i+=3){
   const a=this.indices[i]!*3,b=this.indices[i+1]!*3,c=this.indices[i+2]!*3;
   const ux=p[b]!-p[a]!,uy=p[b+1]!-p[a+1]!,uz=p[b+2]!-p[a+2]!,vx=p[c]!-p[a]!,vy=p[c+1]!-p[a+1]!,vz=p[c+2]!-p[a+2]!;
   const x=uy*vz-uz*vy,y=uz*vx-ux*vz,z=ux*vy-uy*vx;for(const j of [a,b,c]){n[j]!+=x;n[j+1]!+=y;n[j+2]!+=z;}
  }
  for(let i=0;i<p.length;i+=3){const length=Math.hypot(n[i]!,n[i+1]!,n[i+2]!)||1;
   for(let a=0;a<3;a++){n[i+a]!/=length;this.vertices[i*2+a]=p[i+a]!;this.vertices[i*2+3+a]=n[i+a]!;}}
  this.revision++;
 }
}
