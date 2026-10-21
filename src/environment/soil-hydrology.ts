import {ShallowWaterBasin} from '../physics/shallow-water-basin.js';
export type SoilProfile={depthM:number;porosity:number;fieldCapacity:number;conductivityMps:number;fineFraction:number;rootCover:number};
export type HydrologyWeather={rainMps:number;snowMps:number;temperatureC:number;humidity:number;sunlightWm2:number;windMps:number};
export type SoilHydrologySnapshot={soil:number[];ground:number[];ice:number[];snow:number[];water:number[];flowX:number[];flowZ:number[];inputM3:number;evaporatedM3:number;boundaryNetM3?:number};
const clamp=(v:number,a=0,b=1)=>Math.max(a,Math.min(b,v));
/** Two material reservoirs plus the Engine's conservative free surface.
 * Quantities are water-equivalent metres over each cell. Nothing drains into
 * an unaccounted sink: subsurface water remains in the groundwater reservoir. */
export class SoilHydrologyGrid{
 readonly water:ShallowWaterBasin;
 readonly soil:Float64Array;readonly ground:Float64Array;readonly ice:Float64Array;readonly snow:Float64Array;
 inputM3=0;evaporatedM3=0;boundaryNetM3=0;revision=0;
 constructor(readonly profiles:readonly SoilProfile[],bed:Float64Array,readonly columns:number,readonly cellM:number,solid?:Uint8Array){
  if(profiles.length!==bed.length||bed.length%columns||profiles.some(p=>![p.depthM,p.porosity,p.fieldCapacity,p.conductivityMps,p.fineFraction,p.rootCover].every(Number.isFinite)||p.depthM<0||p.porosity<0||p.porosity>1||p.fieldCapacity<0||p.fieldCapacity>p.porosity||p.conductivityMps<0))throw RangeError('Invalid soil field');
  this.soil=new Float64Array(bed.length);this.ground=new Float64Array(bed.length);this.ice=new Float64Array(bed.length);this.snow=new Float64Array(bed.length);
  this.water=new ShallowWaterBasin({columns,rows:bed.length/columns,widthM:columns*cellM,lengthM:bed.length/columns*cellM,depthM:0,bed,...(solid?{solid}:{}),dampingPerSecond:2});
 }
 addWater(index:number,volumeM3:number){if(!Number.isSafeInteger(index)||index<0||index>=this.soil.length||!Number.isFinite(volumeM3)||volumeM3<0)throw RangeError('Invalid hydrology source');this.water.depth[index]!+=volumeM3/this.cellM**2;this.inputM3+=volumeM3;this.revision++;}
 stepWeather(seconds:number,w:HydrologyWeather){
  if(![seconds,...Object.values(w)].every(Number.isFinite)||seconds<=0||seconds>300||w.rainMps<0||w.snowMps<0||w.windMps<0||w.sunlightWm2<0||w.humidity<0||w.humidity>1)throw RangeError('Invalid hydrology forcing');
  const area=this.cellM**2,latent=2.45e9;
  for(let i=0;i<this.soil.length;i++){
   if(this.water.solid[i])continue;const p=this.profiles[i]!,capacity=p.depthM*p.porosity;
   const rain=w.rainMps*seconds,snow=w.snowMps*seconds;this.water.depth[i]!+=rain;this.snow[i]!+=snow;this.inputM3+=(rain+snow)*area;
   const warmth=Math.max(0,w.temperatureC)*(8+2*w.windMps)+w.sunlightWm2*.3;
   const thaw=Math.min(this.snow[i]!+this.ice[i]!,warmth*seconds/334e6),snowThaw=Math.min(this.snow[i]!,thaw);this.snow[i]!-=snowThaw;this.ice[i]!-=thaw-snowThaw;this.water.depth[i]!+=thaw;
   if(w.temperatureC<0){let budget=-w.temperatureC*(8+2*w.windMps)*seconds/334e6;const surface=Math.min(this.water.depth[i]!,budget);this.water.depth[i]!-=surface;this.ice[i]!+=surface;budget-=surface;const soil=Math.min(this.soil[i]!,budget);this.soil[i]!-=soil;this.ice[i]!+=soil;}
   const frozen=clamp(this.ice[i]!/Math.max(.002,capacity)),sat=capacity?clamp(this.soil[i]!/capacity):0;
   const infiltrate=Math.min(this.water.depth[i]!,Math.max(0,capacity-this.soil[i]!-Math.min(capacity,this.ice[i]!)),p.conductivityMps*(1-frozen)**3*(1+2*(1-sat))*seconds);
   this.water.depth[i]!-=infiltrate;this.soil[i]!+=infiltrate;
   const drain=Math.min(Math.max(0,this.soil[i]!-p.depthM*p.fieldCapacity),p.conductivityMps*.12*sat**3*seconds);this.soil[i]!-=drain;this.ground[i]!+=drain;
   const returnFlow=Math.min(this.ground[i]!,Math.max(0,this.ground[i]!-capacity)*.015*seconds);this.ground[i]!-=returnFlow;this.water.depth[i]!+=returnFlow;
   const evaporativeEnergy=Math.max(0,w.sunlightWm2*.42+(1-w.humidity)*(10+5*w.windMps)*Math.max(0,w.temperatureC));
   let demand=evaporativeEnergy*seconds/latent;
   const film=Math.min(this.water.depth[i]!,demand);this.water.depth[i]!-=film;demand-=film;
   // Buried pore water is diffusion limited; a dry crust suppresses its loss.
   const pore=Math.min(this.soil[i]!,demand*(.05+.2*sat**2)*(1-frozen)*(1-p.rootCover*.5));this.soil[i]!-=pore;this.evaporatedM3+=(film+pore)*area;
  }this.revision++;
 }
 stepFlow(seconds:number){
  if(!Number.isFinite(seconds)||seconds<=0||seconds>300)throw RangeError('Invalid terrain flow step');
  let remaining=seconds;while(remaining>1e-8){let depth=0;for(const h of this.water.depth)depth=Math.max(depth,h);const dt=Math.min(remaining,10,.4*this.cellM/Math.max(.001,Math.sqrt(9.81*depth)));this.water.step(dt,0);remaining-=dt;}
  // Darcy-like interflow carries retained water downslope after rain stops.
  const transfer=new Float64Array(this.ground.length),n=this.columns;
  for(let i=0;i<this.ground.length;i++)for(const j of [i%n<n-1?i+1:-1,i+n<this.ground.length?i+n:-1]){
   if(j<0||this.water.solid[i]||this.water.solid[j])continue;const a=this.profiles[i]!,b=this.profiles[j]!;
   const ha=this.water.bed[i]!-a.depthM+this.ground[i]!/Math.max(.05,a.porosity),hb=this.water.bed[j]!-b.depthM+this.ground[j]!/Math.max(.05,b.porosity),from=ha>hb?i:j,to=ha>hb?j:i;
   const amount=Math.min(this.ground[from]!*.2,Math.abs(ha-hb)/this.cellM*Math.min(a.conductivityMps,b.conductivityMps)*seconds);transfer[from]!-=amount;transfer[to]!+=amount;
  }for(let i=0;i<transfer.length;i++)this.ground[i]!+=transfer[i]!;this.revision++;
 }
 sample(index:number){const p=this.profiles[index]!,capacity=p.depthM*p.porosity,saturation=capacity?clamp(this.soil[index]!/capacity):0,waterDepthM=this.water.depth[index]!,ice=clamp(this.ice[index]!/.004);
  const mud=clamp((saturation-.45)/.55)*p.fineFraction*(1-ice);
  return {saturation,waterDepthM,mud,ice,wetness:Math.max(saturation,clamp(waterDepthM/.002)),darkening:clamp(saturation*.28+mud*.2),frictionScale:Math.max(.16,1-mud*.62-ice*.74),rollingResistance:1+mud*3};
 }
 volumeM3(){let sum=0;for(let i=0;i<this.soil.length;i++)sum+=this.soil[i]!+this.ground[i]!+this.ice[i]!+this.snow[i]!+this.water.depth[i]!;return sum*this.cellM**2;}
 snapshot():SoilHydrologySnapshot{return {soil:[...this.soil],ground:[...this.ground],ice:[...this.ice],snow:[...this.snow],water:[...this.water.depth],flowX:[...this.water.faceX],flowZ:[...this.water.faceZ],inputM3:this.inputM3,evaporatedM3:this.evaporatedM3,boundaryNetM3:this.boundaryNetM3};}
 restore(s:SoilHydrologySnapshot){const fields=[[this.soil,s.soil],[this.ground,s.ground],[this.ice,s.ice],[this.snow,s.snow],[this.water.depth,s.water],[this.water.faceX,s.flowX],[this.water.faceZ,s.flowZ]] as const;
  if(fields.some(([target,values])=>!Array.isArray(values)||values.length!==target.length||!values.every(Number.isFinite))||[...s.soil,...s.ground,...s.ice,...s.snow,...s.water].some(v=>v<0)||!Number.isFinite(s.inputM3)||s.inputM3<0||!Number.isFinite(s.evaporatedM3)||s.evaporatedM3<0||!Number.isFinite(s.boundaryNetM3??0))throw RangeError('Invalid saved hydrology');
  for(const [target,values]of fields)target.set(values);this.inputM3=s.inputM3;this.evaporatedM3=s.evaporatedM3;this.boundaryNetM3=s.boundaryNetM3??0;this.revision++;
 }
}
/** Shared conservative interface flux; collect all transfers before mutating
 * either side, including corner donors shared by multiple patch interfaces. */
