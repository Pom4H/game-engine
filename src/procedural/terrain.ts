import type {Primitive} from '../scene/types.js';

export interface TerrainCorridorSpec {
  readonly points:readonly (readonly[number,number,number])[];
  readonly halfWidthM:number;
  readonly shoulderM?:number;
  readonly crownM?:number;
}
export interface HillyTerrainOptions {
  readonly size:readonly[number,number];
  readonly segments?:readonly[number,number];
  readonly amplitudeM?:number;
  readonly baseHeightM?:number;
  readonly wavelengthM?:number;
  readonly seed?:number;
  readonly irregularity?:number;
  readonly corridors?:readonly TerrainCorridorSpec[];
}
type Mesh=Extract<Primitive,{kind:'triangle-mesh'}>;
type V3=readonly[number,number,number];
type V2=readonly[number,number];
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const smooth=(v:number)=>{const t=clamp(v,0,1);return t*t*(3-2*t);};

function naturalHeight(options:HillyTerrainOptions,x:number,z:number):number{
  const amplitude=options.amplitudeM??2,wavelength=Math.max(2,options.wavelengthM??28),phase=(options.seed??1)*.731;
  const a=Math.sin(x/wavelength*Math.PI*2+phase)*.46,b=Math.cos(z/wavelength*Math.PI*2*.73-phase*.61)*.29,c=Math.sin((x*.72+z*1.31)/wavelength*Math.PI*2+phase*1.7)*.17,ridge=Math.sin((x-z*.42)/wavelength*Math.PI*4-phase*.27)*.08;
  return(options.baseHeightM??0)+amplitude*(a+b+c+ridge);
}
function corridorSample(spec:TerrainCorridorSpec,x:number,z:number):{weight:number;height:number}|undefined{
  if(spec.points.length<2||!Number.isFinite(spec.halfWidthM)||spec.halfWidthM<=0)return;
  const shoulder=Math.max(.001,spec.shoulderM??spec.halfWidthM*.8),crown=Math.max(0,spec.crownM??0);let bestDistance=Infinity,bestHeight=0;
  for(let i=0;i<spec.points.length-1;i++){
    const a=spec.points[i]!,b=spec.points[i+1]!,dx=b[0]-a[0],dz=b[2]-a[2],den=dx*dx+dz*dz,t=den>1e-12?clamp(((x-a[0])*dx+(z-a[2])*dz)/den,0,1):0,qx=a[0]+dx*t,qz=a[2]+dz*t,distance=Math.hypot(x-qx,z-qz);
    if(distance>=bestDistance)continue;bestDistance=distance;
    const centre=a[1]+(b[1]-a[1])*t,across=clamp(distance/spec.halfWidthM,0,1);bestHeight=centre+crown*(1-across*across);
  }
  const outer=spec.halfWidthM+shoulder;if(bestDistance>=outer)return;
  const weight=bestDistance<=spec.halfWidthM?1:1-smooth((bestDistance-spec.halfWidthM)/shoulder);
  return{weight,height:bestHeight};
}
export function hillyTerrainHeight(options:HillyTerrainOptions,x:number,z:number):number{
  const base=naturalHeight(options,x,z);let weight=0,target=base;
  for(const corridor of options.corridors??[]){const sample=corridorSample(corridor,x,z);if(!sample||sample.weight<=weight)continue;weight=sample.weight;target=sample.height;}
  return base+(target-base)*weight;
}
function hash(seed:number,x:number,z:number){let h=Math.imul((x+0x7f4a7c15)|0,0x45d9f3b)^Math.imul((z+0x165667b1)|0,0x27d4eb2d)^seed;h=Math.imul(h^(h>>>16),0x45d9f3b);return((h^(h>>>16))>>>0)/4294967295;}

