import type {Vec3} from '../math.js';
import {V3} from '../math.js';

export interface AcousticWaveFieldSpec {
  readonly size:readonly [number,number,number];
  readonly cellSizeM:number;
  readonly waveSpeedMps:number;
  readonly densityKgM3:number;
  readonly origin?:Vec3;
  /** Linear drag applied to medium velocity. Zero is lossless apart from discretization. */
  readonly velocityDampingPerSecond?:number;
}

export interface AcousticWaveStepStats {
  readonly pressureCells:number;
  readonly velocityFaces:number;
  readonly solidCells:number;
  readonly courant:number;
}

/** Optional compiled kernel operating directly on its own Wasm-backed typed arrays.
 * Buffer identity and ownership remain stable across simulation ticks. */
export interface AcousticWaveKernel {
  readonly pressurePa:Float64Array;
  readonly velocityXMps:Float64Array;
  readonly velocityYMps:Float64Array;
  readonly velocityZMps:Float64Array;
  readonly solid:Uint8Array;
  readonly planeBytesPerRow:number;
  step(velocityScale:number,velocityKick:number,pressureKick:number):void;
  packPressurePlane(y:number):Float32Array;
  dispose():void;
}
export interface AcousticPressurePlane {
  /** r32float, X across columns, Z across rows, padded to 256 bytes/row for WebGPU. */
  readonly data:Float32Array;
  readonly width:number;
  readonly height:number;
  readonly bytesPerRow:number;
}

export interface BlastInjection {
  readonly acousticEnergyJ:number;
  readonly affectedCells:number;
  /** Amplitude of the compact pressure profile before cell-centre sampling. */
  readonly peakPressurePa:number;
}

export interface PressurePatch {
  readonly point:Vec3;
  /** Unit convention: points from the solid into the acoustic medium. */
  readonly outwardNormal:Vec3;
  readonly areaM2:number;
  /** Multiplier for unresolved geometry/transmission. One means direct pressure coupling. */
  readonly coupling?:number;
  readonly impulseRadiusM?:number;
}

export interface PressurePatchLoad {
  readonly pressurePa:number;
  readonly forceN:Vec3;
  readonly impulseNs:Vec3;
}

export interface StructuralImpulseSink {
  applyImpulse(point:Vec3,impulse:Vec3,radius?:number):void;
}

const MAX_CELLS=32_000_000;
const CFL_3D=1/Math.sqrt(3);

export class AcousticWaveField {
  readonly size:readonly [number,number,number];
  readonly origin:Vec3;
  readonly cellSizeM:number;
  readonly waveSpeedMps:number;
  readonly densityKgM3:number;
  readonly velocityDampingPerSecond:number;
  readonly pressurePa:Float64Array;
  readonly velocityXMps:Float64Array;
  readonly velocityYMps:Float64Array;
  readonly velocityZMps:Float64Array;
  readonly solid:Uint8Array;

  private readonly nx:number;
  private readonly ny:number;
  private readonly nz:number;
  private solidCount=0;
  private readonly numericalKernel?:AcousticWaveKernel;
  private pressurePlaneScratch?:Float32Array;
  private disposed=false;

