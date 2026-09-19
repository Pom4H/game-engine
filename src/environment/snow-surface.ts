import type {Vec3} from '../math.js';
import type {EntitySpec,MaterialSpec} from '../scene/types.js';
import type {SnowFootprint} from './footprints.js';

export interface SnowSurfaceOptions {
 readonly id:string;
 readonly center:readonly [number,number];
 readonly size:readonly [number,number];
 /** Undeformed top of the settled snow, in world metres. */
 readonly height:number;
 readonly yaw?:number;
 readonly snowDepth?:number;
 readonly tileSize?:number;
 readonly coarseCellSize?:number;
 readonly detailedCellSize?:number;
 readonly maxTiles?:number;
 readonly maxDetailedTiles?:number;
 readonly capacity?:number;
 readonly seed?:number;
 readonly material?:MaterialSpec;
}
interface Tile {readonly x:number;readonly z:number;readonly key:string;detailed:boolean;touched:number}
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const smooth=(a:number,b:number,x:number)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
function hash(x:number,z:number,seed:number){let n=Math.imul(x,374761393)^Math.imul(z,668265263)^seed;n=Math.imul(n^(n>>>13),1274126177);return((n^(n>>>16))>>>0)/4294967295;}
function noise(x:number,z:number,seed:number){const ix=Math.floor(x),iz=Math.floor(z),fx=smooth(0,1,x-ix),fz=smooth(0,1,z-iz),a=hash(ix,iz,seed),b=hash(ix+1,iz,seed),c=hash(ix,iz+1,seed),d=hash(ix+1,iz+1,seed);return(a+(b-a)*fx)*(1-fz)+(c+(d-c)*fx)*fz;}
/** World-anchored non-periodic snow relief shared by mesh generation and foot IK.
 * The broad, shallow wind crust and smaller grains are independent octaves. */
export function snowRelief(x:number,z:number,depth=.05,seed=1):number {
 const amount=Math.min(1,Math.max(0,depth)/.035);
 return amount*((noise(x*1.9,z*2.1,seed)-.5)*.009+(noise(x*8.7,z*9.3,seed+17)-.5)*.004+(noise(x*33.1,z*31.4,seed+41)-.5)*.0016);
}
/** A bounded tiled heightfield. Persistent stamps are spatially indexed by tile;
 * only touched tiles get centimetre geometry and only dirty tiles are rebuilt.
 * Scene identity, weather, contact detection and audio are owned by the caller. */
