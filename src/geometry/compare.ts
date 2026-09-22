export interface TriangleSurface {
  readonly positions:readonly number[];
  readonly indices:readonly number[];
}

export interface SurfaceDistanceReport {
  readonly samplesA:number;
  readonly samplesB:number;
  readonly aToBMeanMm:number;
  readonly aToBP95Mm:number;
  readonly aToBMaxMm:number;
  readonly bToAMeanMm:number;
  readonly bToAP95Mm:number;
  readonly bToAMaxMm:number;
  readonly symmetricMeanMm:number;
  readonly symmetricP95Mm:number;
  readonly hausdorffMm:number;
  readonly referenceDiagonalM:number;
  readonly normalizedFit:number;
  readonly sampling:'vertices + triangle centroids';
}

type V=readonly[number,number,number];

function point(surface:TriangleSurface,index:number):V{
  const i=index*3;
  return[surface.positions[i]!,surface.positions[i+1]!,surface.positions[i+2]!];
}
const sub=(a:V,b:V):V=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const dot=(a:V,b:V)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const len2=(v:V)=>dot(v,v);

function pointTriangleDistance2(p:V,a:V,b:V,c:V):number{
  const ab=sub(b,a),ac=sub(c,a),ap=sub(p,a),d1=dot(ab,ap),d2=dot(ac,ap);
  if(d1<=0&&d2<=0)return len2(ap);
  const bp=sub(p,b),d3=dot(ab,bp),d4=dot(ac,bp);
  if(d3>=0&&d4<=d3)return len2(bp);
  const vc=d1*d4-d3*d2;
  if(vc<=0&&d1>=0&&d3<=0){const v=d1/(d1-d3),q:[number,number,number]=[a[0]+v*ab[0],a[1]+v*ab[1],a[2]+v*ab[2]];return len2(sub(p,q));}
  const cp=sub(p,c),d5=dot(ab,cp),d6=dot(ac,cp);
  if(d6>=0&&d5<=d6)return len2(cp);
  const vb=d5*d2-d1*d6;
  if(vb<=0&&d2>=0&&d6<=0){const w=d2/(d2-d6),q:[number,number,number]=[a[0]+w*ac[0],a[1]+w*ac[1],a[2]+w*ac[2]];return len2(sub(p,q));}
  const va=d3*d6-d5*d4;
  if(va<=0&&(d4-d3)>=0&&(d5-d6)>=0){const bc=sub(c,b),w=(d4-d3)/((d4-d3)+(d5-d6)),q:[number,number,number]=[b[0]+w*bc[0],b[1]+w*bc[1],b[2]+w*bc[2]];return len2(sub(p,q));}
  const denom=1/(va+vb+vc),v=vb*denom,w=vc*denom,q:[number,number,number]=[a[0]+ab[0]*v+ac[0]*w,a[1]+ab[1]*v+ac[1]*w,a[2]+ab[2]*v+ac[2]*w];
  return len2(sub(p,q));
}

function validate(surface:TriangleSurface,label:string){
  if(surface.positions.length<9||surface.positions.length%3)throw new RangeError(label+'.positions must contain complete vertices');
  if(surface.indices.length<3||surface.indices.length%3)throw new RangeError(label+'.indices must contain complete triangles');
  const count=surface.positions.length/3;
  for(const value of surface.positions)if(!Number.isFinite(value))throw new RangeError(label+'.positions must be finite');
  for(const index of surface.indices)if(!Number.isSafeInteger(index)||index<0||index>=count)throw new RangeError(label+'.indices contain an out-of-range vertex');
}

function samples(surface:TriangleSurface):V[]{
  const result:V[]=[];
  for(let i=0;i<surface.positions.length/3;i++)result.push(point(surface,i));
  for(let i=0;i<surface.indices.length;i+=3){
    const a=point(surface,surface.indices[i]!),b=point(surface,surface.indices[i+1]!),c=point(surface,surface.indices[i+2]!);
    result.push([(a[0]+b[0]+c[0])/3,(a[1]+b[1]+c[1])/3,(a[2]+b[2]+c[2])/3]);
  }
  return result;
}

function distances(from:V[],to:TriangleSurface):number[]{
  const out:number[]=[];
  for(const p of from){
    let best=Infinity;
    for(let i=0;i<to.indices.length;i+=3){
      const a=point(to,to.indices[i]!),b=point(to,to.indices[i+1]!),c=point(to,to.indices[i+2]!);
      best=Math.min(best,pointTriangleDistance2(p,a,b,c));
    }
    out.push(Math.sqrt(best)*1000);
  }
  return out;
}

function stats(values:number[]){const sorted=[...values].sort((a,b)=>a-b),mean=values.reduce((s,v)=>s+v,0)/values.length;return{mean,p95:sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.95))]!,max:sorted.at(-1)!};}
function diagonal(surface:TriangleSurface):number{
  const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<surface.positions.length;i+=3)for(let axis=0;axis<3;axis++){const value=surface.positions[i+axis]!;lo[axis]=Math.min(lo[axis]!,value);hi[axis]=Math.max(hi[axis]!,value);}
  return Math.hypot(hi[0]!-lo[0]!,hi[1]!-lo[1]!,hi[2]!-lo[2]!);
}

/** Approximate symmetric surface distance using all vertices plus every triangle centroid. */
export function compareTriangleSurfaces(a:TriangleSurface,b:TriangleSurface):SurfaceDistanceReport{
  validate(a,'a');validate(b,'b');
  const sa=samples(a),sb=samples(b),ab=distances(sa,b),ba=distances(sb,a),as=stats(ab),bs=stats(ba),all=stats([...ab,...ba]),referenceDiagonalM=Math.max(diagonal(a),diagonal(b)),hausdorffMm=Math.max(as.max,bs.max);
  return Object.freeze({
    samplesA:sa.length,samplesB:sb.length,
    aToBMeanMm:as.mean,aToBP95Mm:as.p95,aToBMaxMm:as.max,
    bToAMeanMm:bs.mean,bToAP95Mm:bs.p95,bToAMaxMm:bs.max,
    symmetricMeanMm:all.mean,symmetricP95Mm:all.p95,hausdorffMm,
    referenceDiagonalM,
    normalizedFit:Math.max(0,1-hausdorffMm/(referenceDiagonalM*1000)),
    sampling:'vertices + triangle centroids' as const,
  });
}