  constructor(spec:AcousticWaveFieldSpec,numericalKernel?:AcousticWaveKernel){
    const [nx,ny,nz]=spec.size;
    for(const value of [nx,ny,nz])if(!Number.isSafeInteger(value)||value<2||value>2048)throw new RangeError('Acoustic grid dimensions must be integers in 2..2048');
    const cells=nx*ny*nz;
    if(!Number.isSafeInteger(cells)||cells>MAX_CELLS)throw new RangeError('Acoustic grid is too large');
    if(!Number.isFinite(spec.cellSizeM)||spec.cellSizeM<=0)throw new RangeError('Acoustic cell size must be positive');
    if(!Number.isFinite(spec.waveSpeedMps)||spec.waveSpeedMps<=0)throw new RangeError('Acoustic wave speed must be positive');
    if(!Number.isFinite(spec.densityKgM3)||spec.densityKgM3<=0)throw new RangeError('Acoustic density must be positive');
    const damping=spec.velocityDampingPerSecond??0;
    if(!Number.isFinite(damping)||damping<0)throw new RangeError('Acoustic velocity damping must be non-negative');
    const origin=spec.origin??[0,0,0];
    if(!origin.every(Number.isFinite))throw new TypeError('Acoustic origin must be finite');

    this.nx=nx;this.ny=ny;this.nz=nz;
    this.size=Object.freeze([nx,ny,nz]);
    this.origin=Object.freeze([...origin]) as Vec3;
    this.cellSizeM=spec.cellSizeM;
    this.waveSpeedMps=spec.waveSpeedMps;
    this.densityKgM3=spec.densityKgM3;
    this.velocityDampingPerSecond=damping;
    const vxCells=(nx+1)*ny*nz,vyCells=nx*(ny+1)*nz,vzCells=nx*ny*(nz+1);
    if(numericalKernel){
      const lengths=[
        [numericalKernel.pressurePa,cells,'pressurePa'],
        [numericalKernel.velocityXMps,vxCells,'velocityXMps'],
        [numericalKernel.velocityYMps,vyCells,'velocityYMps'],
        [numericalKernel.velocityZMps,vzCells,'velocityZMps'],
        [numericalKernel.solid,cells,'solid'],
      ] as const;
      for(const [buffer,length,name] of lengths)if(buffer.length!==length)throw new RangeError('Acoustic kernel '+name+' length mismatch');
      if(!Number.isSafeInteger(numericalKernel.planeBytesPerRow)||numericalKernel.planeBytesPerRow<nx*4||numericalKernel.planeBytesPerRow%256!==0)throw new RangeError('Acoustic kernel GPU row stride must be 256-byte aligned');
    }
    this.numericalKernel=numericalKernel;
    this.pressurePa=numericalKernel?.pressurePa??new Float64Array(cells);
    this.velocityXMps=numericalKernel?.velocityXMps??new Float64Array(vxCells);
    this.velocityYMps=numericalKernel?.velocityYMps??new Float64Array(vyCells);
    this.velocityZMps=numericalKernel?.velocityZMps??new Float64Array(vzCells);
    this.solid=numericalKernel?.solid??new Uint8Array(cells);
  }

  get backend(): 'typescript'|'wasm' {return this.numericalKernel?'wasm':'typescript';}
  get maxStableDt():number{return this.cellSizeM*CFL_3D/this.waveSpeedMps;}
  get solidCellCount():number{return this.solidCount;}

  /** Rebuildable geometry projection. Wave state is preserved in cells that become fluid. */
  clearSolidCells():void{this.solid.fill(0);this.solidCount=0;}

  cellCenter(x:number,y:number,z:number):Vec3{
    this.validateCell(x,y,z);
    const h=this.cellSizeM,o=this.origin;
    return[o[0]+(x+.5)*h,o[1]+(y+.5)*h,o[2]+(z+.5)*h];
  }

  setSolidCell(x:number,y:number,z:number,value=true):void{
    this.validateCell(x,y,z);
    const i=this.pIndex(x,y,z),prior=this.solid[i]!==0;
    if(prior===value)return;
    this.solid[i]=value?1:0;
    this.solidCount+=value?1:-1;
    if(!value)return;
    this.pressurePa[i]=0;
    this.velocityXMps[this.vxIndex(x,y,z)]=0;
    this.velocityXMps[this.vxIndex(x+1,y,z)]=0;
    this.velocityYMps[this.vyIndex(x,y,z)]=0;
    this.velocityYMps[this.vyIndex(x,y+1,z)]=0;
    this.velocityZMps[this.vzIndex(x,y,z)]=0;
    this.velocityZMps[this.vzIndex(x,y,z+1)]=0;
  }

  addPressureCell(x:number,y:number,z:number,deltaPa:number):void{
    this.validateCell(x,y,z);
    if(!Number.isFinite(deltaPa))throw new TypeError('Pressure delta must be finite');
    const i=this.pIndex(x,y,z);
    if(this.solid[i])throw new Error('Cannot inject pressure into a solid acoustic cell');
    this.pressurePa[i]=this.pressurePa[i]!+deltaPa;
  }

