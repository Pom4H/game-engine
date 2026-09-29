export interface DeformableSurfaceCell {
  displacementM:number;
  compaction:number;
  shear:number;
  history:number;
}

export interface DeformableSurfaceStamp {
  readonly x:number;
  readonly z:number;
  readonly radiusM:number;
  readonly depthM:number;
  readonly compaction?:number;
  readonly shear?:number;
  /** Fraction of displaced volume that forms a positive rim; the rest compacts. */
  readonly displacementRatio?:number;
}

const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));

/**
 * Persistent signed surface displacement. Negative height is a rut/footprint;
 * positive height is material pushed out around it. The field is material-agnostic:
 * snow, slush, mud or sand choose stamp parameters from their physical state.
 */
export class DeformableSurfaceField {
  readonly cells:DeformableSurfaceCell[];
  constructor(
    readonly center:readonly[number,number],
    readonly size:readonly[number,number],
    readonly nx:number,
    readonly nz:number,
  ){
    if(!center.every(Number.isFinite)||!size.every(v=>Number.isFinite(v)&&v>0)||!Number.isInteger(nx)||!Number.isInteger(nz)||nx<1||nz<1)throw new RangeError('Invalid deformable surface field');
    this.cells=Array.from({length:nx*nz},()=>({displacementM:0,compaction:0,shear:0,history:0}));
  }

  sample(x:number,z:number):DeformableSurfaceCell|undefined{
    const u=(x-this.center[0])/this.size[0]+.5,v=(z-this.center[1])/this.size[1]+.5;
    if(u<0||u>1||v<0||v>1)return undefined;
    return this.cells[Math.min(this.nz-1,Math.floor(v*this.nz))*this.nx+Math.min(this.nx-1,Math.floor(u*this.nx))];
  }

  stamp(stamp:DeformableSurfaceStamp):boolean{
    const {x,z,radiusM,depthM}=stamp;
    if(![x,z,radiusM,depthM].every(Number.isFinite)||radiusM<=0||depthM<=0)return false;
    const cellX=this.size[0]/this.nx,cellZ=this.size[1]/this.nz,cellArea=cellX*cellZ,halfDiag=Math.hypot(cellX,cellZ)*.5;
    const influence=radiusM*1.8+halfDiag,lx=x-this.center[0]+this.size[0]/2,lz=z-this.center[1]+this.size[1]/2;
    const minX=Math.max(0,Math.floor((lx-influence)/cellX)),maxX=Math.min(this.nx-1,Math.floor((lx+influence)/cellX));
    const minZ=Math.max(0,Math.floor((lz-influence)/cellZ)),maxZ=Math.min(this.nz-1,Math.floor((lz+influence)/cellZ));
    const depression:{index:number;weight:number}[]=[],rim:{index:number;weight:number}[]=[];
    let maxDepression=0,sumRim=0;
    for(let iz=minZ;iz<=maxZ;iz++)for(let ix=minX;ix<=maxX;ix++){
      const cx=this.center[0]+((ix+.5)/this.nx-.5)*this.size[0],cz=this.center[1]+((iz+.5)/this.nz-.5)*this.size[1],q=Math.hypot(cx-x,cz-z)/radiusM,index=iz*this.nx+ix;
      const depressionWeight=q<1.18?Math.pow(Math.max(0,1-(q/1.18)**2),2):0;
      const rimWeight=q>.55&&q<1.82?Math.exp(-((q-1.18)/.28)**2):0;
      if(depressionWeight>0){depression.push({index,weight:depressionWeight});maxDepression=Math.max(maxDepression,depressionWeight);}
      if(rimWeight>.001){rim.push({index,weight:rimWeight});sumRim+=rimWeight;}
    }
    if(!depression.length||maxDepression<=0)return false;
    const compaction=clamp(stamp.compaction??.5,0,1),shear=clamp(stamp.shear??0,0,1),ratio=clamp(stamp.displacementRatio??.72,0,1);
    let removedVolume=0;
    for(const item of depression){
      const normalized=item.weight/maxDepression,cell=this.cells[item.index]!,down=depthM*normalized;
      cell.displacementM=clamp(cell.displacementM-down,-.12,.12);
      cell.compaction=clamp(cell.compaction+compaction*normalized*.18,0,1);
      cell.shear=clamp(Math.max(cell.shear,shear*normalized),0,1);
      cell.history=clamp(cell.history+normalized*.08,0,1);
      removedVolume+=down*cellArea;
    }
    if(sumRim>0&&removedVolume>0){
      const rise=removedVolume*ratio/(sumRim*cellArea);
      for(const item of rim){
        const cell=this.cells[item.index]!;
        cell.displacementM=clamp(cell.displacementM+rise*item.weight,-.12,.12);
        cell.shear=clamp(Math.max(cell.shear,shear*item.weight),0,1);
        cell.history=clamp(cell.history+item.weight*.035,0,1);
      }
    }
    return true;
  }

  relax(dt:number,flow=0):void{
    if(!Number.isFinite(dt)||dt<=0)return;
    const heightDecay=Math.exp(-dt*(.00001+clamp(flow,0,1)*.00008)),shearDecay=Math.exp(-dt*(.018+clamp(flow,0,1)*.08)),compactionDecay=Math.exp(-dt/43_200),historyDecay=Math.exp(-dt/86_400);
    for(const cell of this.cells){
      cell.displacementM*=heightDecay;
      cell.shear*=shearDecay;
      cell.compaction*=compactionDecay;
      cell.history*=historyDecay;
    }
  }
}

export function surfaceFieldResolution(size:readonly[number,number]):readonly[number,number]{
  return[
    Math.min(384,Math.max(1,Math.ceil(size[0]/.35))),
    Math.min(192,Math.max(1,Math.ceil(size[1]/.35))),
  ];
}
