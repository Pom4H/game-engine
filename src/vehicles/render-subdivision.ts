import type {Primitive} from '../scene/types.js';

export type TriangleMesh=Extract<Primitive,{kind:'triangle-mesh'}>;
export interface SmoothSubdivisionPlan {
  readonly sourceTriangles:number;
  /** Per source triangle: edge 0-1, 1-2, 2-0 may curve. Creases/boundaries remain linear. */
  readonly smoothEdges:readonly (readonly [boolean,boolean,boolean])[];
  readonly maxDisplacementM:number;
}

type EdgeRecord={a:number;b:number};
type EdgeInfo={ka:string;kb:string;records:EdgeRecord[];smooth?:boolean};

const normal=(mesh:TriangleMesh,index:number):readonly[number,number,number]=>[
  mesh.normals[index*3]!,mesh.normals[index*3+1]!,mesh.normals[index*3+2]!,
];
const position=(mesh:TriangleMesh,index:number):readonly[number,number,number]=>[
  mesh.positions[index*3]!,mesh.positions[index*3+1]!,mesh.positions[index*3+2]!,
];
const positionKey=(mesh:TriangleMesh,index:number)=>`${mesh.positions[index*3]},${mesh.positions[index*3+1]},${mesh.positions[index*3+2]}`;
const dot=(a:readonly number[],b:readonly number[])=>a[0]!*b[0]!+a[1]!*b[1]!+a[2]!*b[2]!;
const normalize=(v:readonly[number,number,number]):[number,number,number]=>{const l=Math.hypot(...v)||1;return[v[0]/l,v[1]/l,v[2]/l];};

export function buildSmoothSubdivisionPlan(mesh:TriangleMesh,creaseDegrees=35,maxDisplacementM=.018):SmoothSubdivisionPlan{
  if(mesh.indices.length%3)throw new RangeError('Subdivision requires triangle indices');
  if(!Number.isFinite(creaseDegrees)||creaseDegrees<=0||creaseDegrees>=90)throw new RangeError('creaseDegrees must be in (0,90)');
  if(!Number.isFinite(maxDisplacementM)||maxDisplacementM<0||maxDisplacementM>.1)throw new RangeError('Invalid subdivision displacement');
  const vertexCount=mesh.positions.length/3;
  if(mesh.normals.length!==mesh.positions.length)throw new RangeError('Subdivision positions/normals differ');
  for(const index of mesh.indices)if(index<0||index>=vertexCount)throw new RangeError('Subdivision index out of range');

  const keys=Array.from({length:vertexCount},(_,index)=>positionKey(mesh,index)),edges=new Map<string,EdgeInfo>();
  const edgeInfo=(a:number,b:number)=>{
    const ka=keys[a]!,kb=keys[b]!,lo=ka<kb?ka:kb,hi=ka<kb?kb:ka,key=lo+'|'+hi;
    let edge=edges.get(key);if(!edge){edge={ka:lo,kb:hi,records:[]};edges.set(key,edge);}
    edge.records.push({a,b});return edge;
  };
  const triangleEdges:EdgeInfo[][]=[];
  for(let i=0;i<mesh.indices.length;i+=3){
    const a=mesh.indices[i]!,b=mesh.indices[i+1]!,c=mesh.indices[i+2]!;
    triangleEdges.push([edgeInfo(a,b),edgeInfo(b,c),edgeInfo(c,a)]);
  }
  const cosine=Math.cos(creaseDegrees*Math.PI/180);
  for(const edge of edges.values()){
    // Open boundaries keep the exact imported silhouette. Shared edges curve only
    // when the source normals agree on both geometric endpoints.
    if(edge.records.length!==2){edge.smooth=false;continue;}
    const reference=new Map<string,readonly[number,number,number]>();
    let smooth=true;
    for(const record of edge.records){
      for(const index of [record.a,record.b]){
        const key=keys[index]!,n=normal(mesh,index),seen=reference.get(key);
        if(seen&&dot(seen,n)<cosine){smooth=false;break;}
        if(!seen)reference.set(key,n);
      }
      if(!smooth)break;
    }
    edge.smooth=smooth;
  }
  return Object.freeze({
    sourceTriangles:mesh.indices.length/3,
    smoothEdges:Object.freeze(triangleEdges.map(edges=>Object.freeze(edges.map(edge=>!!edge.smooth) as [boolean,boolean,boolean]))),
    maxDisplacementM,
  });
}