  pressureAt(point:Vec3):number{
    if(!point.every(Number.isFinite))throw new TypeError('Pressure sample point must be finite');
    const cell=this.cellAt(point);if(!cell)return 0;
    const [x,y,z]=cell,i=this.pIndex(x,y,z);
    return this.solid[i]?0:this.pressurePa[i]!;
  }

  /** Cell-centred medium velocity reconstructed from the six staggered faces. */
  velocityAt(point:Vec3):Vec3{
    if(!point.every(Number.isFinite))throw new TypeError('Velocity sample point must be finite');
    const cell=this.cellAt(point);if(!cell)return[0,0,0];
    const [x,y,z]=cell,i=this.pIndex(x,y,z);if(this.solid[i])return[0,0,0];
    return[
      .5*(this.velocityXMps[this.vxIndex(x,y,z)]!+this.velocityXMps[this.vxIndex(x+1,y,z)]!),
      .5*(this.velocityYMps[this.vyIndex(x,y,z)]!+this.velocityYMps[this.vyIndex(x,y+1,z)]!),
      .5*(this.velocityZMps[this.vzIndex(x,y,z)]!+this.velocityZMps[this.vzIndex(x,y,z+1)]!),
    ];
  }

  /** Compression energy currently stored in pressure, excluding medium kinetic energy. */
  compressionEnergyJ():number{
    const bulk=this.densityKgM3*this.waveSpeedMps*this.waveSpeedMps;
    const volume=this.cellSizeM**3;
    let sum=0;
    for(let i=0;i<this.pressurePa.length;i++)if(!this.solid[i]){const p=this.pressurePa[i]!;sum+=p*p;}
    return sum*volume/(2*bulk);
  }

  /**
   * Adds a compact positive-pressure source whose isolated initial compression
   * energy equals acousticEnergyJ. This is the acoustic share of an explosion,
   * not a TNT/chemistry model and not a near-field detonation solver.
   */
  injectBlast(input:{readonly position:Vec3;readonly acousticEnergyJ:number;readonly radiusM:number}):BlastInjection{
    const {position,acousticEnergyJ,radiusM}=input;
    if(!position.every(Number.isFinite))throw new TypeError('Blast position must be finite');
    if(!Number.isFinite(acousticEnergyJ)||acousticEnergyJ<=0)throw new RangeError('Blast acoustic energy must be positive');
    if(!Number.isFinite(radiusM)||radiusM<=0)throw new RangeError('Blast radius must be positive');
    const bounds=this.sourceBounds(position,radiusM);
    let sumWeight2=0,affectedCells=0;
    this.forSourceCells(bounds,position,radiusM,(index,weight)=>{
      if(this.solid[index])return;
      sumWeight2+=weight*weight;affectedCells++;
    });
    if(affectedCells===0||sumWeight2<=0)throw new Error('Blast source does not overlap a fluid acoustic cell');
    const bulk=this.densityKgM3*this.waveSpeedMps*this.waveSpeedMps;
    const cellVolume=this.cellSizeM**3;
    const amplitude=Math.sqrt(2*bulk*acousticEnergyJ/(cellVolume*sumWeight2));
    this.forSourceCells(bounds,position,radiusM,(index,weight)=>{
      if(!this.solid[index])this.pressurePa[index]=this.pressurePa[index]!+amplitude*weight;
    });
    return Object.freeze({acousticEnergyJ,affectedCells,peakPressurePa:amplitude});
  }