export function hillyTerrainMesh(options:HillyTerrainOptions):Mesh{
  const sx=options.size[0],sz=options.size[1];if(![sx,sz].every(Number.isFinite)||sx<=0||sz<=0)throw new RangeError('Invalid terrain size');
  for(const corridor of options.corridors??[]){if(corridor.points.length<2)throw new RangeError('Terrain corridor requires at least two points');if(!Number.isFinite(corridor.halfWidthM)||corridor.halfWidthM<=0)throw new RangeError('Invalid terrain corridor width');}
  const nx=Math.max(4,Math.min(256,Math.round(options.segments?.[0]??72))),nz=Math.max(4,Math.min(256,Math.round(options.segments?.[1]??48))),seed=options.seed??1,irregularity=clamp(options.irregularity??.22,0,.42),positions:number[]=[],normals:number[]=[],indices:number[]=[],dx=sx/nx,dz=sz/nz;
  const point=(ix:number,iz:number):V3=>{const edge=ix===0||iz===0||ix===nx||iz===nz,jx=edge?0:(hash(seed,ix,iz)-.5)*dx*irregularity,jz=edge?0:(hash(seed^0x9e3779b9,iz,ix)-.5)*dz*irregularity,x=-sx/2+ix*dx+jx,z=-sz/2+iz*dz+jz;return[x,hillyTerrainHeight(options,x,z),z];};
  const points:V3[]=[];for(let iz=0;iz<=nz;iz++)for(let ix=0;ix<=nx;ix++)points.push(point(ix,iz));
  const at=(ix:number,iz:number):V3=>points[Math.max(0,Math.min(nz,iz))*(nx+1)+Math.max(0,Math.min(nx,ix))]!;
  for(let iz=0;iz<=nz;iz++)for(let ix=0;ix<=nx;ix++){
    const p=at(ix,iz),l=at(ix-1,iz),r=at(ix+1,iz),d=at(ix,iz-1),u=at(ix,iz+1),tx:[number,number,number]=[r[0]-l[0],r[1]-l[1],r[2]-l[2]],tz:[number,number,number]=[u[0]-d[0],u[1]-d[1],u[2]-d[2]],n:[number,number,number]=[tz[1]*tx[2]-tz[2]*tx[1],tz[2]*tx[0]-tz[0]*tx[2],tz[0]*tx[1]-tz[1]*tx[0]],len=Math.hypot(n[0],n[1],n[2])||1;
    positions.push(p[0],p[1],p[2]);normals.push(n[0]/len,n[1]/len,n[2]/len);
  }
  const row=nx+1;for(let iz=0;iz<nz;iz++)for(let ix=0;ix<nx;ix++){const a=iz*row+ix,b=a+1,c=a+row,d=c+1;if((ix+iz+(seed&1))&1)indices.push(a,c,d,a,d,b);else indices.push(a,c,b,b,c,d);}
  return{kind:'triangle-mesh',positions,normals,indices};
}
function insidePolygon(points:readonly V2[],x:number,z:number):boolean{
  let inside=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i]!,b=points[j]!;if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;
}
export function polygonSurfaceGrid(points:readonly V2[],cellSizeM=.25):Mesh{
  if(points.length<3||!Number.isFinite(cellSizeM)||cellSizeM<=0)throw new RangeError('Invalid surface patch');
  let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;for(const p of points){minX=Math.min(minX,p[0]);maxX=Math.max(maxX,p[0]);minZ=Math.min(minZ,p[1]);maxZ=Math.max(maxZ,p[1]);}
  const nx=Math.max(1,Math.ceil((maxX-minX)/cellSizeM)),nz=Math.max(1,Math.ceil((maxZ-minZ)/cellSizeM)),dx=(maxX-minX)/nx,dz=(maxZ-minZ)/nz,positions:number[]=[],normals:number[]=[],indices:number[]=[];
  const tri=(a:V3,b:V3,c:V3)=>{const base=positions.length/3;positions.push(...a,...b,...c);normals.push(0,1,0,0,1,0,0,1,0);indices.push(base,base+1,base+2);};
  for(let iz=0;iz<nz;iz++)for(let ix=0;ix<nx;ix++){const x0=minX+ix*dx,x1=x0+dx,z0=minZ+iz*dz,z1=z0+dz,cx=(x0+x1)/2,cz=(z0+z1)/2;if(!insidePolygon(points,cx,cz))continue;tri([x0,0,z0],[x0,0,z1],[x1,0,z0]);tri([x1,0,z0],[x0,0,z1],[x1,0,z1]);}
  return{kind:'triangle-mesh',positions,normals,indices};
}