function midpoint(mesh:TriangleMesh,a:number,b:number,smooth:boolean,maxDisplacementM:number):{p:[number,number,number];n:[number,number,number]}{
  const pa=position(mesh,a),pb=position(mesh,b),na=normal(mesh,a),nb=normal(mesh,b);
  const linear:[number,number,number]=[(pa[0]+pb[0])*.5,(pa[1]+pb[1])*.5,(pa[2]+pb[2])*.5];
  const n=normalize([na[0]+nb[0],na[1]+nb[1],na[2]+nb[2]]);
  if(!smooth)return{p:linear,n};
  const dab:[number,number,number]=[pb[0]-pa[0],pb[1]-pa[1],pb[2]-pa[2]];
  const dba:[number,number,number]=[-dab[0],-dab[1],-dab[2]];
  const wa=dot(dab,na),wb=dot(dba,nb);
  const b210:[number,number,number]=[(2*pa[0]+pb[0]-wa*na[0])/3,(2*pa[1]+pb[1]-wa*na[1])/3,(2*pa[2]+pb[2]-wa*na[2])/3];
  const b120:[number,number,number]=[(2*pb[0]+pa[0]-wb*nb[0])/3,(2*pb[1]+pa[1]-wb*nb[1])/3,(2*pb[2]+pa[2]-wb*nb[2])/3];
  const curved:[number,number,number]=[
    (pa[0]+3*b210[0]+3*b120[0]+pb[0])/8,
    (pa[1]+3*b210[1]+3*b120[1]+pb[1])/8,
    (pa[2]+3*b210[2]+3*b120[2]+pb[2])/8,
  ];
  const delta:[number,number,number]=[curved[0]-linear[0],curved[1]-linear[1],curved[2]-linear[2]],length=Math.hypot(...delta),edgeLength=Math.hypot(...dab),limit=Math.min(maxDisplacementM,edgeLength*.12);
  if(length>limit&&length>1e-9){const s=limit/length;curved[0]=linear[0]+delta[0]*s;curved[1]=linear[1]+delta[1]*s;curved[2]=linear[2]+delta[2]*s;}
  return{p:curved,n};
}

/**
 * One render-only PN edge subdivision. Imported boundaries and authored creases
 * stay exact; smooth shared edges gain curvature. No physics/topology depends on
 * the generated vertices.
 */
export function subdivideSmoothTriangleMesh(mesh:TriangleMesh,plan=buildSmoothSubdivisionPlan(mesh)):TriangleMesh{
  const triangles=mesh.indices.length/3;
  if(plan.sourceTriangles!==triangles||plan.smoothEdges.length!==triangles)throw new RangeError('Subdivision plan does not match mesh topology');
  const positions:number[]=[],normals:number[]=[],indices:number[]=[];
  const add=(p:readonly[number,number,number],n:readonly[number,number,number])=>{const index=positions.length/3;positions.push(...p);normals.push(...n);return index;};
  for(let triangle=0;triangle<triangles;triangle++){
    const i=triangle*3,a=mesh.indices[i]!,b=mesh.indices[i+1]!,c=mesh.indices[i+2]!,smooth=plan.smoothEdges[triangle]!;
    const pa=position(mesh,a),pb=position(mesh,b),pc=position(mesh,c),na=normal(mesh,a),nb=normal(mesh,b),nc=normal(mesh,c);
    const ab=midpoint(mesh,a,b,smooth[0],plan.maxDisplacementM),bc=midpoint(mesh,b,c,smooth[1],plan.maxDisplacementM),ca=midpoint(mesh,c,a,smooth[2],plan.maxDisplacementM);
    const base=positions.length/3;
    add(pa,na);add(pb,nb);add(pc,nc);add(ab.p,ab.n);add(bc.p,bc.n);add(ca.p,ca.n);
    indices.push(base,base+3,base+5, base+3,base+1,base+4, base+5,base+4,base+2, base+3,base+4,base+5);
  }
  return{kind:'triangle-mesh',positions,normals,indices};
}