  /**
   * First-order linear-acoustics FDTD on a staggered grid.
   * Pressure is cell-centred; medium velocity lives on faces. Hard cells impose
   * zero normal velocity, so walls reflect instead of transmitting the wave.
   */
  step(dt:number):AcousticWaveStepStats{
    if(!Number.isFinite(dt)||dt<=0)throw new RangeError('Acoustic dt must be positive');
    const courant=this.waveSpeedMps*dt/this.cellSizeM;
    if(courant>CFL_3D*(1+1e-12))throw new RangeError('Acoustic CFL limit exceeded');
    const h=this.cellSizeM,rho=this.densityKgM3;
    const velocityScale=Math.exp(-this.velocityDampingPerSecond*dt);
    const velocityKick=dt/(rho*h);
    const p=this.pressurePa,solid=this.solid;
    let velocityFaces=0;
    if(this.numericalKernel){
      const pressureKick=rho*this.waveSpeedMps*this.waveSpeedMps*dt/h;
      this.numericalKernel.step(velocityScale,velocityKick,pressureKick);
      velocityFaces=(this.nx-1)*this.ny*this.nz+this.nx*(this.ny-1)*this.nz+this.nx*this.ny*(this.nz-1);
      return Object.freeze({pressureCells:p.length,velocityFaces,solidCells:this.solidCount,courant});
    }

    for(let z=0;z<this.nz;z++)for(let y=0;y<this.ny;y++)for(let x=1;x<this.nx;x++){
      const face=this.vxIndex(x,y,z),left=this.pIndex(x-1,y,z),right=this.pIndex(x,y,z);velocityFaces++;
      this.velocityXMps[face]=(solid[left]||solid[right])?0:velocityScale*this.velocityXMps[face]!-velocityKick*(p[right]!-p[left]!);
    }
    for(let z=0;z<this.nz;z++)for(let y=1;y<this.ny;y++)for(let x=0;x<this.nx;x++){
      const face=this.vyIndex(x,y,z),below=this.pIndex(x,y-1,z),above=this.pIndex(x,y,z);velocityFaces++;
      this.velocityYMps[face]=(solid[below]||solid[above])?0:velocityScale*this.velocityYMps[face]!-velocityKick*(p[above]!-p[below]!);
    }
    for(let z=1;z<this.nz;z++)for(let y=0;y<this.ny;y++)for(let x=0;x<this.nx;x++){
      const face=this.vzIndex(x,y,z),back=this.pIndex(x,y,z-1),front=this.pIndex(x,y,z);velocityFaces++;
      this.velocityZMps[face]=(solid[back]||solid[front])?0:velocityScale*this.velocityZMps[face]!-velocityKick*(p[front]!-p[back]!);
    }

    const pressureKick=rho*this.waveSpeedMps*this.waveSpeedMps*dt/h;
    for(let z=0;z<this.nz;z++)for(let y=0;y<this.ny;y++)for(let x=0;x<this.nx;x++){
      const i=this.pIndex(x,y,z);
      if(solid[i]){p[i]=0;continue;}
      const divergence=
        this.velocityXMps[this.vxIndex(x+1,y,z)]!-this.velocityXMps[this.vxIndex(x,y,z)]!+
        this.velocityYMps[this.vyIndex(x,y+1,z)]!-this.velocityYMps[this.vyIndex(x,y,z)]!+
        this.velocityZMps[this.vzIndex(x,y,z+1)]!-this.velocityZMps[this.vzIndex(x,y,z)]!;
      p[i]=p[i]!-pressureKick*divergence;
    }

    return Object.freeze({pressureCells:p.length,velocityFaces,solidCells:this.solidCount,courant});
  }

  /**
   * Build a GPU-ready r32float XZ slice without allocations in a simulation tick.
   * With the Wasm backend conversion/padding happens inside Rust-owned staging
   * memory; upload can pass this view directly to GPUQueue.writeTexture.
   */
  pressurePlaneForGPU(y:number):AcousticPressurePlane{
    if(!Number.isSafeInteger(y)||y<0||y>=this.ny)throw new RangeError('Acoustic GPU slice Y out of range');
    const bytesPerRow=this.numericalKernel?.planeBytesPerRow??Math.ceil(this.nx*4/256)*256;
    const stride=bytesPerRow/4;
    const data=this.numericalKernel?.packPressurePlane(y)??this.pressurePlaneScratch??new Float32Array(stride*this.nz);
    if(!this.numericalKernel){
      this.pressurePlaneScratch=data;
      for(let z=0;z<this.nz;z++)for(let x=0;x<this.nx;x++){
        const index=this.pIndex(x,y,z);
        data[z*stride+x]=this.solid[index]?0:this.pressurePa[index]!;
      }
    }
    return{data,width:this.nx,height:this.nz,bytesPerRow};
  }

  /** Release an opt-in Rust kernel; never call this field after disposal. */
  dispose():void{
    if(this.disposed)return;
    this.disposed=true;
    this.numericalKernel?.dispose();
  }

  clearWaveState():void{
    this.pressurePa.fill(0);
    this.velocityXMps.fill(0);this.velocityYMps.fill(0);this.velocityZMps.fill(0);
  }

