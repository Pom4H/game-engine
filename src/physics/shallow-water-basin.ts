/**
 * Conservative free-surface flow in a tilting finite basin.
 *
 * This is the bulk-water authority: the same sampled height/velocity must
 * drive refraction geometry, buoyancy and displacement. Short dispersive
 * ripples remain a separate surface projection of this state.
 *
 * Staggered pressure update, upwind finite-volume mass transport, closed
 * Neumann walls. Geometry and render effects must not author another water
 * level. Basin coordinates are x/z; +y is local up.
 */
export interface ShallowBasinSpec {
  readonly columns:number;
  readonly rows:number;
  readonly widthM:number;
  readonly lengthM:number;
  readonly depthM:number;
  /** Cell mask in row-major z,x order; non-zero means solid. */
  readonly solid?:Readonly<Uint8Array>;
  readonly dampingPerSecond?:number;
}
export interface ShallowWaterSample {
  readonly heightM:number;
  readonly velocityXMps:number;
  readonly velocityZMps:number;
  readonly slopeX:number;
  readonly slopeZ:number;
}
const G=9.81;
const finitePositive=(value:number,name:string)=>{
  if(!Number.isFinite(value)||value<=0)throw new RangeError(name+' must be finite and positive');
  return value;
};
export class ShallowWaterBasin {
  readonly columns:number;
  readonly rows:number;
  readonly dx:number;
  readonly dz:number;
  readonly widthM:number;
  readonly lengthM:number;
  readonly depth:Float64Array;
  readonly faceX:Float64Array;
  readonly faceZ:Float64Array;
  readonly solid:Uint8Array;
  readonly dampingPerSecond:number;
  private readonly transportX:Float64Array;
  private readonly transportZ:Float64Array;
  readonly initialVolumeM3:number;
  tiltRad=0;
  timeS=0;
  constructor(spec:ShallowBasinSpec){
    const {columns:nx,rows:nz}=spec;
    if(!Number.isInteger(nx)||!Number.isInteger(nz)||nx<4||nz<4||nx*nz>2_000_000)
      throw new RangeError('Basin grid must have 4+ cells on each side');
    this.columns=nx;this.rows=nz;
    this.widthM=finitePositive(spec.widthM,'widthM');
    this.lengthM=finitePositive(spec.lengthM,'lengthM');
    this.dx=this.widthM/nx;this.dz=this.lengthM/nz;
    const initial=finitePositive(spec.depthM,'depthM');
    this.dampingPerSecond=spec.dampingPerSecond??.29;
    if(!Number.isFinite(this.dampingPerSecond)||this.dampingPerSecond<0)throw new RangeError('Invalid damping');
    this.solid=Uint8Array.from(spec.solid??new Uint8Array(nx*nz));
    if(this.solid.length!==nx*nz)throw new RangeError('Solid mask size mismatch');
    this.depth=new Float64Array(nx*nz);
    for(let i=0;i<nx*nz;i++)if(!this.solid[i])this.depth[i]=initial;
    this.faceX=new Float64Array(nz*(nx+1));
    this.faceZ=new Float64Array((nz+1)*nx);
    this.transportX=new Float64Array(this.faceX.length);
    this.transportZ=new Float64Array(this.faceZ.length);
    this.initialVolumeM3=this.volumeM3();
  }
  index(x:number,z:number):number{return z*this.columns+x;}
  volumeM3():number{
    let sum=0;for(let i=0;i<this.depth.length;i++)if(!this.solid[i])sum+=this.depth[i]!;
    return sum*this.dx*this.dz;
  }
  /**
   * The tank rotates in world space while gravity remains world-down.
   * Negative local x acceleration for positive tank roll creates sloshing.
   * The caller owns rotation/angle; physics owns the resulting water state.
   */
  step(dt:number,rollRad:number):void{
    finitePositive(dt,'dt');
    if(!Number.isFinite(rollRad)||Math.abs(rollRad)>.45)throw new RangeError('Invalid tank roll');
    const nx=this.columns,nz=this.rows,h=this.depth,solid=this.solid;
    let maxH=0;
    for(let i=0;i<h.length;i++)if(h[i]!>maxH)maxH=h[i]!;
    if(Math.sqrt(G*maxH)*dt/Math.min(this.dx,this.dz)>.45)
      throw new RangeError('Shallow water CFL limit exceeded');
    const axial=-G*Math.sin(rollRad),normal=G*Math.cos(rollRad);
    const attenuation=Math.exp(-this.dampingPerSecond*dt);
    const ux=this.faceX,uz=this.faceZ,fx=this.transportX,fz=this.transportZ;
    fx.fill(0);fz.fill(0);
    for(let z=0;z<nz;z++)for(let x=1;x<nx;x++){
      const a=z*nx+x-1,b=a+1,face=z*(nx+1)+x;
      if(solid[a]||solid[b]){ux[face]=0;continue;}
      const u=(ux[face]!+dt*(axial-normal*(h[b]!-h[a]!)/this.dx))*attenuation;
      ux[face]=u;fx[face]=u*(u>=0?h[a]!:h[b]!);
    }
    for(let z=1;z<nz;z++)for(let x=0;x<nx;x++){
      const a=(z-1)*nx+x,b=a+nx,face=z*nx+x;
      if(solid[a]||solid[b]){uz[face]=0;continue;}
      const v=(uz[face]!-dt*normal*(h[b]!-h[a]!)/this.dz)*attenuation;
      uz[face]=v;fz[face]=v*(v>=0?h[a]!:h[b]!);
    }
    for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){
      const i=z*nx+x;if(solid[i])continue;
      const fluxX=(fx[z*(nx+1)+x+1]!-fx[z*(nx+1)+x]!)/this.dx;
      const fluxZ=(fz[(z+1)*nx+x]!-fz[z*nx+x]!)/this.dz;
      const next=h[i]!-dt*(fluxX+fluxZ);
      if(next<0)throw new RangeError('Negative water height: refine time step');
      h[i]=next;
    }
    this.tiltRad=rollRad;this.timeS+=dt;
  }
  /** Bilinear spatial sample in basin-local metres, without authoring state. */
  sample(x:number,z:number):ShallowWaterSample{
    if(!Number.isFinite(x)||!Number.isFinite(z))throw new RangeError('Invalid water sample');
    const ix=Math.max(0,Math.min(this.columns-1.000001,(x/this.widthM+.5)*this.columns-.5));
    const iz=Math.max(0,Math.min(this.rows-1.000001,(z/this.lengthM+.5)*this.rows-.5));
    const x0=Math.floor(ix),z0=Math.floor(iz),x1=Math.min(this.columns-1,x0+1),z1=Math.min(this.rows-1,z0+1);
    const fx=ix-x0,fz=iz-z0,nx=this.columns;
    const field=(values:Float64Array)=>{
      const a=values[z0*nx+x0]!,b=values[z0*nx+x1]!,c=values[z1*nx+x0]!,d=values[z1*nx+x1]!;
      return (a*(1-fx)+b*fx)*(1-fz)+(c*(1-fx)+d*fx)*fz;
    };
    const h=field(this.depth);
    const localU=new Float64Array(4),localV=new Float64Array(4);
    const cells:readonly (readonly [number,number])[]=[[x0,z0],[x1,z0],[x0,z1],[x1,z1]];
    for(let k=0;k<4;k++){
      const [cx,cz]=cells[k]!;
      const px=cz*(nx+1)+cx,pz=cz*nx+cx;
      localU[k]=.5*(this.faceX[px]!+this.faceX[px+1]!);
      localV[k]=.5*(this.faceZ[pz]!+this.faceZ[pz+nx]!);
    }
    const mix=(values:Float64Array)=>(values[0]!*(1-fx)+values[1]!*fx)*(1-fz)+(values[2]!*(1-fx)+values[3]!*fx)*fz;
    const sx=(this.depth[z0*nx+x1]!-this.depth[z0*nx+x0]!)*(1-fz)/this.dx+
             (this.depth[z1*nx+x1]!-this.depth[z1*nx+x0]!)*fz/this.dx;
    const sz=(this.depth[z1*nx+x0]!-this.depth[z0*nx+x0]!)*(1-fx)/this.dz+
             (this.depth[z1*nx+x1]!-this.depth[z0*nx+x1]!)*fx/this.dz;
    return{heightM:h,velocityXMps:mix(localU),velocityZMps:mix(localV),slopeX:sx,slopeZ:sz};
  }
}
/**
 * Low-order finite-inertia drift integrator for the Castle Jelly test vessel.
 * A real multi-probe rigid body may replace it while retaining sample() as
 * the authoritative field input, including its world-level orientation.
 */
