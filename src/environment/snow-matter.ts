import type {Vec3} from '../math.js';

export interface SnowPacket {massKg:number;volumeM3:number;enthalpyJ:number;bond:number}
export interface SnowCell extends SnowPacket {}
export interface SnowShape {min:Vec3;max:Vec3;/** Negative inside, in metres. */ distance:(p:Vec3)=>number}
export interface SnowContact {position:Vec3;radiusM:number;normalLoadN:number;slipSpeedMps:number;durationSeconds:number;temperatureC?:number;heatJ?:number}
const clamp=(v:number,a=0,b=1)=>Math.max(a,Math.min(b,v));
const LATENT=334000,ICE_HEAT=2100;
/** Equilibrium dry density under pressure, shared by contacts and soft support. */
export function snowBearingDensity(stressPa:number,initialDensityKgM3=160):number{
 if(!Number.isFinite(stressPa)||stressPa<0||!Number.isFinite(initialDensityKgM3)||initialDensityKgM3<30||initialDensityKgM3>917)throw RangeError('Invalid snow bearing pressure');
 return initialDensityKgM3+400*(1-Math.exp(-stressPa/55000));
}
export const emptySnow=():SnowPacket=>({massKg:0,volumeM3:0,enthalpyJ:0,bond:0});
export function snowThermal(p:SnowPacket){const h=p.massKg>0?p.enthalpyJ/p.massKg:0;return{temperatureC:h<0?h/ICE_HEAT:h>LATENT?(h-LATENT)/4180:0,liquidFraction:clamp(h/LATENT)};}
export function combineSnow(a:SnowPacket,b:SnowPacket):SnowPacket{const m=a.massKg+b.massKg;return{massKg:m,volumeM3:a.volumeM3+b.volumeM3,enthalpyJ:a.enthalpyJ+b.enthalpyJ,bond:m?(a.bond*a.massKg+b.bond*b.massKg)/m:0};}
const fraction=(p:SnowPacket,f:number):SnowPacket=>({...p,massKg:p.massKg*f,volumeM3:p.volumeM3*f,enthalpyJ:p.enthalpyJ*f});

/** Sparse material volume, not a visual stamp. Unmodified cells represent an
 * even snowfall. Cuts retain cavities; load compaction, transport and heat all
 * edit this same mass/enthalpy store. The discretisation sets the shape limit. */