  private sourceBounds(position:Vec3,radius:number):readonly [number,number,number,number,number,number]{
    const h=this.cellSizeM,o=this.origin;
    const minX=Math.max(0,Math.floor((position[0]-radius-o[0])/h));
    const maxX=Math.min(this.nx-1,Math.floor((position[0]+radius-o[0])/h));
    const minY=Math.max(0,Math.floor((position[1]-radius-o[1])/h));
    const maxY=Math.min(this.ny-1,Math.floor((position[1]+radius-o[1])/h));
    const minZ=Math.max(0,Math.floor((position[2]-radius-o[2])/h));
    const maxZ=Math.min(this.nz-1,Math.floor((position[2]+radius-o[2])/h));
    return[minX,maxX,minY,maxY,minZ,maxZ];
  }

  private forSourceCells(
    bounds:readonly [number,number,number,number,number,number],
    position:Vec3,
    radius:number,
    visit:(index:number,weight:number)=>void,
  ):void{
    const [minX,maxX,minY,maxY,minZ,maxZ]=bounds;
    for(let z=minZ;z<=maxZ;z++)for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
      const center=this.cellCenter(x,y,z);
      const q=Math.hypot(center[0]-position[0],center[1]-position[1],center[2]-position[2])/radius;
      if(q>=1)continue;
      const weight=(1-q*q)**2;
      if(weight>0)visit(this.pIndex(x,y,z),weight);
    }
  }

  private cellAt(point:Vec3):readonly[number,number,number]|undefined{
    const h=this.cellSizeM,o=this.origin;
    const x=Math.floor((point[0]-o[0])/h),y=Math.floor((point[1]-o[1])/h),z=Math.floor((point[2]-o[2])/h);
    return x<0||y<0||z<0||x>=this.nx||y>=this.ny||z>=this.nz?undefined:[x,y,z];
  }
  private validateCell(x:number,y:number,z:number):void{
    if(!Number.isInteger(x)||!Number.isInteger(y)||!Number.isInteger(z)||x<0||y<0||z<0||x>=this.nx||y>=this.ny||z>=this.nz)throw new RangeError('Acoustic cell index out of range');
  }
  private pIndex(x:number,y:number,z:number):number{return x+this.nx*(y+this.ny*z);}
  private vxIndex(x:number,y:number,z:number):number{return x+(this.nx+1)*(y+this.ny*z);}
  private vyIndex(x:number,y:number,z:number):number{return x+this.nx*(y+(this.ny+1)*z);}
  private vzIndex(x:number,y:number,z:number):number{return x+this.nx*(y+this.ny*z);}
}

export function pressurePatchLoad(field:AcousticWaveField,patch:PressurePatch,dt:number):PressurePatchLoad{
  if(!Number.isFinite(dt)||dt<=0)throw new RangeError('Pressure load dt must be positive');
  if(!patch.point.every(Number.isFinite)||!patch.outwardNormal.every(Number.isFinite))throw new TypeError('Pressure patch vectors must be finite');
  if(!Number.isFinite(patch.areaM2)||patch.areaM2<=0)throw new RangeError('Pressure patch area must be positive');
  const coupling=patch.coupling??1;
  if(!Number.isFinite(coupling)||coupling<0||coupling>2)throw new RangeError('Pressure coupling must be in 0..2');
  const normal=V3.normalize(patch.outwardNormal);
  if(V3.length(normal)<.999)throw new TypeError('Pressure patch normal must be non-zero');
  const pressurePa=field.pressureAt(patch.point);
  const forceN=V3.scale(normal,-pressurePa*patch.areaM2*coupling);
  const impulseNs=V3.scale(forceN,dt);
  return Object.freeze({pressurePa,forceN:Object.freeze(forceN) as Vec3,impulseNs:Object.freeze(impulseNs) as Vec3});
}

export function applyPressureLoad(field:AcousticWaveField,target:StructuralImpulseSink,patch:PressurePatch,dt:number):PressurePatchLoad{
  const load=pressurePatchLoad(field,patch,dt);
  if(V3.length(load.impulseNs)>0)target.applyImpulse(patch.point,load.impulseNs,patch.impulseRadiusM);
  return load;
}