export function exchangeHydrologyEdges(edges:readonly {a:SoilHydrologyGrid;b:SoilHydrologyGrid;axis:'x'|'z'}[],seconds:number){
 if(!Number.isFinite(seconds)||seconds<=0||seconds>300)throw RangeError('Invalid interface step');
 type Reservoir='water'|'ground';
 const transfers:{a:SoilHydrologyGrid;b:SoilHydrologyGrid;i:number;j:number;kind:Reservoir;depth:number}[]=[],demand=new Map<SoilHydrologyGrid,Record<Reservoir,Float64Array>>();
 const field=(grid:SoilHydrologyGrid,kind:Reservoir)=>kind==='water'?grid.water.depth:grid.ground;
 const request=(a:SoilHydrologyGrid,b:SoilHydrologyGrid,i:number,j:number,kind:Reservoir,depth:number)=>{
  if(!depth)return;transfers.push({a,b,i,j,kind,depth});const donor=depth>0?a:b,index=depth>0?i:j;let d=demand.get(donor);if(!d){d={water:new Float64Array(donor.soil.length),ground:new Float64Array(donor.soil.length)};demand.set(donor,d);}d[kind][index]!+=Math.abs(depth);
 };
 for(const {a,b,axis}of edges){if(a.cellM!==b.cellM||a.columns!==b.columns||a.soil.length!==b.soil.length)throw RangeError('Hydrology interface resolution mismatch');const n=a.columns,rows=a.soil.length/n;
  for(let k=0;k<(axis==='x'?rows:n);k++){const i=axis==='x'?k*n+n-1:(rows-1)*n+k,j=axis==='x'?k*n:k;if(a.water.solid[i]||b.water.solid[j])continue;
   const ha=a.water.bed[i]!+a.water.depth[i]!,hb=b.water.bed[j]!+b.water.depth[j]!,crest=Math.max(a.water.bed[i]!,b.water.bed[j]!);
   request(a,b,i,j,'water',Math.sign(ha-hb)*Math.min(Math.abs(ha-hb)*.25,Math.max(0,Math.max(ha,hb)-crest)*.25)*Math.min(1,seconds/2));
   const pa=a.profiles[i]!,pb=b.profiles[j]!,ga=a.water.bed[i]!-pa.depthM+a.ground[i]!/Math.max(.05,pa.porosity),gb=b.water.bed[j]!-pb.depthM+b.ground[j]!/Math.max(.05,pb.porosity);
   request(a,b,i,j,'ground',Math.sign(ga-gb)*Math.abs(ga-gb)/a.cellM*Math.min(pa.conductivityMps,pb.conductivityMps)*seconds);
  }
 }
 const limits=new Map<SoilHydrologyGrid,Record<Reservoir,Float64Array>>();for(const [grid,requests]of demand)limits.set(grid,{water:Float64Array.from(requests.water,(v,i)=>v?Math.min(1,grid.water.depth[i]!*(1-1e-12)/v):1),ground:Float64Array.from(requests.ground,(v,i)=>v?Math.min(1,grid.ground[i]!*(1-1e-12)/v):1)});
 for(const t of transfers){const donor=t.depth>0?t.a:t.b,index=t.depth>0?t.i:t.j,depth=t.depth*limits.get(donor)![t.kind][index]!,volume=depth*t.a.cellM**2;field(t.a,t.kind)[t.i]!-=depth;field(t.b,t.kind)[t.j]!+=depth;t.a.boundaryNetM3-=volume;t.b.boundaryNetM3+=volume;t.a.revision++;t.b.revision++;}
}
