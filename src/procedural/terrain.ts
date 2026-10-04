import type {Primitive} from '../scene/types.js';

export interface HillyTerrainOptions {
  readonly size:readonly[number,number];
  readonly segments?:readonly[number,number];
  readonly amplitudeM?:number;
  readonly baseHeightM?:number;
  readonly wavelengthM?:number;
  readonly seed?:number;
  /** Fraction of one grid cell used to jitter interior vertices. */
  readonly irregularity?:number;
}
type Mesh=Extract<Primitive,{kind:'triangle-mesh'}>;
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));

export function hillyTerrainHeight(options:HillyTerrainOptions,x:number,z:number):number{
  const amplitude=options.amplitudeM??2,wavelength=Math.max(2,options.wavelengthM??28),phase=(options.seed??1)*.731;
  const a=Math.sin(x/wavelength*Math.PI*2+phase)*.46,b=Math.cos(z/wavelength*Math.PI*2*.73-phase*.61)*.29,c=Math.sin((x*.72+z*1.31)/wavelength*Math.PI*2+phase*1.7)*.17,ridge=Math.sin((x-z*.42)/wavelength*Math.PI*4-phase*.27)*.08;
  return(options.baseHeightM??0)+amplitude*(a+b+c+ridge);
}
function hash(seed:number,x:number,z:number){let h=Math.imul((x+0x7f4a7c15)|0,0x45d9f3b)^Math.imul((z+0x165667b1)|0,0x27d4eb2d)^seed;h=Math.imul(h^(h>>>16),0x45d9f3b);return((h^(h>>>16))>>>0)/4294967295;}

/** Deterministic irregular triangulation. Nearby detail is real geometry, not
 * parallax; the exported height function can drive collision/support projections. */
export function hillyTerrainMesh(options:HillyTerrainOptions):Mesh{
 const sx=options.size[0],sz=options.size[1];if(![sx,sz].every(Number.isFinite)||sx<=0||sz<=0)throw new RangeError('Invalid terrain size');
 const nx=Math.max(4,Math.min(256,Math.round(options.segments?.[0]??72))),nz=Math.max(4,Math.min(256,Math.round(options.segments?.[1]??48))),seed=options.seed??1,irregularity=clamp(options.irregularity??.22,0,.42),positions:number[]=[],normals:number[]=[],indices:number[]=[],dx=sx/nx,dz=sz/nz;
 const point=(ix:number,iz:number):readonly[number,number,number]=>{const edge=ix===0||iz===0||ix===nx||iz===nz,jx=edge?0:(hash(seed,ix,iz)-.5)*dx*irregularity,jz=edge?0:(hash(seed^0x9e3779b9,iz,ix)-.5)*dz*irregularity,x=-sx/2+ix*dx+jx,z=-sz/2+iz*dz+jz;return[x,hillyTerrainHeight(options,x,z),z];};
 const points:readonly[number,number,number][]=[];for(let iz=0;iz<=nz;iz++)for(let ix=0;ix<=nx;ix++)points.push(point(ix,iz));
 const at=(ix:number,iz:number)=>points[Math.max(0,Math.min(nz,iz))*(nx+1)+Math.max(0,Math.min(nx,ix))]!;
 for(let iz=0;iz<=nz;iz++)for(let ix=0;ix<=nx;ix++){const p=at(ix,iz),l=at(ix-1,iz),r=at(ix+1,iz),d=at(ix,iz-1),u=at(ix,iz+1),tx=[r[0]-l[0],r[1]-l[1],r[2]-l[2]],tz=[u[0]-d[0],u[1]-d[1],u[2]-d[2]],n=[tz[1]*tx[2]-tz[2]*tx[1],tz[2]*tx[0]-tz[0]*tx[2],tz[0]*tx[1]-tz[1]*tx[0]],len=Math.hypot(...n)||1;positions.push(...p);normals.push(n[0]/len,n[1]/len,n[2]/len);}
 const row=nx+1;for(let iz=0;iz<nz;iz++)for(let ix=0;ix<nx;ix++){const a=iz*row+ix,b=a+1,c=a+row,d=c+1;if((ix+iz+(seed&1))&1)indices.push(a,c,d,a,d,b);else indices.push(a,c,b,b,c,d);}
 return{kind:'triangle-mesh',positions,normals,indices};
}