export class SnowMatter {
  readonly cellM:number;readonly depthM:number;readonly densityKgM3:number;readonly temperatureC:number;
  readonly cells=new Map<string,SnowCell>();readonly changedColumns=new Set<string>();
  private readonly modifiedColumns=new Set<string>();
  private readonly columnRows=new Map<string,Set<string>>();
  private readonly columnCeilings=new Map<string,number>();
  private readonly flowColumns=new Set<string>();
  private readonly removedCells=new Set<string>();
  private readonly heightCache=new Map<string,ReturnType<SnowMatter['sampleUncached']>>();
  private pristineSample:ReturnType<SnowMatter['sampleUncached']>|undefined;
  private readonly edits=new Map<string,SnowCell>();
  revision=0;exportedKg=0;heatAddedJ=0;
  constructor(options:{cellM?:number;depthM?:number;densityKgM3?:number;temperatureC?:number;maxCells?:number}={}){
    this.cellM=options.cellM??.15;this.depthM=options.depthM??.48;this.densityKgM3=options.densityKgM3??160;this.temperatureC=options.temperatureC??-5;this.maxCells=options.maxCells??250000;
    if(![this.cellM,this.depthM,this.densityKgM3,this.temperatureC].every(Number.isFinite)||this.cellM<.025||this.cellM>1||this.depthM<0||this.depthM>3||this.densityKgM3<30||this.densityKgM3>917||this.temperatureC>0||!Number.isSafeInteger(this.maxCells)||this.maxCells<1)throw RangeError('Invalid snow volume');
  }
  private readonly maxCells:number;
  private key(x:number,y:number,z:number){return `${x},${y},${z}`;}
  cell(x:number,y:number,z:number):SnowCell{
    const stored=this.cells.get(this.key(x,y,z));if(stored)return stored;
    const volume=y<0?0:this.cellM**2*clamp(this.depthM-y*this.cellM,0,this.cellM),mass=volume*this.densityKgM3;
    return{massKg:mass,volumeM3:volume,enthalpyJ:mass*ICE_HEAT*this.temperatureC,bond:.04};
  }
  private put(x:number,y:number,z:number,c:SnowCell,record=true){
    const key=this.key(x,y,z);if(!this.cells.has(key)&&this.cells.size>=this.maxCells)throw RangeError('Snow residency budget exhausted');
    if(record)for(const [dx,dz] of [[0,0],[1,0],[-1,0],[0,1],[0,-1]])this.flowColumns.add(`${x+dx!},${z+dz!}`);
    const column=`${x},${z}`;let rows=this.columnRows.get(column);if(!rows){rows=new Set();this.columnRows.set(column,rows);}rows.add(key);if(c.massKg>0)this.columnCeilings.set(column,Math.max(y,this.columnCeilings.get(column)??0));
    this.removedCells.delete(key);this.cells.set(key,c);if(record)this.edits.set(key,c);this.changedColumns.add(`${x},${z}`);this.modifiedColumns.add(`${x},${z}`);this.heightCache.delete(`${x},${z}`);this.revision++;
  }
  private range(shape:SnowShape){
    if(![...shape.min,...shape.max].every(Number.isFinite)||shape.min.some((v,k)=>v>shape.max[k]!))throw RangeError('Invalid snow contact bounds');
    const lo=shape.min.map(v=>Math.floor(v/this.cellM)),hi=shape.max.map(v=>Math.floor(v/this.cellM));
    if((hi[0]!-lo[0]!+1)*(hi[1]!-lo[1]!+1)*(hi[2]!-lo[2]!+1)>65536)throw RangeError('Snow contact exceeds local volume budget');
    return{lo,hi};
  }
  editedColumns():IterableIterator<string>{return this.modifiedColumns.values();}
  sample(x:number,z:number){
    const key=`${Math.floor(x/this.cellM)},${Math.floor(z/this.cellM)}`;
    // Uniform snowfall needs one immutable sample, not an allocation per vertex
    // or an unbounded cache of untouched city coordinates.
    if(!this.modifiedColumns.has(key))return this.pristineSample??=Object.freeze(this.sampleUncached(x,z));
    const cached=this.heightCache.get(key);if(cached)return cached;
    const value=this.sampleUncached(x,z);if(this.modifiedColumns.has(key))this.heightCache.set(key,value);return value;
  }
  private topIndex(x:number,z:number){
    const column=`${x},${z}`,base=Math.max(0,Math.ceil(this.depthM/this.cellM)-1);let top=this.columnCeilings.get(column)??base;
    while(top>base&&this.cell(x,top,z).massKg<=0)top--;top=Math.max(base,top);this.columnCeilings.set(column,top);return Math.min(39,top);
  }
  private sampleUncached(x:number,z:number){
    const ix=Math.floor(x/this.cellM),iz=Math.floor(z/this.cellM);let height=0,top=emptySnow();
    if(!this.modifiedColumns.has(`${ix},${iz}`)){height=this.depthM;top=this.cell(ix,0,iz);}
    else for(let y=0,topY=this.topIndex(ix,iz);y<=topY;y++){const c=this.cell(ix,y,iz);if(c.massKg>1e-9){height=y*this.cellM+c.volumeM3/this.cellM**2;top=c;}}
    const thermal=snowThermal(top),density=top.massKg/Math.max(1e-9,top.volumeM3),compaction=clamp((density-this.densityKgM3)/400);
    return{height,depthM:height,densityKgM3:density,compaction,...thermal,friction:height<.012?.78:Math.max(.10,.28+.16*compaction-.20*thermal.liquidFraction),bond:top.bond};
  }
  /** Body/shovel swept SDF clips occupied material, including undercuts. Eight
   * subcell samples are conservative at the configured contact resolution. */
  cut(shape:SnowShape,maxKg=Infinity):SnowPacket{
    if(!(maxKg>=0))throw RangeError('Invalid snow payload');const {lo,hi}=this.range(shape),edits:{x:number;y:number;z:number;take:SnowPacket;left:SnowCell}[]=[];let removed=emptySnow();
    for(let z=lo[2]!;z<=hi[2]!;z++)for(let y=Math.max(0,lo[1]!);y<=hi[1]!;y++)for(let x=lo[0]!;x<=hi[0]!;x++){
      const c=this.cell(x,y,z);if(c.massKg<=0||removed.massKg>=maxKg)continue;let inside=0;
      const filledHeight=c.volumeM3/this.cellM**2;
      for(const dx of [.25,.75])for(const dy of [.25,.75])for(const dz of [.25,.75]){
        const d=shape.distance([(x+dx)*this.cellM,y*this.cellM+dy*filledHeight,(z+dz)*this.cellM]);if(!Number.isFinite(d))throw RangeError('Snow distance must be finite');if(d<=0)inside++;
      }
      const f=Math.min(inside/8,(maxKg-removed.massKg)/c.massKg);if(f<=0)continue;
      const take=fraction(c,f);removed=combineSnow(removed,take);edits.push({x,y,z,take,left:fraction(c,1-f)});
    }
    const additional=edits.filter(e=>!this.cells.has(this.key(e.x,e.y,e.z))).length;if(this.cells.size+additional>this.maxCells)throw RangeError('Snow residency budget exhausted');
    for(const e of edits)this.put(e.x,e.y,e.z,e.left);return removed;
  }
  /** Deposit into available volume; return overflow to the caller, never delete
   * snow when a pile reaches the bounded vertical residency (6 m by default). */
  deposit(position:Vec3,packet:SnowPacket):SnowPacket{
    if(!position.every(Number.isFinite)||![packet.massKg,packet.volumeM3,packet.enthalpyJ,packet.bond].every(Number.isFinite)||packet.massKg<0||packet.volumeM3<0)throw RangeError('Invalid snow transfer');
    let rest={...packet};const changes:{x:number;y:number;z:number;cell:SnowCell}[]=[];const x=Math.floor(position[0]/this.cellM),z=Math.floor(position[2]/this.cellM);
    for(let y=0;y<40&&rest.massKg>1e-9;y++){
      const cell=this.cell(x,y,z),space=Math.max(0,this.cellM**3-cell.volumeM3);if(space<1e-12)continue;
      const f=clamp(space/Math.max(1e-12,rest.volumeM3)),take=fraction(rest,f);changes.push({x,y,z,cell:combineSnow(cell,take)});rest=fraction(rest,1-f);
    }
    if(this.cells.size+changes.filter(e=>!this.cells.has(this.key(e.x,e.y,e.z))).length>this.maxCells)throw RangeError('Snow residency budget exhausted');
    for(const e of changes)this.put(e.x,e.y,e.z,e.cell);return rest;
  }
  /** A finite shovel/blade footprint distributes its packet before gravity
   * relaxes the pile. Putting a whole bucket into one column creates a needle. */
  pour(position:Vec3,packet:SnowPacket,radiusM:number):SnowPacket{
    if(!Number.isFinite(radiusM)||radiusM<this.cellM*.5||radiusM>3)throw RangeError('Invalid snow pour radius');
    const columns:Vec3[]=[],s=this.cellM;
    for(let z=Math.floor((position[2]-radiusM)/s);z<=Math.floor((position[2]+radiusM)/s);z++)for(let x=Math.floor((position[0]-radiusM)/s);x<=Math.floor((position[0]+radiusM)/s);x++)if(Math.hypot((x+.5)*s-position[0],(z+.5)*s-position[2])<radiusM+s*.3)columns.push([(x+.5)*s,0,(z+.5)*s]);
    // Reserve every potential column before starting the transfer. No partial
    // mutation is allowed when the configured residency cannot hold a pour.
    let additional=0;for(const p of columns)for(let y=0;y<40;y++)if(!this.cells.has(this.key(Math.floor(p[0]/s),y,Math.floor(p[2]/s))))additional++;
    if(this.cells.size+additional>this.maxCells)throw RangeError('Snow residency budget exhausted');
    const share=fraction(packet,1/columns.length);let overflow=emptySnow();for(const p of columns)overflow=combineSnow(overflow,this.deposit(p,share));return overflow;
  }
  contact(c:SnowContact){
    if(![...c.position,c.radiusM,c.normalLoadN,c.slipSpeedMps,c.durationSeconds,c.temperatureC??0,c.heatJ??0].every(Number.isFinite)||c.radiusM<=0||c.radiusM>3||c.normalLoadN<0||c.durationSeconds<=0||c.durationSeconds>.25||c.slipSpeedMps<0|| (c.heatJ??0)<0)throw RangeError('Invalid snow contact');
    const r=c.radiusM,s=this.cellM,columns:number[][]=[];
    for(let z=Math.floor((c.position[2]-r)/s);z<=Math.floor((c.position[2]+r)/s);z++)for(let x=Math.floor((c.position[0]-r)/s);x<=Math.floor((c.position[0]+r)/s);x++)if(Math.hypot((x+.5)*s-c.position[0],(z+.5)*s-c.position[2])<=r+s*.3)columns.push([x,z]);
    const stress=c.normalLoadN/Math.max(s*s,columns.length*s*s),targetDensity=snowBearingDensity(stress,this.densityKgM3);let compressionM=0,addedHeat=0;const changes:{x:number;y:number;z:number;cell:SnowCell}[]=[];
    for(const [x,z] of columns){
      const before=this.sample((x!+.5)*s,(z!+.5)*s).height;let packet=emptySnow();
      const topY=this.topIndex(x!,z!);for(let y=0;y<=topY;y++)packet=combineSnow(packet,this.cell(x!,y,z!));if(packet.massKg<=0)continue;
      const density=packet.massKg/packet.volumeM3,nextDensity=Math.max(density,density+(targetDensity-density)*(1-Math.exp(-c.durationSeconds*18)));
      const thermal=snowThermal(packet),conduction=Math.max(0,(c.temperatureC??thermal.temperatureC)-thermal.temperatureC)*s*s*28*c.durationSeconds;
      const energy=(c.heatJ??0)/Math.max(1,columns.length)+conduction;
      packet.enthalpyJ+=energy;addedHeat+=energy;const liquid=snowThermal(packet).liquidFraction;
      packet.volumeM3=packet.massKg*((1-liquid)/nextDensity+liquid/1000);packet.bond=clamp(packet.bond+liquid*c.durationSeconds*.8);
      let rest=packet;
      for(let y=0;y<=topY;y++){const f=Math.min(1,s**3/Math.max(1e-12,rest.volumeM3)),layer=fraction(rest,f);rest=fraction(rest,1-f);const old=this.cell(x!,y,z!);if(old.massKg||layer.massKg)changes.push({x:x!,y,z:z!,cell:layer});}
      compressionM+=Math.max(0,before-packet.volumeM3/(s*s));
    }
    if(this.cells.size+changes.filter(e=>!this.cells.has(this.key(e.x,e.y,e.z))).length>this.maxCells)throw RangeError('Snow residency budget exhausted');
    for(const e of changes)this.put(e.x,e.y,e.z,e.cell);this.heatAddedJ+=addedHeat;
    return{compressionM:compressionM/Math.max(1,columns.length),sample:this.sample(c.position[0],c.position[2])};
  }
  /** Local gravitational flow follows angle of repose and wet cohesion. Cuts
   * activate neighbours; no timed avalanche animation exists. */
  relax(dt:number,budget=160){
    if(!Number.isFinite(dt)||dt<=0||dt>.25||!Number.isSafeInteger(budget)||budget<0)throw RangeError('Invalid snow step');let movedKg=0;
    // Rendering drains changedColumns. Gravity has its own fair work queue.
    const active:string[]=[];for(const key of this.flowColumns){if(active.length>=budget)break;active.push(key);}
    for(const key of active){this.flowColumns.delete(key);const [x,z]=key.split(',').map(Number),s=this.cellM,a=this.sample((x!+.5)*s,(z!+.5)*s);let dest:number[]|undefined,low=a.height;
      for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x!+dx!,nz=z!+dz!,h=this.sample((nx+.5)*s,(nz+.5)*s).height;if(h<low){low=h;dest=[nx,nz];}}
      const excess=a.height-low-s*(.65+a.bond*1.5);
      if(!dest||excess<=.0001||this.cells.size+40>=this.maxCells)continue;
      let volume=excess*s*s*Math.min(.5,dt*5),packet=emptySnow();
      // Move a finite slab from the top, including whole cells. Exponentially
      // draining only the uppermost cell leaves a tall, almost massless needle.
      for(let y=Math.max(0,Math.floor((a.height-1e-6)/s));y>=0&&volume>1e-12;y--){const cell=this.cell(x!,y,z!);if(cell.volumeM3<=1e-12)continue;const f=Math.min(1,volume/cell.volumeM3),take=fraction(cell,f);this.put(x!,y,z!,fraction(cell,1-f));packet=combineSnow(packet,take);volume-=take.volumeM3;}
      const leftover=this.deposit([(dest[0]!+.5)*s,0,(dest[1]!+.5)*s],packet);if(leftover.massKg)this.deposit([(x!+.5)*s,0,(z!+.5)*s],leftover);movedKg+=packet.massKg-leftover.massKg;
    }return movedKg;
  }
  adhesion(packet:SnowPacket,bodyTemperatureC:number,pressurePa:number){const t=snowThermal(packet);return clamp((.08+t.liquidFraction*2+packet.bond*.65)*(1-Math.exp(-Math.max(0,pressurePa)/2500))*(bodyTemperatureC>5?.6:1));}
  /** Surface energy balance in physical seconds. Melt drains at 0 C carrying
   * latent heat; solid columns settle into the vacated volume. Gravity then
   * uses the existing repose law, independently of the thermal work budget. */
  exchangeHeat(dt:number,environment:{temperatureC:number;windMps:number;sunlightWm2:number;groundTemperatureC?:number},onDrain?:(x:number,z:number,massKg:number)=>void){
    const {temperatureC,windMps,sunlightWm2,groundTemperatureC=temperatureC}=environment;
    if(![dt,temperatureC,windMps,sunlightWm2,groundTemperatureC].every(Number.isFinite)||dt<=0||dt>3600||windMps<0||sunlightWm2<0)throw RangeError('Invalid snow heat exchange');
    let drainedKg=0;
    // Explicitly resident columns only. An infinite implicit snowfall field
    // cannot be heated by enumerating arbitrary world coordinates.
    for(const column of [...this.modifiedColumns]){
      const [x,z]=column.split(',').map(Number),top=this.topIndex(x!,z!);let packet=emptySnow();
      for(let y=0;y<=top;y++)packet=combineSnow(packet,this.cell(x!,y,z!));
      if(packet.massKg<=1e-9)continue;
      const thermal=snowThermal(packet),area=this.cellM**2;
      const convection=(8+4*windMps)*(temperatureC-thermal.temperatureC);
      const ground=2*(groundTemperatureC-thermal.temperatureC),solar=sunlightWm2*.25;
      const requested=(convection+ground+solar)*area*dt;
      // Prevent passive transfer overshooting ambient equilibrium.
      const equilibrium=packet.massKg*(temperatureC<0?ICE_HEAT*temperatureC:LATENT+4180*temperatureC);
      const heat=requested>0?Math.min(requested,Math.max(0,equilibrium-packet.enthalpyJ)):Math.max(requested,Math.min(0,equilibrium-packet.enthalpyJ));
      packet.enthalpyJ+=heat;this.heatAddedJ+=heat;
      const melt=Math.min(packet.massKg,Math.max(0,packet.enthalpyJ/LATENT)),remaining=packet.massKg-melt;
      packet.volumeM3*=remaining/packet.massKg;packet.massKg=remaining;packet.enthalpyJ-=melt*LATENT;
      drainedKg+=melt;this.exportedKg+=melt;
      if(melt>0)onDrain?.((x!+.5)*this.cellM,(z!+.5)*this.cellM,melt);
      let rest=packet;
      for(let y=0;y<=top;y++){
        const f=Math.min(1,this.cellM**3/Math.max(1e-12,rest.volumeM3)),layer=fraction(rest,f);rest=fraction(rest,1-f);this.put(x!,y,z!,layer);
      }
    }
    return {drainedKg};
  }
  export(packet:SnowPacket){this.exportedKg+=packet.massKg;}
  drainEdits(){const result=[...this.edits].map(([key,c])=>[key,c.massKg,c.volumeM3,c.enthalpyJ,c.bond] as const);this.edits.clear();return result;}
  /** Move distant changes to a persistent world store; the caller owns the
   * returned material records and must restore them before reactivating a tile. */
  detachWhere(outside:(x:number,z:number)=>boolean){
    const columns=new Set<string>();for(const key of this.modifiedColumns){const [x,z]=key.split(',').map(Number);if(outside((x!+.5)*this.cellM,(z!+.5)*this.cellM))columns.add(key);}
    const rows:ReturnType<SnowMatter['drainEdits']>=[];
    for(const column of columns){for(const key of this.columnRows.get(column)??[]){const c=this.cells.get(key)!;rows.push([key,c.massKg,c.volumeM3,c.enthalpyJ,c.bond]);this.cells.delete(key);this.edits.delete(key);this.removedCells.add(key);}this.columnRows.delete(column);}
    for(const key of columns){this.modifiedColumns.delete(key);this.columnCeilings.delete(key);this.flowColumns.delete(key);this.changedColumns.delete(key);this.heightCache.delete(key);}return rows;
  }
  drainRemoved():string[]{const keys=[...this.removedCells];this.removedCells.clear();return keys;}
  removeCells(keys:readonly string[]){
    const columns=new Set<string>();for(const key of keys){const [x,,z]=key.split(','),column=x+','+z;this.cells.delete(key);this.edits.delete(key);this.columnRows.get(column)?.delete(key);columns.add(column);}
    for(const key of columns){this.changedColumns.add(key);this.heightCache.delete(key);this.flowColumns.delete(key);if(!this.columnRows.get(key)?.size){this.modifiedColumns.delete(key);this.columnCeilings.delete(key);this.columnRows.delete(key);}}
  }
  apply(edits:ReturnType<SnowMatter['drainEdits']>,record=false){for(const [key,m,v,h,b] of edits){const [x,y,z]=key.split(',').map(Number);this.put(x!,y!,z!,{massKg:m,volumeM3:v,enthalpyJ:h,bond:b},record);}if(!record){this.edits.clear();this.flowColumns.clear();}}
  snapshot(){return{revision:this.revision,cells:[...this.cells].map(([key,c])=>[key,c.massKg,c.volumeM3,c.enthalpyJ,c.bond] as const),exportedKg:this.exportedKg,heatAddedJ:this.heatAddedJ};}
  restore(snapshot:ReturnType<SnowMatter['snapshot']>){
    if(snapshot.cells.length>this.maxCells)throw RangeError('Snow snapshot exceeds residency');
    // Adjacent chunks share almost all terrain. Retain cached column heights
    // and invalidate only actual changes, including columns evicted by authority.
    const keep=new Set(snapshot.cells.map(row=>row[0])),removed=new Set<string>();
    for(const key of this.cells.keys())if(!keep.has(key)){const [x,,z]=key.split(','),column=x+','+z;this.cells.delete(key);this.columnRows.get(column)?.delete(key);removed.add(column);}
    for(const key of removed){this.changedColumns.add(key);this.heightCache.delete(key);if(!this.columnRows.get(key)?.size){this.modifiedColumns.delete(key);this.columnCeilings.delete(key);this.columnRows.delete(key);}}
    for(const [key,m,v,h,b] of snapshot.cells){const old=this.cells.get(key);if(old&&old.massKg===m&&old.volumeM3===v&&old.enthalpyJ===h&&old.bond===b)continue;const [x,y,z]=key.split(',').map(Number);this.put(x!,y!,z!,{massKg:m,volumeM3:v,enthalpyJ:h,bond:b},false);}
    this.edits.clear();this.removedCells.clear();this.flowColumns.clear();this.revision=snapshot.revision;this.exportedKg=snapshot.exportedKg;this.heatAddedJ=snapshot.heatAddedJ;
  }
}

export function snowSphere(center:Vec3,radius:number):SnowShape{return{min:center.map(v=>v-radius) as unknown as Vec3,max:center.map(v=>v+radius) as unknown as Vec3,distance:p=>Math.hypot(...p.map((v,k)=>v-center[k]!))-radius};}
