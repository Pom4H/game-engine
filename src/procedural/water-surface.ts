export interface WaterSurfaceMesh {positions:number[];normals:number[];indices:number[];/** Optional optical depth in metres, one value per emitted vertex. */depths?:number[]}
export interface WaterSurfaceCell {
 readonly x:number;readonly z:number;readonly size:number;readonly bedM:number;readonly depthM:number;
 /** At most 2*segments² film faces, or 4*segments² after shoreline clipping. */
 readonly segments?:number;readonly biasM?:number;readonly maximumStepM?:number;
}
/** Reconstruct a shallow flowing film on the actual substrate. A cell-centred
 * horizontal plane cuts through inclines and creates alternating wet/dry bands.
 * Deep standing water remains horizontal; disconnected supports never join.
 * This is presentation only: the caller retains ownership of water volume. */
export function appendWaterSurfaceCell(mesh:WaterSurfaceMesh,cell:WaterSurfaceCell,sample:(x:number,z:number)=>number|null):void{
 const {x,z,size,bedM,depthM}=cell,segments=cell.segments??1,bias=cell.biasM??.004,maximumStep=cell.maximumStepM??.8;
 if(![x,z,size,bedM,depthM,bias,maximumStep].every(Number.isFinite)||size<=0||depthM<0||bias<0||maximumStep<=0||!Number.isInteger(segments)||segments<1||segments>16)throw new RangeError('Invalid water surface cell');
 const points:Array<readonly[number,number,number]|null>=[];let low=Infinity,high=-Infinity;
 for(let iz=0;iz<=segments;iz++)for(let ix=0;ix<=segments;ix++){
  const px=x+ix*size/segments,pz=z+iz*size/segments,y=sample(px,pz);
  if(y===null){points.push(null);continue;}if(!Number.isFinite(y))throw new RangeError('Nonfinite water substrate');
  low=Math.min(low,y);high=Math.max(high,y);points.push([px,y,pz]);
 }
 if(!Number.isFinite(low))return;
 const relief=high-low,t=relief>1e-8?Math.max(0,Math.min(1,(depthM-relief)/relief)):1,standing=t*t*(3-2*t),level=bedM+depthM;
 const triangle=(ia:number,ib:number,ic:number)=>{
  const support=[points[ia],points[ib],points[ic]];if(support.some(p=>!p))return;
  const heights=support.map(p=>p![1]);if(Math.max(...heights)-Math.min(...heights)>maximumStep)return;
  const polygon=support.map(p=>{const y=(p![1]+depthM)*(1-standing)+level*standing+bias;return[p![0],y,p![2],y-p![1]-bias];});
  // A standing level can meet a shoreline. Clip in the same substrate triangle
  // rather than pushing the submerged part through its ground surface.
  let clipped:number[][]=[];
  for(let k=0;k<3;k++){
   const a=polygon[k]!,b=polygon[(k+1)%3]!,da=a[1]!-heights[k]!,db=b[1]!-heights[(k+1)%3]!;
   if(da>=0)clipped.push(a);
   if((da>=0)!==(db>=0)){const f=da/(da-db);clipped.push(a.map((v,j)=>v+(b[j]!-v)*f));}
  }
  for(let k=1;k<clipped.length-1;k++){
   const a=clipped[0]!,b=clipped[k]!,c=clipped[k+1]!,ux=b[0]!-a[0]!,uy=b[1]!-a[1]!,uz=b[2]!-a[2]!,vx=c[0]!-a[0]!,vy=c[1]!-a[1]!,vz=c[2]!-a[2]!;
   const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,length=Math.hypot(nx,ny,nz);if(length<1e-12)continue;
   const offset=mesh.positions.length/3;for(const p of [a,b,c]){mesh.positions.push(p[0]!,p[1]!,p[2]!);mesh.normals.push(nx/length,ny/length,nz/length);mesh.depths?.push(Math.max(0,p[3]!));}mesh.indices.push(offset,offset+1,offset+2);
  }
 };
 for(let iz=0;iz<segments;iz++)for(let ix=0;ix<segments;ix++){const a=iz*(segments+1)+ix,b=a+1,c=a+segments+1,d=c+1;triangle(a,c,b);triangle(b,c,d);}
}
