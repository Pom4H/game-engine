import {mulberry32} from '../core/random.js';

export type Vec2=readonly[number,number];

export interface PlateFractureInput{
  readonly width:number;
  readonly height:number;
  readonly thickness:number;
  /** Impact coordinates in plate-local 2D space, centred on the plate. */
  readonly impact:Vec2;
  readonly energyRatio:number;
  readonly seed:number;
}
export interface PlateFragment{
  /** Convex Voronoi cell in plate-local coordinates. */
  readonly points:readonly Vec2[];
  readonly centroid:Vec2;
  readonly area:number;
  readonly distanceFromImpact:number;
}
export interface PlateFracturePattern{
  readonly sites:readonly Vec2[];
  readonly fragments:readonly PlateFragment[];
  readonly radialRays:number;
  readonly rings:number;
}

/** Deterministic brittle-plate topology.
 * Sites follow radial stress paths from the impact; Voronoi bisectors become the
 * crack graph. The cells are clipped to the real plate rectangle, so every
 * generated fragment comes from actual source material and total area is conserved.
 */
export function fracturePlate(input:PlateFractureInput):PlateFracturePattern{
  const width=Math.max(.01,input.width),height=Math.max(.01,input.height),halfW=width/2,halfH=height/2;
  const impact:Vec2=[
    clamp(input.impact[0],-halfW*.98,halfW*.98),
    clamp(input.impact[1],-halfH*.98,halfH*.98),
  ];
  const ratio=Math.max(1,input.energyRatio),rng=mulberry32(input.seed>>>0),minDim=Math.min(width,height),maxRadius=Math.hypot(width,height)*.56;
  const radialRays=clampInt(Math.round(6+Math.sqrt(ratio)*2.4),6,14),rings=clampInt(Math.round(2+Math.log2(ratio+1)*1.25),2,5);
  const sites:Vec2[]=[[...impact]];

  // Stress propagates outwards from the impact. Keeping one family of sites on
  // each perturbed ray creates mostly radial cracks; multiple radii create the
  // familiar cross-links between them.
  const baseAngle=rng()*Math.PI*2;
  for(let ray=0;ray<radialRays;ray++){
    const rayAngle=baseAngle+ray/radialRays*Math.PI*2+(rng()-.5)*(.22/radialRays*Math.PI*2);
    for(let ring=1;ring<=rings;ring++){
      const fraction=ring/(rings+.35),radius=maxRadius*Math.pow(fraction,.92)*(0.86+rng()*.22);
      const angle=rayAngle+(rng()-.5)*(.12+ring*.015);
      const x=impact[0]+Math.cos(angle)*radius,y=impact[1]+Math.sin(angle)*radius;
      // Clamp instead of dropping outer sites: edge intersections are part of
      // the crack field and should terminate at the physical panel boundary.
      sites.push([clamp(x,-halfW,halfW),clamp(y,-halfH,halfH)]);
    }
  }

  // A few high-energy branch sites break perfect radial symmetry near the
  // impact without replacing the stress-directed topology with random noise.
  const branches=clampInt(Math.round((ratio-1)*2),0,10);
  for(let i=0;i<branches;i++){
    const angle=baseAngle+rng()*Math.PI*2,radius=minDim*(.06+rng()*.28);
    sites.push([
      clamp(impact[0]+Math.cos(angle)*radius,-halfW,halfW),
      clamp(impact[1]+Math.sin(angle)*radius,-halfH,halfH),
    ]);
  }

  const unique=dedupeSites(sites,Math.max(.002,input.thickness*.35));
  const rectangle:Vec2[]=[[-halfW,-halfH],[halfW,-halfH],[halfW,halfH],[-halfW,halfH]];
  const fragments:PlateFragment[]=[];
  for(let i=0;i<unique.length;i++){
    let polygon:Vec2[]=rectangle.map(point=>[...point] as [number,number]);
    const site=unique[i]!;
    for(let j=0;j<unique.length&&polygon.length>=3;j++){
      if(i===j)continue;
      polygon=clipToVoronoiHalfPlane(polygon,site,unique[j]!);
    }
    if(polygon.length<3)continue;
    const area=Math.abs(polygonArea(polygon));
    if(area<Math.max(1e-6,width*height*1e-5))continue;
    const centroid=polygonCentroid(polygon),distanceFromImpact=Math.hypot(centroid[0]-impact[0],centroid[1]-impact[1]);
    fragments.push({points:polygon,centroid,area,distanceFromImpact});
  }
  fragments.sort((a,b)=>a.distanceFromImpact-b.distanceFromImpact||a.centroid[0]-b.centroid[0]||a.centroid[1]-b.centroid[1]);
  return{sites:unique,fragments,radialRays,rings};
}

function clipToVoronoiHalfPlane(polygon:readonly Vec2[],site:Vec2,other:Vec2):Vec2[]{
  // |p-site|² <= |p-other|²  ->  A*x + B*y <= C
  const A=2*(other[0]-site[0]),B=2*(other[1]-site[1]),C=other[0]*other[0]+other[1]*other[1]-site[0]*site[0]-site[1]*site[1];
  const out:Vec2[]=[];
  for(let i=0;i<polygon.length;i++){
    const a=polygon[i]!,b=polygon[(i+1)%polygon.length]!,fa=A*a[0]+B*a[1]-C,fb=A*b[0]+B*b[1]-C,insideA=fa<=1e-9,insideB=fb<=1e-9;
    if(insideA)out.push(a);
    if(insideA!==insideB){
      const denom=fa-fb,t=Math.abs(denom)<1e-12?0:fa/denom;
      out.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);
    }
  }
  return dedupePolygon(out);
}

function polygonArea(points:readonly Vec2[]):number{let area=0;for(let i=0;i<points.length;i++){const a=points[i]!,b=points[(i+1)%points.length]!;area+=a[0]*b[1]-b[0]*a[1];}return area*.5;}
function polygonCentroid(points:readonly Vec2[]):Vec2{
  let crossSum=0,cx=0,cy=0;
  for(let i=0;i<points.length;i++){const a=points[i]!,b=points[(i+1)%points.length]!,cross=a[0]*b[1]-b[0]*a[1];crossSum+=cross;cx+=(a[0]+b[0])*cross;cy+=(a[1]+b[1])*cross;}
  if(Math.abs(crossSum)<1e-10){const x=points.reduce((s,p)=>s+p[0],0)/points.length,y=points.reduce((s,p)=>s+p[1],0)/points.length;return[x,y];}
  return[cx/(3*crossSum),cy/(3*crossSum)];
}
function dedupeSites(points:readonly Vec2[],epsilon:number):Vec2[]{const out:Vec2[]=[];for(const point of points)if(!out.some(other=>Math.hypot(point[0]-other[0],point[1]-other[1])<epsilon))out.push(point);return out;}
function dedupePolygon(points:readonly Vec2[]):Vec2[]{const out:Vec2[]=[];for(const point of points){const last=out.at(-1);if(!last||Math.hypot(point[0]-last[0],point[1]-last[1])>1e-8)out.push(point);}if(out.length>2&&Math.hypot(out[0]![0]-out.at(-1)![0],out[0]![1]-out.at(-1)![1])<1e-8)out.pop();return out;}
function clamp(value:number,min:number,max:number){return Math.max(min,Math.min(max,value));}
function clampInt(value:number,min:number,max:number){return Math.max(min,Math.min(max,value|0));}