export class SnowSurface {
 readonly options:Readonly<SnowSurfaceOptions>;
 readonly tiles=new Map<string,Tile>();
 private readonly records:SnowFootprint[]=[];
 private readonly dirty=new Set<string>();
 private readonly nx:number;private readonly nz:number;private readonly cell:number;private readonly detailCell:number;
 private readonly capacity:number;private readonly detailedBudget:number;
 private heightValue:number;private depth:number;private revision=0;
 constructor(input:SnowSurfaceOptions){
  if(typeof input.id!=='string'||!input.id||input.id.length>130||input.center.length!==2||input.size.length!==2||[...input.center,...input.size,input.height,input.yaw??0,input.snowDepth??.05].some(v=>!Number.isFinite(v))||input.size.some(v=>v<=0)||input.snowDepth!==undefined&&input.snowDepth<0)throw new TypeError('Invalid snow surface dimensions');
  const tileSize=input.tileSize??2,maxTiles=input.maxTiles??256;
  this.cell=input.coarseCellSize??.12;this.detailCell=input.detailedCellSize??.024;this.capacity=input.capacity??256;this.detailedBudget=input.maxDetailedTiles??Math.min(28,maxTiles);
  if(!Number.isFinite(tileSize)||tileSize<=0||!Number.isFinite(this.cell)||this.cell<.025||!Number.isFinite(this.detailCell)||this.detailCell<.012||this.detailCell>this.cell||![maxTiles,this.capacity,this.detailedBudget].every(v=>Number.isSafeInteger(v)&&v>0)||maxTiles>4096||this.capacity>10000||this.detailedBudget>maxTiles)throw new RangeError('Invalid snow surface geometry budget');
  // Narrow paths remain a single strip: splitting their width doubles draw calls
  // without improving the adaptive contact detail.
  this.nx=Math.ceil(input.size[0]/(input.size[0]<=3.2?Math.max(tileSize,input.size[0]):tileSize));
  this.nz=Math.ceil(input.size[1]/(input.size[1]<=3.2?Math.max(tileSize,input.size[1]):tileSize));
  if(this.nx*this.nz>maxTiles)throw new RangeError('Snow surface exceeds tile budget');
  const maxX=Math.ceil(input.size[0]/this.nx/this.detailCell),maxZ=Math.ceil(input.size[1]/this.nz/this.detailCell);
  if((maxX+1)*(maxZ+1)>100000)throw new RangeError('Snow surface tile exceeds geometry budget');
  this.heightValue=input.height;this.depth=input.snowDepth??.05;
  const owned=structuredClone(input);if(owned.material){if(owned.material.texture)Object.freeze(owned.material.texture);if(owned.material.color)Object.freeze(owned.material.color);if(owned.material.emissive)Object.freeze(owned.material.emissive);Object.freeze(owned.material);}
  this.options=Object.freeze({...owned,center:Object.freeze([...input.center]) as readonly[number,number],size:Object.freeze([...input.size]) as readonly[number,number]});
  for(let z=0;z<this.nz;z++)for(let x=0;x<this.nx;x++){const key=`${x}:${z}`;this.tiles.set(key,{x,z,key,detailed:false,touched:0});this.dirty.add(key);}
 }
 get stamps():readonly SnowFootprint[]{return this.records.slice();}
 get heightBase(){return this.heightValue;}
 get tileCount(){return this.tiles.size;}
 get detailedTiles(){return[...this.tiles.values()].filter(t=>t.detailed).length;}
 get snowDepth(){return this.depth;}
 private local(x:number,z:number):readonly[number,number]{const dx=x-this.options.center[0],dz=z-this.options.center[1],c=Math.cos(this.options.yaw??0),s=Math.sin(this.options.yaw??0);return[c*dx-s*dz,s*dx+c*dz];}
 private world(x:number,z:number):readonly[number,number]{const c=Math.cos(this.options.yaw??0),s=Math.sin(this.options.yaw??0);return[this.options.center[0]+c*x+s*z,this.options.center[1]-s*x+c*z];}
 contains(x:number,z:number){const p=this.local(x,z);return Math.abs(p[0])<=this.options.size[0]/2&&Math.abs(p[1])<=this.options.size[1]/2;}
 /** Querying the pristine snow top avoids compressing a planted foot twice. */
 sample(x:number,z:number){return this.contains(x,z)?this.heightValue+snowRelief(x,z,this.depth,this.options.seed??1):undefined;}
 setSnow(height:number,depth:number):void{
  if(!Number.isFinite(height)||!Number.isFinite(depth)||depth<0)throw new TypeError('Invalid snow surface state');
  // One-millimetre weather quantization prevents whole-field mesh churn at 60 Hz.
  const h=Math.round(height*1000)/1000,d=Math.round(depth*1000)/1000;
  if(h===this.heightValue&&d===this.depth)return;this.heightValue=h;this.depth=d;
  if(d<=.002)this.records.length=0;
  for(const key of this.tiles.keys())this.dirty.add(key);
 }
 private affected(stamp:SnowFootprint):Tile[]{
  const p=this.local(stamp.position[0],stamp.position[2]),sx=this.options.size[0]/this.nx,sz=this.options.size[1]/this.nz,result:Tile[]=[];
  const x0=clamp(Math.floor((p[0]+this.options.size[0]/2-.27)/sx),0,this.nx-1),x1=clamp(Math.floor((p[0]+this.options.size[0]/2+.27)/sx),0,this.nx-1),z0=clamp(Math.floor((p[1]+this.options.size[1]/2-.27)/sz),0,this.nz-1),z1=clamp(Math.floor((p[1]+this.options.size[1]/2+.27)/sz),0,this.nz-1);
  for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++)result.push(this.tiles.get(`${x}:${z}`)!);return result;
 }
 stamp(stamp:SnowFootprint):boolean{
  if(!Number.isFinite(stamp.depth)||stamp.depth<0||stamp.position.length!==3||stamp.position.some(v=>!Number.isFinite(v))||!Number.isFinite(stamp.yaw))throw new TypeError('Invalid snow stamp');
  if(!this.contains(stamp.position[0],stamp.position[2]))return false;
  this.records.push(Object.freeze({...stamp,position:Object.freeze([...stamp.position]) as Vec3}));this.revision++;
  const evicted=this.records.length>this.capacity?this.records.shift():undefined;if(evicted)for(const tile of this.affected(evicted))this.dirty.add(tile.key);
  for(const tile of this.affected(stamp)){tile.detailed=true;tile.touched=this.revision;this.dirty.add(tile.key);}
  const detailed=[...this.tiles.values()].filter(t=>t.detailed).sort((a,b)=>a.touched-b.touched);
  while(detailed.length>this.detailedBudget){const tile=detailed.shift()!;tile.detailed=false;this.dirty.add(tile.key);}return true;
 }
 height(x:number,z:number,stamps:readonly SnowFootprint[]=this.records):number{
  let h=this.heightValue+snowRelief(x,z,this.depth,this.options.seed??1);
  for(const stamp of stamps){
   const dx=x-stamp.position[0],dz=z-stamp.position[2];if(Math.abs(dx)>.28||Math.abs(dz)>.28)continue;
   const c=Math.cos(stamp.yaw),s=Math.sin(stamp.yaw),u=c*dx-s*dz-.032,v=s*dx+c*dz;
   const toe=clamp((u+.04)/.1,0,1),heel=clamp((-u-.03)/.07,0,1),width=.047+.017*toe+.008*heel;
   const shape=(u/.154)**4+(v/width)**4,r=Math.sqrt(Math.sqrt(shape));if(r>=1.48)continue;
   const depth=Math.min(stamp.depth,this.depth*.7),depression=depth*(1-smooth(.67,1.02,r));
   // Displaced snow piles up into a broken rim. The sole leaves transverse lugs
   // and a heel/toe divide, rather than a smooth oval painted onto the ground.
   const rim=depth*.25*Math.exp(-(((r-1.08)/.135)**2))*(.55+noise(x*49,z*47,this.options.seed??1));
   const tread=(1-smooth(.56,.88,r))*(.5+.5*Math.cos(u*174))**5*.0021;
   const arch=Math.exp(-(((u+.018)/.028)**2))*.0024*(1-smooth(.6,.95,r));
   h+=rim-depression+Math.min(depth*.22,tread+arch);
  }
  return Math.max(this.heightValue-this.depth*.78,h);
 }
 /** Take immutable authoring descriptions for only changed tiles. */
 drainMeshes():EntitySpec[]{const result:EntitySpec[]=[];for(const key of this.dirty){const tile=this.tiles.get(key);if(tile)result.push(this.mesh(tile));}this.dirty.clear();return result;}
 ids():string[]{return[...this.tiles.keys()].map(key=>`${this.options.id}:${key}`);}
 private mesh(tile:Tile):EntitySpec{
  const sx=this.options.size[0]/this.nx,sz=this.options.size[1]/this.nz,cx=-this.options.size[0]/2+(tile.x+.5)*sx,cz=-this.options.size[1]/2+(tile.z+.5)*sz;
  const center=this.world(cx,cz),positions:number[]=[],normals:number[]=[],indices:number[]=[],cell=tile.detailed?this.detailCell:this.cell,nx=Math.ceil(sx/cell),nz=Math.ceil(sz/cell),eps=.008;
  const stamps=this.records.filter(s=>{const p=this.local(s.position[0],s.position[2]);return Math.abs(p[0]-cx)<sx/2+.28&&Math.abs(p[1]-cz)<sz/2+.28;});
  for(let z=0;z<=nz;z++)for(let x=0;x<=nx;x++){
   const p=this.world(cx+(x/nx-.5)*sx,cz+(z/nz-.5)*sz),h=this.height(p[0],p[1],stamps),dx=(this.height(p[0]+eps,p[1],stamps)-this.height(p[0]-eps,p[1],stamps))/(eps*2),dz=(this.height(p[0],p[1]+eps,stamps)-this.height(p[0],p[1]-eps,stamps))/(eps*2),length=Math.hypot(dx,1,dz);
   positions.push(p[0]-center[0],h,p[1]-center[1]);normals.push(-dx/length,1/length,-dz/length);
   if(x<nx&&z<nz){const a=z*(nx+1)+x,b=a+nx+1;indices.push(a,b,a+1,b,b+1,a+1);}
  }
  return{id:`${this.options.id}:${tile.key}`,position:[center[0],0,center[1]],mesh:{kind:'triangle-mesh',positions,normals,indices},material:this.options.material??{kind:'snow',color:[.89,.925,.953,1],roughness:.94}};
 }
}
