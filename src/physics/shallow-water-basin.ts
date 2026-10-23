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
  /** Actual substrate elevation in row-major order; dry cells are permitted. */
  readonly bed?:Readonly<Float64Array>;
  readonly openBoundary?:boolean;
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
  readonly bed:Float64Array;
  readonly dampingPerSecond:number;
  private readonly transportX:Float64Array;
  private readonly transportZ:Float64Array;
  private readonly outflowLimits:Float64Array;
  readonly initialVolumeM3:number;
  tiltRad=0;
  escapedVolumeM3=0;
  private readonly openBoundary:boolean;
  timeS=0;
  constructor(spec:ShallowBasinSpec){
    const {columns:nx,rows:nz}=spec;
    if(!Number.isInteger(nx)||!Number.isInteger(nz)||nx<4||nz<4||nx*nz>2_000_000)
      throw new RangeError('Basin grid must have 4+ cells on each side');
    this.columns=nx;this.rows=nz;
    this.openBoundary=spec.openBoundary??false;
    this.widthM=finitePositive(spec.widthM,'widthM');
    this.lengthM=finitePositive(spec.lengthM,'lengthM');
    this.dx=this.widthM/nx;this.dz=this.lengthM/nz;
    const initial=spec.depthM;if(!Number.isFinite(initial)||initial<0)throw new RangeError('Invalid initial water depth');
    this.dampingPerSecond=spec.dampingPerSecond??.29;
    if(!Number.isFinite(this.dampingPerSecond)||this.dampingPerSecond<0)throw new RangeError('Invalid damping');
    this.solid=Uint8Array.from(spec.solid??new Uint8Array(nx*nz));
    if(this.solid.length!==nx*nz)throw new RangeError('Solid mask size mismatch');
    this.bed=Float64Array.from(spec.bed??new Float64Array(nx*nz));
    if(this.bed.length!==nx*nz||!this.bed.every(Number.isFinite))throw new RangeError('Invalid water bed');
    this.depth=new Float64Array(nx*nz);
    for(let i=0;i<nx*nz;i++)if(!this.solid[i])this.depth[i]=initial;
    this.faceX=new Float64Array(nz*(nx+1));
    this.faceZ=new Float64Array((nz+1)*nx);
    this.transportX=new Float64Array(this.faceX.length);
    this.transportZ=new Float64Array(this.faceZ.length);
    this.outflowLimits=new Float64Array(this.depth.length);
    this.initialVolumeM3=this.volumeM3();
  }
  index(x:number,z:number):number{return z*this.columns+x;}
  volumeM3():number{
    let sum=0;for(let i=0;i<this.depth.length;i++)if(!this.solid[i])sum+=this.depth[i]!;
    return sum*this.dx*this.dz;
  }
  addVolume(x:number,z:number,volumeM3:number):boolean{
    if(![x,z,volumeM3].every(Number.isFinite)||volumeM3<0)throw new RangeError('Invalid water source');
    const ix=Math.floor((x/this.widthM+.5)*this.columns),iz=Math.floor((z/this.lengthM+.5)*this.rows);
    if(ix<0||iz<0||ix>=this.columns||iz>=this.rows||this.solid[this.index(ix,iz)])return false;
    this.depth[this.index(ix,iz)]!+=volumeM3/(this.dx*this.dz);return true;
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
    let maxH=0,dry=true;
    for(let i=0;i<h.length;i++){if(h[i]!>maxH)maxH=h[i]!;if(h[i]!==0||!Number.isFinite(this.bed[i]))dry=false;}
    if(Math.sqrt(G*maxH)*dt/Math.min(this.dx,this.dz)>.45)
      throw new RangeError('Shallow water CFL limit exceeded');
    const ux=this.faceX,uz=this.faceZ,fx=this.transportX,fz=this.transportZ;
    fx.fill(0);fz.fill(0);
    // A genuinely empty free surface cannot exchange mass or carry an
    // interior velocity, irrespective of finite substrate slope or tank roll.
    // Preserve boundary velocities, signed transport zeros, solid cells and
    // the exact clock increment of the ordinary solver (including wet→dry).
    if(dry){
      for(let z=0;z<nz;z++)ux.fill(0,z*(nx+1)+1,z*(nx+1)+nx);
      uz.fill(0,nx,nz*nx);
      for(let i=0;i<h.length;i++)if(!solid[i])h[i]=0;
      if(this.openBoundary){
        for(let z=0;z<nz;z++)fx[z*(nx+1)]=-0;
        for(let x=0;x<nx;x++)fz[x]=-0;
        this.escapedVolumeM3+=0;
      }
      this.tiltRad=rollRad;this.timeS+=dt;return;
    }
    const axial=-G*Math.sin(rollRad),normal=G*Math.cos(rollRad);
    const attenuation=Math.exp(-this.dampingPerSecond*dt);
    if(this.openBoundary){
      for(let z=0;z<nz;z++){const a=z*nx,b=a+nx-1;fx[z*(nx+1)]=-h[a]!*Math.sqrt(G*h[a]!);fx[z*(nx+1)+nx]=h[b]!*Math.sqrt(G*h[b]!);}
      for(let x=0;x<nx;x++){fz[x]=-h[x]!*Math.sqrt(G*h[x]!);const i=(nz-1)*nx+x;fz[nz*nx+x]=h[i]!*Math.sqrt(G*h[i]!);}
    }
    for(let z=0;z<nz;z++)for(let x=1;x<nx;x++){
      const a=z*nx+x-1,b=a+1,face=z*(nx+1)+x;
      if(solid[a]||solid[b]){ux[face]=0;continue;}
      const ha=h[a]!+this.bed[a]!,hb=h[b]!+this.bed[b]!,crest=Math.max(this.bed[a]!,this.bed[b]!);
      if(Math.max(ha,hb)<=crest+1e-12){ux[face]=0;continue;}
      const u=(ux[face]!+dt*(axial-normal*(hb-ha)/this.dx))*attenuation;
      ux[face]=u;fx[face]=u*Math.max(0,(u>=0?ha:hb)-crest);
    }
    for(let z=1;z<nz;z++)for(let x=0;x<nx;x++){
      const a=(z-1)*nx+x,b=a+nx,face=z*nx+x;
      if(solid[a]||solid[b]){uz[face]=0;continue;}
      const ha=h[a]!+this.bed[a]!,hb=h[b]!+this.bed[b]!,crest=Math.max(this.bed[a]!,this.bed[b]!);
      if(Math.max(ha,hb)<=crest+1e-12){uz[face]=0;continue;}
      const v=(uz[face]!-dt*normal*(hb-ha)/this.dz)*attenuation;
      uz[face]=v;fz[face]=v*Math.max(0,(v>=0?ha:hb)-crest);
    }
    // A dry front may request more outflow than a cell contains. Limit all
    // outgoing faces together; the identical shared flux enters its neighbour.
    const limits=this.outflowLimits;limits.fill(1);
    for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){
      const i=z*nx+x,out=(Math.max(0,fx[z*(nx+1)+x+1]!)+Math.max(0,-fx[z*(nx+1)+x]!))/this.dx+(Math.max(0,fz[(z+1)*nx+x]!)+Math.max(0,-fz[z*nx+x]!))/this.dz;
      if(out>0)limits[i]=Math.min(1,h[i]!/(dt*out));
    }
    for(let z=0;z<nz;z++)for(let x=1;x<nx;x++){const face=z*(nx+1)+x;fx[face]!*=limits[z*nx+x-(fx[face]!>=0?1:0)]!;}
    for(let z=1;z<nz;z++)for(let x=0;x<nx;x++){const face=z*nx+x;fz[face]!*=limits[(z-(fz[face]!>=0?1:0))*nx+x]!;}
    if(this.openBoundary){
      for(let z=0;z<nz;z++){fx[z*(nx+1)]!*=limits[z*nx]!;fx[z*(nx+1)+nx]!*=limits[z*nx+nx-1]!;this.escapedVolumeM3+=dt*this.dz*(fx[z*(nx+1)+nx]!-fx[z*(nx+1)]!);}
      for(let x=0;x<nx;x++){fz[x]!*=limits[x]!;fz[nz*nx+x]!*=limits[(nz-1)*nx+x]!;this.escapedVolumeM3+=dt*this.dx*(fz[nz*nx+x]!-fz[x]!);}
    }
    for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){
      const i=z*nx+x;if(solid[i])continue;
      const fluxX=(fx[z*(nx+1)+x+1]!-fx[z*(nx+1)+x]!)/this.dx;
      const fluxZ=(fz[(z+1)*nx+x]!-fz[z*nx+x]!)/this.dz;
      const next=h[i]!-dt*(fluxX+fluxZ);
      if(next< -1e-10)throw new RangeError('Negative water height: refine time step');
      h[i]=Math.max(0,next);
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
    const h=field(this.depth)+field(this.bed);
    const localU=new Float64Array(4),localV=new Float64Array(4);
    const cells:readonly (readonly [number,number])[]=[[x0,z0],[x1,z0],[x0,z1],[x1,z1]];
    for(let k=0;k<4;k++){
      const [cx,cz]=cells[k]!;
      const px=cz*(nx+1)+cx,pz=cz*nx+cx;
      localU[k]=.5*(this.faceX[px]!+this.faceX[px+1]!);
      localV[k]=.5*(this.faceZ[pz]!+this.faceZ[pz+nx]!);
    }
    const mix=(values:Float64Array)=>(values[0]!*(1-fx)+values[1]!*fx)*(1-fz)+(values[2]!*(1-fx)+values[3]!*fx)*fz;
    const eta=(x:number,z:number)=>this.depth[z*nx+x]!+this.bed[z*nx+x]!;
    const sx=(eta(x1,z0)-eta(x0,z0))*(1-fz)/this.dx+(eta(x1,z1)-eta(x0,z1))*fz/this.dx;
    const sz=(eta(x0,z1)-eta(x0,z0))*(1-fx)/this.dz+(eta(x1,z1)-eta(x1,z0))*fx/this.dz;
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