export class FloatingBasinBoat {
  x:number;
  z:number;
  vx=0;
  vz=0;
  surfaceHeightM=0;
  worldRollRad=0;
  constructor(x:number,z:number,readonly halfLengthM=.64){this.x=x;this.z=z;}
  step(water:ShallowWaterBasin,dt:number):void{
    finitePositive(dt,'dt');
    const sample=water.sample(this.x,this.z);
    const follow=1-Math.exp(-1.8*dt);
    this.vx+=(sample.velocityXMps-this.vx)*follow;
    this.vz+=(sample.velocityZMps-this.vz)*follow;
    this.x+=this.vx*dt;this.z+=this.vz*dt;
    const limit=water.widthM/2-this.halfLengthM;
    if(Math.abs(this.x)>limit){this.x=Math.sign(this.x)*limit;this.vx=0;}
    this.z=Math.max(-water.lengthM/2+this.halfLengthM,Math.min(water.lengthM/2-this.halfLengthM,this.z));
    const at=water.sample(this.x,this.z);
    this.surfaceHeightM=at.heightM;
    // The boat is level in world coordinates when the sloshing fluid has
    // compensated the tank tilt: theta + atan(dh/dx) = approx zero.
    this.worldRollRad=water.tiltRad+Math.atan(at.slopeX);
  }
}
